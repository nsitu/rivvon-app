// Animated gallery thumbnails are separate from the still poster image.
export const MAX_VIDEO_THUMBNAIL_BYTES = 32 * 1024 * 1024;

export function videoThumbnailSize(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error('Video has no readable dimensions');
    }
    const scale = Math.min(1, 640 / Math.max(width, height));
    // AVC requires even dimensions. Contain preserves the picture's proportions
    // within the nearest even-sized rectangle (at most a pixel of padding).
    const even = value => Math.max(2, Math.min(640, Math.round(value / 2) * 2));
    return { width: even(width * scale), height: even(height * scale) };
}

/** Transcode the full video to a silent, 15 fps AVC MP4 using WebCodecs. */
export async function createVideoPreviewThumbnail(source, { signal, onProgress } = {}) {
    signal?.throwIfAborted();
    if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
        throw new Error('WebCodecs is required to generate video thumbnails. Try a browser with WebCodecs support.');
    }
    const MB = await import('mediabunny');
    const input = new MB.Input({
        formats: MB.ALL_FORMATS,
        source: source instanceof Blob ? new MB.BlobSource(source) : new MB.UrlSource(source, { getRetryDelay: attempts => attempts < 3 ? 1 : null }),
    });
    const target = new MB.BufferTarget();
    const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    let conversion;
    const abort = () => {
        if (conversion) void conversion.cancel().catch(() => {});
        input.dispose();
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
        signal?.throwIfAborted();
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error('The video has no video track');
        const [width, height, duration] = await Promise.all([
            track.getDisplayWidth(), track.getDisplayHeight(), track.computeDuration(),
        ]);
        const size = videoThumbnailSize(width, height);
        signal?.throwIfAborted();
        conversion = await MB.Conversion.init({
            input, output, tracks: 'primary', audio: { discard: true }, tags: {}, showWarnings: false,
            video: {
                ...size, fit: 'contain', codec: 'avc', frameRate: 15,
                // Leave headroom for MP4 overhead on long videos.
                bitrate: Math.min(1_200_000, Math.floor(MAX_VIDEO_THUMBNAIL_BYTES * 8 * 0.85 / Math.max(1, duration))),
                forceTranscode: true, allowTransformationMetadata: false, keyFrameInterval: 2,
            },
        });
        signal?.throwIfAborted();
        if (!conversion.isValid) throw new Error('This browser cannot decode this video or encode an AVC video thumbnail.');
        conversion.onProgress = progress => onProgress?.(progress);
        await conversion.execute();
        signal?.throwIfAborted();
        if (!target.buffer?.byteLength || target.buffer.byteLength > MAX_VIDEO_THUMBNAIL_BYTES) {
            throw new Error('The generated video thumbnail is empty or exceeds 32 MB.');
        }
        return new Blob([target.buffer], { type: 'video/mp4' });
    } catch (error) {
        signal?.throwIfAborted();
        throw error;
    } finally {
        signal?.removeEventListener('abort', abort);
        if (conversion && conversion.state !== 'done' && conversion.state !== 'canceled') await conversion.cancel();
        input.dispose();
    }
}
