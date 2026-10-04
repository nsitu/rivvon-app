import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../types/hono';
import { getCookie, buildCookieString, isLocalDev } from '../utils/cookies';
import { verifySessionToken, type SessionUser } from '../utils/session';
import { openPhotosCookie, sealPhotosCookie } from '../utils/photosCredentials';
import { normalizeSourceProvenance } from '../utils/sourceProvenance';

export const PHOTOS_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
export const MAX_PHOTOS_VIDEO_BYTES = 2048 * 1024 * 1024;
const PICKER_API = 'https://photospicker.googleapis.com/v1';
const COOKIE_PATH = '/api/auth';
type Flow = { state: string; attempt: string; userId: string; googleId: string; expiresAt: number; continueToPicker?: boolean };
type Grant = { accessToken: string; attempt: string; userId: string; googleId: string; expiresAt: number };
type Outcome = { attempt: string; userId: string; error: string; expiresAt: number };
type PickerSession = { id: string; pickerUri: string; expireTime?: string; pollingConfig?: { pollInterval?: string; timeoutIn?: string }; mediaItemsSet: boolean };
type PendingPicker = { attempt: string; userId: string; googleId: string; session: PickerSession; expiresAt: number };

function setCookie(c: Context<AppEnv>, name: string, value: string, maxAge: number, sameSite?: 'Lax') {
    c.header('Set-Cookie', buildCookieString(name, value, {
        path: COOKIE_PATH, maxAge, isLocalDev: isLocalDev(c), ...(sameSite ? { sameSite } : {}),
    }), { append: true });
}

async function sessionUser(c: Context<AppEnv>) {
    const token = getCookie(c, 'session');
    return token ? verifySessionToken(token, c.env.SESSION_SECRET) : null;
}

async function grantFor(c: Context<AppEnv>, user: SessionUser) {
    const grant = await openPhotosCookie<Grant>(getCookie(c, 'photos_grant'), c.env.SESSION_SECRET, 'photos-grant');
    return grant?.userId === user.id && grant.googleId === user.googleId && grant.expiresAt > Date.now() + 30000 ? grant : null;
}

function finishPage(c: Context<AppEnv>, success: boolean) {
    c.header('Cache-Control', 'no-store');
    c.header('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    return c.html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Rivvon Google Photos</title><body><p>${success ? 'Google Photos is connected.' : 'Google Photos was not connected.'} Return to Rivvon. You can close this tab.</p><script>window.close()</script></body></html>`);
}

// Uses the already-registered callback URI, with a separate encrypted flow cookie.
export async function finishPhotosAuthorization(c: Context<AppEnv>) {
    const flow = await openPhotosCookie<Flow>(getCookie(c, 'photos_flow'), c.env.SESSION_SECRET, 'photos-flow');
    setCookie(c, 'photos_flow', '', 0, 'Lax');
    const user = await sessionUser(c);
    if (!flow || !user || flow.userId !== user.id || flow.googleId !== user.googleId || c.req.query('state') !== flow.state) {
        return finishPage(c, false);
    }
    let error = 'Unable to connect Google Photos. Please try again.';
    try {
        if (c.req.query('error')) throw new Error('Google Photos permission was declined.');
        const code = c.req.query('code');
        if (!code) throw new Error(error);
        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ code, client_id: c.env.GOOGLE_CLIENT_ID, client_secret: c.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: `${c.env.API_URL}/api/auth/callback`, grant_type: 'authorization_code' }),
            signal: AbortSignal.timeout(30000),
        });
        const tokens = await response.json() as { access_token?: string; expires_in?: number; scope?: string };
        if (!response.ok || !tokens.access_token || !tokens.scope?.split(' ').includes(PHOTOS_SCOPE)) {
            throw new Error('Google Photos permission was not granted.');
        }
        // Get identity from Google's authenticated endpoint, not an unverified
        // browser assertion, and reject account changes without touching login.
        const identityResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(30000),
        });
        const identity = await identityResponse.json() as { sub?: string };
        if (!identityResponse.ok || identity.sub !== user.googleId) throw new Error('Choose the same Google account you used to sign in to Rivvon.');
        const lifetime = Math.min(Math.max(Number(tokens.expires_in) || 3600, 1), 3600);
        const grant: Grant = { accessToken: tokens.access_token, attempt: flow.attempt, userId: user.id,
            googleId: user.googleId, expiresAt: Date.now() + lifetime * 1000 };
        const cookie = await sealPhotosCookie(grant, c.env.SESSION_SECRET, 'photos-grant');
        if (cookie.length > 3800) throw new Error('Google Photos returned credentials that cannot be stored.');
        setCookie(c, 'photos_grant', cookie, lifetime);
        if (flow.continueToPicker) {
            error = 'Google Photos connected, but the picker could not open. Please try again.';
            const session = await createPickerSession(tokens.access_token);
            try {
                const pending: PendingPicker = { attempt: flow.attempt, userId: user.id, googleId: user.googleId,
                    session, expiresAt: Date.now() + 600000 };
                const sealed = await sealPhotosCookie(pending, c.env.SESSION_SECRET, 'photos-picker');
                if (sealed.length > 3800) throw new Error('Picker session is too large.');
                setCookie(c, 'photos_picker', sealed, 600);
            } catch (failure) {
                await pickerRequest(tokens.access_token, `/sessions/${encodeURIComponent(session.id)}`, 'DELETE').catch(() => {});
                throw failure;
            }
            setCookie(c, 'photos_outcome', '', 0);
            c.header('Cache-Control', 'private, no-store');
            return c.redirect(`${session.pickerUri.replace(/\/$/, '')}/autoclose`);
        }
        setCookie(c, 'photos_outcome', '', 0);
        return finishPage(c, true);
    } catch (e) {
        // Do not expose or log upstream response bodies or credentials.
        if (e instanceof Error && ['Google Photos permission was declined.', 'Google Photos permission was not granted.',
            'Choose the same Google account you used to sign in to Rivvon.'].includes(e.message)) error = e.message;
        const outcome: Outcome = { attempt: flow.attempt, userId: user.id, error, expiresAt: Date.now() + 600000 };
        setCookie(c, 'photos_outcome', await sealPhotosCookie(outcome, c.env.SESSION_SECRET, 'photos-outcome'), 600);
        return finishPage(c, false);
    }
}

export const photosRoutes = new Hono<AppEnv>();
photosRoutes.onError((error, c) => {
    const status = error instanceof PhotosError ? error.status : 502;
    if (status === 403) setCookie(c, 'photos_grant', '', 0);
    return c.json({ error: error instanceof PhotosError ? error.message : 'Google Photos import failed. Please try again.',
        ...(status === 403 ? { needsPhotosAuth: true } : {}) }, status);
});
photosRoutes.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    c.header('Vary', 'Origin, Cookie');
    const user = await sessionUser(c);
    if (!user) return c.json({ error: 'Sign in to Rivvon before importing from Google Photos.' }, 401);
    if (!['GET', 'HEAD'].includes(c.req.method)) {
        const allowed = c.env.CORS_ORIGINS?.split(',') || ['https://rivvon.ca', 'https://slyce.rivvon.ca'];
        if (!allowed.includes(c.req.header('Origin') || '')) return c.json({ error: 'Invalid request origin.' }, 403);
    }
    c.set('auth', { userId: user.id, googleId: user.googleId, email: user.email, name: user.name });
    if (!c.req.path.endsWith('/connect') && !c.req.path.endsWith('/authorization') && !await grantFor(c, user)) {
        return c.json({ error: 'Connect Google Photos to import a video.', needsPhotosAuth: true }, 403);
    }
    await next();
});

photosRoutes.get('/connect', async (c) => {
    const attempt = c.req.query('attempt') || '';
    if (!/^[a-f0-9-]{36}$/i.test(attempt)) return c.json({ error: 'Invalid authorization attempt.' }, 400);
    const user = (await sessionUser(c))!;
    const flow: Flow = { state: crypto.randomUUID(), attempt, userId: user.id, googleId: user.googleId,
        expiresAt: Date.now() + 600000, continueToPicker: c.req.query('picker') === '1' };
    setCookie(c, 'photos_flow', await sealPhotosCookie(flow, c.env.SESSION_SECRET, 'photos-flow'), 600, 'Lax');
    setCookie(c, 'photos_outcome', '', 0);
    setCookie(c, 'photos_picker', '', 0);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: c.env.GOOGLE_CLIENT_ID, redirect_uri: `${c.env.API_URL}/api/auth/callback`,
        response_type: 'code', scope: `openid email profile ${PHOTOS_SCOPE}`, include_granted_scopes: 'true',
        login_hint: user.email, state: flow.state }).toString();
    return c.redirect(url.toString());
});

photosRoutes.get('/authorization', async (c) => {
    const user = (await sessionUser(c))!;
    const grant = await grantFor(c, user);
    const attempt = c.req.query('attempt');
    const outcome = await openPhotosCookie<Outcome>(getCookie(c, 'photos_outcome'), c.env.SESSION_SECRET, 'photos-outcome');
    const pending = attempt ? await openPhotosCookie<PendingPicker>(getCookie(c, 'photos_picker'), c.env.SESSION_SECRET, 'photos-picker') : null;
    return c.json({ connected: !!grant && (!attempt || grant.attempt === attempt),
        pickerSession: grant && pending && grant.attempt === attempt && pending.attempt === attempt
            && pending.userId === user.id && pending.googleId === user.googleId ? pending.session : null,
        error: outcome?.userId === user.id && outcome.attempt === attempt ? outcome.error : null });
});

class PhotosError extends Error {
    constructor(message: string, public status: 400 | 403 | 404 | 413 | 429 | 502 = 502) { super(message); }
}

async function pickerRequest(token: string, path: string, method = 'GET', body?: object) {
    const response = await fetch(`${PICKER_API}${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
    });
    if (response.status === 401 || response.status === 403) throw new PhotosError('Reconnect Google Photos to continue.', 403);
    if (response.status === 404) throw new PhotosError('The selection session has expired. Choose the video again.', 404);
    if (response.status === 429) throw new PhotosError('Google Photos is busy. Please try again shortly.', 429);
    if (!response.ok) throw new PhotosError('Google Photos could not complete this request. Please try again.');
    return response.status === 204 ? {} : response.json() as Promise<any>;
}

async function token(c: Context<AppEnv>) { return (await grantFor(c, (await sessionUser(c))!))!.accessToken; }
function sessionPath(c: Context<AppEnv>) { return `/sessions/${encodeURIComponent(c.req.param('sessionId'))}`; }

async function createPickerSession(accessToken: string): Promise<PickerSession> {
    const result = await pickerRequest(accessToken, '/sessions', 'POST', { pickingConfig: { maxItemCount: '1' } });
    const uri = new URL(result.pickerUri);
    if (uri.protocol !== 'https:' || uri.hostname !== 'photos.google.com' || uri.username || uri.password || uri.port
        || typeof result.id !== 'string' || !result.id || result.id.length > 512) throw new PhotosError('Google Photos returned an invalid selection session.');
    return { id: result.id, pickerUri: result.pickerUri, mediaItemsSet: result.mediaItemsSet === true,
        ...(typeof result.expireTime === 'string' ? { expireTime: result.expireTime } : {}),
        ...(result.pollingConfig ? { pollingConfig: { pollInterval: result.pollingConfig.pollInterval, timeoutIn: result.pollingConfig.timeoutIn } } : {}) };
}

photosRoutes.post('/sessions', async (c) => c.json(await createPickerSession(await token(c))));
photosRoutes.get('/sessions/:sessionId', async (c) => c.json(await pickerRequest(await token(c), sessionPath(c))));
photosRoutes.delete('/sessions/:sessionId', async (c) => {
    await pickerRequest(await token(c), sessionPath(c), 'DELETE');
    const pending = await openPhotosCookie<PendingPicker>(getCookie(c, 'photos_picker'), c.env.SESSION_SECRET, 'photos-picker');
    if (pending?.session.id === c.req.param('sessionId') && pending.userId === c.get('auth').userId) setCookie(c, 'photos_picker', '', 0);
    return c.json({ success: true });
});

async function selectedVideo(c: Context<AppEnv>) {
    const accessToken = await token(c);
    const session = await pickerRequest(accessToken, sessionPath(c));
    if (!session.mediaItemsSet) throw new PhotosError('Finish selecting your video in Google Photos first.', 400);
    const items = await pickerRequest(accessToken, `/mediaItems?${new URLSearchParams({ sessionId: c.req.param('sessionId'), pageSize: '2' })}`);
    if (items.nextPageToken || items.mediaItems?.length !== 1 || items.mediaItems[0].type !== 'VIDEO') {
        throw new PhotosError('Please select one video rather than a photo.', 400);
    }
    const item = items.mediaItems[0];
    const meta = item.mediaFile?.mediaFileMetadata;
    if (meta?.videoMetadata?.processingStatus !== 'READY') throw new PhotosError('This video is still processing in Google Photos or is unavailable. Choose a ready video.', 400);
    const provenance = normalizeSourceProvenance({ version: 1, provider: 'google-photos', mediaItemId: item.id,
        createTime: item.createTime, originalFilename: item.mediaFile.filename, reportedMimeType: item.mediaFile.mimeType,
        reportedWidth: meta.width, reportedHeight: meta.height, reportedFps: meta.videoMetadata.fps,
        cameraMake: meta.cameraMake, cameraModel: meta.cameraModel, importedAt: new Date().toISOString() });
    return { item, provenance, accessToken };
}

photosRoutes.get('/sessions/:sessionId/video', async (c) => {
    const { provenance } = await selectedVideo(c);
    return c.json({ provenance, maxBytes: MAX_PHOTOS_VIDEO_BYTES });
});

export function googleMediaUrl(baseUrl: string): string {
    validateGoogleMediaUrl(baseUrl);
    return `${baseUrl}=dv`;
}

function validateGoogleMediaUrl(address: string) {
    const url = new URL(address);
    if (url.protocol !== 'https:' || !(url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com')) || url.username || url.password || url.port) {
        throw new PhotosError('Google Photos returned an invalid media address.');
    }
    return url;
}

async function fetchMedia(address: string, accessToken: string, signal: AbortSignal) {
    // Follow only validated Google media redirects, never arbitrary hosts.
    for (let hop = 0; hop < 5; hop++) {
        validateGoogleMediaUrl(address);
        const response = await fetch(address, { headers: { Authorization: `Bearer ${accessToken}` }, signal, redirect: 'manual' });
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        const location = response.headers.get('Location');
        await response.body?.cancel();
        if (!location) throw new PhotosError('Google Photos returned an invalid media redirect.');
        address = new URL(location, address).toString();
    }
    throw new PhotosError('Google Photos returned too many media redirects.');
}

photosRoutes.get('/sessions/:sessionId/video/bytes', async (c) => {
    const { item, accessToken } = await selectedVideo(c);
    const controller = new AbortController();
    const abort = () => controller.abort();
    c.req.raw.signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 5 * 60 * 1000);
    const cleanup = () => { clearTimeout(timeout); c.req.raw.signal.removeEventListener('abort', abort); };
    try {
        if (c.req.raw.signal.aborted) controller.abort();
        const upstream = await fetchMedia(googleMediaUrl(item.mediaFile.baseUrl), accessToken, controller.signal);
        if (upstream.status === 401 || upstream.status === 403) throw new PhotosError('Reconnect Google Photos to download this video.', 403);
        if (!upstream.ok || !upstream.body) throw new PhotosError('Unable to download this video from Google Photos.');
        const length = Number(upstream.headers.get('Content-Length'));
        if (length > MAX_PHOTOS_VIDEO_BYTES) { controller.abort(); throw new PhotosError('Choose a video no larger than 2048 MiB.', 413); }
        const contentType = (upstream.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
        if (!['video/mp4', 'video/webm', 'video/quicktime', 'application/octet-stream', ''].includes(contentType)) {
            controller.abort(); throw new PhotosError('Google Photos did not return a supported video.');
        }
        const reader = upstream.body.getReader();
        let received = 0;
        const stream = new ReadableStream<Uint8Array>({
            async pull(target) {
                try {
                    const chunk = await reader.read();
                    if (chunk.done) { cleanup(); target.close(); return; }
                    received += chunk.value.byteLength;
                    if (received > MAX_PHOTOS_VIDEO_BYTES) throw new Error('Video exceeds the import limit.');
                    target.enqueue(chunk.value);
                } catch (error) { cleanup(); controller.abort(); target.error(error); }
            },
            async cancel() { cleanup(); controller.abort(); await reader.cancel().catch(() => {}); },
        });
        return new Response(stream, { headers: {
            'Content-Type': contentType || 'application/octet-stream', 'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff', ...(length > 0 ? { 'Content-Length': String(length) } : {}),
        } });
    } catch (error) { cleanup(); controller.abort(); throw error; }
});
