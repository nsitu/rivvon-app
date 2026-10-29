import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataArrayTexture, DataTexture, TextureLoader, HalfFloatType, LinearSRGBColorSpace, PerspectiveCamera, OrthographicCamera, Scene, UnsignedByteType } from 'three';
import { useSceneBackground } from './useSceneBackground.js';
import { setBackgroundImageAccessScope } from '../../services/backgroundImageCache.js';
beforeEach(() => setBackgroundImageAccessScope(crypto.randomUUID()));

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

describe('background replacement transactions', () => {
    it.each(['webgl', 'webgpu'])('updates Normal/Soft Light without rebuilding the %s background', async rendererType => {
        setBackgroundImageAccessScope(crypto.randomUUID());
        const loader = vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((_url, onLoad) => {
            const texture = new DataTexture(new Uint8Array([120, 100, 80, 128]), 1, 1); onLoad(texture); return texture;
        });
        const { runtime, app, camera } = fixture(rendererType);
        app.backgroundTextureEnabled = true; app.backgroundTexture = 'card'; app.backgroundTextureBlendMode = 'softLight';
        try {
            await runtime.setBackgroundFromTileManager();
            const material = camera.children[0].material;
            const uniforms = rendererType === 'webgl' ? material.uniforms : material._staticTextureAdjustmentUniforms;
            expect(uniforms.uStaticTextureNormalMode.value).toBe(false);
            app.backgroundTextureBlendMode = 'normal'; runtime.updateBackground();
            expect(uniforms.uStaticTextureNormalMode.value).toBe(true);
            expect(camera.children[0].material).toBe(material);
            if (rendererType === 'webgl') expect(material.fragmentShader).toContain('staticSample.a');
        } finally { runtime.disposeBackground(); loader.mockRestore(); }
    });

    it('retains the active runtime after failure and ignores an older replacement that completes late', async () => {
        setBackgroundImageAccessScope(crypto.randomUUID());
        const pending = new Map();
        const loader = vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((url, resolve, _progress, reject) => {
            const texture = new DataTexture(new Uint8Array(4), 1, 1);
            if (url.includes('card')) resolve(texture); else pending.set(url, { resolve: () => resolve(texture), reject });
            return texture;
        });
        const { runtime, app, camera } = fixture('webgl');
        app.backgroundTextureEnabled = true; app.backgroundTexture = 'card';
        try {
            await runtime.setBackgroundFromTileManager(); const original = camera.children[0];
            app.backgroundTexture = 'textile'; const failed = runtime.setBackgroundFromTileManager();
            pending.get('/background-textures/textile.jpg').reject(new Error('Offline'));
            await expect(failed).rejects.toThrow('Offline');
            expect(camera.children[0]).toBe(original);
            await expect(runtime.ensureReady()).rejects.toThrow('Offline');
            const older = runtime.setBackgroundFromTileManager();
            app.backgroundTexture = 'cenote'; const newer = runtime.setBackgroundFromTileManager();
            pending.get('/background-textures/cenote.jpg').resolve(); await newer;
            const current = camera.children[0]; expect(current).not.toBe(original);
            pending.get('/background-textures/textile.jpg').resolve(); await older;
            expect(camera.children[0]).toBe(current); await runtime.ensureReady();
        } finally { runtime.disposeBackground(); loader.mockRestore(); }
    });
});

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

    it.each(['sharp', 'blurred', 'gradient'].flatMap(mode => ['perspective', 'orthographic'].map(cameraType => [mode, cameraType])))('fits static images in %s backgrounds with a %s camera and restores preview after export', async (mode, cameraType) => {
        const loader = vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((_url, onLoad) => {
            const texture = new DataTexture(new Uint8Array(8), 2, 1);
            onLoad(texture);
            return texture;
        });
        const { runtime, ctx, app } = blurredFixture();
        const camera = cameraType === 'orthographic' ? new OrthographicCamera(-2, 2, 1, -1, 0.1, 1000) : ctx.camera.value;
        ctx.camera.value = camera;
        const setAspect = aspect => {
            if (camera.isOrthographicCamera) { camera.left = -aspect; camera.right = aspect; }
            else camera.aspect = aspect;
            camera.updateProjectionMatrix();
        };
        setAspect(2);
        app.backgroundTextureEnabled = true;
        app.backgroundTexture = 'card';
        app.backgroundMode = mode === 'gradient' ? 'gradient' : 'texture';
        app.backgroundBlurEnabled = mode === 'blurred';
        try {
            await runtime.setBackgroundFromTileManager();
            const material = camera.children[0].material;
            const readScale = () => {
                const active = camera.children[0].material;
                return (rendererType === 'webgl' ? active.uniforms : active._staticTextureAdjustmentUniforms).uStaticTextureUvScale.value.toArray();
            };
            const readOffset = () => {
                const active = camera.children[0].material;
                return (rendererType === 'webgl' ? active.uniforms : active._staticTextureAdjustmentUniforms).uStaticTextureUvOffset.value.toArray();
            };
            expect(readScale()).toEqual([1, 1]);
            expect(readOffset()).toEqual([0, 0]);
            for (const [aspect, expected] of [[4, [1, 0.5]], [0.5, [0.25, 1]], [1, [0.5, 1]]]) {
                setAspect(aspect);
                runtime.updateBackground();
                expect(readScale()).toEqual(expected);
                expect(camera.children[0].material).toBe(material);
                for (const alignment of [0, 0.5, 1]) {
                    app.backgroundTextureVerticalAlignment = alignment;
                    runtime.updateBackground();
                    expect(readOffset()).toEqual([(1 - expected[0]) / 2, (1 - expected[1]) * (1 - alignment)]);
                    expect(readScale()).toEqual(expected);
                    expect(camera.children[0].material).toBe(material);
                }
            }
            setAspect(4);
            runtime.updateBackground({ blurMode: 'export', width: 1024, height: 256 });
            expect(readScale()).toEqual([1, 0.5]);
            expect(readOffset()).toEqual([0, 0]);
            app.backgroundTextureVerticalAlignment = 0;
            runtime.updateBackground({ blurMode: 'export', width: 1024, height: 256 });
            expect(readOffset()).toEqual([0, 0.5]);
            setAspect(1);
            runtime.updateBackground();
            expect(readScale()).toEqual([0.5, 1]);
        } finally {
            runtime.disposeBackground();
            loader.mockRestore();
        }
    });

    it.each(['sharp', 'blurred', 'gradient'])('updates static texture treatment in %s preview and export without rebuilding', async mode => {
        const loader = vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((_url, onLoad) => {
            const texture = new DataTexture(new Uint8Array([120, 100, 80, 255]), 1, 1);
            onLoad(texture);
            return texture;
        });
        const { runtime, camera, app } = blurredFixture();
        app.backgroundBlurEnabled = mode === 'blurred';
        app.backgroundMode = mode === 'gradient' ? 'gradient' : 'texture';
        app.backgroundTextureEnabled = true;
        app.backgroundTexture = 'cenote';
        app.backgroundTextureContrast = 1.6;
        app.backgroundTextureSaturation = 0.2;
        app.backgroundTextureGradientMapEnabled = true;
        app.backgroundTextureGradientMapStops = [{ position: 0, color: '#123456' }, { position: 1, color: '#abcdef' }];
        // The scene treatment must not drive background-local uniforms.
        app.contrast = 0.7;
        app.saturation = 1.8;
        try {
            await runtime.setBackgroundFromTileManager();
            expect(camera.children).toHaveLength(1);
            const material = camera.children[0].material;
            const uniforms = rendererType === 'webgl' ? material.uniforms : material._staticTextureAdjustmentUniforms;
            expect(uniforms.uStaticTextureContrast.value).toBe(1.6);
            expect(uniforms.uStaticTextureSaturation.value).toBe(0.2);
            expect(uniforms.uStaticTextureGradientMapEnabled.value).toBe(true);
            expect(uniforms.uStaticTextureGradientMapMix.value).toBe(1);
            for (const mix of [0, 0.5, 1]) {
                app.backgroundTextureGradientMapMix = mix;
                runtime.updateBackground();
                expect(uniforms.uStaticTextureGradientMapMix.value).toBe(mix);
                expect(camera.children[0].material).toBe(material);
            }
            app.backgroundTextureGradientMapMix = 0.25;
            app.backgroundTextureContrast = 0.5;
            app.backgroundTextureSaturation = 0;
            app.backgroundTextureGradientMapEnabled = false;
            runtime.updateBackground({ timeSeconds: 3 });
            expect(uniforms.uStaticTextureContrast.value).toBe(0.5);
            expect(uniforms.uStaticTextureSaturation.value).toBe(0);
            expect(uniforms.uStaticTextureGradientMapEnabled.value).toBe(false);
            expect(camera.children[0].material).toBe(material);
            runtime.updateBackground({ blurMode: 'export', width: 384, height: 192, timeSeconds: 3 });
            const exportMaterial = camera.children[0].material;
            const exportUniforms = rendererType === 'webgl' ? exportMaterial.uniforms : exportMaterial._staticTextureAdjustmentUniforms;
            expect(exportUniforms.uStaticTextureContrast.value).toBe(0.5);
            expect(exportUniforms.uStaticTextureSaturation.value).toBe(0);
            expect(exportUniforms.uStaticTextureGradientMapEnabled.value).toBe(false);
            expect(exportUniforms.uStaticTextureGradientMapMix.value).toBe(0.25);
            expect(app.contrast).toBe(0.7);
            expect(app.saturation).toBe(1.8);
        } finally {
            runtime.disposeBackground();
            loader.mockRestore();
        }
    });

    it('caches source palettes and updates only nine colors without blur targets in preview or export', async () => {
        const { runtime, ctx, camera, app, renderer, renders } = blurredFixture();
        app.backgroundMode = 'gradient';
        const callerTarget = renderer.getRenderTarget();
        await runtime.setBackgroundFromTileManager();
        expect(camera.children).toHaveLength(1);
        expect(ctx.backgroundTexture.value.image).toMatchObject({ width: 3, height: 3 });
        // One atlas extraction (four 3x3 layers), then nine interpolated colors.
        expect(renders).toHaveLength(2);
        expect(renders[0].target.texture.image).toMatchObject({ width: 6, height: 6 });
        const atlas = renders[0].target;
        const atlasDisposed = vi.fn();
        atlas.addEventListener('dispose', atlasDisposed);
        const output = ctx.backgroundTexture.value;
        const outputDisposed = vi.fn();
        renders[1].target.addEventListener('dispose', outputDisposed);
        renders.length = 0;
        runtime.updateBackground({ timeSeconds: 0, blurMode: 'export', width: 3840, height: 2160 });
        expect(renders).toHaveLength(0);
        expect(ctx.backgroundTexture.value).toBe(output);
        runtime.updateBackground({ timeSeconds: 10.5, deterministicBackground: true });
        expect(renders).toHaveLength(1);
        expect(renders[0].target.texture.image).toMatchObject({ width: 3, height: 3 });
        app.backgroundGradientInfluence = 1.2;
        app.backgroundGradientFalloff = 4;
        runtime.updateBackground({ timeSeconds: 10.5, deterministicBackground: true });
        expect(renders).toHaveLength(1); // Influence/falloff do not resample the source.
        const display = camera.children[0].material;
        expect(rendererType === 'webgl' ? display.uniforms.uGradientInfluence.value : display._gradientInfluenceUniform.value).toBe(1.2);
        ctx.tileManager.value.arrayTextures[0].needsUpdate = true;
        runtime.updateBackground({ timeSeconds: 10.5, deterministicBackground: true });
        expect(renders).toHaveLength(3); // Changed source version: replace atlas, then update nine colors.
        expect(atlasDisposed).toHaveBeenCalledOnce();
        const interpolation = await runtime.createExportInterpolation();
        expect(await interpolation.prepareFrame({ timeSeconds: 1 })).toBeNull();
        await interpolation.dispose();
        expect(renderer.getRenderTarget()).toBe(callerTarget);
        runtime.disposeBackground();
        expect(atlasDisposed).toHaveBeenCalledOnce();
        expect(outputDisposed).toHaveBeenCalledOnce();
        expect(camera.children).toHaveLength(0);
    });

    it('restores the caller target after a gradient palette render fails', async () => {
        const { runtime, app, renderer } = blurredFixture();
        app.backgroundMode = 'gradient';
        await runtime.setBackgroundFromTileManager();
        const callerTarget = renderer.getRenderTarget();
        renderer.render.mockImplementationOnce(() => { throw new Error('GPU render failed'); });
        expect(() => runtime.updateBackground({ timeSeconds: 10.5, deterministicBackground: true })).toThrow('GPU render failed');
        expect(renderer.getRenderTarget()).toBe(callerTarget);
        runtime.disposeBackground();
    });

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
