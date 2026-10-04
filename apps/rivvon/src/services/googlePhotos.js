const API_URL = import.meta.env.VITE_API_URL || 'https://api.rivvon.ca';
const PHOTOS_URL = `${API_URL}/api/auth/photos`;
export const MAX_PHOTOS_VIDEO_BYTES = 2048 * 1024 * 1024;

// Called synchronously from a click, before any request can lose user activation.
export function openGooglePhotosWindow(url = 'about:blank') {
    const width = Math.min(960, window.screen.availWidth);
    const height = Math.min(800, window.screen.availHeight);
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
    return window.open(url, '_blank', `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
}

function checkAbort(signal) { signal?.throwIfAborted(); }

function delay(milliseconds, signal) {
    checkAbort(signal);
    return new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason || new DOMException('Import cancelled', 'AbortError')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
        signal?.addEventListener('abort', abort, { once: true });
    });
}

async function request(path, { signal, method = 'GET' } = {}) {
    const response = await fetch(`${PHOTOS_URL}${path}`, {
        method, signal, credentials: 'include', cache: 'no-store',
        ...(method !== 'GET' ? { headers: { 'Content-Type': 'application/json' } } : {}),
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const error = new Error(payload.error || 'Unable to import from Google Photos.');
        error.status = response.status;
        throw error;
    }
    return response;
}

export function pollingMilliseconds(duration, fallback = 2000) {
    const seconds = typeof duration === 'string' && /^\d+(?:\.\d+)?s$/.test(duration) ? Number(duration.slice(0, -1)) : NaN;
    return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : fallback;
}

export function importedVideoFilename(original, mimeType) {
    const extension = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }[mimeType];
    if (!extension) throw new Error('Google Photos returned an unsupported video format.');
    const name = typeof original === 'string' ? original.split(/[\\/]/).pop().replace(/[\x00-\x1f]/g, '').trim() : '';
    return `${(name || 'google-photos-video').replace(/\.[^.]+$/, '')}.${extension}`;
}

// Inspect the transcode container rather than trusting the original file's MIME.
export async function detectVideoMime(blob, responseMime) {
    const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'video/mp4';
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm';
    if (['video/mp4', 'video/webm', 'video/quicktime'].includes(responseMime)) return responseMime;
    throw new Error('The downloaded file is not a supported video.');
}

export async function readVideoDownload(response, { signal, onProgress, maxBytes = MAX_PHOTOS_VIDEO_BYTES } = {}) {
    const length = Number(response.headers.get('Content-Length'));
    if (length > maxBytes) { await response.body?.cancel(); throw new Error('Choose a video no larger than 2048 MiB.'); }
    if (!response.body) throw new Error('Google Photos returned an empty video.');
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    try {
        while (true) {
            checkAbort(signal);
            const { done, value } = await reader.read();
            checkAbort(signal);
            if (done) break;
            received += value.byteLength;
            if (received > maxBytes) throw new Error('Choose a video no larger than 2048 MiB.');
            chunks.push(value);
            onProgress?.({ received, total: length > 0 ? length : null });
        }
        if (!received) throw new Error('Google Photos returned an empty video.');
        return new Blob(chunks);
    } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
    } finally { reader.releaseLock(); }
}

export async function importGooglePhotosVideo({ signal, popup, onStatus, onProgress, onExternalLink }) {
    let sessionId = null;
    const navigate = (url, label) => {
        checkAbort(signal);
        // Completion depends on API polling rather than window.opener. Show a
        // continuation link only when the browser blocked or closed the window.
        try {
            if (popup && !popup.closed) {
                popup.location.href = url;
                onExternalLink?.(null);
                return;
            }
        } catch { /* use the link */ }
        onExternalLink?.({ url, label });
    };
    try {
        let session = null;
        onStatus?.('Checking Google Photos permission…');
        const authorization = await (await request('/authorization', { signal })).json();
        if (!authorization.connected) {
            const attempt = crypto.randomUUID();
            navigate(`${PHOTOS_URL}/connect?attempt=${attempt}&picker=1`, 'Continue with Google');
            onStatus?.('Grant access to selected videos in the Google window.');
            const deadline = Date.now() + 10 * 60 * 1000;
            while (true) {
                await delay(1500, signal);
                const result = await (await request(`/authorization?attempt=${attempt}`, { signal })).json();
                if (result.error) throw new Error(result.error);
                // Older API deployments finish consent without staging a
                // picker. Keep the link fallback working during rollout.
                if (result.connected) { session = result.pickerSession || null; break; }
                if (Date.now() >= deadline) throw new Error('Google authorization timed out. Please try again.');
            }
            // The callback redirects this same Google window to the picker,
            // even when COOP has severed Rivvon's handle to it.
            onExternalLink?.(null);
        }
        const alreadyOpened = !!session;
        session ||= await (await request('/sessions', { method: 'POST', signal })).json();
        sessionId = session.id;
        const pickerUrl = new URL(session.pickerUri);
        if (pickerUrl.protocol !== 'https:' || pickerUrl.hostname !== 'photos.google.com') throw new Error('Google Photos returned an invalid picker address.');
        if (!alreadyOpened) navigate(`${session.pickerUri.replace(/\/$/, '')}/autoclose`, 'Open Google Photos');
        onStatus?.('Search Google Photos and select one video, then finish your selection.');
        const expiry = Date.parse(session.expireTime);
        let deadline = Math.min(Number.isFinite(expiry) ? expiry : Infinity,
            Date.now() + pollingMilliseconds(session.pollingConfig?.timeoutIn, 10 * 60 * 1000));
        while (!session.mediaItemsSet) {
            const timeout = pollingMilliseconds(session.pollingConfig?.timeoutIn, deadline - Date.now());
            deadline = Math.min(deadline, Date.now() + timeout);
            if (timeout <= 0 || Date.now() >= deadline) throw new Error('Video selection timed out. Please try again.');
            await delay(Math.min(Math.max(1000, pollingMilliseconds(session.pollingConfig?.pollInterval)), deadline - Date.now()), signal);
            session = await (await request(`/sessions/${encodeURIComponent(sessionId)}`, { signal })).json();
        }
        onExternalLink?.(null);
        const path = `/sessions/${encodeURIComponent(sessionId)}/video`;
        const { provenance } = await (await request(path, { signal })).json();
        onStatus?.('Downloading your video…');
        const response = await request(`${path}/bytes`, { signal });
        const blob = await readVideoDownload(response, { signal, onProgress });
        checkAbort(signal);
        const mimeType = await detectVideoMime(blob, (response.headers.get('Content-Type') || '').split(';')[0]);
        const file = new File([blob], importedVideoFilename(provenance.originalFilename, mimeType), { type: mimeType });
        onStatus?.('Checking the imported video…');
        await inspectImportedVideo(file, signal);
        checkAbort(signal);
        return { file, provenance };
    } finally {
        try { popup?.close(); } catch { /* COOP-isolated tab */ }
        onExternalLink?.(null);
        if (sessionId) {
            // Do not reuse the aborted import signal for cleanup.
            await request(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', signal: AbortSignal.timeout(10000) }).catch(() => {});
        }
    }
}

function inspectImportedVideo(file, signal) {
    checkAbort(signal);
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        const url = URL.createObjectURL(file);
        const finish = (error) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', aborted);
            video.onloadedmetadata = null;
            video.onerror = null;
            video.removeAttribute('src');
            video.load();
            URL.revokeObjectURL(url);
            error ? reject(error) : resolve();
        };
        const aborted = () => finish(signal.reason || new DOMException('Import cancelled', 'AbortError'));
        const timer = setTimeout(() => finish(new Error('Unable to inspect this video. Please try another.')), 30000);
        video.onloadedmetadata = () => finish(video.videoWidth > 0 && video.videoHeight > 0 && Number.isFinite(video.duration)
            ? null : new Error('This video cannot be processed in this browser.'));
        video.onerror = () => finish(new Error('This video cannot be decoded in this browser.'));
        signal?.addEventListener('abort', aborted, { once: true });
        video.preload = 'metadata';
        video.src = url;
    });
}
