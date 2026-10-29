import * as THREE from 'three';
import { useSceneBackground } from '../src/composables/viewer/useSceneBackground.js';
import { applyRendererDisplayConfig } from '../src/modules/viewer/rendererConfig.js';
import { acquireBackgroundClip } from '../src/services/backgroundClip.js';
import { prepareClipUpload, clipAssetUrl } from '../src/services/clipService.js';
import { Input, ALL_FORMATS, BlobSource } from 'mediabunny';
import { getClipInputFormats } from '../../../packages/shared-types/src/clipAsset.js';
import { createApp, h, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import ClipLibrary from '../src/views/ClipLibraryView.vue';
import { useGoogleAuth } from '../src/composables/shared/useGoogleAuth.js';
import '../src/components/viewer/toolsPanelShared.css';
import '../src/components/shared/buttonPrimitives.css';

const assert = (value, message) => { if (!value) throw new Error(message); };
const pixels = canvas => {
    const copy = new OffscreenCanvas(canvas.width, canvas.height), context = copy.getContext('2d');
    context.drawImage(canvas, 0, 0); return context.getImageData(0, 0, canvas.width, canvas.height).data;
};
const difference = (a, b) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length;
const errors = [];
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));

window.clipBackgroundTest = (async () => {
    const reports = [];
    for (const id of ['test-clip', 'vp9-clip', 'mkv-clip', 'mov-clip', 'hevc-clip', 'av1-clip', 'ts-clip']) {
        console.log('[Clip background test] Probing', id);
        const blob = await fetch(clipAssetUrl(id)).then(response => response.blob());
        // Ignore the filename and browser MIME, just as a real generic upload.
        const file = new File([blob], 'video.bin', { type: 'application/octet-stream' });
        const input = new Input({ formats: getClipInputFormats(ALL_FORMATS), source: new BlobSource(file) });
        let decodable;
        try { decodable = await (await input.getPrimaryVideoTrack()).canDecode(); } finally { input.dispose(); }
        if (decodable) {
            let prepared;
            try { prepared = await prepareClipUpload(file); }
            catch (error) {
                if (!['hevc-clip', 'av1-clip'].includes(id)) throw error;
                assert(error.message.includes('could not decode a frame'), `${id}: failed decode is not actionable`);
                reports.push({ id, failedFirstFrameReported: true }); continue;
            }
            assert(prepared.blob.type !== 'application/octet-stream', `${id}: container MIME was not detected`);
            assert(prepared.thumbnailBlob.size > 0, `${id}: no first-frame poster`);
            reports.push({ id, uploadProbe: true, mimeType: prepared.blob.type });
        } else {
            try { await prepareClipUpload(file); throw new Error(`${id}: unsupported decoder was accepted`); }
            catch (error) { assert(error.message.includes('cannot decode the video codec'), `${id}: wrong capability error: ${error.message}`); }
            reports.push({ id, unsupportedDecoderReported: true });
            continue;
        }
        // Includes MPEG-TS, which needs the decoded-playback fallback on Chrome.
        const consumer = await acquireBackgroundClip({ kind: 'clip', id });
        try {
            const initial = pixels(consumer.texture.image), start = performance.now();
            while (performance.now() - start < 650) {
                consumer.update({ timeSeconds: (performance.now() - start) / 1000, targetDuration: consumer.duration });
                await new Promise(requestAnimationFrame);
            }
            assert(difference(initial, pixels(consumer.texture.image)) > 0.1, `${id}: playback did not advance`);
            const session = await consumer.beginExport({ targetDuration: 1, playbackMode: 'alignLoop' });
            try {
                await session.prepareFrame(0); const first = pixels(consumer.texture.image);
                await session.prepareFrame(0.5); assert(difference(first, pixels(consumer.texture.image)) > 0.1, `${id}: export frame did not advance`);
                await session.prepareFrame(2); assert(difference(first, pixels(consumer.texture.image)) === 0, `${id}: export did not wrap exactly`);
            } finally { session.dispose(); }
        } finally { consumer.release(); }
    }
    // Live viewing uses a native decoder; export uses timestamp-directed WebCodecs.
    const lease = await acquireBackgroundClip({ kind: 'clip', id: 'test-clip' });
    try {
        const initial = pixels(lease.texture.image);
        const start = performance.now();
        while (performance.now() - start < 700) {
            lease.update({ timeSeconds: (performance.now() - start) / 1000, targetDuration: 1, playbackMode: 'alignLoop' });
            await new Promise(requestAnimationFrame);
        }
        assert(difference(initial, pixels(lease.texture.image)) > 0.1, 'Native live playback did not advance');
        lease.pause();
        const a = await lease.beginExport({ targetDuration: 1, playbackMode: 'alignLoop' });
        try {
            assert(a.plan.rate === 1.2 && a.plan.repetitions === 1, 'Wrong computed playback rate');
            await a.prepareFrame(0); const first = pixels(lease.texture.image);
            await a.prepareFrame(0.5); assert(difference(first, pixels(lease.texture.image)) > 0.1, 'Synthetic clip frame did not advance');
            await a.prepareFrame(3); assert(difference(first, pixels(lease.texture.image)) === 0, 'Repeated loop did not return to exact first pixels');
        } finally { a.dispose(); }
    } finally { lease.release(); }

    for (const rendererType of ['webgl', 'webgpu']) {
        const renderer = rendererType === 'webgpu'
            ? new (await import('three/webgpu')).WebGPURenderer({ antialias: false })
            : new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
        if (renderer.init) await renderer.init();
        applyRendererDisplayConfig(renderer, null, rendererType);
        renderer.setPixelRatio(1); renderer.setSize(96, 64);
        if (rendererType === 'webgpu') renderer.backend.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
        const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1.5, 0.1, 1000);
        const source = new THREE.DataArrayTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, 1);
        source.needsUpdate = true;
        let time = 0;
        const app = { rendererType, backgroundMode: 'texture', backgroundTextureSource: { kind: 'clip', id: 'test-clip' },
            backgroundTextureEnabled: true, backgroundTextureBlendMode: 'normal', backgroundClipPlaybackMode: 'alignLoop',
            backgroundTextureContrast: 1, backgroundTextureSaturation: 1, backgroundBaseEnabled: false, backgroundBlurEnabled: false };
        const background = useSceneBackground({ app, renderer: { value: renderer }, scene: { value: scene }, camera: { value: camera },
            backgroundTexture: { value: null }, getBackgroundTime: () => time, getBackgroundLoopDuration: () => 1,
            tileManager: { value: { arrayTextures: [source], variant: 'waves', getLayerCount: () => 1 } } });
        try {
            for (const blur of [false, true]) {
                app.backgroundBlurEnabled = blur; app.backgroundBlurAmount = 2;
                await background.setBackgroundFromTileManager();
                const session = await background.beginMediaExport({ targetDuration: 1, playbackMode: 'alignLoop' });
                try {
                    const render = async t => {
                        time = t; await session.prepareFrame(t);
                        background.updateBackground({ timeSeconds: t, deterministicBackground: true, blurMode: 'export', width: 96, height: 64 });
                        renderer.render(scene, camera); return pixels(renderer.domElement);
                    };
                    const first = await render(0), middle = await render(0.5), loop = await render(2);
                    assert(first.some((v, i) => i % 4 !== 3 && v > 30), `${rendererType}: black clip background`);
                    const change = difference(first, middle), wrap = difference(first, loop);
                    assert(change > 0.1, `${rendererType}: stale synthetic clip texture (${change})`);
                    assert(wrap < 0.01, `${rendererType}: clip wrap changed first-frame pixels (${wrap})`);
                    reports.push({ rendererType, blur, change, wrap });
                } finally { session.dispose(); }
            }
        } finally { background.disposeBackground(); source.dispose(); renderer.dispose(); }
    }
    const pinia = createPinia(); setActivePinia(pinia);
    const auth = useGoogleAuth(); await auth.checkSession();
    const root = document.createElement('div'); document.body.append(root);
    document.body.style.margin = '0'; document.body.style.fontFamily = 'sans-serif';
    let applied = null;
    const ui = createApp({ render: () => h(ClipLibrary, { onApply: clip => { applied = clip; } }) });
    ui.use(pinia).use(PrimeVue, { theme: { preset: Aura } }); ui.mount(root);
    const waitFor = async selector => {
        for (let i = 0; i < 100; i++) { const element = root.querySelector(selector); if (element) return element; await new Promise(resolve => setTimeout(resolve, 20)); }
        throw new Error(`Missing UI element: ${selector}`);
    };
    try {
        const preview = await waitFor('[aria-label="Preview Test clip"]');
        preview.click(); await nextTick();
        await waitFor('.clip-library-preview canvas');
        const transport = await waitFor('[aria-label="Pause clip preview"]');
        assert(root.textContent.includes('Muted'), 'Preview does not identify muted loop playback');
        transport.click(); await nextTick();
        assert(root.querySelector('[aria-label="Play clip preview"]'), 'Preview cannot pause');
        const back = [...root.querySelectorAll('button')].find(button => button.textContent.includes('Back to Clips'));
        back.click(); await nextTick();
        assert(!root.querySelector('.clip-playback-preview'), 'Closing the preview retained its player');
        assert(document.activeElement === preview, 'Closing the preview did not return focus');
        const apply = [...root.querySelectorAll('button')].find(button => button.textContent.includes('Apply as background'));
        apply.click(); assert(applied?.source.kind === 'clip' && applied?.id === 'test-clip', 'Apply did not emit a clip reference');
        auth.user.value = null; await nextTick();
        assert(root.textContent.includes('Sign in to upload'), 'Signed-out library did not clear private cards');
        assert(!root.querySelector('.clip-card'), 'Private cards survived sign-out');
        reports.push({ libraryPreview: true, focusReturn: true, apply: true, signOutClearsCards: true });
    } finally { ui.unmount(); root.remove(); }
    assert(!errors.length, errors.join('\n'));
    return { passed: true, reports };
})();
