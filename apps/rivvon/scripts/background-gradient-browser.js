import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { normalizeWebGPUArrayTexture } from '../src/modules/shared/webgpuTextureCompatibility.js';
import { applyRendererDisplayConfig } from '../src/modules/viewer/rendererConfig.js';
import { useSceneBackground } from '../src/composables/viewer/useSceneBackground.js';
import { useRenderFilter } from '../src/composables/viewer/useRenderFilter.js';

const assert = (value, message) => { if (!value) throw new Error(message); };
const pixels = canvas => {
    const copy = new OffscreenCanvas(canvas.width, canvas.height);
    const ctx = copy.getContext('2d'); ctx.drawImage(canvas, 0, 0);
    return ctx.getImageData(0, 0, copy.width, copy.height).data;
};
const mae = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
const circleBounds = (data, width, height) => {
    let darkest = 255, lightest = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
        darkest = Math.min(darkest, data[offset]); lightest = Math.max(lightest, data[offset]);
    }
    assert(lightest - darkest > 20, 'Aspect test image has no visible circle');
    const threshold = (lightest + darkest) / 2;
    let left = width, right = -1, top = height, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4] >= threshold) continue;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    return { left, right, top, bottom, width: right - left + 1, height: bottom - top + 1 };
};
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
                app.backgroundTextureGradientMapMix = 1;
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
                app.backgroundTextureSaturation = 1;
                app.backgroundTextureGradientMapMix = 0;
                const unmapped = draw();
                assert(mae(original, unmapped) < 0.1, `${mode}: 0% static gradient mix changed original`);
                app.backgroundTextureGradientMapMix = 0.5;
                const half = draw();
                assert(mae(half, original) > 0.1 && mae(half, blue) > 0.1, `${mode}: 50% static mix did not blend both images`);
                const halfExported = draw(0, { blurMode: 'export', width: 192, height: 128 });
                assert(mae(half, halfExported) < 1, `${mode}: 50% static mix differs in export`);
                app.backgroundTextureGradientMapMix = 1;
                const exported = draw(0, { blurMode: 'export', width: 192, height: 128 });
                const previewExportMAE = mae(blue, exported);
                assert(previewExportMAE < 1, `${mode}: static treatment differs in export (${previewExportMAE})`);
                staticTextureReports.push({ mode, grayscaleError, previewExportMAE });
            }
            // A circular feature in a 2:1 image must remain round and centered,
            // including when the view is resized after the texture was cached.
            const image = document.createElement('canvas'); image.width = 256; image.height = 128;
            const painter = image.getContext('2d');
            painter.fillStyle = '#eeeeee'; painter.fillRect(0, 0, 256, 128);
            painter.fillStyle = '#111111'; painter.beginPath(); painter.arc(128, 64, 20, 0, Math.PI * 2); painter.fill();
            const verticalImage = document.createElement('canvas'); verticalImage.width = 128; verticalImage.height = 256;
            const verticalPainter = verticalImage.getContext('2d');
            for (const [color, top, height] of [['#ff0000', 0, 85], ['#00ff00', 85, 86], ['#0000ff', 171, 85]]) {
                verticalPainter.fillStyle = color; verticalPainter.fillRect(0, top, 128, height);
            }
            const loadTexture = THREE.TextureLoader.prototype.load;
            THREE.TextureLoader.prototype.load = function(url, onLoad, ...args) {
                if (!['/background-textures/card.jpg', '/background-textures/textile.jpg'].includes(url)) return loadTexture.call(this, url, onLoad, ...args);
                const texture = new THREE.CanvasTexture(url.endsWith('textile.jpg') ? verticalImage : image); onLoad(texture); return texture;
            };
            const aspectReports = [];
            try {
                app.backgroundTexture = 'card';
                app.backgroundTextureGradientMapEnabled = false;
                app.backgroundTextureContrast = 1; app.backgroundTextureSaturation = 1;
                for (const mode of ['sharp', 'blurred', 'gradient']) {
                    app.backgroundMode = mode === 'gradient' ? 'gradient' : 'texture';
                    app.backgroundBlurEnabled = mode === 'blurred';
                    await background.setBackgroundFromTileManager();
                    for (const [width, height] of [[192, 64], [128, 128], [80, 160]]) {
                        renderer.setSize(width, height);
                        camera.aspect = width / height; camera.updateProjectionMatrix();
                        const preview = draw();
                        const bounds = circleBounds(preview, width, height);
                        assert(Math.abs(bounds.width - bounds.height) <= 2, `${mode}: static image stretched at ${width}x${height} (${bounds.width}x${bounds.height})`);
                        assert(Math.abs((bounds.left + bounds.right + 1) / 2 - width / 2) <= 1, `${mode}: horizontal cover crop is off-center`);
                        assert(Math.abs((bounds.top + bounds.bottom + 1) / 2 - height / 2) <= 1, `${mode}: vertical cover crop is off-center`);
                        const exported = draw(0, { blurMode: 'export', width: width * 2, height: height * 2 });
                        const exportBounds = circleBounds(exported, width, height);
                        assert(Math.abs(exportBounds.width - exportBounds.height) <= 2, `${mode}: export stretched the static image`);
                        const restored = draw();
                        assert(mae(preview, restored) < 0.1, `${mode}: export did not restore the preview crop`);
                        aspectReports.push({ mode, width, height, circle: [bounds.width, bounds.height] });
                    }
                }
                renderer.setSize(160, 80); camera.aspect = 2; camera.updateProjectionMatrix();
                app.backgroundTexture = 'textile';
                for (const mode of ['sharp', 'blurred', 'gradient']) {
                    app.backgroundMode = mode === 'gradient' ? 'gradient' : 'texture';
                    app.backgroundBlurEnabled = mode === 'blurred';
                    await background.setBackgroundFromTileManager();
                    for (const [alignment, channel] of [[0, 0], [0.5, 1], [1, 2]]) {
                        draw();
                        const material = camera.children[0].material;
                        app.backgroundTextureVerticalAlignment = alignment;
                        const preview = draw();
                        const offset = (40 * 160 + 80) * 4;
                        const assertBand = data => {
                            const color = Array.from(data.slice(offset, offset + 3));
                            assert(color[channel] > Math.max(...color.filter((_, index) => index !== channel)) + 20,
                                `${mode}: ${alignment * 100}% vertical alignment selected the wrong image region (${color})`);
                        };
                        assertBand(preview);
                        assert(camera.children[0].material === material, 'Vertical alignment rebuilt the preview material');
                        assertBand(draw(0, { blurMode: 'export', width: 320, height: 160 }));
                        assertBand(draw());
                    }
                }
                app.backgroundTextureVerticalAlignment = 0.5;
            } finally {
                THREE.TextureLoader.prototype.load = loadTexture;
                renderer.setSize(96, 64); camera.aspect = 1.5; camera.updateProjectionMatrix();
            }
            const mixScene = new THREE.Scene();
            mixScene.background = new THREE.Color('#3b91c8');
            const mixCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
            const mixApp = { renderFilterMode: 'gradientMap', contrast: 1, saturation: 1,
                gradientMapStops: [{ position: 0, color: '#ef630d' }, { position: 1, color: '#ef630d' }] };
            const filter = useRenderFilter({ app: mixApp, renderer: { value: renderer }, scene: { value: mixScene }, camera: { value: mixCamera } });
            let sceneMixError;
            await filter.initRenderFilter(rendererType);
            try {
                const drawMix = value => { mixApp.gradientMapMix = value; filter.renderScene(); return pixels(renderer.domElement); };
                const full = drawMix(undefined);
                assert(mae(full, drawMix(1)) < 0.1, 'Default scene mix no longer matches 100%');
                const unmapped = drawMix(0);
                mixApp.renderFilterMode = 'none';
                filter.renderScene();
                assert(mae(unmapped, pixels(renderer.domElement)) < 1, '0% scene mix changed original');
                mixApp.renderFilterMode = 'gradientMap';
                const half = drawMix(0.5);
                // WebGPU writes linear-light blends through the sRGB output transform.
                const decode = value => rendererType === 'webgpu' ? THREE.ColorManagement.getTransfer(renderer.outputColorSpace) === THREE.SRGBTransfer
                    ? (value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4) : value / 255 : value / 255;
                sceneMixError = Math.max(...[0, 1, 2].map(channel => Math.abs(decode(half[channel]) - (decode(unmapped[channel]) + decode(full[channel])) / 2)));
                assert(sceneMixError < 0.01, `50% scene mix is not a balanced blend (${sceneMixError})`);
                assert(mae(half, unmapped) > 1 && mae(half, full) > 1, 'Scene half mix did not retain both colors');
                const exportTarget = rendererType === 'webgpu' ? new THREE.RenderTarget(96, 64, { colorSpace: renderer.outputColorSpace }) : new THREE.WebGLRenderTarget(96, 64, { colorSpace: renderer.outputColorSpace });
                try {
                    filter.renderScene(exportTarget);
                    const material = rendererType === 'webgpu' ? new (await import('three/webgpu')).MeshBasicNodeMaterial() : new THREE.MeshBasicMaterial();
                    if (rendererType === 'webgpu') material.colorNode = (await import('three/tsl')).texture(exportTarget.texture);
                    else material.map = exportTarget.texture;
                    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
                    const outputScene = new THREE.Scene(); outputScene.add(quad);
                    const outputCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
                    renderer.setRenderTarget(null); renderer.render(outputScene, outputCamera);
                    assert(mae(half, pixels(renderer.domElement)) < 1, '50% scene mix differs in export target');
                    material.dispose(); quad.geometry.dispose();
                } finally { exportTarget.dispose(); }
            } finally { filter.disposeRenderFilter(); }
            await new Promise(resolve => setTimeout(resolve, 100));
            assert(errors.length === 0, errors.join('\n'));
            reports.push({ rendererType, layers: source.image.depth, flipError, animationMAE: mae(baseline, changed), previewExportMAE: mae(baseline, exportPixels), staticTextureReports, sceneMixError, aspectReports });
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
        store.setBackgroundTextureBlendMode('multiply');
        await nextTick();
        const blendStrength = host.querySelector('[role="slider"][aria-label="Background blend strength"]');
        assert(blendStrength, 'Background blend strength is missing its accessible slider name');
        blendStrength.dispatchEvent(new KeyboardEvent('keydown', { code: 'Home', bubbles: true }));
        await nextTick();
        assert(store.backgroundTextureBlendStrength === 0 && store.artworkBlendStrength === 1, 'Background blend strength did not update independently');
        blendStrength.dispatchEvent(new KeyboardEvent('keydown', { code: 'End', bubbles: true }));
        await nextTick();
        assert(store.backgroundTextureBlendStrength === 1, 'Background blend strength cannot reach 100%');
        blendStrength.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', bubbles: true }));
        await nextTick();
        assert(store.backgroundTextureBlendStrength === .99, 'Background blend strength keyboard step failed');
        assert(blendStrength.getBoundingClientRect().right <= host.getBoundingClientRect().right + 1, 'Background blend strength overflows narrow panel');
        store.setBackgroundTextureBlendMode('normal');
        await nextTick();
        assert(!host.querySelector('[aria-label="Background blend strength"]'), 'Normal should hide background blend strength');
        const alignment = host.querySelector('[role="slider"][aria-label="Static texture vertical alignment"]');
        assert(alignment && store.backgroundTextureVerticalAlignment === 0.5, 'Static vertical alignment did not default to center');
        alignment.dispatchEvent(new KeyboardEvent('keydown', { code: 'Home', bubbles: true }));
        await nextTick();
        assert(store.backgroundTextureVerticalAlignment === 0, 'Vertical alignment keyboard Home did not select top');
        alignment.dispatchEvent(new KeyboardEvent('keydown', { code: 'End', bubbles: true }));
        await nextTick();
        assert(store.backgroundTextureVerticalAlignment === 1, 'Vertical alignment keyboard End did not select bottom');
        alignment.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', bubbles: true }));
        await nextTick();
        assert(store.backgroundTextureVerticalAlignment === 0.99, 'Vertical alignment keyboard step failed');
        assert(alignment.getBoundingClientRect().right <= host.getBoundingClientRect().right + 1, 'Vertical alignment slider overflows narrow panel');
        for (const [label, key] of [['Static texture contrast', 'backgroundTextureContrast'], ['Static texture saturation', 'backgroundTextureSaturation']]) {
            const slider = host.querySelector(`[role="slider"][aria-label="${label}"]`);
            assert(slider, `${label} is missing its accessible slider name`);
            slider.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true }));
            await nextTick();
            assert(Math.abs(store[key] - 1.01) < 0.001, `${label} did not update from keyboard`);
        }
        const sceneStops = JSON.stringify(store.gradientMapStops);
        const editor = host.querySelector('.gradient-map-editor');
        const backgroundMix = editor.querySelector('[role="slider"][aria-label="static texture gradient map mix"]');
        assert(backgroundMix, 'Static gradient mix slider is missing');
        backgroundMix.dispatchEvent(new KeyboardEvent('keydown', { code: 'Home', bubbles: true }));
        await nextTick();
        assert(store.backgroundTextureGradientMapMix === 0 && store.gradientMapMix === 1, 'Background mix did not update independently');
        backgroundMix.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true }));
        await nextTick();
        assert(store.backgroundTextureGradientMapMix === 0.01, 'Background mix keyboard step failed');
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
        assert(!sceneHost.querySelector('[aria-label="Artwork blend strength"]'), 'Normal should hide artwork blend strength');
        store.setArtworkBlendMode('screen');
        await nextTick();
        const blendStrength = sceneHost.querySelector('[role="slider"][aria-label="Artwork blend strength"]');
        assert(blendStrength, 'Artwork blend strength is missing its accessible slider name');
        blendStrength.dispatchEvent(new KeyboardEvent('keydown', { code: 'Home', bubbles: true }));
        await nextTick();
        assert(store.artworkBlendStrength === 0 && store.backgroundTextureBlendStrength === .99, 'Artwork blend strength did not update independently');
        blendStrength.dispatchEvent(new KeyboardEvent('keydown', { code: 'End', bubbles: true }));
        await nextTick();
        assert(store.artworkBlendStrength === 1, 'Artwork blend strength cannot reach 100%');
        assert(blendStrength.getBoundingClientRect().right <= sceneHost.getBoundingClientRect().right + 1, 'Artwork blend strength overflows narrow panel');
        const backgroundStops = JSON.stringify(store.backgroundTextureGradientMapStops);
        const editor = sceneHost.querySelector('.gradient-map-editor');
        assert(editor, 'Shared scene gradient editor is missing');
        const sceneMix = editor.querySelector('[role="slider"][aria-label="scene gradient map mix"]');
        assert(sceneMix, 'Scene gradient mix slider is missing');
        sceneMix.dispatchEvent(new KeyboardEvent('keydown', { code: 'Home', bubbles: true }));
        await nextTick();
        assert(store.gradientMapMix === 0 && store.backgroundTextureGradientMapMix === 0.01, 'Scene mix did not update independently');
        sceneMix.dispatchEvent(new KeyboardEvent('keydown', { code: 'End', bubbles: true }));
        await nextTick();
        assert(store.gradientMapMix === 1, 'Scene mix cannot reach 100% with keyboard');
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
