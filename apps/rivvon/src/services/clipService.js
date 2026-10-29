import { ref } from 'vue';
import { inspectClipInput, MAX_CLIP_BYTES } from '../../../../packages/shared-types/src/clipAsset.js';
import { MAX_THUMBNAIL_SIDE } from '../../../../packages/shared-types/src/imageAsset.js';
import { Input, MP4, BlobSource, CanvasSink } from 'mediabunny';

const API = import.meta.env.VITE_API_URL || 'https://api.rivvon.ca';
export const CLIP_LIBRARY_KEY = Symbol('clip-library');
export const clipMetadataRevision = ref(0);
async function request(path, options = {}) {
    const response = await fetch(`${API}${path}`, { credentials: 'include', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || 'The clip request failed'); error.status = response.status; error.payload = data; throw error; }
    return data;
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const grant = presetId => presetId ? `?sourcePresetId=${encodeURIComponent(presetId)}` : '';
export const fetchClips = ({ limit = 24, offset = 0 } = {}) => request(`/clips?limit=${limit}&offset=${offset}`);
export const fetchClip = (id, presetId = '', signal) => request(`/clips/${encodeURIComponent(id)}${grant(presetId)}`, { signal }).then(data => data.clip);
export const renameClip = async (id, name) => { const result = await request(`/clip/${encodeURIComponent(id)}`, json('PATCH', { name })); clipMetadataRevision.value++; return result; };
export const fetchClipDependencies = id => request(`/clip/${encodeURIComponent(id)}/preset-dependencies`);
export const deleteClip = (id, acceptedPresetIds = []) => request(`/clip/${encodeURIComponent(id)}`, json('DELETE', { acceptedPresetIds }));
export async function fetchClipBlob(id, { asset = 'clip', presetId = '', signal } = {}) {
    const response = await fetch(`${API}/clips/${encodeURIComponent(id)}/assets/${asset}${grant(presetId)}`, { credentials: 'include', signal, cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 404 ? 'This clip is unavailable. Choose another clip from the library.' : 'Could not load the clip. Please try again.');
    return response.blob();
}
const canvasBlob = (canvas, type, quality) => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode this clip')), type, quality));

export const clipAssetUrl = (id, { asset = 'clip', presetId = '' } = {}) => `${API}/clips/${encodeURIComponent(id)}/assets/${asset}${grant(presetId)}`;

export async function prepareClipUpload(file, { signal } = {}) {
    if (!file.size || file.size > MAX_CLIP_BYTES) throw new Error('Choose an H.264 MP4 clip of at most 64 MiB');
    const input = new Input({ formats: [MP4], source: new BlobSource(file) });
    const abort = () => input.dispose();
    signal?.throwIfAborted(); signal?.addEventListener('abort', abort, { once: true });
    try {
        const info = await inspectClipInput(input);
        const track = await input.getPrimaryVideoTrack();
        if (!await track.canDecode()) throw new Error('This browser cannot decode the clip. Try a supported browser or convert to H.264 MP4.');
        const scale = Math.min(1, MAX_THUMBNAIL_SIDE / Math.max(info.width, info.height));
        const sink = new CanvasSink(track, { width: Math.max(1, Math.round(info.width * scale)), height: Math.max(1, Math.round(info.height * scale)), fit: 'fill' });
        const frame = await sink.getCanvas(info.firstTimestamp);
        if (!frame) throw new Error('The clip has no decodable first frame.');
        const thumbnailBlob = await canvasBlob(frame.canvas, 'image/webp', 0.85);
        signal?.throwIfAborted();
        return { ...info, blob: new Blob([file], { type: 'video/mp4' }), thumbnailBlob };
    } finally { signal?.removeEventListener('abort', abort); input.dispose(); }
}

function uploadBlob(path, blob, { signal, onProgress } = {}) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const abort = () => xhr.abort();
        const finish = (callback, value) => { signal?.removeEventListener('abort', abort); callback(value); };
        xhr.open('PUT', `${API}${path}`); xhr.withCredentials = true; xhr.setRequestHeader('Content-Type', blob.type);
        xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(event.loaded / event.total); };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) finish(resolve);
            else { let data; try { data = JSON.parse(xhr.responseText); } catch {} finish(reject, new Error(data?.error || 'Clip upload failed')); }
        };
        xhr.onerror = () => finish(reject, new Error('Clip upload failed. Check your connection and try again.'));
        xhr.onabort = () => finish(reject, new DOMException('Upload cancelled', 'AbortError'));
        if (signal?.aborted) { reject(new DOMException('Upload cancelled', 'AbortError')); return; }
        signal?.addEventListener('abort', abort, { once: true }); xhr.send(blob);
    });
}

export async function uploadClip(file, { signal, onProgress, onStatus } = {}) {
    onStatus?.('Preparing clip…');
    const prepared = await prepareClipUpload(file, { signal });
    signal?.throwIfAborted();
    const created = await request('/clip', { ...json('POST', { name: (file.name.replace(/\.[^.]+$/, '') || 'Clip').slice(0, 120),
        sourceFilename: file.name, sourceMimeType: file.type, mimeType: prepared.blob.type, width: prepared.width, height: prepared.height,
        fileSize: prepared.blob.size, thumbnailSize: prepared.thumbnailBlob.size, thumbnailMimeType: prepared.thumbnailBlob.type }), signal });
    try {
        onStatus?.('Uploading clip…');
        await uploadBlob(`/clip/${created.clipId}/assets/clip`, prepared.blob, { signal, onProgress: value => onProgress?.(value * 0.9) });
        await uploadBlob(`/clip/${created.clipId}/assets/thumbnail`, prepared.thumbnailBlob, { signal, onProgress: value => onProgress?.(0.9 + value * 0.1) });
        onStatus?.('Finalizing…');
        // Finalization is idempotent; one retry covers a dropped response.
        const complete = () => request(`/clip/${created.clipId}/complete`, { method: 'POST', signal });
        const result = await complete().catch(error => { signal?.throwIfAborted(); if (error.status && error.status < 500) throw error; return complete(); });
        return result.clip;
    } catch (error) { await deleteClip(created.clipId).catch(() => {}); throw error; }
}
