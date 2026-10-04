import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { photosRoutes, MAX_PHOTOS_VIDEO_BYTES, googleMediaUrl, PHOTOS_SCOPE } from './photos';
import { authRoutes } from './auth';
import { createSessionToken } from '../utils/session';
import { openPhotosCookie, sealPhotosCookie } from '../utils/photosCredentials';

const env = { SESSION_SECRET: 'test-secret-for-photos', GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-client-secret',
    API_URL: 'https://api.rivvon.ca', APP_URL: 'https://rivvon.ca', CORS_ORIGINS: 'https://rivvon.ca' } as any;
const user = { id: 'owner', googleId: 'google-owner', email: 'owner@example.com', name: 'Owner' };
const attempt = '12345678-1234-1234-1234-123456789abc';
const video = { id: 'original-id', type: 'VIDEO', createTime: '2020-05-01T10:00:00Z', mediaFile: {
    filename: 'original.mov', mimeType: 'video/quicktime', baseUrl: 'https://lh3.googleusercontent.com/video',
    mediaFileMetadata: { width: 1920, height: 1080, videoMetadata: { fps: 30, processingStatus: 'READY' } },
} };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function cookieFrom(response: Response, name: string) {
    return response.headers.get('Set-Cookie')?.match(new RegExp(`${name}=([^;,]*)`))?.[1];
}

describe('Photos import authorization and transfer', () => {
    let cookie: string;
    let session: string;
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(async () => {
        session = await createSessionToken(user, env.SESSION_SECRET);
        const grant = await sealPhotosCookie({ userId: user.id, googleId: user.googleId, accessToken: 'photos-access', attempt,
            expiresAt: Date.now() + 3600000 }, env.SESSION_SECRET, 'photos-grant');
        cookie = `session=${session}; photos_grant=${grant}`;
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => vi.unstubAllGlobals());
    const headers = (cookie: string) => ({ Cookie: cookie, Origin: 'https://rivvon.ca' });

    it('requires login, Photos consent, and an allowed mutation origin', async () => {
        expect((await photosRoutes.request('/sessions', { method: 'POST' }, env)).status).toBe(401);
        expect((await photosRoutes.request('/sessions', { method: 'POST', headers: headers(`session=${session}`) }, env)).status).toBe(403);
        expect((await photosRoutes.request('/sessions', { method: 'POST', headers: { ...headers(cookie), Origin: 'https://other.example' } }, env)).status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('binds the encrypted grant to the signed-in Google account', async () => {
        const grant = await sealPhotosCookie({ userId: user.id, googleId: 'another-account', accessToken: 'wrong-token', expiresAt: Date.now() + 3600000 }, env.SESSION_SECRET, 'photos-grant');
        expect((await photosRoutes.request('/sessions', { method: 'POST', headers: headers(`session=${session}; photos_grant=${grant}`) }, env)).status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('requests one item and never exposes access tokens', async () => {
        fetchMock.mockResolvedValue(json({ id: 'picker-session', pickerUri: 'https://photos.google.com/picker', mediaItemsSet: false }));
        const response = await photosRoutes.request('/sessions', { method: 'POST', headers: headers(cookie) }, env);
        expect(response.status).toBe(200);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ pickingConfig: { maxItemCount: '1' } });
        expect(await response.text()).not.toContain('photos-access');
    });
    it('checks existing permission without requiring a staged picker or an attempt', async () => {
        const response = await photosRoutes.request('/authorization', { headers: headers(cookie) }, env);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ connected: true, pickerSession: null, error: null });
    });
    it('returns a reauthorization error on revoked Google access', async () => {
        fetchMock.mockResolvedValue(json({}, 403));
        const response = await photosRoutes.request('/sessions/id', { headers: headers(cookie) }, env);
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ needsPhotosAuth: true });
        expect(response.headers.get('Set-Cookie')).toContain('photos_grant=;');
    });
    it.each([
        { ...video, type: 'PHOTO' },
        { ...video, mediaFile: { ...video.mediaFile, mediaFileMetadata: { videoMetadata: { processingStatus: 'PROCESSING' } } } },
    ])('rejects photos and unfinished videos before downloading', async (item) => {
        fetchMock.mockResolvedValueOnce(json({ mediaItemsSet: true })).mockResolvedValueOnce(json({ mediaItems: [item] }));
        const response = await photosRoutes.request('/sessions/id/video/bytes', { headers: headers(cookie) }, env);
        expect(response.status).toBe(400);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    it('returns source facts without expiring URLs', async () => {
        fetchMock.mockResolvedValueOnce(json({ mediaItemsSet: true })).mockResolvedValueOnce(json({ mediaItems: [video] }));
        const response = await photosRoutes.request('/sessions/id/video', { headers: headers(cookie) }, env);
        expect(await response.json()).toMatchObject({ provenance: { mediaItemId: 'original-id', originalFilename: 'original.mov', reportedFps: 30 } });
        expect(response.headers.get('Cache-Control')).toContain('no-store');
    });
    it('streams video bytes with server-side authorization', async () => {
        fetchMock.mockResolvedValueOnce(json({ mediaItemsSet: true })).mockResolvedValueOnce(json({ mediaItems: [video] }))
            .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '3' } }));
        const response = await photosRoutes.request('/sessions/id/video/bytes', { headers: headers(cookie) }, env);
        expect(response.status).toBe(200);
        expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
        expect(fetchMock.mock.calls[2][0]).toBe('https://lh3.googleusercontent.com/video=dv');
        expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer photos-access');
    });
    it('rejects oversized videos before forwarding bytes', async () => {
        fetchMock.mockResolvedValueOnce(json({ mediaItemsSet: true })).mockResolvedValueOnce(json({ mediaItems: [video] }))
            .mockResolvedValueOnce(new Response('video', { headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(MAX_PHOTOS_VIDEO_BYTES + 1) } }));
        expect((await photosRoutes.request('/sessions/id/video/bytes', { headers: headers(cookie) }, env)).status).toBe(413);
    });
    it('does not forward bearer credentials to a redirect outside Google media', async () => {
        fetchMock.mockResolvedValueOnce(json({ mediaItemsSet: true })).mockResolvedValueOnce(json({ mediaItems: [video] }))
            .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://attacker.example/video' } }));
        const response = await photosRoutes.request('/sessions/id/video/bytes', { headers: headers(cookie) }, env);
        expect(response.status).toBe(502);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    async function connect(continueToPicker = false) {
        const response = await authRoutes.request(`/photos/connect?attempt=${attempt}${continueToPicker ? '&picker=1' : ''}`, { headers: headers(cookie) }, env);
        const flow = cookieFrom(response, 'photos_flow')!;
        const state = new URL(response.headers.get('Location')!).searchParams.get('state')!;
        return { flow, state, response };
    }
    it('clears a stale Photos flow when starting the normal login', async () => {
        const response = await authRoutes.request('/login', { headers: headers(cookie) }, env);
        expect(response.status).toBe(302);
        expect(cookieFrom(response, 'oauth_state')).toBeTruthy();
        expect(response.headers.get('Set-Cookie')).toContain('photos_flow=; Max-Age=0;');
    });
    it('uses the existing callback and does not request offline Drive credentials', async () => {
        const { response } = await connect();
        const url = new URL(response.headers.get('Location')!);
        expect(url.searchParams.get('redirect_uri')).toBe(`${env.API_URL}/api/auth/callback`);
        expect(url.searchParams.get('scope')).toContain(PHOTOS_SCOPE);
        expect(url.searchParams.get('access_type')).not.toBe('offline');
    });
    it('declining Photos leaves the login and Drive cookies intact', async () => {
        const { flow, state } = await connect();
        const response = await authRoutes.request(`/callback?state=${state}&error=access_denied`, { headers: headers(`${cookie}; photos_flow=${flow}; google_refresh_token=drive-token`) }, env);
        expect(response.headers.get('Set-Cookie')).not.toMatch(/(?:^|, )session=|google_refresh_token=/);
        const outcome = await openPhotosCookie<any>(cookieFrom(response, 'photos_outcome'), env.SESSION_SECRET, 'photos-outcome');
        expect(outcome.error).toContain('declined');
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('rejects a mismatched OAuth state without exchanging a code', async () => {
        const { flow } = await connect();
        const response = await authRoutes.request('/callback?state=bad&code=code', { headers: headers(`${cookie}; photos_flow=${flow}`) }, env);
        expect(cookieFrom(response, 'photos_grant')).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('rejects a different Google identity without replacing Rivvon login', async () => {
        const { flow, state } = await connect();
        fetchMock.mockResolvedValueOnce(json({ access_token: 'new-access', scope: `openid ${PHOTOS_SCOPE}`, expires_in: 3600 }))
            .mockResolvedValueOnce(json({ sub: 'different-google-user' }));
        const response = await authRoutes.request(`/callback?state=${state}&code=code`, { headers: headers(`${cookie}; photos_flow=${flow}`) }, env);
        expect(cookieFrom(response, 'photos_grant')).toBeUndefined();
        const outcome = await openPhotosCookie<any>(cookieFrom(response, 'photos_outcome'), env.SESSION_SECRET, 'photos-outcome');
        expect(outcome.error).toContain('same Google account');
    });
    it('stores only an encrypted short-lived grant on successful incremental consent', async () => {
        const { flow, state } = await connect();
        fetchMock.mockResolvedValueOnce(json({ access_token: 'new-access', scope: `openid ${PHOTOS_SCOPE}`, expires_in: 3600 }))
            .mockResolvedValueOnce(json({ sub: user.googleId }));
        const response = await authRoutes.request(`/callback?state=${state}&code=code`, { headers: headers(`${cookie}; photos_flow=${flow}`) }, env);
        const raw = response.headers.get('Set-Cookie')!;
        expect(raw).not.toContain('new-access');
        expect(raw).not.toContain('google_refresh_token');
        const grant = await openPhotosCookie<any>(cookieFrom(response, 'photos_grant'), env.SESSION_SECRET, 'photos-grant');
        expect(grant).toMatchObject({ accessToken: 'new-access', userId: user.id, attempt });
    });

    it('continues from consent into the picker in the same window and exposes its session to Rivvon', async () => {
        const { flow, state } = await connect(true);
        const picker = { id: 'picker-session', pickerUri: 'https://photos.google.com/picker/selection', mediaItemsSet: false,
            pollingConfig: { pollInterval: '2s', timeoutIn: '600s' } };
        fetchMock.mockResolvedValueOnce(json({ access_token: 'new-access', scope: `openid ${PHOTOS_SCOPE}`, expires_in: 3600 }))
            .mockResolvedValueOnce(json({ sub: user.googleId })).mockResolvedValueOnce(json(picker));
        const response = await authRoutes.request(`/callback?state=${state}&code=code`, { headers: headers(`${cookie}; photos_flow=${flow}`) }, env);
        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe(`${picker.pickerUri}/autoclose`);
        const updatedCookies = `session=${session}; photos_grant=${cookieFrom(response, 'photos_grant')}; photos_picker=${cookieFrom(response, 'photos_picker')}`;
        const status = await photosRoutes.request(`/authorization?attempt=${attempt}`, { headers: headers(updatedCookies) }, env);
        expect(await status.json()).toMatchObject({ connected: true, pickerSession: picker, error: null });
        const otherAttempt = await photosRoutes.request('/authorization?attempt=different', { headers: headers(updatedCookies) }, env);
        expect(await otherAttempt.json()).toMatchObject({ connected: false, pickerSession: null });
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
        const deleted = await photosRoutes.request('/sessions/picker-session', { method: 'DELETE', headers: headers(updatedCookies) }, env);
        expect(deleted.headers.get('Set-Cookie')).toContain('photos_picker=; Max-Age=0');
    });

    it('does not return a staged session belonging to another account', async () => {
        const pending = await sealPhotosCookie({ attempt, userId: 'another-owner', googleId: 'another-google-user',
            session: { id: 'private-selection' }, expiresAt: Date.now() + 600000 }, env.SESSION_SECRET, 'photos-picker');
        const response = await photosRoutes.request(`/authorization?attempt=${attempt}`, { headers: headers(`${cookie}; photos_picker=${pending}`) }, env);
        expect(await response.json()).toMatchObject({ connected: true, pickerSession: null });
    });

    it('reports a picker creation failure while preserving the new Photos grant', async () => {
        const { flow, state } = await connect(true);
        fetchMock.mockResolvedValueOnce(json({ access_token: 'new-access', scope: `openid ${PHOTOS_SCOPE}`, expires_in: 3600 }))
            .mockResolvedValueOnce(json({ sub: user.googleId })).mockResolvedValueOnce(json({}, 503));
        const response = await authRoutes.request(`/callback?state=${state}&code=code`, { headers: headers(`${cookie}; photos_flow=${flow}`) }, env);
        expect(cookieFrom(response, 'photos_grant')).toBeTruthy();
        expect(response.headers.get('Location')).toBeNull();
        const outcome = await openPhotosCookie<any>(cookieFrom(response, 'photos_outcome'), env.SESSION_SECRET, 'photos-outcome');
        expect(outcome.error).toContain('picker could not open');
    });

    it('rejects a non-Google picker redirect after consent', async () => {
        const { flow, state } = await connect(true);
        fetchMock.mockResolvedValueOnce(json({ access_token: 'new-access', scope: `openid ${PHOTOS_SCOPE}`, expires_in: 3600 }))
            .mockResolvedValueOnce(json({ sub: user.googleId }))
            .mockResolvedValueOnce(json({ id: 'picker-session', pickerUri: 'https://attacker.example/picker' }));
        const response = await authRoutes.request(`/callback?state=${state}&code=code`, { headers: headers(`${cookie}; photos_flow=${flow}`) }, env);
        expect(response.headers.get('Location')).toBeNull();
        expect(cookieFrom(response, 'photos_picker')).toBeUndefined();
    });
});

describe('Google media URL validation', () => {
    it.each(['http://lh3.googleusercontent.com/file', 'https://googleusercontent.com.attacker.example/file', 'https://user:password@lh3.googleusercontent.com/file', 'https://127.0.0.1/file'])('rejects %s', (url) => {
        expect(() => googleMediaUrl(url)).toThrow();
    });
});
