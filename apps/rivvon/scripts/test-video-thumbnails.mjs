// Exercise actual WebCodecs encoding, MP4 parsing, and gallery interaction in Chromium.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const binary = process.env.BROWSER_BINARY || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(existsSync);
if (!binary) throw new Error('Set BROWSER_BINARY to Chrome or Edge.');
const profile = await mkdtemp(join(tmpdir(), 'rivvon-video-thumbnails-'));
const server = await createServer({ root, optimizeDeps: { noDiscovery: true, include: ['vue', 'vue-router', 'mediabunny'] },
    server: { host: '127.0.0.1', port: 0, open: false }, plugins: [{
    name: 'thumbnail-test-page',
    resolveId(id) { if (id === '/__thumbnail_modules.js') return '\0thumbnail-test-modules'; },
    load(id) { if (id === '\0thumbnail-test-modules') return `
        export * as MB from 'mediabunny';
        export { createApp, h, nextTick } from 'vue';
        export { createRouter, createMemoryHistory } from 'vue-router';
    `; },
    configureServer(server) {
        server.middlewares.use('/__thumbnail_test', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end('<html><body style="background:#222;color:white"><div id="app" style="width:640px"></div></body></html>');
        });
    },
}] });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, ws;
try {
    await server.listen();
    browser = spawn(binary, ['--headless=new', '--no-first-run', '--no-default-browser-check',
        '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
    { windowsHide: true, stdio: 'ignore' });
    let port;
    for (let n = 0; n < 100; n++) {
        try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
        catch { await delay(100); }
    }
    if (!port) throw new Error('Browser did not start.');
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
    });
    const call = (method, params = {}) => new Promise(resolve => {
        pending.set(++id, resolve); ws.send(JSON.stringify({ id, method, params }));
    });
    async function evaluate(expression) {
        const result = await Promise.race([
            call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Browser check timed out')), 60_000).unref()),
        ]);
        if (result.error || result.result?.exceptionDetails) throw new Error(JSON.stringify(result));
        return result.result.result.value;
    }
    await call('Page.navigate', { url: `${server.resolvedUrls.local[0]}__thumbnail_test` });
    await call('Emulation.setFocusEmulationEnabled', { enabled: true });
    await evaluate(`new Promise(resolve => document.readyState === 'complete' ? resolve() : window.addEventListener('load', resolve, { once:true }))`);
    const report = await evaluate(`(async () => {
        const { MB } = await import('/__thumbnail_modules.js');
        const { createVideoPreviewThumbnail } = await import('/src/modules/viewer/videoPreviewThumbnail.js');
        const assert = (value, message) => { if (!value) throw new Error(message); };
        const report = [];
        for (const [width, height, rotation = 0] of [[1280,720], [720,1280], [1024,1024], [32,24], [1280,720,90]]) {
            const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
            const context = canvas.getContext('2d');
            const target = new MB.BufferTarget();
            const output = new MB.Output({ format: new MB.Mp4OutputFormat(), target });
            const source = new MB.CanvasSource(canvas, { codec:'avc', bitrate:2_000_000 });
            output.addVideoTrack(source, { frameRate:12, rotation }); await output.start();
            for (let frame = 0; frame < 12; frame++) {
                context.fillStyle = frame % 2 ? '#dd5a36' : '#368bdd'; context.fillRect(0,0,width,height);
                context.fillStyle = 'white'; context.fillRect(frame * width / 12, height / 4, width / 12, height / 2);
                await source.add(frame / 12, 1 / 12);
            }
            source.close(); await output.finalize();
            const original = new Blob([target.buffer], { type:'video/mp4' });
            const thumbnail = await createVideoPreviewThumbnail(original);
            const input = new MB.Input({ formats:MB.ALL_FORMATS, source:new MB.BlobSource(thumbnail) });
            const track = await input.getPrimaryVideoTrack();
            const w = await track.getDisplayWidth(), h = await track.getDisplayHeight();
            assert(w <= 640 && h <= 640, 'Preview exceeded 640 pixels');
            assert(Math.max(w,h) === Math.min(640,Math.max(width,height)), 'Preview did not use the available resolution');
            const aspect = rotation === 90 ? height/width : width/height;
            assert(Math.abs(w/h - aspect) / aspect < .015, 'Incorrect preview proportions');
            assert(await track.getCodec() === 'avc', 'Incorrect codec');
            assert((await input.getAudioTracks()).length === 0, 'Preview has audio');
            const duration = await track.computeDuration();
            assert(Math.abs(duration - 1) < .1, 'Preview lost video duration');
            const frame = await new MB.CanvasSink(track).getCanvas(.5);
            assert(frame?.canvas.width === w, 'Preview cannot be decoded');
            report.push({ source: [width,height], rotation, thumbnail: [w,h], bytes:thumbnail.size, duration });
            input.dispose();
            window.previewBlob = thumbnail;
        }
        const { createApp, h, nextTick, createRouter, createMemoryHistory } = await import('/__thumbnail_modules.js');
        const Poster = (await import('/src/components/shared/VideoGalleryPoster.vue')).default;
        const router = createRouter({ history:createMemoryHistory(), routes:[{ path:'/', component:{ render:()=>null } }] });
        await router.push('/');
        window.previewUrl = URL.createObjectURL(window.previewBlob);
        window.testApp = createApp({ render:() => h(Poster, { to:{path:'/'}, name:'Test preview', src:window.previewUrl }) });
        window.testApp.use(router).mount('#app'); await nextTick();
        assert(!document.querySelector('video'), 'Preview loaded without interaction');
        window.assert = assert; window.nextTick = nextTick;
        return report;
    })()`);
    console.log(JSON.stringify(report, null, 2));
    console.log(await evaluate(`(async () => {
        const link = document.querySelector('a');
        link.dispatchEvent(new PointerEvent('pointerenter', { pointerType:'mouse' })); await nextTick();
        let player = document.querySelector('video'); assert(player, 'Hover did not create preview');
        await new Promise((resolve,reject) => { player.addEventListener('playing',resolve,{once:true}); player.addEventListener('error',reject,{once:true}); });
        assert(player.muted && player.loop && player.playsInline, 'Preview playback options incorrect');
        link.dispatchEvent(new PointerEvent('pointerleave')); await nextTick();
        assert(!document.querySelector('video') && player.paused && !player.getAttribute('src'), 'Hover leave did not release preview');
        link.focus(); await nextTick(); assert(document.querySelector('video'), 'Keyboard focus did not create preview');
        link.blur(); await nextTick(); assert(!document.querySelector('video'), 'Blur did not remove preview');
        return 'Hover, playback, leave, keyboard focus, and blur passed';
    })()`));
    await call('Emulation.setEmulatedMedia', { features: [{ name:'prefers-reduced-motion', value:'reduce' }] });
    await delay(100);
    console.log(await evaluate(`(async () => {
        document.querySelector('a').focus(); await nextTick();
        assert(!document.querySelector('video'), 'Reduced motion still autoplayed');
        testApp.unmount(); URL.revokeObjectURL(previewUrl);
        return 'Reduced motion passed';
    })()`));
} finally {
    ws?.close(); browser?.kill(); await server.close();
    // Only delete the isolated profile created under the system temp directory.
    if (resolve(profile).startsWith(resolve(tmpdir()) + '\\') || resolve(profile).startsWith(resolve(tmpdir()) + '/')) {
        for (let n = 0; n < 10; n++) {
            try { await rm(profile, { recursive:true, force:true }); break; } catch { await delay(250); }
        }
    }
}
