import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createArtworkBlendCompositor, ARTWORK_BACKDROP_FLAG } from './artworkBlend.js';
import { useRenderFilter } from '../../composables/viewer/useRenderFilter.js';

function fixture() {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(); scene.add(camera);
    scene.background = new THREE.Color('#123456');
    const mesh = name => { const object = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()); object.name = name; return object; };
    const backdrop = mesh('backdrop'); backdrop.userData[ARTWORK_BACKDROP_FLAG] = true; camera.add(backdrop);
    const catcher = mesh('shadow catcher'); catcher.userData[ARTWORK_BACKDROP_FLAG] = true; scene.add(catcher);
    const artwork = mesh('artwork'), hidden = mesh('hidden'); hidden.visible = false;
    scene.add(artwork, hidden);
    const light = new THREE.SpotLight(); light.shadow.needsUpdate = true; scene.add(light);
    let target = { name: 'caller target' }, clearColor = new THREE.Color('#334455'), clearAlpha = .4;
    const draws = [];
    const renderer = {
        domElement: { width: 96, height: 64 }, shadowMap: { autoUpdate: true, needsUpdate: false },
        getDrawingBufferSize: size => size.set(96, 64), getRenderTarget: () => target,
        setRenderTarget: value => { target = value; },
        getClearColor: color => color.copy(clearColor), getClearAlpha: () => clearAlpha,
        setClearColor: (color, alpha) => { clearColor = new THREE.Color(color); clearAlpha = alpha; }, clear: vi.fn(),
        render: vi.fn((renderScene, renderCamera) => {
            const names = []; renderScene.traverseVisible(object => { if (object.isMesh) names.push(object.name); });
            draws.push({ names, target, width: target?.width, camera: renderCamera,
                shadowAuto: light.shadow.autoUpdate, shadowNeeds: light.shadow.needsUpdate,
                backdropTransparent: backdrop.material.transparent, material: renderScene.children[0]?.material });
        }),
    };
    const ctx = { app: { artworkBlendMode: 'softLight', renderFilterMode: 'none', renderAntialiasEnabled: false },
        scene: { value: scene }, camera: { value: camera }, renderer: { value: renderer } };
    return { ctx, renderer, draws, scene, camera, backdrop, catcher, artwork, hidden, light };
}

describe('completed artwork compositing', () => {
    it('isolates camera-attached backdrop and shadows without changing depth-tested artwork or hidden objects', () => {
        const h = fixture(), compositor = createArtworkBlendCompositor(h.ctx); compositor.init('webgl');
        const originalTarget = h.renderer.getRenderTarget(), originalBackground = h.scene.background;
        compositor.render(null, () => h.renderer.render(h.scene, h.camera));
        expect(h.draws[0].names).toEqual(['artwork']);
        expect(h.draws[1].names).toEqual(['backdrop', 'shadow catcher']);
        expect(h.draws[0].target.depthBuffer).toBe(true);
        expect(h.draws[1].target.depthBuffer).toBe(false);
        expect(h.draws[1]).toMatchObject({ shadowAuto: false, shadowNeeds: false, backdropTransparent: true });
        expect(h.backdrop.material.transparent).toBe(false);
        expect(h.artwork.visible).toBe(true); expect(h.hidden.visible).toBe(false);
        expect(h.light.shadow.autoUpdate).toBe(true); expect(h.light.shadow.needsUpdate).toBe(true);
        expect(h.scene.background).toBe(originalBackground);
        expect(h.renderer.getRenderTarget()).toBe(originalTarget); expect(h.renderer.getClearAlpha()).toBe(.4);
        compositor.dispose();
    });

    it.each([1, 2])('restores scene, shadow, and renderer state when pass %s throws', pass => {
        const h = fixture(), compositor = createArtworkBlendCompositor(h.ctx); compositor.init('webgl');
        const render = h.renderer.render.getMockImplementation(), originalBackground = h.scene.background;
        h.renderer.render.mockImplementation((...args) => { render(...args); if (h.draws.length === pass) throw new Error('GPU draw failed'); });
        expect(() => compositor.render(null, () => h.renderer.render(h.scene, h.camera))).toThrow('GPU draw failed');
        expect(h.backdrop.visible).toBe(true); expect(h.catcher.visible).toBe(true);
        expect(h.artwork.visible).toBe(true); expect(h.hidden.visible).toBe(false);
        expect(h.backdrop.material.transparent).toBe(false); expect(h.light.shadow.needsUpdate).toBe(true);
        expect(h.scene.background).toBe(originalBackground); expect(h.renderer.getRenderTarget()).toEqual({ name: 'caller target' });
        expect(h.renderer.getClearAlpha()).toBe(.4); compositor.dispose();
    });

    it.each(['softLight', 'multiply', 'screen', 'overlay', 'difference'])('uses export target dimensions, restores preview size, and disposes %s targets when Normal is selected', async mode => {
        const h = fixture(), filter = useRenderFilter(h.ctx); await filter.initRenderFilter('webgl');
        h.ctx.app.artworkBlendMode = mode;
        h.artwork.material._hasCapMask = true; h.artwork.material.alphaToCoverage = true;
        filter.renderScene();
        const source = h.draws[0].target, backdrop = h.draws[1].target;
        const sourceDisposed = vi.fn(), backdropDisposed = vi.fn();
        source.addEventListener('dispose', sourceDisposed); backdrop.addEventListener('dispose', backdropDisposed);
        filter.renderScene(new THREE.WebGLRenderTarget(192, 128));
        expect(h.draws[3].width).toBe(192); expect(h.draws[3].target).toBe(source);
        filter.renderScene(); expect(h.draws[6].width).toBe(96);
        expect(h.artwork.material.alphaToCoverage).toBe(true); expect(h.artwork.material.transparent).toBe(false);
        h.ctx.app.artworkBlendMode = 'normal';
        const before = h.draws.length; filter.renderScene();
        expect(h.draws).toHaveLength(before + 1);
        expect(h.draws.at(-1).names).toEqual(['backdrop', 'shadow catcher', 'artwork']);
        expect(sourceDisposed).toHaveBeenCalled(); expect(backdropDisposed).toHaveBeenCalled();
        filter.disposeRenderFilter();
    });

    it('keeps filtered blend inputs at the export target resolution and applies alpha only once', async () => {
        const h = fixture(); h.ctx.app.renderFilterMode = 'gradientMap'; h.ctx.app.gradientMapMix = 0;
        const filter = useRenderFilter(h.ctx); await filter.initRenderFilter('webgl');
        const target = new THREE.WebGLRenderTarget(192, 128); filter.renderScene(target);
        expect(h.draws[0].target.width).toBe(192); expect(h.draws[0].target.height).toBe(128);
        expect(h.draws.at(-1).target).toBe(target);
        expect(h.draws.at(-1).material.blending).toBe(THREE.NoBlending);
        filter.disposeRenderFilter(); target.dispose();
    });
});
