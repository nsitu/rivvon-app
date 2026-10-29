import { describe, expect, it } from 'vitest';
import { effectScope } from 'vue';
import { Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { useViewerMotion } from './useViewerMotion.js';

describe('live elliptical tilt', () => {
    it('applies angle changes immediately without restarting the motion or accumulating rotation', () => {
        const root = new Object3D();
        const camera = new PerspectiveCamera();
        camera.position.set(0, 0, 5);
        const app = { viewerControlMode: 'orbit', artworkMotionMode: 'circularTilt', viewerMotionLoopCount: 1,
            artworkTiltHorizontalDegrees: 40, artworkTiltVerticalDegrees: 10 };
        const scope = effectScope();
        const motion = scope.run(() => useViewerMotion({ app, camera: { value: camera },
            controls: { value: { target: new Vector3() } },
            tileManager: { value: { getSeamlessLoopDuration: () => 1 } },
            ribbonSeries: { value: { getTransformRoot: () => root } },
            cinematicCamera: { isPlaying: { value: false } },
        }));
        try {
            motion.tick(0);
            expect(root.quaternion.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 40 * Math.PI / 180))).toBeCloseTo(0, 7);
            motion.tick(250);
            const pitch10 = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 10 * Math.PI / 180);
            expect(root.quaternion.angleTo(pitch10)).toBeCloseTo(0, 7);
            app.artworkTiltVerticalDegrees = 35;
            motion.tick(250);
            const pitch35 = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 35 * Math.PI / 180);
            expect(root.quaternion.angleTo(pitch35)).toBeCloseTo(0, 7);
            motion.tick(1250);
            expect(root.quaternion.angleTo(pitch35)).toBeCloseTo(0, 7);
            app.artworkTiltHorizontalDegrees = 0;
            app.artworkTiltVerticalDegrees = 0;
            motion.tick(1300);
            expect(root.quaternion.equals(new Quaternion())).toBe(true);
            motion.deactivate();
            expect(root.quaternion.equals(new Quaternion())).toBe(true);
        } finally {
            scope.stop();
        }
    });
});
