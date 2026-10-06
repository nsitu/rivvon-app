import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TileManager } from './tileManager.js';

function createManager(options = {}) {
    return new TileManager({
        filmstripStyleEnabled: true,
        filmstripMotionEnabled: true,
        flowAlignmentEnabled: false,
        ...options,
    });
}

describe('filmstrip motion', () => {
    it('moves independently, freezes when disabled, and resumes without jumping', () => {
        const tm = createManager();
        tm.setFlowSpeed(0.25);
        tm.tickDeterministic(0.4);
        expect(tm.sharedFilmstripOffsetUniform.value).toBeCloseTo(0.1);
        tm.setFilmstripMotionEnabled(false);
        tm.tickDeterministic(1);
        expect(tm.sharedFilmstripOffsetUniform.value).toBeCloseTo(0.1);
        tm.setFilmstripMotionEnabled(true);
        tm.setFilmstripMotionSpeed(2);
        tm.tickDeterministic(0.1);
        expect(tm.sharedFilmstripOffsetUniform.value).toBeCloseTo(0.15);
    });

    it('matches the applied conveyor speed and reverses with it', () => {
        const tm = createManager({ flowAlignmentEnabled: true, tileCount: 3 });
        tm.layerCount = 9;
        tm.setFlowSpeed(0.37);
        tm.setFlowEnabled(true);
        expect(tm.getFilmstripMotionSpeed()).toBe(tm.getFlowSpeed());
        tm.tickDeterministic(0.1);
        expect(tm.sharedFilmstripOffsetUniform.value).toBeCloseTo(tm.flowOffset);
        tm.setFlowSpeed(-0.37);
        tm.tickDeterministic(0.1);
        const offset = tm.sharedFilmstripOffsetUniform.value;
        expect(Math.min(offset, 0.25 - offset)).toBeCloseTo(0);
    });

    it('keeps the pattern continuous when textures cross a whole tile', () => {
        const tm = createManager({ filmstripGapLength: 0.17 });
        tm.setFlowEnabled(true);
        tm.advanceFlowOffset(1.1);
        const offset = tm.sharedFilmstripOffsetUniform.value;
        tm.wrapFlowOffset(1);
        expect(tm.sharedFilmstripOffsetUniform.value).toBe(offset);
        expect(offset).toBeCloseTo(0.02);
    });

    it('uses per-render elapsed time even between layer animation frames', () => {
        const tm = createManager();
        tm.layerCount = 30;
        tm.setFlowSpeed(0.25);
        tm.setFlowEnabled(true);
        for (let now = 1000; now <= 1100; now += 10) tm.tick(now);
        expect(tm.flowOffset).toBeCloseTo(0.025);
        expect(tm.sharedFilmstripOffsetUniform.value).toBeCloseTo(0.025);
    });

    it('follows scroll-driven conveyor displacement without adding timed motion', () => {
        const tm = createManager();
        tm.setFlowEnabled(true);
        tm.tick(1000, { suppressFlowAnimation: true });
        tm.advanceFlowOffset(0.1);
        tm.tick(1100, { suppressFlowAnimation: true });
        expect(tm.sharedFilmstripOffsetUniform.value).toBeCloseTo(0.1);
    });

    it('excludes hidden filmstrip motion and resets deterministically', () => {
        const tm = createManager();
        tm.setFilmstripStyleEnabled(false);
        tm.tickDeterministic(1);
        expect(tm.sharedFilmstripOffsetUniform.value).toBe(0);
        expect(tm.getFilmstripCyclePeriod()).toBe(0);
        tm.setFilmstripStyleEnabled(true);
        tm.tickDeterministic(0.4);
        tm.resetAnimationState();
        expect(tm.sharedFilmstripOffsetUniform.value).toBe(0);
        tm.tickDeterministic(0.4);
        expect(tm.sharedFilmstripOffsetUniform.value).toBeCloseTo(0.1);
    });

    it('includes moving perforations in the seamless material loop', () => {
        const tm = createManager();
        tm.layerCount = 3;
        tm.variant = 'waves';
        tm.setFlowSpeed(0.25);
        expect(tm.getFilmstripCyclePeriod()).toBeCloseTo(1);
        expect(tm.getSeamlessLoopDuration(false)).toBeCloseTo(1);
        tm.setFilmstripMotionSpeed(1.3);
        expect(tm.getSeamlessLoopDuration(false)).toBeCloseTo(10);
        tm.setFilmstripMotionEnabled(false);
        expect(tm.getSeamlessLoopDuration(false)).toBeCloseTo(0.1);
    });

    it.each(['webgl', 'webgpu'])('updates static and flow material offsets in %s', async rendererType => {
        const tm = createManager({ rendererType, tileCount: 1 });
        if (rendererType === 'webgpu') {
            tm._webgpuDeps = {
                threeWebGPU: await import('three/webgpu'),
                threeTSL: await import('three/tsl'),
            };
        }
        tm.arrayTextures = [new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1)];
        tm.materials = [new THREE.MeshBasicMaterial()];
        const staticMaterial = tm.getMaterial(0, { orientationMirrorY: true });
        const flowMaterial = tm.createFlowMaterial(0);
        tm.tickDeterministic(0.4);
        expect(staticMaterial._filmstripOffsetUniform.value).toBeCloseTo(0.1);
        expect(flowMaterial._filmstripOffsetUniform.value).toBeCloseTo(0.1);
        tm.resetAnimationState();
        expect(staticMaterial._filmstripOffsetUniform.value).toBe(0);
        expect(flowMaterial._filmstripOffsetUniform.value).toBe(0);
        tm.dispose();
    });
});
