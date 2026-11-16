import { describe, expect, it } from 'vitest';
import { Quality } from 'mediabunny';
import { getBasicVideoQuality, resolveFfmpegVideoRateControl, resolveVideoRateControl, VIDEO_QUALITY_LEVELS } from './videoRateControl.js';

describe('explicit video rate control', () => {
    it.each(['avc', 'vp9', 'av1'])('keeps WebCodecs Basic explanations aligned with installed Mediabunny for %s', videoCodec => {
        for (const quality of VIDEO_QUALITY_LEVELS) for (const [width, height] of [[1280, 720], [2160, 2160]]) {
            // This test intentionally inspects the dependency's internal planner;
            // production code uses only its public Quality(level) constructor.
            const native = new Quality(quality)._toVideoRateControl(videoCodec, width, height);
            expect(getBasicVideoQuality(quality, { videoCodec, width, height })).toEqual({ quantizer: native.quantizer, fallbackBitrate: native.bitrate });
        }
    });
    it('keeps CRF distinct from QP and rejects cross-encoder Basic/CRF modes', () => {
        expect(resolveFfmpegVideoRateControl({ bitrateMode: 'crf', crf: 23.5, quantizer: 1, bitrate: 99_000_000, encoderPreset: 'slow' }))
            .toEqual({ bitrateMode: 'crf', crf: 23.5, quantizer: null, bitrate: null });
        expect(() => resolveFfmpegVideoRateControl({ bitrateMode: 'basic', quality: 'medium' })).toThrow('Quality presets are available with WebCodecs');
        expect(() => resolveVideoRateControl({ bitrateMode: 'crf', crf: 23 })).toThrow('CRF is available with FFmpeg');
        expect(() => resolveFfmpegVideoRateControl({ bitrateMode: 'crf', crf: 23, encoderPreset: 'high' })).toThrow('x264 encoding preset');
    });
    it.each([null, -1, 51.5, NaN, Infinity])('rejects invalid CRF %s', crf => {
        expect(() => resolveFfmpegVideoRateControl({ bitrateMode: 'crf', crf })).toThrow('CRF must be');
    });
    it('passes Basic through without manual bitrate or QP overrides and rejects unknown levels', () => {
        expect(resolveVideoRateControl({ bitrateMode: 'basic', quality: 'medium', bitrate: 1_000_000, quantizer: 0 }))
            .toEqual({ bitrateMode: 'basic', quality: 'medium', bitrate: null, quantizer: null });
        expect(() => resolveVideoRateControl({ bitrateMode: 'basic', quality: 'unknown' })).toThrow('Choose a quality level');
    });
    it.each(['variable', 'constant'])('preserves an explicit %s bitrate at any resolution', bitrateMode => {
        expect(resolveVideoRateControl({ bitrateMode, bitrate: 14_000_000, width: 3840, height: 2160 }))
            .toEqual({ bitrateMode, bitrate: 14_000_000, quantizer: null });
    });
    it('uses quantizer zero without a hidden bitrate fallback', () => {
        expect(resolveVideoRateControl({ bitrateMode: 'quantizer', quantizer: 0, bitrate: 14_000_000 }))
            .toEqual({ bitrateMode: 'quantizer', bitrate: null, quantizer: 0 });
    });
    it('uses codec-specific quantizer bounds', () => {
        expect(resolveVideoRateControl({ bitrateMode: 'quantizer', format: 'mp4', videoCodec: 'av1', quantizer: 255 }).quantizer).toBe(255);
        expect(() => resolveVideoRateControl({ bitrateMode: 'quantizer', format: 'mp4', videoCodec: 'av1', quantizer: 256 })).toThrow('0 to 255 for AV1');
        expect(resolveVideoRateControl({ bitrateMode: 'quantizer', format: 'webm', quantizer: 63 }).quantizer).toBe(63);
        expect(() => resolveVideoRateControl({ bitrateMode: 'quantizer', format: 'mp4', quantizer: 63 })).toThrow('0 to 51');
    });
    it.each([null, 0, -1, NaN, Infinity, 12.5])('rejects invalid explicit bitrate %s', bitrate => {
        expect(() => resolveVideoRateControl({ bitrate })).toThrow('positive target bitrate');
    });
    it.each([null, -1, 52, NaN, 16.5])('rejects invalid H.264 quantizer %s', quantizer => {
        expect(() => resolveVideoRateControl({ bitrateMode: 'quantizer', quantizer })).toThrow('integer from 0 to 51');
    });
    it('rejects unsupported control modes instead of silently substituting VBR', () => {
        expect(() => resolveVideoRateControl({ bitrateMode: 'auto' })).toThrow('Choose VBR');
        expect(() => resolveVideoRateControl({ bitrateMode: 'constant', bitrate: 1_000_000, encodingMethod: 'ffmpeg' })).toThrow('CBR is available with WebCodecs');
    });
    it('preserves legacy callers with resolution-aware preset defaults', () => {
        expect(resolveVideoRateControl({ width: 2160, height: 2160, quality: 'very-high' }).bitrate).toBe(25_928_000);
    });
});
