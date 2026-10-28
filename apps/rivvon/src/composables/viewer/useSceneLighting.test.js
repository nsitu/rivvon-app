import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import * as THREE from 'three';
import { useSceneLighting } from './useSceneLighting.js';

const cleanups = [];
afterEach(() => {
    cleanups.splice(0).reverse().forEach(cleanup => cleanup());
    vi.unstubAllGlobals();
});

async function fixture({ webGPU = false, coarsePointer = false, previewResolution } = {}) {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: coarsePointer }) });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 250);
    camera.position.set(0, 0, 10);
    const root = new THREE.Group();
    const geometry = new THREE.PlaneGeometry();
    const material = new THREE.MeshBasicMaterial({ map: new THREE.Texture() });
    const artwork = new THREE.Mesh(geometry, material);
    root.add(artwork);
    scene.add(root);
    let currentTarget = null;
    const frames = [];
    const renderer = {
        domElement: { width: 1600, height: 900 },
        isWebGPURenderer: webGPU,
        shadowMap: {},
        getRenderTarget: () => currentTarget,
        setRenderTarget: target => { currentTarget = target; },
        getClearColor: color => color.set(0x123456),
        getClearAlpha: () => 0,
        setClearColor: vi.fn(),
        clear: vi.fn(),
        render: vi.fn((_scene, projector) => {
            frames.push({ target: currentTarget, width: currentTarget.width, height: currentTarget.height, aspect: projector.aspect });
        }),
    };
    const app = {
        sceneLightingEnabled: true,
        sceneColoredShadowsEnabled: true,
        sceneLightingIntensity: 1,
        sceneShadowOpacity: 0.5,
        sceneLightDistance: 5,
        sceneShadowPlaneDistance: 5,
        sceneProjectionPreviewResolution: previewResolution,
    };
    const scope = effectScope();
    const lighting = scope.run(() => useSceneLighting({
        app,
        scene: { value: scene },
        camera: { value: camera },
        renderer: { value: renderer },
        ribbonSeries: { value: { getTransformRoot: () => root } },
        controls: { value: null },
        tileManagers: { value: [] },
        tileManager: { value: null },
    }));
    cleanups.push(() => {
        lighting.dispose();
        scope.stop();
        geometry.dispose();
        material.map.dispose();
        material.dispose();
    });
    await lighting.init();
    return { lighting, frames, camera, app, renderer, artwork, material, scene };
}

describe.each([['WebGL', false], ['WebGPU', true]])('%s colored projection resolution', (_name, webGPU) => {
    it.each([256, 512])('uses a selected %i preview resolution on either pointer type', async previewResolution => {
        for (const coarsePointer of [false, true]) {
            const { lighting, frames, app } = await fixture({ webGPU, coarsePointer, previewResolution });
            expect(frames.at(-1)).toMatchObject({ width: previewResolution, height: previewResolution });
            const nextResolution = previewResolution === 256 ? 512 : 256;
            app.sceneProjectionPreviewResolution = nextResolution;
            lighting.tick();
            expect(frames.at(-1)).toMatchObject({ width: nextResolution, height: nextResolution });
        }
    });

    it('tracks rendered canvas dimensions in full-size previews and reuses unchanged targets', async () => {
        const { lighting, frames, renderer, app } = await fixture({ webGPU, previewResolution: 'full' });
        expect(frames.at(-1)).toMatchObject({ width: 1600, height: 900 });
        const dispose = vi.fn();
        frames[0].target.addEventListener('dispose', dispose);
        lighting.tick();
        expect(dispose).not.toHaveBeenCalled();
        renderer.domElement.width = 2160;
        renderer.domElement.height = 2160;
        lighting.tick();
        expect(frames.at(-1)).toMatchObject({ width: 2160, height: 2160 });
        expect(dispose).toHaveBeenCalledOnce();
        app.sceneProjectionPreviewResolution = 256;
        lighting.tick();
        expect(frames.at(-1)).toMatchObject({ width: 256, height: 256 });
    });

    it.each([256, 512, 'full'])('overrides the %s preview choice for export and restores the selected resolution', async previewResolution => {
        const { lighting, frames } = await fixture({ webGPU, previewResolution });
        lighting.tick({ blurMode: 'export', width: 1920, height: 1080 });
        expect(frames.at(-1)).toMatchObject({ width: 1920, height: 1080 });
        lighting.restorePreviewResolution();
        const target = frames.at(-1).target;
        expect([target.width, target.height]).toEqual(previewResolution === 'full' ? [1600, 900] : [previewResolution, previewResolution]);
    });

    it.each([[1920, 1080], [2160, 2160]])('renders exports at %i × %i and reuses the target between frames', async (width, height) => {
        const { lighting, frames, camera, scene } = await fixture({ webGPU });
        const target = frames[0].target;
        const texture = target.texture;
        const dispose = vi.fn();
        target.addEventListener('dispose', dispose);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        lighting.tick({ blurMode: 'export', width, height });
        lighting.tick({ blurMode: 'export', width, height });
        expect(frames.slice(-2)).toEqual([
            { target, width, height, aspect: width / height },
            { target, width, height, aspect: width / height },
        ]);
        expect(dispose).toHaveBeenCalledOnce();
        expect(target.texture).toBe(texture);
        if (!webGPU) {
            expect(scene.getObjectByName('RivvonBackgroundShadowCatcher').material.uniforms.uTransmissionMap.value).toBe(texture);
        }

        lighting.restorePreviewResolution();
        expect([target.width, target.height]).toEqual([512, 512]);
        expect(dispose).toHaveBeenCalledTimes(2);
        lighting.tick();
        expect(frames.at(-1)).toMatchObject({ width: 512, height: 512 });
        expect(dispose).toHaveBeenCalledTimes(2);
    });

    it('keeps touch previews small while rendering exports at full resolution', async () => {
        const { lighting, frames } = await fixture({ webGPU, coarsePointer: true });
        expect(frames[0]).toMatchObject({ width: 256, height: 256 });
        lighting.tick({ width: 1920, height: 1080 });
        expect(frames.at(-1)).toMatchObject({ width: 256, height: 256 });
        lighting.tick({ blurMode: 'export', width: 2160, height: 2160 });
        expect(frames.at(-1)).toMatchObject({ width: 2160, height: 2160 });
        lighting.tick();
        expect(frames.at(-1)).toMatchObject({ width: 256, height: 256 });
    });

    it('does not enlarge the target when colored projection is disabled', async () => {
        const { lighting, frames, app, renderer } = await fixture({ webGPU });
        const target = frames[0].target;
        app.sceneColoredShadowsEnabled = false;
        renderer.render.mockClear();
        lighting.tick({ blurMode: 'export', width: 2160, height: 2160 });
        expect([target.width, target.height]).toEqual([512, 512]);
        expect(renderer.render).not.toHaveBeenCalled();
    });

    it('restores scene state after a projection render fails and can release the export allocation', async () => {
        const { lighting, renderer, frames, artwork, material, scene } = await fixture({ webGPU });
        const background = new THREE.Color('red');
        scene.background = background;
        renderer.render.mockImplementationOnce(() => { throw new Error('Render failed'); });
        expect(() => lighting.tick({ blurMode: 'export', width: 1920, height: 1080 })).toThrow('Render failed');
        expect(renderer.getRenderTarget()).toBeNull();
        expect(artwork.material).toBe(material);
        expect(scene.background).toBe(background);
        expect(scene.getObjectByName('RivvonBackgroundShadowCatcher').visible).toBe(true);
        lighting.restorePreviewResolution();
        expect([frames[0].target.width, frames[0].target.height]).toEqual([512, 512]);
    });
});
