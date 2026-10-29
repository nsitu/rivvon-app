import { describe, expect, it } from 'vitest';
import { createClipTimingPlan, getClipLocalTime, getClipExportPeriod } from './clipTiming.js';

describe('clip alignment', () => {
    it.each([[8, 12, 2, 4 / 3], [20, 12, 1, 5 / 3], [6, 12, 2, 1], [0.1, 0.3, 3, 1], [60, 0.25, 1, 240]])('fits %ss into %ss at the smallest speed increase', (clip, loop, count, rate) => {
        const plan = createClipTimingPlan(clip, loop, 'alignLoop');
        expect(plan.repetitions).toBe(count); expect(plan.rate).toBeCloseTo(rate, 12); expect(plan.rate).toBeGreaterThanOrEqual(1);
        expect(plan.rate * loop / clip).toBeCloseTo(count, 12);
        expect(getClipLocalTime(loop, plan)).toBe(0); expect(getClipLocalTime(loop * 5, plan)).toBe(0);
        if (count > 1) expect((count - 1) * clip / loop).toBeLessThan(1);
    });
    it('maps synthetic timestamps, retains original speed, and does not append an endpoint frame', () => {
        const plan = createClipTimingPlan(8, 12, 'alignLoop');
        expect([0, 3, 6, 9, 12].map(t => getClipLocalTime(t, plan))).toEqual([0, 4, 0, 4, 0]);
        expect(getClipLocalTime(12, createClipTimingPlan(8, 12, 'native'))).toBe(4);
        const period = getClipExportPeriod(1.001, 30, 3);
        expect(period).toEqual({ cycleFrames: 31, totalFrames: 93, targetDuration: 31 / 30, duration: 93 / 30 });
        const aligned = createClipTimingPlan(8, period.targetDuration, 'alignLoop');
        expect(getClipLocalTime(period.duration, aligned)).toBeCloseTo(0, 10);
        expect(getClipLocalTime((period.totalFrames - 1) / 30, aligned)).toBeGreaterThan(0);
        expect(getClipExportPeriod(1.001, 30, 3, true).totalFrames).toBe(31);
    });
    it.each([0, -1, NaN, Infinity])('rejects invalid durations (%s)', value => {
        expect(() => createClipTimingPlan(value, 12, 'alignLoop')).toThrow();
        expect(() => createClipTimingPlan(8, value, 'alignLoop')).toThrow();
    });
});
