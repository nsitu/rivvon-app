import { describe, expect, it } from 'vitest';
import { DataArrayTexture, PerspectiveCamera, Scene } from 'three';
import { useSceneBackground } from './useSceneBackground.js';

function fixture(rendererType) {
    const texture = new DataArrayTexture(new Uint8Array(4 * 4), 1, 1, 4);
    const camera = new PerspectiveCamera();
    const app = { rendererType, animatedBackgroundEnabled: true, textureAnimationEnabled: true,
        backgroundAnimationSyncEnabled: true, backgroundLayerIndex: 2, backgroundBlurEnabled: false };
    const ctx = { app, camera: { value: camera }, scene: { value: new Scene() }, renderer: { value: {} },
        backgroundTexture: { value: null }, getBackgroundTime: () => 0,
        tileManager: { value: { arrayTextures: [texture], variant: 'waves', currentLayer: 2,
            getLayerCount: () => 4, getSeamlessLoopDuration: () => 12 } } };
    return { app, camera, runtime: useSceneBackground(ctx) };
}

describe.each(['webgl', 'webgpu'])('background renderer uniforms (%s)', (rendererType) => {
    it('updates both flip axes independently without rebuilding the material', async () => {
        const { runtime, camera, app } = fixture(rendererType);
        app.backgroundFlipHorizontal = true;
        await runtime.setBackgroundFromTileManager();
        const material = camera.children[0].material;
        const read = () => rendererType === 'webgl'
            ? [material.uniforms.uFlipHorizontal.value, material.uniforms.uFlipVertical.value]
            : [material._flipHorizontalUniform.value, material._flipVerticalUniform.value];
        expect(read()).toEqual([1, 0]);
        for (const [horizontal, vertical] of [[false, true], [true, true], [false, false]]) {
            app.backgroundFlipHorizontal = horizontal;
            app.backgroundFlipVertical = vertical;
            runtime.updateBackground();
            expect(read()).toEqual([Number(horizontal), Number(vertical)]);
            expect(camera.children[0].material).toBe(material);
        }
        runtime.disposeBackground();
    });

    it('blends independently of the ribbon layer, updates speed without rebuilding, and retains a fixed layer when disabled', async () => {
        const { runtime, camera, app } = fixture(rendererType);
        await runtime.setBackgroundFromTileManager();
        const material = camera.children[0].material;
        const read = () => rendererType === 'webgl'
            ? [material.uniforms.uLayer.value, material.uniforms.uNextLayer.value, material.uniforms.uLayerBlend.value]
            : [material._layerUniform.value, material._nextLayerUniform.value, material._layerBlendUniform.value];
        runtime.updateBackground({ timeSeconds: 10.5, deterministicBackground: true });
        expect(read()).toEqual([3, 0, 0.5]);
        app.backgroundAnimationSyncEnabled = false;
        app.backgroundCycleDuration = 24;
        runtime.updateBackground({ timeSeconds: 21, deterministicBackground: true });
        expect(read()).toEqual([3, 0, 0.5]);
        expect(camera.children[0].material).toBe(material);
        app.animatedBackgroundEnabled = false;
        runtime.updateBackground({ timeSeconds: 21 });
        expect(read()).toEqual([2, 2, 0]);
        runtime.disposeBackground();
        expect(camera.children).toHaveLength(0);
    });
});
