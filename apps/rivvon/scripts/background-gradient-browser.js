import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { normalizeWebGPUArrayTexture } from '../src/modules/shared/webgpuTextureCompatibility.js';
import { applyRendererDisplayConfig } from '../src/modules/viewer/rendererConfig.js';
import { useSceneBackground } from '../src/composables/viewer/useSceneBackground.js';

const assert = (value, message) => { if (!value) throw new Error(message); };
const pixels = canvas => {
    const copy = new OffscreenCanvas(canvas.width, canvas.height);
    const ctx = copy.getContext('2d'); ctx.drawImage(canvas, 0, 0);
    return ctx.getImageData(0, 0, copy.width, copy.height).data;
};
const mae = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
const errors = [];
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));

window.backgroundGradientTest = (async () => {
    const reports = [];
    for (const rendererType of ['webgl', 'webgpu']) {
        const renderer = rendererType === 'webgpu'
            ? new (await import('three/webgpu')).WebGPURenderer({ antialias: false })
            : new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
        if (renderer.init) await renderer.init();
        if (rendererType === 'webgpu') renderer.backend.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
        renderer.debug.onShaderError = () => errors.push('Shader failed');
        renderer.setSize(96, 64); renderer.setPixelRatio(1);
        applyRendererDisplayConfig(renderer, null, rendererType);
        const loader = new KTX2Loader().setTranscoderPath('/wasm/'); loader.detectSupport(renderer);
        let source, background;
        try {
            source = await loader.loadAsync('/tiles-ktx2-waves/0.ktx2');
            if (rendererType === 'webgpu') source = normalizeWebGPUArrayTexture(source);
            if (rendererType === 'webgl') source.colorSpace = THREE.LinearSRGBColorSpace;
            source.minFilter = source.magFilter = THREE.LinearFilter;
            source.generateMipmaps = false;
            const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1.5, 0.1, 1000);
            const app = { rendererType, backgroundMode: 'gradient', backgroundGradientInfluence: 0.5,
                backgroundGradientFalloff: 2, animatedBackgroundEnabled: true, textureAnimationEnabled: true,
                backgroundAnimationSyncEnabled: false, backgroundCycleDuration: 12,
                backgroundBaseEnabled: true, backgroundBlurEnabled: true };
            const ctx = { renderer: { value: renderer }, scene: { value: scene }, camera: { value: camera },
                backgroundTexture: { value: null }, getBackgroundTime: () => 0, app,
                tileManager: { value: { arrayTextures: [source], variant: 'waves', getLayerCount: () => source.image.depth,
                    getSeamlessLoopDuration: () => 12 } } };
            background = useSceneBackground(ctx);
            await background.setBackgroundFromTileManager();
            assert(camera.children.length === 1, 'Gradient did not attach');
            const draw = (timeSeconds = 0, options = {}) => {
                background.updateBackground({ timeSeconds, deterministicBackground: true, ...options });
                renderer.render(scene, camera);
                return pixels(renderer.domElement);
            };
            const baseline = draw();
            await new Promise(resolve => setTimeout(resolve, 100));
            assert(baseline.some((v, i) => i % 4 !== 3 && v > 30), `Gradient is black: ${errors.join('\n')}`);
            const exportPixels = draw(0, { blurMode: 'export', width: 3840, height: 2160 });
            assert(mae(baseline, exportPixels) < 0.1, 'Preview and export colors differ');
            assert(ctx.backgroundTexture.value.image.width === 3 && ctx.backgroundTexture.value.image.height === 3, 'Full-size target allocated');
            const changed = draw(3.25);
            assert(mae(baseline, changed) > 0.1, 'Layer animation did not change colors');
            app.backgroundFlipHorizontal = true;
            const flipped = draw();
            let flipError = 0;
            for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) for (let c = 0; c < 3; c++) {
                flipError += Math.abs(baseline[(y * 96 + x) * 4 + c] - flipped[(y * 96 + 95 - x) * 4 + c]);
            }
            flipError /= 96 * 64 * 3;
            assert(flipError < 1, `Flip changed orientation: ${flipError}`);
            app.backgroundFlipHorizontal = false;
            app.backgroundGradientInfluence = 0.15; app.backgroundGradientFalloff = 6;
            const local = draw();
            app.backgroundGradientInfluence = 1.5; app.backgroundGradientFalloff = 0.5;
            const broad = draw();
            assert(mae(local, broad) > 0.1, 'Influence/falloff controls have no effect');
            app.backgroundOverlayEnabled = true; app.backgroundOverlayColor = '#ff0000'; app.backgroundOverlayOpacity = 1;
            const overlay = draw();
            assert(overlay[0] > 245 && overlay[1] < 5 && overlay[2] < 5, 'Color overlay did not composite');
            app.backgroundOverlayEnabled = false;
            app.backgroundWaterEnabled = true;
            // Rebuild to include water's node graph, as the product watcher does.
            await background.setBackgroundFromTileManager();
            assert(mae(draw(0), draw(2)) > 0.1, 'Water did not animate');
            app.backgroundWaterEnabled = false; app.backgroundBaseEnabled = false;
            const neutral = draw();
            assert(Math.abs(neutral[0] - neutral[1]) <= 1 && Math.abs(neutral[1] - neutral[2]) <= 1, 'Base toggle did not yield neutral');
            app.backgroundTextureEnabled = true;
            app.backgroundTexture = 'cenote';
            const staticTextureReports = [];
            for (const mode of ['sharp', 'blurred', 'gradient']) {
                app.backgroundMode = mode === 'gradient' ? 'gradient' : 'texture';
                app.backgroundBlurEnabled = mode === 'blurred';
                app.backgroundTextureContrast = 1;
                app.backgroundTextureSaturation = 1;
                app.backgroundTextureGradientMapEnabled = false;
                await background.setBackgroundFromTileManager();
                const original = draw();
                app.backgroundTextureSaturation = 0;
                const grayscale = draw();
                let grayscaleError = 0;
                for (let index = 0; index < grayscale.length; index += 4) {
                    grayscaleError = Math.max(grayscaleError, Math.abs(grayscale[index] - grayscale[index + 1]), Math.abs(grayscale[index + 1] - grayscale[index + 2]));
                }
                assert(grayscaleError <= 1, `${mode}: static saturation did not produce grayscale (${grayscaleError})`);
                assert(mae(original, grayscale) > 0.1, `${mode}: static saturation has no effect`);
                app.backgroundTextureContrast = 0;
                const flat = draw();
                assert(mae(grayscale, flat) > 0.1, `${mode}: static contrast has no effect`);
                app.backgroundTextureContrast = 1;
                app.backgroundTextureGradientMapEnabled = true;
                app.backgroundTextureGradientMapStops = [{ position: 0, color: '#ff0000' }, { position: 1, color: '#ff0000' }];
                const red = draw();
                app.backgroundTextureGradientMapStops = [{ position: 0, color: '#0000ff' }, { position: 1, color: '#0000ff' }];
                const blue = draw();
                assert(red[0] > red[2] + 20 && blue[2] > blue[0] + 20, `${mode}: static gradient edits did not recolor texture`);
                const exported = draw(0, { blurMode: 'export', width: 192, height: 128 });
                const previewExportMAE = mae(blue, exported);
                assert(previewExportMAE < 1, `${mode}: static treatment differs in export (${previewExportMAE})`);
                staticTextureReports.push({ mode, grayscaleError, previewExportMAE });
            }
            await new Promise(resolve => setTimeout(resolve, 100));
            assert(errors.length === 0, errors.join('\n'));
            reports.push({ rendererType, layers: source.image.depth, flipError, animationMAE: mae(baseline, changed), previewExportMAE: mae(baseline, exportPixels), staticTextureReports });
            console.log(`[Background gradient test] Passed ${rendererType}`);
        } finally {
            background?.disposeBackground(); source?.dispose(); loader.dispose(); renderer.dispose();
            if (rendererType === 'webgl') renderer.forceContextLoss();
        }
    }
    const { createApp, nextTick } = await import('vue');
    const { createPinia } = await import('pinia');
    const { default: PrimeVue } = await import('primevue/config');
    const { default: Aura } = await import('@primeuix/themes/aura');
    const { default: Controls } = await import('../src/components/viewer/AnimationSettingsControls.vue');
    const { useViewerStore } = await import('../src/stores/viewerStore.js');
    const host = document.createElement('div');
    host.style.width = '320px'; document.body.append(host);
    const pinia = createPinia();
    const store = useViewerStore(pinia);
    store.setBackgroundMode('gradient');
    const vue = createApp(Controls).use(pinia).use(PrimeVue, { theme: { preset: Aura } });
    vue.mount(host);
    try {
        await nextTick();
        const influence = host.querySelector('[role="slider"][aria-label="Gradient color influence"]');
        const falloff = host.querySelector('[role="slider"][aria-label="Gradient color falloff"]');
        assert(influence && falloff, 'Gradient controls are missing accessible slider names');
        influence.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true }));
        await nextTick();
        assert(Math.abs(store.backgroundGradientInfluence - 0.55) < 0.001, 'Keyboard did not update gradient influence');
        for (const element of [influence.closest('.tools-slider-block'), falloff.closest('.tools-slider-block')]) {
            assert(element.getBoundingClientRect().right <= host.getBoundingClientRect().right + 1, 'Gradient control overflows 320px panel');
        }
        store.setBackgroundMode('texture'); await nextTick();
        assert(!host.querySelector('[aria-label="Gradient color influence"]') && host.querySelector('[aria-label="Background blur amount"]'), 'Texture mode did not restore blur controls');
        assert(!host.querySelector('[aria-label="Static texture contrast"]'), 'Static controls should be hidden while disabled');
        store.setBackgroundTextureEnabled(true);
        store.setBackgroundTextureGradientMapEnabled(true);
        await nextTick();
        for (const [label, key] of [['Static texture contrast', 'backgroundTextureContrast'], ['Static texture saturation', 'backgroundTextureSaturation']]) {
            const slider = host.querySelector(`[role="slider"][aria-label="${label}"]`);
            assert(slider, `${label} is missing its accessible slider name`);
            slider.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true }));
            await nextTick();
            assert(Math.abs(store[key] - 1.01) < 0.001, `${label} did not update from keyboard`);
        }
        const sceneStops = JSON.stringify(store.gradientMapStops);
        const editor = host.querySelector('.gradient-map-editor');
        const handle = editor.querySelector('.gradient-map-handle');
        handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await nextTick();
        assert(store.backgroundTextureGradientMapStops[0].position === 0.01, 'Static gradient handle did not update from keyboard');
        assert(JSON.stringify(store.gradientMapStops) === sceneStops, 'Static gradient editor changed scene gradient stops');
        editor.querySelector('.gradient-map-add').click();
        await nextTick();
        assert(store.backgroundTextureGradientMapStops.length === 4, 'Static gradient Add did not create a stop');
        editor.querySelector('.gradient-map-remove').click();
        await nextTick();
        assert(store.backgroundTextureGradientMapStops.length === 3, 'Static gradient Remove did not remove a stop');
        for (const element of editor.querySelectorAll('.gradient-map-stop-row, input, button')) {
            assert(element.getBoundingClientRect().right <= host.getBoundingClientRect().right + 1, 'Static gradient editor overflows 320px panel');
        }
        reports.push({ controls: 'Keyboard interaction and 320px layout passed' });
    } finally { vue.unmount(); host.remove(); }
    const { default: SceneControls } = await import('../src/components/viewer/TextureSettingsControls.vue');
    const sceneHost = document.createElement('div');
    sceneHost.style.width = '320px'; document.body.append(sceneHost);
    store.setRenderFilterMode('gradientMap');
    const sceneVue = createApp(SceneControls, { showDuotoneFilter: true }).use(pinia).use(PrimeVue, { theme: { preset: Aura } });
    sceneVue.mount(sceneHost);
    try {
        await nextTick();
        const backgroundStops = JSON.stringify(store.backgroundTextureGradientMapStops);
        const editor = sceneHost.querySelector('.gradient-map-editor');
        assert(editor, 'Shared scene gradient editor is missing');
        const hex = editor.querySelector('input[aria-label="Stop color"]');
        hex.value = '#fedcba';
        hex.dispatchEvent(new Event('change', { bubbles: true }));
        await nextTick();
        assert(store.gradientMapStops[0].color === '#fedcba', 'Shared scene gradient color edit failed');
        assert(JSON.stringify(store.backgroundTextureGradientMapStops) === backgroundStops, 'Scene editor changed static gradient stops');
        reports.push({ sceneEditor: 'Shared editor preserves independent scene and static texture stops' });
    } finally { sceneVue.unmount(); sceneHost.remove(); }
    return reports;
})();
