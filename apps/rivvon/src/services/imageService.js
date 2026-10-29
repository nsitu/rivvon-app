import { ref } from 'vue';
import { inspectImage, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, MAX_THUMBNAIL_SIDE } from '../../../../packages/shared-types/src/imageAsset.js';

const API = import.meta.env.VITE_API_URL || 'https://api.rivvon.ca';
export const IMAGE_LIBRARY_KEY = Symbol('image-library');
export const imageMetadataRevision = ref(0);
async function request(path, options = {}) {
    const response = await fetch(`${API}${path}`, { credentials: 'include', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || 'The image request failed'); error.status = response.status; error.payload = data; throw error; }
    return data;
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const grant = presetId => presetId ? `?sourcePresetId=${encodeURIComponent(presetId)}` : '';
export const fetchImages = ({ limit = 24, offset = 0 } = {}) => request(`/images?limit=${limit}&offset=${offset}`);
export const fetchImage = (id, presetId = '') => request(`/images/${encodeURIComponent(id)}${grant(presetId)}`).then(data => data.image);
export const renameImage = async (id, name) => { const result = await request(`/image/${encodeURIComponent(id)}`, json('PATCH', { name })); imageMetadataRevision.value++; return result; };
export const fetchImageDependencies = id => request(`/image/${encodeURIComponent(id)}/preset-dependencies`);
export const deleteImage = (id, acceptedPresetIds = []) => request(`/image/${encodeURIComponent(id)}`, json('DELETE', { acceptedPresetIds }));
export async function fetchImageBlob(id, { asset = 'image', presetId = '', signal } = {}) {
    const response = await fetch(`${API}/images/${encodeURIComponent(id)}/assets/${asset}${grant(presetId)}`, { credentials: 'include', signal, cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 404 ? 'This image is unavailable. Choose another image from the library.' : 'Could not load the image. Please try again.');
    return response.blob();
}
const canvasBlob = (canvas, type, quality) => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode this image')), type, quality));

export async function prepareImageUpload(file, { signal } = {}) {
    if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error('Choose an image of at most 20 MiB');
    inspectImage(await file.arrayBuffer());
    signal?.throwIfAborted();
    // createImageBitmap applies EXIF orientation. Re-encoding strips source metadata.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
        const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Image processing is unavailable in this browser');
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await canvasBlob(canvas, 'image/webp', 0.95);
        signal?.throwIfAborted();
        const thumbnail = document.createElement('canvas'), ratio = Math.min(1, MAX_THUMBNAIL_SIDE / Math.max(canvas.width, canvas.height));
        thumbnail.width = Math.max(1, Math.round(canvas.width * ratio)); thumbnail.height = Math.max(1, Math.round(canvas.height * ratio));
        thumbnail.getContext('2d').drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
        const thumbnailBlob = await canvasBlob(thumbnail, 'image/webp', 0.85);
        return { blob, thumbnailBlob, width: canvas.width, height: canvas.height, resized: scale < 1 };
    } finally { bitmap.close(); }
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
            else { let data; try { data = JSON.parse(xhr.responseText); } catch {} finish(reject, new Error(data?.error || 'Image upload failed')); }
        };
        xhr.onerror = () => finish(reject, new Error('Image upload failed. Check your connection and try again.'));
        xhr.onabort = () => finish(reject, new DOMException('Upload cancelled', 'AbortError'));
        if (signal?.aborted) { reject(new DOMException('Upload cancelled', 'AbortError')); return; }
        signal?.addEventListener('abort', abort, { once: true }); xhr.send(blob);
    });
}

export async function uploadImage(file, { signal, onProgress, onStatus } = {}) {
    onStatus?.('Preparing image…');
    const prepared = await prepareImageUpload(file, { signal });
    signal?.throwIfAborted();
    const created = await request('/image', { ...json('POST', { name: (file.name.replace(/\.[^.]+$/, '') || 'Image').slice(0, 120),
        sourceFilename: file.name, sourceMimeType: file.type, mimeType: prepared.blob.type, width: prepared.width, height: prepared.height,
        fileSize: prepared.blob.size, thumbnailSize: prepared.thumbnailBlob.size, thumbnailMimeType: prepared.thumbnailBlob.type }), signal });
    try {
        onStatus?.(prepared.resized ? 'Uploading resized image…' : 'Uploading image…');
        await uploadBlob(`/image/${created.imageId}/assets/image`, prepared.blob, { signal, onProgress: value => onProgress?.(value * 0.9) });
        await uploadBlob(`/image/${created.imageId}/assets/thumbnail`, prepared.thumbnailBlob, { signal, onProgress: value => onProgress?.(0.9 + value * 0.1) });
        onStatus?.('Finalizing…');
        // Finalization is idempotent; one retry covers a dropped response.
        const complete = () => request(`/image/${created.imageId}/complete`, { method: 'POST', signal });
        const result = await complete().catch(error => { signal?.throwIfAborted(); if (error.status && error.status < 500) throw error; return complete(); });
        return result.image;
    } catch (error) { await deleteImage(created.imageId).catch(() => {}); throw error; }
}
