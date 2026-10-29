import { ref } from 'vue';
import { inspectClipInput, MAX_CLIP_BYTES, MAX_CLIP_SINGLE_UPLOAD_BYTES, CLIP_UPLOAD_PART_BYTES, getClipInputFormats } from '../../../../packages/shared-types/src/clipAsset.js';
import { MAX_THUMBNAIL_SIDE } from '../../../../packages/shared-types/src/imageAsset.js';
import { Input, ALL_FORMATS, BlobSource, CanvasSink } from 'mediabunny';

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
    if (!file.size || file.size > MAX_CLIP_BYTES) throw new Error('Choose a video clip of at most 1 GB (1,000,000,000 bytes)');
    const input = new Input({ formats: getClipInputFormats(ALL_FORMATS), source: new BlobSource(file) });
    const abort = () => input.dispose();
    signal?.throwIfAborted(); signal?.addEventListener('abort', abort, { once: true });
    try {
        const info = await inspectClipInput(input);
        const track = await input.getPrimaryVideoTrack();
        if (!await track.canDecode()) throw new Error('This browser cannot decode the video codec in this clip. Try a compatible browser or convert the video.');
        const scale = Math.min(1, MAX_THUMBNAIL_SIDE / Math.max(info.width, info.height));
        const sink = new CanvasSink(track, { width: Math.max(1, Math.round(info.width * scale)), height: Math.max(1, Math.round(info.height * scale)), fit: 'fill' });
        let frame;
        try { frame = await sink.getCanvas(info.firstTimestamp); }
        catch (error) {
            signal?.throwIfAborted();
            throw new Error('This browser could not decode a frame from this video. Try a compatible browser or convert the video.', { cause: error });
        }
        if (!frame) throw new Error('The clip has no decodable first frame.');
        const thumbnailBlob = await canvasBlob(frame.canvas, 'image/webp', 0.85);
        signal?.throwIfAborted();
        return { ...info, blob: new Blob([file], { type: info.mimeType }), thumbnailBlob };
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
            let data; try { data = JSON.parse(xhr.responseText); } catch {}
            if (xhr.status >= 200 && xhr.status < 300) finish(resolve, data);
            else { const error = new Error(data?.error || 'Clip upload failed'); error.status = xhr.status; finish(reject, error); }
        };
        xhr.onerror = () => finish(reject, new Error('Clip upload failed. Check your connection and try again.'));
        xhr.onabort = () => finish(reject, new DOMException('Upload cancelled', 'AbortError'));
        if (signal?.aborted) { reject(new DOMException('Upload cancelled', 'AbortError')); return; }
        signal?.addEventListener('abort', abort, { once: true }); xhr.send(blob);
    });
}

async function retryTransfer(operation, signal) {
    try { return await operation(); }
    catch (error) { signal?.throwIfAborted(); if (error.status && error.status < 500) throw error; return operation(); }
}

export async function uploadClipBytes(id, blob, { signal, onProgress, onStatus } = {}) {
    if (!blob.size || blob.size > MAX_CLIP_BYTES) throw new Error('Clips must be at most 1 GB (1,000,000,000 bytes)');
    if (blob.size <= MAX_CLIP_SINGLE_UPLOAD_BYTES) return uploadBlob(`/clip/${id}/assets/clip`, blob, { signal, onProgress });
    const session = await retryTransfer(() => request(`/clip/${id}/upload`, { method: 'POST', signal }), signal);
    const expectedParts = Math.ceil(blob.size / CLIP_UPLOAD_PART_BYTES);
    if (session.partSize !== CLIP_UPLOAD_PART_BYTES || session.partCount !== expectedParts || typeof session.sessionId !== 'string'
        || !/^[\w-]{1,64}$/.test(session.sessionId)) throw new Error('Invalid clip upload session');
    const parts = [];
    for (let index = 0; index < expectedParts; index++) {
        signal?.throwIfAborted();
        const start = index * CLIP_UPLOAD_PART_BYTES, end = Math.min(blob.size, start + CLIP_UPLOAD_PART_BYTES);
        onStatus?.(`Uploading clip part ${index + 1} of ${expectedParts}…`);
        const part = await retryTransfer(() => uploadBlob(`/clip/${id}/upload/${session.sessionId}/parts/${index + 1}`,
            blob.slice(start, end, blob.type || 'video/mp4'), { signal, onProgress: value => onProgress?.((start + value * (end - start)) / blob.size) }), signal);
        if (part?.partNumber !== index + 1 || typeof part.etag !== 'string' || !part.etag) throw new Error('The clip part upload returned an invalid receipt');
        parts.push(part);
    }
    onStatus?.('Assembling clip…');
    await retryTransfer(() => request(`/clip/${id}/upload/${session.sessionId}/complete`, { ...json('POST', { parts }), signal }), signal);
    onProgress?.(1);
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
        await uploadClipBytes(created.clipId, prepared.blob, { signal, onStatus, onProgress: value => onProgress?.(value * 0.9) });
        await uploadBlob(`/clip/${created.clipId}/assets/thumbnail`, prepared.thumbnailBlob, { signal, onProgress: value => onProgress?.(0.9 + value * 0.1) });
        onStatus?.('Finalizing…');
        // Finalization is idempotent; one retry covers a dropped response.
        const complete = () => request(`/clip/${created.clipId}/complete`, { method: 'POST', signal });
        const result = await complete().catch(error => { signal?.throwIfAborted(); if (error.status && error.status < 500) throw error; return complete(); });
        return result.clip;
    } catch (error) { await deleteClip(created.clipId).catch(() => {}); throw error; }
}
