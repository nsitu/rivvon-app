import { describe, expect, it } from 'vitest';
import { Quaternion } from 'three';
import {
    getTumbleOrbitQuaternionAtProgress,
    normalizeArtworkMotionMode,
} from './viewerMotion.js';

function expectQuaternionClose(actual, expected, precision = 12) {
    expect(actual.x).toBeCloseTo(expected.x, precision);
    expect(actual.y).toBeCloseTo(expected.y, precision);
    expect(actual.z).toBeCloseTo(expected.z, precision);
    expect(actual.w).toBeCloseTo(expected.w, precision);
}

describe('tumble orbit motion', () => {
    it('accepts tumbleOrbit as an artwork motion mode', () => {
        expect(normalizeArtworkMotionMode('tumbleOrbit')).toBe('tumbleOrbit');
    });

    it.each([-2, -1, 0, 1, 2])('is exactly aligned at integral progress %s', (progress) => {
        expect(getTumbleOrbitQuaternionAtProgress(progress).equals(new Quaternion())).toBe(true);
    });

    it('is periodic and deterministic', () => {
        for (const progress of [0.07, 0.25, 0.63, 0.91]) {
            const expected = getTumbleOrbitQuaternionAtProgress(progress);
            expectQuaternionClose(getTumbleOrbitQuaternionAtProgress(progress), expected);
            expectQuaternionClose(getTumbleOrbitQuaternionAtProgress(progress + 3), expected);
        }
    });

    it('stays normalized and advances at a calm, coherent angular rate', () => {
        const angularSteps = [];
        let previous = getTumbleOrbitQuaternionAtProgress(0);
        for (let sample = 1; sample < 100; sample += 1) {
            const quaternion = getTumbleOrbitQuaternionAtProgress(sample / 100);
            expect(quaternion.length()).toBeCloseTo(1, 12);
            angularSteps.push(previous.angleTo(quaternion));
            previous = quaternion;
        }

        const slowestStep = Math.min(...angularSteps);
        const fastestStep = Math.max(...angularSteps);
        expect(fastestStep / slowestStep).toBeLessThan(1.2);
    });

    it('crosses the loop seam with the same angular step as the rest of the path', () => {
        const sampleCount = 360;
        const beforeSeam = getTumbleOrbitQuaternionAtProgress((sampleCount - 1) / sampleCount);
        const seam = getTumbleOrbitQuaternionAtProgress(1);
        const afterSeam = getTumbleOrbitQuaternionAtProgress(1 + (1 / sampleCount));

        expect(beforeSeam.angleTo(seam)).toBeCloseTo(seam.angleTo(afterSeam), 10);
    });

    it('can reuse a target quaternion', () => {
        const target = new Quaternion();
        expect(getTumbleOrbitQuaternionAtProgress(0.4, target)).toBe(target);
    });
});
