import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { getAmplitudeTarget, getAudioRms, renderWithAudioZoom, smoothAudioAmplitude } from './audioReactivity.js';

describe('audio amplitude', () => {
    it('measures signal energy without cancelling opposite-phase stereo', () => {
        expect(getAudioRms([[0.5, -0.5], [-0.5, 0.5]])).toBe(0.5);
        expect(getAudioRms([[0.5, -0.5]])).toBe(0.5);
        expect(getAudioRms([[0, 0], [0, 0]])).toBe(0);
        expect(getAudioRms([])).toBe(0);
    });

    it('rejects noise, handles invalid input and bounds sensitivity', () => {
        expect(getAmplitudeTarget(0.003)).toBe(0);
        expect(getAmplitudeTarget(0.255, 2)).toBeCloseTo(0.5);
        expect(getAmplitudeTarget(2, 100)).toBe(1);
        expect(getAmplitudeTarget(NaN)).toBe(0);
    });

    it('has the same response after a second at different frame rates', () => {
        function run(fps, initial, target) {
            let value = initial;
            for (let frame = 0; frame < fps; frame += 1) value = smoothAudioAmplitude(value, target, 1 / fps);
            return value;
        }
        expect(run(30, 0, 1)).toBeCloseTo(run(120, 0, 1), 12);
        expect(run(30, 1, 0)).toBeCloseTo(run(120, 1, 0), 12);
        expect(smoothAudioAmplitude(0, 1, 0.03)).toBeGreaterThan(1 - smoothAudioAmplitude(1, 0, 0.03));
        expect(smoothAudioAmplitude(0.4, 1, 0)).toBe(0.4);
    });
});

describe('render-only audio zoom', () => {
    it('composes with base zoom and FOV, then restores the projection without accumulation', () => {
        const camera = new PerspectiveCamera(45, 1.5, 0.1, 100);
        camera.zoom = 1.4;
        camera.updateProjectionMatrix();
        const original = camera.projectionMatrix.clone();
        for (let frame = 0; frame < 5; frame += 1) {
            renderWithAudioZoom(camera, 0.5, 0.2, () => {
                expect(camera.zoom).toBeCloseTo(1.54);
                expect(camera.fov).toBe(45);
                expect(camera.projectionMatrix.equals(original)).toBe(false);
            });
            expect(camera.zoom).toBe(1.4);
            expect(camera.projectionMatrix.equals(original)).toBe(true);
        }
    });

    it('restores the camera even when rendering fails', () => {
        const camera = new PerspectiveCamera();
        const original = camera.projectionMatrix.clone();
        expect(() => renderWithAudioZoom(camera, 1, 0.5, () => { throw new Error('device lost'); })).toThrow('device lost');
        expect(camera.zoom).toBe(1);
        expect(camera.projectionMatrix.equals(original)).toBe(true);
    });
});
