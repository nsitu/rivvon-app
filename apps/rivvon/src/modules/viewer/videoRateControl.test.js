import { describe, expect, it } from 'vitest';
import { resolveVideoRateControl } from './videoRateControl.js';

describe('explicit video rate control', () => {
    it.each(['variable', 'constant'])('preserves an explicit %s bitrate at any resolution', bitrateMode => {
        expect(resolveVideoRateControl({ bitrateMode, bitrate: 14_000_000, width: 3840, height: 2160 }))
            .toEqual({ bitrateMode, bitrate: 14_000_000, quantizer: null });
    });
    it('uses quantizer zero without a hidden bitrate fallback', () => {
        expect(resolveVideoRateControl({ bitrateMode: 'quantizer', quantizer: 0, bitrate: 14_000_000 }))
            .toEqual({ bitrateMode: 'quantizer', bitrate: null, quantizer: 0 });
    });
    it('uses codec-specific quantizer bounds', () => {
        expect(resolveVideoRateControl({ bitrateMode: 'quantizer', format: 'mp4', videoCodec: 'av1', quantizer: 63 }).quantizer).toBe(63);
        expect(() => resolveVideoRateControl({ bitrateMode: 'quantizer', format: 'mp4', videoCodec: 'av1', quantizer: 64 })).toThrow('0 to 63 for AV1');
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
