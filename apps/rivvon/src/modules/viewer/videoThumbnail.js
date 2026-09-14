function waitForEvent(target, successEvent, errorEvents = ['error'], timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => finish(reject, new Error(`Timed out waiting for video ${successEvent}`)), timeoutMs);
        const handlers = new Map();

        function finish(callback, value) {
            clearTimeout(timeout);
            handlers.forEach((handler, eventName) => target.removeEventListener(eventName, handler));
            callback(value);
        }

        handlers.set(successEvent, () => finish(resolve));
        errorEvents.forEach((eventName) => {
            handlers.set(eventName, () => finish(reject, new Error('Unable to decode exported video for its thumbnail')));
        });
        handlers.forEach((handler, eventName) => target.addEventListener(eventName, handler, { once: true }));
    });
}

function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Unable to encode video thumbnail'));
        }, type, quality);
    });
}

function waitForVideoFrame(video, timeoutMs = 1000) {
    return new Promise((resolve) => {
        let settled = false;
        const timeout = setTimeout(finish, timeoutMs);

        function finish() {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve();
        }

        if (typeof video.requestVideoFrameCallback === 'function') {
            video.requestVideoFrameCallback(finish);
        } else if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(finish);
        } else {
            finish();
        }
    });
}

async function seekVideo(video, targetTime) {
    const duration = Number(video.duration);
    const boundedTime = Number.isFinite(duration) && duration > 0
        ? Math.min(Math.max(0, targetTime), Math.max(0, duration - 0.001))
        : Math.max(0, targetTime);

    if (
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && Math.abs(video.currentTime - boundedTime) < 0.01
    ) {
        await waitForVideoFrame(video);
        return;
    }

    // Register before assigning currentTime: fast seeks can otherwise emit
    // `seeked` before the listener is attached.
    const seeked = waitForEvent(video, 'seeked', ['error', 'abort', 'emptied']);
    video.currentTime = boundedTime;
    await seeked;
    await waitForVideoFrame(video);
}

export async function createVideoThumbnailFromElement(video, { maxWidth = 640, quality = 0.82 } = {}) {
    if (!(video instanceof HTMLVideoElement)) {
        throw new Error('A video element is required to create a thumbnail');
    }

    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await waitForEvent(video, 'loadeddata');
    }

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) {
        throw new Error('Video has no readable dimensions');
    }

    const originalTime = video.currentTime;
    try {
        const posterTime = Math.min(0.1, Math.max(0, Number(video.duration) / 2));
        if (posterTime > 0 && video.seekable?.length) {
            await seekVideo(video, posterTime);
        } else {
            await waitForVideoFrame(video);
        }

        const scale = Math.min(1, maxWidth / sourceWidth);
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Unable to create thumbnail canvas');
        context.drawImage(video, 0, 0, width, height);

        return await canvasToBlob(canvas, 'image/webp', quality);
    } finally {
        if (Number.isFinite(originalTime) && video.seekable?.length) {
            try {
                video.currentTime = originalTime;
            } catch {
                // The player may have been unloaded while the thumbnail was generated.
            }
        }
    }
}

export async function createVideoThumbnailFromUrl(videoUrl, options = {}) {
    if (typeof videoUrl !== 'string' || !videoUrl.trim()) {
        throw new Error('A video URL is required to create a thumbnail');
    }

    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.src = videoUrl;

    try {
        const metadataReady = waitForEvent(video, 'loadedmetadata');
        video.load();
        await metadataReady;
        return await createVideoThumbnailFromElement(video, options);
    } finally {
        video.removeAttribute('src');
        video.load();
    }
}

export async function createVideoThumbnail(videoBlob, { maxWidth = 640, quality = 0.82 } = {}) {
    if (!(videoBlob instanceof Blob) || !videoBlob.size) {
        throw new Error('A completed video is required to create a thumbnail');
    }

    const objectUrl = URL.createObjectURL(videoBlob);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;

    try {
        const metadataReady = waitForEvent(video, 'loadedmetadata');
        video.load();
        await metadataReady;

        return await createVideoThumbnailFromElement(video, { maxWidth, quality });
    } finally {
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(objectUrl);
    }
}
