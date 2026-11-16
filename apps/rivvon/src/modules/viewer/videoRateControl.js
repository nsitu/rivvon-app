// Legacy bitrate suggestions for saved callers and diagnostics. Basic mode
// uses Mediabunny's named-quality mapping below instead of these old factors.
export function getDefaultVideoBitrate(width, height, quality = 'very-high') {
    const factors = { 'very-low': 0.3, low: 0.6, medium: 1, high: 2, 'very-high': 4 };
    return Math.ceil(3_000_000 * (width * height / (1920 * 1080)) ** 0.95 * (factors[quality] ?? 4) / 1000) * 1000;
}

export const getVideoQuantizerMax = (format, videoCodec) => videoCodec === 'av1' ? 255 : format === 'webm' ? 63 : 51;

export const VIDEO_QUALITY_LEVELS = ['very-low', 'low', 'medium', 'high', 'very-high'];
export const VIDEO_QUALITY_OPTIONS = VIDEO_QUALITY_LEVELS.map(value => ({ value,
    label: ({ 'very-low': 'Very Low', low: 'Low', medium: 'Medium', high: 'High', 'very-high': 'Very High' })[value] }));

// Explanation mapping for installed Mediabunny 1.60.0 (WebCodecs only).
// WebCodecs receives new Quality(level) and lets Mediabunny choose the actual
// supported mode. A parity test against the dependency guards this explanation.
export function getBasicVideoQuality(quality = 'medium', { videoCodec, format = 'mp4', width = 1920, height = 1080 } = {}) {
    const index = VIDEO_QUALITY_LEVELS.indexOf(quality);
    if (index < 0) throw new Error('Choose a quality level from Very Low to Very High.');
    const codec = videoCodec ?? (format === 'webm' ? 'vp9' : 'avc');
    const mappings = { avc: { worst: 41, best: 16, efficiency: 1 }, vp9: { worst: 52, best: 20, efficiency: 0.6 },
        av1: { worst: 208, best: 80, efficiency: 0.4 } };
    const mapping = mappings[codec];
    if (!mapping) throw new Error('Unsupported quality-level codec.');
    const scalar = index / 4;
    const quantizer = Math.round(mapping.worst + (mapping.best - mapping.worst) * scalar);
    const fallbackBitrate = Math.ceil(3_000_000 * (width * height / (1920 * 1080)) ** 0.95
        * mapping.efficiency * (0.3 * Math.exp(2.5538 * scalar)) / 1000) * 1000;
    return { quantizer, fallbackBitrate };
}

export function resolveFfmpegVideoRateControl(options) {
    getX264EncoderPreset(options.encoderPreset);
    return resolveVideoRateControl({ ...options, encodingMethod: 'ffmpeg', format: 'mp4', videoCodec: 'avc' });
}

export const X264_ENCODER_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow', 'placebo'];
export function getX264EncoderPreset(preset = 'veryfast') {
    if (!X264_ENCODER_PRESETS.includes(preset)) throw new Error('Choose a supported x264 encoding preset.');
    return preset;
}

export function resolveVideoRateControl({ bitrateMode = 'variable', bitrate, quantizer = 23, crf = 23,
    width, height, quality, format = 'mp4', videoCodec, encodingMethod = 'webcodecs' } = {}) {
    if (!['basic', 'variable', 'constant', 'quantizer', 'crf'].includes(bitrateMode)) throw new Error('Choose VBR, CBR, constant quantizer, CRF, or Quality presets rate control.');
    if (bitrateMode === 'basic') {
        if (encodingMethod === 'ffmpeg') throw new Error('Quality presets are available with WebCodecs. Choose CRF, average bitrate or QP for FFmpeg WASM.');
        if (!VIDEO_QUALITY_LEVELS.includes(quality)) throw new Error('Choose a quality level from Very Low to Very High.');
        return { bitrateMode: 'basic', quality, bitrate: null, quantizer: null };
    }
    if (encodingMethod === 'ffmpeg' && bitrateMode === 'constant') {
        throw new Error('CBR is available with WebCodecs. Choose CRF, average bitrate or QP for FFmpeg WASM.');
    }
    if (bitrateMode === 'crf') {
        if (encodingMethod !== 'ffmpeg') throw new Error('CRF is available with FFmpeg WASM. Choose QP or Quality presets for WebCodecs.');
        if (!Number.isFinite(crf) || crf < 0 || crf > 51) throw new Error('CRF must be a number from 0 to 51 for 8-bit x264.');
        return { bitrateMode, bitrate: null, quantizer: null, crf };
    }
    if (bitrateMode === 'quantizer') {
        const max = getVideoQuantizerMax(format, videoCodec);
        if (!Number.isInteger(quantizer) || quantizer < 0 || quantizer > max) {
            throw new Error(`Quantizer must be an integer from 0 to ${max} for ${videoCodec === 'av1' ? 'AV1' : format === 'webm' ? 'VP9' : 'H.264'}.`);
        }
        return { bitrateMode, bitrate: null, quantizer };
    }
    const target = bitrate === undefined ? getDefaultVideoBitrate(width, height, quality) : bitrate;
    if (!Number.isSafeInteger(target) || target <= 0) throw new Error('Enter a positive target bitrate in Mb/s.');
    return { bitrateMode, bitrate: target, quantizer: null };
}
