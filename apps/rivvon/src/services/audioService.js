const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://api.rivvon.ca';

async function parseResponse(response, fallbackMessage) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.error || fallbackMessage);
        error.status = response.status;
        error.payload = data;
        throw error;
    }
    return data;
}

export async function fetchMyAudios({ limit = 50, offset = 0 } = {}) {
    const response = await fetch(`${API_BASE_URL}/audios?limit=${limit}&offset=${offset}`, {
        credentials: 'include',
    });
    return parseResponse(response, 'Failed to load your audio library');
}

export async function fetchAudio(audioId) {
    const response = await fetch(`${API_BASE_URL}/audios/${encodeURIComponent(audioId)}`, {
        credentials: 'include',
    });
    return parseResponse(response, 'Failed to load audio');
}

export async function createAudioPublication(metadata) {
    const response = await fetch(`${API_BASE_URL}/audio`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metadata),
    });
    return parseResponse(response, 'Failed to prepare audio publication');
}

export function uploadAudioBlob({ uploadUrl, uploadHeaders = {}, blob, signal, onProgress }) {
    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        let settled = false;
        const cleanup = () => signal?.removeEventListener('abort', abortUpload);
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            cleanup();
            callback(value);
        };
        const abortUpload = () => request.abort();

        request.open('PUT', uploadUrl, true);
        Object.entries(uploadHeaders).forEach(([name, value]) => request.setRequestHeader(name, value));
        request.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) onProgress?.(event.loaded / event.total);
        });
        request.addEventListener('load', () => {
            if (request.status >= 200 && request.status < 300) {
                onProgress?.(1);
                finish(resolve, { etag: request.getResponseHeader('ETag') });
                return;
            }
            finish(reject, new Error(`R2 audio upload failed (${request.status})`));
        });
        request.addEventListener('error', () => finish(reject, new Error('R2 audio upload failed due to a network error')));
        request.addEventListener('abort', () => finish(reject, new DOMException('Audio upload cancelled', 'AbortError')));
        if (signal?.aborted) {
            finish(reject, new DOMException('Audio upload cancelled', 'AbortError'));
            return;
        }
        signal?.addEventListener('abort', abortUpload, { once: true });
        request.send(blob);
    });
}

export async function completeAudioPublication(audioId) {
    const response = await fetch(`${API_BASE_URL}/audio/${encodeURIComponent(audioId)}/complete`, {
        method: 'POST',
        credentials: 'include',
    });
    return parseResponse(response, 'Failed to complete audio publication');
}

export async function updateAudioPublication(audioId, updates) {
    const response = await fetch(`${API_BASE_URL}/audio/${encodeURIComponent(audioId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
    return parseResponse(response, 'Failed to update audio');
}

export async function deleteAudioPublication(audioId) {
    const response = await fetch(`${API_BASE_URL}/audio/${encodeURIComponent(audioId)}`, {
        method: 'DELETE',
        credentials: 'include',
    });
    return parseResponse(response, 'Failed to delete audio');
}

export async function publishAudioBlob({ metadata = {}, blob, signal, onProgress, onStatus } = {}) {
    if (!blob) throw new Error('An audio file is required');
    const publication = await createAudioPublication({
        ...metadata,
        mimeType: 'audio/mp4',
        fileSize: blob.size,
    });

    try {
        onStatus?.('Uploading audio to R2…');
        await uploadAudioBlob({
            uploadUrl: publication.uploadUrl,
            uploadHeaders: publication.uploadHeaders,
            blob,
            signal,
            onProgress,
        });
        onStatus?.('Finalizing audio library entry…');
        await completeAudioPublication(publication.audioId);
        return publication;
    } catch (error) {
        await deleteAudioPublication(publication.audioId).catch(() => {});
        throw error;
    }
}
