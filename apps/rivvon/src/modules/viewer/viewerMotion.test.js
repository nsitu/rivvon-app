import { describe, expect, it } from 'vitest';
import { Euler, Quaternion } from 'three';
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

    it('produces normalized, non-trivial rotation on all three axes', () => {
        let maxX = 0;
        let maxY = 0;
        let maxZ = 0;

        for (let sample = 1; sample < 100; sample += 1) {
            const quaternion = getTumbleOrbitQuaternionAtProgress(sample / 100);
            const rotation = new Euler().setFromQuaternion(quaternion, 'YXZ');
            maxX = Math.max(maxX, Math.abs(rotation.x));
            maxY = Math.max(maxY, Math.abs(rotation.y));
            maxZ = Math.max(maxZ, Math.abs(rotation.z));
            expect(quaternion.length()).toBeCloseTo(1, 12);
        }

        expect(maxX).toBeGreaterThan(0.1);
        expect(maxY).toBeGreaterThan(0.1);
        expect(maxZ).toBeGreaterThan(0.05);
    });

    it('can reuse a target quaternion', () => {
        const target = new Quaternion();
        expect(getTumbleOrbitQuaternionAtProgress(0.4, target)).toBe(target);
    });
});
