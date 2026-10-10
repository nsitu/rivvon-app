// Canvas bytes are display-referred sRGB, including the legacy numeric-RGB shaders.
// Decode sRGB and re-encode BT.709 BEFORE the BT.709 limited-range Y'CbCr matrix.
export const SDR_VIDEO_COLOUR = Object.freeze({ primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false });

export function validateSdrDimensions(width, height, fps) {
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n % 2 === 0)) {
        throw new Error('SDR MP4 requires even pixel dimensions. Choose an even width and height; dimensions are never rounded.');
    }
    if (!Number.isFinite(fps) || fps <= 0 || fps > 120) throw new Error('Export frame rate must be between 0 and 120 fps.');
    if (Math.abs(Math.round(fps * 1_000_000) / 1_000_000 - fps) > 1e-9) throw new Error('Export frame rate supports up to six decimal places.');
}

export function srgbToBt709(value) {
    const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    return linear < 0.018 ? linear * 4.5 : 1.099 * linear ** 0.45 - 0.099;
}

const transferLut = Float64Array.from({ length: 256 }, (_, i) => srgbToBt709(i / 255));
const byte = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));

// Input must be opaque, unpremultiplied sRGB RGBA. Chroma is a 2x2 box average,
// centred (chroma_sample_loc_type=1), with only one final quantization per sample.
export function rgbaToBt709I420(rgba, width, height, target = new Uint8Array(width * height * 3 / 2)) {
    validateSdrDimensions(width, height, 30);
    if (rgba.length !== width * height * 4 || target.length !== width * height * 3 / 2) throw new Error('Invalid frame buffer size.');
    const pixels = width * height;
    let chroma = 0;
    for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
            let cb = 0, cr = 0;
            for (let dy = 0; dy < 2; dy++) {
                for (let dx = 0; dx < 2; dx++) {
                    const pixel = (y + dy) * width + x + dx;
                    const r = transferLut[rgba[pixel * 4]];
                    const g = transferLut[rgba[pixel * 4 + 1]];
                    const b = transferLut[rgba[pixel * 4 + 2]];
                    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                    target[pixel] = byte(16 + 219 * luma, 16, 235);
                    cb += (b - luma) / 1.8556;
                    cr += (r - luma) / 1.5748;
                }
            }
            target[pixels + chroma] = byte(128 + 56 * cb, 16, 240);
            target[pixels * 5 / 4 + chroma++] = byte(128 + 56 * cr, 16, 240);
        }
    }
    return target;
}

// Match Mediabunny 1.60's AVC subjective-quality bitrate curve.
export function getSdrBitrate(width, height, quality = 'very-high') {
    const factors = { 'very-low': 0.3, low: 0.6, medium: 1, high: 2, 'very-high': 4 };
    return Math.ceil(3_000_000 * (width * height / (1920 * 1080)) ** 0.95 * (factors[quality] ?? 4) / 1000) * 1000;
}

function frameRateFraction(fps) {
    // Explicit rational avoids FFmpeg's named-rate snapping (29.97 → 30000/1001).
    const scale = 1_000_000;
    let numerator = Math.round(fps * scale), denominator = scale;
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    const divisor = gcd(numerator, denominator);
    numerator /= divisor; denominator /= divisor;
    return `${numerator}/${denominator}`;
}

export function getSdrEncodeArgs({ width, height, fps, frames, quality }) {
    validateSdrDimensions(width, height, fps);
    return ['-f', 'rawvideo', '-pixel_format', 'yuv420p', '-video_size', `${width}x${height}`,
        '-framerate', frameRateFraction(fps), '-i', 'frames.yuv', '-frames:v', String(frames), '-an',
        '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '1', '-b:v', String(getSdrBitrate(width, height, quality)),
        '-pix_fmt', 'yuv420p', '-bf', '0', '-color_range', 'tv', '-colorspace', 'bt709',
        '-color_primaries', 'bt709', '-color_trc', 'bt709', '-chroma_sample_location', 'center',
        '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv:chromaloc=1',
        '-f', 'h264', 'chunk.h264'];
}

export function getSdrMuxArgs(fps) {
    // No B frames: raw AVC timestamps can be generated exactly at the input rate.
    const numerator = Number(frameRateFraction(fps).split('/')[0]);
    const timescale = String(numerator * 1000 <= 2_147_483_647 ? numerator * 1000 : numerator);
    return ['-r', frameRateFraction(fps), '-i', 'video.h264', '-map', '0:v:0', '-c:v', 'copy',
        '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
        '-video_track_timescale', timescale, '-movie_timescale', timescale, '-movflags', '+faststart+write_colr', 'video.mp4'];
}
