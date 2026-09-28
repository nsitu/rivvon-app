// Real WebCodecs + WebGPU integration test. No mocked decoding or GPU.
import { createServer } from 'vite';
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
const profile = await mkdtemp(join(tmpdir(), 'rivvon-deinterlace-test-'));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false }, plugins: [{
    name: 'deinterlace-test-page',
    configureServer(server) {
        server.middlewares.use('/__deinterlace_test', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end('<script type="module" src="/scripts/deinterlace-browser.js"></script>');
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
            if (text.includes('[Deinterlace test]') || message.params.type === 'error') console.log(text);
        }
    });
    call = (method, params = {}) => new Promise(r => {
        pending.set(++id, r); ws.send(JSON.stringify({ id, method, params }));
    });
    await call('Runtime.enable');
    await call('Page.navigate', { url: `${server.resolvedUrls.local[0]}__deinterlace_test` });
    await delay(500);
    const result = await Promise.race([
        call('Runtime.evaluate', {
            expression: `(async () => { while (!window.deinterlaceTest) await new Promise(r => setTimeout(r, 100)); return await window.deinterlaceTest; })()`,
            awaitPromise: true, returnByValue: true,
        }),
        new Promise((_, reject) => { setTimeout(() => reject(new Error('Browser regression timed out after 180 seconds.')), 180000).unref(); }),
    ]);
    if (result.error || result.result?.exceptionDetails) throw new Error(JSON.stringify(result));
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
