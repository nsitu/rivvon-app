import { describe, expect, it } from 'vitest';
import { CameraMotionTrack, createCameraMotionTrack } from './cameraMotionTrack.js';

function sample(t, x, targetX = 0) {
    return {
        t,
        position: [x, 0, 5],
        target: [targetX, 0, 0],
        quaternion: [0, 0, 0, 1],
        fov: 45,
    };
}

describe('CameraMotionTrack', () => {
    it('creates a timed return segment and closes at the first state', () => {
        const track = createCameraMotionTrack([
            sample(0, 0),
            sample(1, 2, 1),
            sample(2, 4, 2),
        ]);

        expect(track).toBeInstanceOf(CameraMotionTrack);
        expect(track.duration).toBeGreaterThan(track.sourceDuration);
        expect(track.sampleAt(0).position[0]).toBe(0);

        const final = track.sampleAt(track.duration - 0.00001);
        expect(final.position[0]).toBeCloseTo(0, 2);
        expect(final.target[0]).toBeCloseTo(0, 2);
    });

    it('omits the closure when the capture seam is already aligned', () => {
        const track = createCameraMotionTrack([
            sample(0, 0),
            sample(1, 1),
            sample(2, 0),
        ]);

        expect(track.closureDuration).toBe(0);
        expect(track.duration).toBe(track.sourceDuration);
    });

    it('serializes normalized samples and timing metadata', () => {
        const track = createCameraMotionTrack([
            sample(10, 0),
            sample(11, 1),
        ]);
        const serialized = track.toJSON();

        expect(serialized.version).toBe(1);
        expect(serialized.samples[0].t).toBe(0);
        expect(serialized.duration).toBe(track.duration);
    });
});
