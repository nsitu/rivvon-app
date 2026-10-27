// Real KTX2 decoding, RIFE inference, background shaders, and video encoders.
import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { Input, BlobSource, ALL_FORMATS, EncodedPacketSink } from 'mediabunny';
import { normalizeWebGPUArrayTexture } from '../src/modules/shared/webgpuTextureCompatibility.js';
import { applyRendererDisplayConfig } from '../src/modules/viewer/rendererConfig.js';
import { useSceneBackground } from '../src/composables/viewer/useSceneBackground.js';
import { useSceneExport } from '../src/composables/viewer/useSceneExport.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const log = value => console.log(`[Background interpolation test] ${value}`);
const errors = [];
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
const pixels = canvas => {
    const copy = new OffscreenCanvas(canvas.width, canvas.height);
    const ctx = copy.getContext('2d'); ctx.drawImage(canvas, 0, 0);
    return ctx.getImageData(0, 0, copy.width, copy.height).data;
};

window.backgroundInterpolationTest = (async () => {
    const results = [];
    for (const [rendererType, variant, blur, format] of [
        ['webgl', 'waves', false, 'mp4'], ['webgl', 'planes', true, 'webm'],
        ['webgpu', 'waves', true, 'webm'], ['webgpu', 'planes', false, 'mp4'],
    ]) {
        log(`Starting ${rendererType}/${variant}/${format}, blur=${blur}`);
        const renderer = rendererType === 'webgpu'
            ? new (await import('three/webgpu')).WebGPURenderer({ antialias: false })
            : new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
        if (renderer.init) await renderer.init();
        if (rendererType === 'webgpu') renderer.backend.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
        renderer.debug.onShaderError = (_gl, _program, vertex, fragment) => errors.push(`Shader failed: ${vertex}, ${fragment}`);
        renderer.setPixelRatio(1); renderer.setSize(96, 96);
        applyRendererDisplayConfig(renderer, null, rendererType);
        const loader = new KTX2Loader().setTranscoderPath('/wasm/'); loader.detectSupport(renderer);
        let source;
        let background;
        try {
            const bytes = new Uint8Array(await (await fetch(`/tiles-ktx2-${variant}/0.ktx2`)).arrayBuffer());
            source = await new Promise((resolve, reject) => loader.parse(bytes.buffer.slice(0), resolve, reject));
            if (rendererType === 'webgpu') source = normalizeWebGPUArrayTexture(source);
            if (rendererType === 'webgl') source.colorSpace = THREE.LinearSRGBColorSpace;
            source.minFilter = source.magFilter = THREE.LinearFilter;
            source.generateMipmaps = false;
            const manager = { isKTX2: true, isZip: true, zipFiles: { '0.ktx2': bytes },
                arrayTextures: [source], variant, getLayerCount: () => source.image.depth,
                resetAnimationState() {}, tickDeterministic() {}, getSeamlessLoopDuration: () => 2 };
            const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
            const ctx = { renderer: { value: renderer }, scene: { value: scene }, camera: { value: camera },
                tileManager: { value: manager }, tileManagers: { value: [] }, ribbonSeries: { value: null },
                controls: { value: null }, backgroundTexture: { value: null }, cinematicCamera: { hasROIs: { value: false } },
                getBackgroundTime: () => 0,
                app: { rendererType, animatedBackgroundEnabled: true, textureAnimationEnabled: true,
                    backgroundAnimationSyncEnabled: false, backgroundCycleDuration: 2,
                    backgroundBaseEnabled: true, backgroundBlurEnabled: blur, backgroundBlurAmount: 8,
                    backgroundOverlayEnabled: false, backgroundTextureEnabled: false, backgroundWaterEnabled: false } };
            background = useSceneBackground(ctx);
            await background.setBackgroundFromTileManager();
            background.updateBackground({ timeSeconds: 0, deterministicBackground: true, blurMode: 'export', width: 96, height: 96 });
            renderer.render(scene, camera);
            const baseline = pixels(renderer.domElement);
            let prepares = 0, disposals = 0, restores = 0;
            const framePixels = [];
            const exporter = useSceneExport(ctx, {
                createBackgroundExportInterpolation: async options => {
                    const service = await background.createExportInterpolation(options);
                    return { prepareFrame: async opts => { prepares++; return service.prepareFrame(opts); },
                        dispose: async () => { disposals++; await service.dispose(); } };
                },
                restoreBackgroundPreview: () => { restores++; background.updateBackground(); },
                renderScene: options => { background.updateBackground(options); renderer.render(scene, camera); framePixels.push(pixels(renderer.domElement)); },
            });
            const started = performance.now();
            const blob = await exporter.exportVideo({ width: 96, height: 96, fps: 24, duration: 3 / 24,
                format, backgroundInterpolation: 'rife', logoOverlayEnabled: false, onStatus: log });
            assert(blob?.size > 100, 'No encoded video was produced.');
            assert(prepares === 3 && framePixels.length === 3 && disposals === 1 && restores === 1, 'Frame or lifecycle count differs.');
            const endpointError = baseline.reduce((sum, value, i) => sum + Math.abs(value - framePixels[0][i]), 0) / baseline.length;
            const debugCanvas = document.createElement('canvas'); debugCanvas.width = 192; debugCanvas.height = 96;
            const debugCtx = debugCanvas.getContext('2d');
            debugCtx.putImageData(new ImageData(baseline, 96, 96), 0, 0);
            debugCtx.putImageData(new ImageData(framePixels[0], 96, 96), 96, 0);
            window.backgroundInterpolationDebugImage = debugCanvas.toDataURL();
            log(`Endpoint ${rendererType}/${variant}: MAE=${endpointError}, colorSpace=${source.colorSpace}, format=${source.format}`);
            assert(endpointError < 3, `Endpoint color/orientation changed: MAE=${endpointError}`);
            assert(framePixels[1].some((value, i) => Math.abs(value - framePixels[0][i]) > 8), 'Generated frame was not visible in the rendered background.');
            background.updateBackground({ timeSeconds: 0, deterministicBackground: true, blurMode: 'export', width: 96, height: 96 });
            renderer.render(scene, camera);
            const restoredPixels = pixels(renderer.domElement);
            const restorationError = baseline.reduce((sum, value, i) => sum + Math.abs(value - restoredPixels[i]), 0) / baseline.length;
            assert(restorationError < 0.1, `Original texture was not restored after export: MAE=${restorationError}`);
            assert(manager.arrayTextures[0] === source && manager.zipFiles['0.ktx2'].byteLength === bytes.byteLength, 'Source texture or bytes were replaced.');
            const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
            const track = await input.getPrimaryVideoTrack();
            const duration = await input.computeDuration();
            assert(track?.displayWidth === 96 && track?.displayHeight === 96, 'Encoded dimensions differ.');
            const packets = [];
            for await (const packet of new EncodedPacketSink(track).packets()) packets.push(packet);
            assert(packets.length === 3, `Encoded frame count differs: ${packets.length}`);
            for (let i = 0; i < packets.length; i++) assert(Math.abs(packets[i].timestamp - i / 24) < 0.002, 'Encoded frame timestamps differ.');
            // WebM can omit the final packet duration; verify all presentation
            // timestamps directly rather than inferring frame count from metadata.
            if (format === 'mp4') assert(Math.abs(duration - 3 / 24) < 0.01, `Encoded duration differs: ${duration}`);
            input.dispose();
            // Exercise cancellation with actual decode/inference preparation, before encoding frame 1.
            const controller = new AbortController();
            let cancelPrepares = 0;
            const cancelledExporter = useSceneExport(ctx, {
                createBackgroundExportInterpolation: async options => {
                    const service = await background.createExportInterpolation(options);
                    return { prepareFrame: async opts => {
                        const result = await service.prepareFrame(opts);
                        if (++cancelPrepares === 2) controller.abort();
                        return result;
                    }, dispose: () => service.dispose() };
                },
                restoreBackgroundPreview: () => background.updateBackground(),
                renderScene: options => { background.updateBackground(options); renderer.render(scene, camera); },
            });
            assert(await cancelledExporter.exportVideo({ width: 96, height: 96, fps: 24, duration: 3 / 24,
                format: 'webm', backgroundInterpolation: 'rife', signal: controller.signal, logoOverlayEnabled: false }) === null, 'Cancellation did not return null.');
            assert(errors.length === 0, errors.join('\n'));
            results.push({ rendererType, variant, blur, format, bytes: blob.size, duration, endpointError, restorationError, ms: performance.now() - started });
            log(`Passed ${rendererType}/${variant}/${format}`);
        } finally {
            background?.disposeBackground(); source?.dispose(); loader.dispose(); renderer.dispose();
            if (rendererType === 'webgl') renderer.forceContextLoss();
        }
    }
    return results;
})();
