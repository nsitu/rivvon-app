// Real WebGL2 regression: compare raw shader output with the CPU reference.
// BROWSER_BINARY selects Chrome/Edge; results stay in ignored colour-test-output.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const binary = process.env.BROWSER_BINARY || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(existsSync);
if (!binary) throw new Error('Set BROWSER_BINARY to a Chromium browser.');
const out = resolve(process.env.COLOUR_OUTPUT_DIR || join(root, 'colour-test-output/gpu-yuv'));
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'rivvon-gpu-yuv-'));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false } });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, ws, call;
try {
    await server.listen();
    browser = spawn(binary, ['--headless=new', '--no-first-run', '--no-default-browser-check',
        '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    let port;
    for (let i = 0; i < 100; i++) {
        try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
        catch { await delay(100); }
    }
    if (!port) throw new Error('Browser debugging endpoint unavailable.');
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
    });
    call = (method, params = {}) => new Promise(resolve => {
        pending.set(++id, resolve); ws.send(JSON.stringify({ id, method, params }));
    });
    await call('Page.navigate', { url: server.resolvedUrls.local[0] + 'colour-test.html?width=320&height=240&frames=1' });
    const result = await call('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
        for (let attempt = 0; !window.colourLab && attempt < 200; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
        if (!window.colourLab) throw new Error('Colour lab failed to initialize.');
        const { createGpuYuvConversion } = await import('/src/modules/viewer/gpuYuvConversion.js');
        const { createExportYuvConversion } = await import('/src/modules/viewer/exportYuvConversion.js');
        const { rgbaToBt709I420 } = await import('/src/modules/viewer/exportColour.js');
        const results = [];
        let state = 123456789;
        const randomByte = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state >>> 24; };
        for (const [width, height] of [[2,2], [6,10], [258,130], [960,540], [1920,1080], [3840,2160]]) {
            const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb', willReadFrequently: true });
            const image = ctx.createImageData(width, height);
            for (let i = 0; i < image.data.length; i += 4) {
                image.data[i] = randomByte(); image.data[i+1] = randomByte(); image.data[i+2] = randomByte(); image.data[i+3] = 255;
            }
            // Distinct top/bottom rows detect vertical reversal, with exact endpoints.
            for (let x = 0; x < width; x++) {
                image.data.set([255,255,255,255], x * 4);
                image.data.set([0,0,0,255], ((height - 1) * width + x) * 4);
            }
            ctx.putImageData(image, 0, 0);
            const rgba = ctx.getImageData(0, 0, width, height).data;
            for (const fullRange of [false, true]) {
                const gpu = createGpuYuvConversion(width, height, { fullRange });
                try {
                    const expected = rgbaToBt709I420(rgba, width, height, undefined, { fullRange });
                    const actual = new Uint8Array(expected.length);
                    const started = performance.now(); gpu.convert(canvas, actual);
                    const coldMs = performance.now() - started;
                    let maxError = 0, differences = 0;
                    for (let i = 0; i < actual.length; i++) {
                        const error = Math.abs(actual[i] - expected[i]);
                        maxError = Math.max(maxError, error); if (error) differences++;
                    }
                    const firstY = actual[0], lastY = actual[width * height - 1];
                    if (maxError > 1 || firstY !== (fullRange ? 255 : 235) || lastY !== (fullRange ? 0 : 16)) {
                        throw new Error(JSON.stringify({ width, height, fullRange, maxError, firstY, lastY }));
                    }
                    // Check texture updates rather than accidentally re-encoding the first frame.
                    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
                    gpu.convert(canvas, actual);
                    if (actual[actual.length - 1] !== 128 || actual[width * height - 1] !== (fullRange ? 255 : 235)) throw new Error('Stale GPU frame');
                    ctx.putImageData(image, 0, 0);
                    const warm = [], cpu = [];
                    for (let i = 0; i < 5; i++) {
                        let t = performance.now(); gpu.convert(canvas, actual); warm.push(performance.now() - t);
                        t = performance.now(); rgbaToBt709I420(rgba, width, height, actual, { fullRange }); cpu.push(performance.now() - t);
                    }
                    const median = values => values.sort((a,b) => a-b)[Math.floor(values.length / 2)];
                    results.push({ width, height, fullRange, maxError, differences, firstY, lastY, coldMs,
                        gpuIncludingReadbackMs: median(warm), cpuArithmeticOnlyMs: median(cpu), readbackBytesPerFrame: gpu.readbackBytesPerFrame });
                } finally { gpu.dispose(); }
            }
        }
        // Lose the isolated converter context and ensure it rejects instead of emitting stale bytes.
        const originalCreate = document.createElement.bind(document);
        let converterCanvas;
        document.createElement = (...args) => { const element = originalCreate(...args); if (args[0] === 'canvas') converterCanvas = element; return element; };
        const adapter = createExportYuvConversion(2, 2);
        document.createElement = originalCreate;
        const gl = converterCanvas.getContext('webgl2');
        gl.getExtension('WEBGL_lose_context').loseContext();
        await new Promise(resolve => setTimeout(resolve, 50));
        const source = originalCreate('canvas'); source.width = source.height = 2;
        const context = source.getContext('2d', { alpha: false, colorSpace: 'srgb' });
        context.fillStyle = '#fff'; context.fillRect(0, 0, 2, 2);
        const pixels = adapter.convert(source, new Uint8Array(6));
        const fallback = adapter.info; adapter.dispose();
        if (fallback.method !== 'cpu' || !fallback.fallbackReason || pixels[0] !== 235) throw new Error('Context-loss fallback failed');
        return { browser: navigator.userAgent, results, fallback };
    })()` });
    if (result.error || result.result?.exceptionDetails) throw new Error(JSON.stringify(result));
    const report = result.result.result.value;
    await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
} finally {
    if (ws?.readyState === WebSocket.OPEN) { await Promise.race([call('Browser.close'), delay(500)]); ws.close(); }
    browser?.kill(); await server.close();
    const tempRoot = resolve(tmpdir());
    if (resolve(profile).startsWith(tempRoot + '\\') || resolve(profile).startsWith(tempRoot + '/')) {
        await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
}
