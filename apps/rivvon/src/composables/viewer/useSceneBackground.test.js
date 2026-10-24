import { describe, expect, it, vi } from 'vitest';
import { DataArrayTexture, HalfFloatType, LinearSRGBColorSpace, PerspectiveCamera, Scene, UnsignedByteType } from 'three';
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
    return { app, camera, ctx, runtime: useSceneBackground(ctx) };
}

describe.each(['webgl', 'webgpu'])('background renderer uniforms (%s)', (rendererType) => {
    function blurredFixture() {
        const result = fixture(rendererType);
        result.app.backgroundBlurEnabled = true;
        result.app.backgroundBlurAmount = 100;
        let target = { name: 'caller render target' };
        const renders = [];
        result.ctx.renderer.value = {
            domElement: { width: 800, height: 400 },
            getRenderTarget: () => target,
            setRenderTarget: value => { target = value; },
            render: vi.fn(scene => renders.push({ target, material: scene.children[0].material })),
        };
        return { ...result, renders, renderer: result.ctx.renderer.value };
    }

    it('uses full-size half-float export targets, restores preview even at identical dimensions, and disposes resources', async () => {
        const { runtime, ctx, camera, renders, renderer, app } = blurredFixture();
        const callerTarget = renderer.getRenderTarget();
        await runtime.setBackgroundFromTileManager();
        expect(ctx.backgroundTexture.value.type).toBe(UnsignedByteType);
        renders.length = 0;
        runtime.updateBackground({ blurMode: 'export', width: 384, height: 192, timeSeconds: 2 });
        expect(renders).toHaveLength(3); // source + dense horizontal + dense vertical
        const exportTarget = renders[0].target;
        expect(exportTarget.texture.type).toBe(HalfFloatType);
        expect(exportTarget.texture.colorSpace).toBe(LinearSRGBColorSpace);
        const disposed = vi.fn();
        exportTarget.addEventListener('dispose', disposed);
        const originalExportTexture = ctx.backgroundTexture.value;
        if (rendererType === 'webgl') {
            expect(renders[0].material.uniforms.uExportLinear.value).toBe(true);
            expect(camera.children[0].material.uniforms.uLinearBlur.value).toBe(true);
        }
        // The export shader and kernel are reused for consecutive frames.
        runtime.updateBackground({ blurMode: 'export', width: 384, height: 192, timeSeconds: 3 });
        expect(ctx.backgroundTexture.value).toBe(originalExportTexture);
        expect(disposed).not.toHaveBeenCalled();
        app.backgroundBlurAmount = 50;
        runtime.updateBackground({ blurMode: 'export', width: 384, height: 192 });
        expect(disposed).toHaveBeenCalledOnce();
        expect(ctx.backgroundTexture.value).not.toBe(originalExportTexture);
        runtime.updateBackground();
        expect(ctx.backgroundTexture.value.type).toBe(UnsignedByteType);
        expect(renderer.getRenderTarget()).toBe(callerTarget);
        if (rendererType === 'webgl') {
            expect(camera.children[0].material.uniforms.uLinearBlur.value).toBe(false);
        }
        runtime.updateBackground({ blurMode: 'export', width: 1920, height: 32 });
        expect(ctx.backgroundTexture.value.image).toMatchObject({ width: 1920, height: 32 });
        const finalTarget = renders.at(-1).target;
        const finalDisposed = vi.fn();
        finalTarget.addEventListener('dispose', finalDisposed);
        runtime.disposeBackground();
        expect(finalDisposed).toHaveBeenCalledOnce();
        expect(camera.children).toHaveLength(0);
    });

    it('restores the caller target if a blur pass fails', async () => {
        const { runtime, renderer } = blurredFixture();
        await runtime.setBackgroundFromTileManager();
        const callerTarget = renderer.getRenderTarget();
        renderer.render.mockImplementationOnce(() => { throw new Error('GPU render failed'); });
        expect(() => runtime.updateBackground({ blurMode: 'export', width: 800, height: 400 })).toThrow('GPU render failed');
        expect(renderer.getRenderTarget()).toBe(callerTarget);
        runtime.disposeBackground();
    });

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
