import { describe, expect, it } from 'vitest';
import { calculateVideoBitrateEstimate, getVideoRenderFrameCount } from './videoBitrateEstimate.js';

describe('sampled QP bitrate estimates', () => {
    it('caps only sampling, retaining full exports and clips shorter than two seconds', () => {
        expect(getVideoRenderFrameCount(3600, 30, true)).toBe(60);
        expect(getVideoRenderFrameCount(15, 30, true)).toBe(15);
        expect(getVideoRenderFrameCount(3600, 30)).toBe(3600);
    });
    it('uses actual encoded duration, not the planned full export duration', () => {
        expect(calculateVideoBitrateEstimate({ measurementOnly: true, size: 2_500_000, duration: 0.5, frames: 15 }))
            .toEqual({ bitrate: 40_000_000, sampleDuration: 0.5, sampleFrames: 15 });
    });
    it.each([null, { measurementOnly: true, size: 0, duration: 2 }, { measurementOnly: true, size: 50, duration: 0 }])
        ('rejects empty or cancelled measurements', sample => expect(() => calculateVideoBitrateEstimate(sample)).toThrow('usable bitrate sample'));
});
