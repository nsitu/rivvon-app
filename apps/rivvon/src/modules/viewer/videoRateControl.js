// Legacy preset support for saved callers and diagnostics. The export UI uses
// explicit bitrate/quantizer values; this only supplies its initial suggestion.
export function getDefaultVideoBitrate(width, height, quality = 'very-high') {
    const factors = { 'very-low': 0.3, low: 0.6, medium: 1, high: 2, 'very-high': 4 };
    return Math.ceil(3_000_000 * (width * height / (1920 * 1080)) ** 0.95 * (factors[quality] ?? 4) / 1000) * 1000;
}

export const getVideoQuantizerMax = format => format === 'webm' ? 63 : 51;

export function resolveVideoRateControl({ bitrateMode = 'variable', bitrate, quantizer = 23,
    width, height, quality, format = 'mp4', encodingMethod = 'webcodecs' } = {}) {
    if (!['variable', 'constant', 'quantizer'].includes(bitrateMode)) throw new Error('Choose VBR, CBR, or constant quantizer rate control.');
    if (encodingMethod === 'ffmpeg' && bitrateMode === 'constant') {
        throw new Error('CBR is available with WebCodecs. Choose VBR or constant QP for FFmpeg WASM.');
    }
    if (bitrateMode === 'quantizer') {
        const max = getVideoQuantizerMax(format);
        if (!Number.isInteger(quantizer) || quantizer < 0 || quantizer > max) {
            throw new Error(`Quantizer must be an integer from 0 to ${max} for ${format === 'webm' ? 'VP9' : 'H.264'}.`);
        }
        return { bitrateMode, bitrate: null, quantizer };
    }
    const target = bitrate === undefined ? getDefaultVideoBitrate(width, height, quality) : bitrate;
    if (!Number.isSafeInteger(target) || target <= 0) throw new Error('Enter a positive target bitrate in Mb/s.');
    return { bitrateMode, bitrate: target, quantizer: null };
}
