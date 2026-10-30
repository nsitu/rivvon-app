export const MAX_CLIP_BYTES = 1_000_000_000; // 1 GB (decimal), shared by client and API.
export const CLIP_UPLOAD_PART_BYTES = 8 * 1024 * 1024;
export const MAX_CLIP_SINGLE_UPLOAD_BYTES = 64 * 1024 * 1024;
export const MAX_CLIP_INSPECTION_BYTES = 128 * 1024 * 1024;
export const MAX_CLIP_DURATION = 60;
export const MAX_CLIP_SIDE = 3840;
export const MAX_CLIP_PIXELS = 3840 * 3840;
export const MAX_CLIP_FPS = 60;
export const CLIP_MIME_TYPE = 'video/mp4';

// Local file containers supported by Mediabunny. Playlists are excluded: a
// resource must be self-contained, without fetching external stream segments.
export const CLIP_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/mp2t', 'application/ogg'];
export const CLIP_FILE_ACCEPT = 'video/*,.mov,.mkv,.webm,.mts,.m2ts,.ts,.ogg,.ogv';
export function getClipInputFormats(formats) { return formats.filter(format => CLIP_MIME_TYPES.includes(format.mimeType.toLowerCase())); }

// Server-side validation identifies the real container and video track, without
// assuming which decoders are installed on a particular viewer's device.
export async function inspectClipInput(input) {
    if (!await input.canRead()) throw new Error('Mediabunny could not open this video file. It may be damaged or use an unsupported container.');
    const format = await input.getFormat();
    const mimeType = format.mimeType.toLowerCase();
    if (!CLIP_MIME_TYPES.includes(mimeType)) throw new Error('Choose a self-contained video file with a readable video track.');
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('This file does not contain a readable video track.');
    const codec = await track.getCodec(), config = await track.getDecoderConfig();
    if (!codec || !config?.codec) throw new Error('Mediabunny could not identify the video codec in this file.');
    const width = track.displayWidth, height = track.displayHeight;
    const start = await track.getFirstTimestamp();
    const duration = (await track.computeDuration()) - start;
    const stats = await track.computePacketStats();
    const fps = stats.averagePacketRate;
    if (![width, height, track.codedWidth, track.codedHeight].every(n => Number.isInteger(n) && n > 0 && n <= MAX_CLIP_SIDE)
        || width * height > MAX_CLIP_PIXELS || track.codedWidth * track.codedHeight > MAX_CLIP_PIXELS
        || !Number.isFinite(duration) || duration <= 0 || duration > MAX_CLIP_DURATION + 1e-6
        || !Number.isFinite(start) || !Number.isFinite(fps) || fps <= 0 || fps > MAX_CLIP_FPS + 0.01) {
        throw new Error('Clips must be at most 60 seconds, 60 fps, and 3840 × 3840 pixels.');
    }
    return { mimeType, formatName: format.name, colorSpace: config.colorSpace || null, width, height, duration, firstTimestamp: start, fps, codec: config.codec, rotation: track.rotation, codedWidth: track.codedWidth, codedHeight: track.codedHeight };
}
