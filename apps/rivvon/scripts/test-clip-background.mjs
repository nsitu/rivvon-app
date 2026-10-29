// Real native clip playback and timestamp-directed background rendering on WebGL/WebGPU.
import { createServer } from 'vite';
import { Input, ALL_FORMATS, BlobSource } from 'mediabunny';
import { inspectClipInput, getClipInputFormats } from '../../../packages/shared-types/src/clipAsset.js';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const binary = process.env.BROWSER_BINARY || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(existsSync);
if (!binary) throw new Error('Set BROWSER_BINARY to a WebGPU-capable Chrome/Edge executable.');
const profile = await mkdtemp(join(tmpdir(), 'rivvon-clip-background-test-'));
process.env.VITE_ASSET_MODE = 'local';
process.env.VITE_API_URL = 'http://127.0.0.1:5189';
const fixtures = new Map();
for (const [id, name] of [['test-clip', 'clip.mp4'], ['vp9-clip', 'clip-vp9.webm'], ['mkv-clip', 'clip-vp9.mkv'], ['mov-clip', 'clip.mov'], ['hevc-clip', 'clip-hevc.mp4'], ['av1-clip', 'clip-av1.mp4'], ['ts-clip', 'clip.mts']]) {
    const bytes = await readFile(resolve(root, '../../packages/shared-types/fixtures', name));
    const input = new Input({ formats: getClipInputFormats(ALL_FORMATS), source: new BlobSource(new Blob([bytes])) });
    try { const info = await inspectClipInput(input); fixtures.set(id, { bytes, info: { ...info, id, name: id === 'test-clip' ? 'Test clip' : name, mime_type: info.mimeType } }); }
    finally { input.dispose(); }
}
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5189, strictPort: true, open: false }, plugins: [{
    name: 'clip-background-test-page',
    configureServer(server) {
        server.middlewares.use('/api/auth/me', (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ authenticated: true, user: { id: 'test-owner', name: 'Test Owner' } })); });
        server.middlewares.use('/clips', (req, res, next) => {
            if (req.url !== '/' && !req.url.startsWith('/?')) return next();
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ clips: [{ id: 'test-clip', name: 'Test clip', width: 32, height: 24, duration: 1.2 }], pagination: { total: 1 } }));
        });
        server.middlewares.use('/clips', (req, res) => {
            const id = req.url.split('/').filter(Boolean)[0], fixture = fixtures.get(id);
            if (!fixture) { res.statusCode = 404; res.end(); return; }
            const { bytes: clipBytes, info } = fixture;
            if (!req.url.includes('/assets/')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ clip: info })); return; }
            if (req.url.includes('/thumbnail')) { const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN6UAAAAASUVORK5CYII=', 'base64'); res.setHeader('Content-Type', 'image/png'); res.end(png); return; }
            let start = 0, end = clipBytes.length - 1;
            const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
            if (range) { start = Number(range[1]); end = range[2] ? Math.min(end, Number(range[2])) : end; res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${clipBytes.length}`); }
            res.setHeader('Content-Type', info.mime_type); res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Content-Length', end - start + 1); res.end(clipBytes.subarray(start, end + 1));
        });
        server.middlewares.use('/__clip_background_test', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end('<script type="module" src="/scripts/clip-background-browser.js"></script>');
        });
    },
}] });
let browser, ws, call;
const delay = ms => new Promise(r => setTimeout(r, ms));
try {
    await server.listen();
    browser = spawn(binary, ['--headless=new', '--no-first-run', '--no-default-browser-check',
        '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    browser.on('error', error => console.error(error));
    let port;
    for (let i = 0; i < 100; i++) {
        try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
        catch { await delay(100); }
    }
    if (!port) throw new Error('Browser did not expose its debugging endpoint.');
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    ws = new WebSocket(pages.find(p => p.type === 'page' && p.url === 'about:blank').webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r, { once: true }));
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
        if (message.method === 'Runtime.consoleAPICalled') {
            const text = message.params.args.map(arg => arg.value ?? arg.description).join(' ');
            if (text.includes('[Clip background test]') || message.params.type === 'error') console.log(text);
        }
    });
    call = (method, params = {}) => new Promise(r => {
        pending.set(++id, r); ws.send(JSON.stringify({ id, method, params }));
    });
    await call('Runtime.enable');
    await call('Page.navigate', { url: `${server.resolvedUrls.local[0]}__clip_background_test` });
    await delay(500);
    const result = await Promise.race([
        call('Runtime.evaluate', {
            expression: `(async () => { while (!window.clipBackgroundTest) await new Promise(r => setTimeout(r, 100)); return await window.clipBackgroundTest; })()`,
            awaitPromise: true, returnByValue: true,
        }),
        new Promise((_, reject) => { setTimeout(() => reject(new Error('Browser regression timed out after 180 seconds.')), 180000).unref(); }),
    ]);
    if (result.error || result.result?.exceptionDetails) {
        throw new Error(JSON.stringify(result));
    }
    console.log(JSON.stringify(result.result.result.value, null, 2));
} finally {
    if (ws?.readyState === WebSocket.OPEN) { await call('Browser.close'); ws.close(); }
    browser?.kill();
    await server.close();
    // Delete only the uniquely created test profile under the system temp directory.
    if (resolve(profile).startsWith(resolve(tmpdir()) + '/') || resolve(profile).startsWith(resolve(tmpdir()) + '\\')) {
        await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
}

