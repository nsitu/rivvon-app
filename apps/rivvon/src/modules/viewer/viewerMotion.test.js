import { describe, expect, it } from 'vitest';
import { Quaternion } from 'three';
import { getEllipticalTiltAnglesAtProgress, getCircularTiltAnglesAtProgress } from './mouseTiltMotion.js';
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

describe('elliptical tilt motion', () => {
    it('preserves the existing default tilt and scroll-driven circular path', () => {
        for (const progress of [0, 0.13, 0.25, 0.5, 0.75, 1]) {
            const angles = getEllipticalTiltAnglesAtProgress(progress);
            expect(angles.yaw).toBeCloseTo(-Math.cos(progress * Math.PI * 2) * Math.PI / 6, 12);
            expect(angles.pitch).toBeCloseTo(Math.sin(progress * Math.PI * 2) * Math.PI / 8, 12);
            expect(getCircularTiltAnglesAtProgress(progress)).toEqual(angles);
        }
    });

    it.each([[0, 0], [0, 45], [60, 0], [12, 48], [90, 90]])('uses independent %s° horizontal and %s° vertical limits', (horizontal, vertical) => {
        const settings = { artworkTiltHorizontalDegrees: horizontal, artworkTiltVerticalDegrees: vertical };
        const start = getEllipticalTiltAnglesAtProgress(0, settings);
        const quarter = getEllipticalTiltAnglesAtProgress(0.25, settings);
        expect(start.yaw).toBeCloseTo(-horizontal * Math.PI / 180, 12);
        expect(start.pitch).toBe(0);
        expect(quarter.yaw).toBeCloseTo(0, 12);
        expect(quarter.pitch).toBeCloseTo(vertical * Math.PI / 180, 12);
        for (const progress of [-0.2, 0.2, 0.63, 1]) {
            const angles = getEllipticalTiltAnglesAtProgress(progress, settings);
            const repeated = getEllipticalTiltAnglesAtProgress(progress + 2, settings);
            expect(repeated.yaw).toBeCloseTo(angles.yaw, 12);
            expect(repeated.pitch).toBeCloseTo(angles.pitch, 12);
            if (horizontal === 0) expect(Math.abs(angles.yaw)).toBe(0);
            if (vertical === 0) expect(Math.abs(angles.pitch)).toBe(0);
        }
    });

    it('traces a circle in angle space when both amounts are equal', () => {
        const settings = { artworkTiltHorizontalDegrees: 25, artworkTiltVerticalDegrees: 25 };
        for (let sample = 0; sample < 20; sample++) {
            const { yaw, pitch } = getEllipticalTiltAnglesAtProgress(sample / 20, settings);
            expect(Math.hypot(yaw, pitch)).toBeCloseTo(25 * Math.PI / 180, 12);
        }
    });
});

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
