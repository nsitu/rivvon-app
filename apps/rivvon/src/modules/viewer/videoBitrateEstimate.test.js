import { describe, expect, it } from 'vitest';
import { calculateVideoBitrateEstimate, calculateVideoPreflight, getVideoPreflightKey, getVideoRenderFrameCount, isVideoPreflightReady } from './videoBitrateEstimate.js';

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

describe('required video preflight', () => {
    const settings = { totalFrames: 3600, fps: 30, bitrateMode: 'variable', bitrate: 25_000_000, width: 2160 };
    const sample = { measurementOnly: true, size: 2_500_000, duration: 2, frames: 60 };
    it('uses measured throughput and adds setup once, rather than scaling setup per frame', () => {
        const result = calculateVideoPreflight(sample, { settings, processingSeconds: 4, setupSeconds: 3 });
        expect(result).toMatchObject({ bitrate: 10_000_000, encodingFps: 15, estimatedEncodingSeconds: 243, sampleFrames: 60 });
        expect(isVideoPreflightReady(result, settings)).toBe(true);
    });
    it('requires a fresh sample after changes to rate, size, duration or encoding mode', () => {
        const result = calculateVideoPreflight(sample, { settings, processingSeconds: 4 });
        for (const changes of [{ bitrate: 50_000_000 }, { width: 1080 }, { totalFrames: 7200 }, { bitrateMode: 'constant' }]) {
            expect(isVideoPreflightReady(result, { ...settings, ...changes })).toBe(false);
        }
        expect(isVideoPreflightReady(null, settings)).toBe(false);
        expect(isVideoPreflightReady({ ...result, encodingFps: 0 }, settings)).toBe(false);
        expect(isVideoPreflightReady({ ...result, estimatedEncodingSeconds: NaN }, settings)).toBe(false);
    });
    it('compares equivalent settings independently of key insertion order', () => {
        expect(getVideoPreflightKey({ fps: 30, width: 2160 })).toBe(getVideoPreflightKey({ width: 2160, fps: 30 }));
    });
    it.each([0, -1, NaN, Infinity])('rejects unusable elapsed time %s', processingSeconds => {
        expect(() => calculateVideoPreflight(sample, { settings, processingSeconds })).toThrow('timing sample');
    });
    it('handles short clips and rejects incomplete frame counts or invalid setup times', () => {
        const short = { ...sample, frames: 15, duration: 0.5 };
        expect(calculateVideoPreflight(short, { settings: { ...settings, totalFrames: 15 }, processingSeconds: 0.25, setupSeconds: 0.1 }))
            .toMatchObject({ encodingFps: 60, estimatedEncodingSeconds: 0.35 });
        expect(() => calculateVideoPreflight({ ...sample, frames: 0 }, { settings, processingSeconds: 4 })).toThrow('timing sample');
        expect(() => calculateVideoPreflight(sample, { settings: { totalFrames: 1 }, processingSeconds: 4 })).toThrow('timing sample');
        expect(() => calculateVideoPreflight(sample, { settings, processingSeconds: 4, setupSeconds: -1 })).toThrow('timing sample');
    });
});
