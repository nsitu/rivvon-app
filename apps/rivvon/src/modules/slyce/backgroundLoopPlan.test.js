import { describe, expect, it } from 'vitest';
import { planBackgroundLoop } from './backgroundLoopPlan.js';

const hd = { width: 1920, height: 1080, frameCount: 2000 };
describe('background loop planning', () => {
    it('separates source samples, output phases and the short-edge phase ceiling', () => {
        expect(planBackgroundLoop(hd)).toMatchObject({ size: 1920, sourceFrames: 1920, phaseCount: 240,
            maxPhases: 1080, duration: 8, fps: 30, passes: 15, batchSize: 16 });
        expect(planBackgroundLoop(hd, { duration: 36 })).toMatchObject({ phaseCount: 1080 });
        expect(() => planBackgroundLoop(hd, { duration: 36.1 })).toThrow('duration');
    });
    it('uses available source frames, even dimensions and portrait orientation', () => {
        expect(planBackgroundLoop({ width: 1080, height: 1920, frameCount: 901 }, { sourceStartFrame: 3 }))
            .toMatchObject({ size: 898, samplingMode: 'columns' });
        expect(() => planBackgroundLoop(hd, { size: 1922 })).toThrow('square size');
        expect(() => planBackgroundLoop(hd, { size: 1919 })).toThrow('even');
    });
    it('samples either side in display coordinates and derives limits from the chosen axis', () => {
        expect(planBackgroundLoop(hd, { samplingSide: 'short' })).toMatchObject({
            samplingSide: 'short', samplingMode: 'columns', size: 1080, maxSize: 1080, maxPhases: 1800,
        });
        expect(planBackgroundLoop({ ...hd, width: 1080, height: 1920 }, { samplingSide: 'short' }))
            .toMatchObject({ samplingMode: 'rows', maxSize: 1080, maxPhases: 1800 });
        expect(() => planBackgroundLoop(hd, { samplingSide: 'short', size: 1920 })).toThrow('1080');
        expect(() => planBackgroundLoop(hd, { samplingSide: 'diagonal' })).toThrow('long or short');
    });
    it('quantizes duration to complete frames, retaining artistic phase choices', () => {
        expect(planBackgroundLoop(hd, { duration: 1 })).toMatchObject({ phaseCount: 30, duration: 1 });
        expect(planBackgroundLoop(hd, { duration: 1.05 })).toMatchObject({ phaseCount: 32, duration: 32 / 30 });
        expect(() => planBackgroundLoop(hd, { duration: 0.9 })).toThrow('duration');
    });
    it('bounds high-resolution phase surfaces independently of encoder allocations', () => {
        const plan = planBackgroundLoop({ width: 3840, height: 2160, frameCount: 3840 });
        expect(plan).toMatchObject({ size: 3840, maxPhases: 1800, batchSize: 4 });
        expect(plan.phaseSurfaceBytes).toBeLessThanOrEqual(256 * 1024 * 1024);
        const hdPlan = planBackgroundLoop(hd);
        expect(hdPlan.phaseSurfaceBytes).toBe(225 * 1024 * 1024);
        expect(() => planBackgroundLoop(hd, { surfaceBudgetMiB: 1 })).toThrow('one output frame');
    });
});
