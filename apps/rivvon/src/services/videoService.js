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

export async function fetchVideos({ limit = 24, offset = 0 } = {}) {
    const response = await fetch(`${API_BASE_URL}/videos?limit=${limit}&offset=${offset}`, {
        credentials: 'include',
    });
    return parseResponse(response, 'Failed to load videos');
}

export async function fetchMyVideos({ limit = 24, offset = 0 } = {}) {
    const response = await fetch(`${API_BASE_URL}/my-videos?limit=${limit}&offset=${offset}`, {
        credentials: 'include',
    });
    return parseResponse(response, 'Failed to load your videos');
}

export async function fetchVideo(videoId) {
    const response = await fetch(`${API_BASE_URL}/videos/${encodeURIComponent(videoId)}`, {
        credentials: 'include',
    });
    return parseResponse(response, 'Failed to load video');
}

export async function createVideoPublication(metadata) {
    const response = await fetch(`${API_BASE_URL}/video`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metadata),
    });
    return parseResponse(response, 'Failed to prepare video publication');
}

export function uploadVideoBlob({ uploadUrl, uploadHeaders = {}, blob, signal, onProgress }) {
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
            if (event.lengthComputable) {
                onProgress?.(event.loaded / event.total);
            }
        });
        request.addEventListener('load', () => {
            if (request.status >= 200 && request.status < 300) {
                onProgress?.(1);
                finish(resolve, { etag: request.getResponseHeader('ETag') });
                return;
            }
            finish(reject, new Error(`R2 upload failed (${request.status})`));
        });
        request.addEventListener('error', () => finish(reject, new Error('R2 upload failed due to a network error')));
        request.addEventListener('abort', () => {
            const error = new DOMException('Video upload cancelled', 'AbortError');
            finish(reject, error);
        });

        if (signal?.aborted) {
            finish(reject, new DOMException('Video upload cancelled', 'AbortError'));
            return;
        }
        signal?.addEventListener('abort', abortUpload, { once: true });
        request.send(blob);
    });
}

export async function uploadVideoThumbnail(videoId, thumbnailBlob) {
    const response = await fetch(`${API_BASE_URL}/video/${encodeURIComponent(videoId)}/thumbnail`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': thumbnailBlob.type || 'image/webp' },
        body: thumbnailBlob,
    });
    return parseResponse(response, 'Failed to upload video thumbnail');
}

export async function completeVideoPublication(videoId) {
    const response = await fetch(`${API_BASE_URL}/video/${encodeURIComponent(videoId)}/complete`, {
        method: 'POST',
        credentials: 'include',
    });
    return parseResponse(response, 'Failed to complete video publication');
}

/**
 * Publish a video blob through the gallery's presigned R2 upload flow.
 * The partial publication is removed if any upload/finalization step fails.
 */
export async function publishVideoBlob({
    metadata = {},
    blob,
    thumbnailBlob = null,
    signal,
    onProgress,
    onStatus,
} = {}) {
    if (!blob) {
        throw new Error('A video file is required');
    }

    const publication = await createVideoPublication({
        ...metadata,
        mimeType: metadata.mimeType || blob.type,
        fileSize: blob.size,
    });

    try {
        onStatus?.('Uploading video to R2…');
        await uploadVideoBlob({
            uploadUrl: publication.uploadUrl,
            uploadHeaders: publication.uploadHeaders,
            blob,
            signal,
            onProgress,
        });

        if (thumbnailBlob) {
            onStatus?.('Uploading thumbnail…');
            await uploadVideoThumbnail(publication.videoId, thumbnailBlob);
        }

        onStatus?.('Finalizing gallery entry…');
        await completeVideoPublication(publication.videoId);
        return publication;
    } catch (error) {
        await deleteVideoPublication(publication.videoId).catch(() => {});
        throw error;
    }
}

export async function updateVideoPublication(videoId, updates) {
    const response = await fetch(`${API_BASE_URL}/video/${encodeURIComponent(videoId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
    return parseResponse(response, 'Failed to update video');
}

export async function deleteVideoPublication(videoId) {
    const response = await fetch(`${API_BASE_URL}/video/${encodeURIComponent(videoId)}`, {
        method: 'DELETE',
        credentials: 'include',
    });
    return parseResponse(response, 'Failed to delete video');
}
