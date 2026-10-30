import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { cpus, homedir, platform, release, tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const binary = process.env.BROWSER_BINARY || [join(homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
if (!binary) throw new Error('Set BROWSER_BINARY to Chrome or Edge.');
const quick = process.argv.includes('--quick');
const integration = process.argv.includes('--integration');
const outputDir = resolve(process.env.BACKGROUND_LOOP_OUTPUT_DIR || join(root, 'colour-test-output/background-loop', integration ? 'integration' : quick ? 'quick' : 'full'));
await mkdir(outputDir, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'rivvon-background-loop-benchmark-'));
process.env.VITE_ASSET_MODE = 'local';
if (integration) process.env.VITE_API_URL = 'http://127.0.0.1:5193';
const uploads = { metadata: null, videoBytes: 0, posterBytes: 0, complete: false };
const server = await createServer({ root, server: { host: '127.0.0.1', port: integration ? 5193 : 0, strictPort: integration, open: false },
    plugins: integration ? [{ name: 'background-loop-workflow-api', configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
            const path = req.url.split('?')[0];
            const json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
            if (path === '/api/auth/me') return json({ authenticated: true, user: { id: 'test-owner', name: 'Test Artist' } });
            if (path === '/clip' && req.method === 'POST') {
                const parts = []; for await (const chunk of req) parts.push(chunk);
                uploads.metadata = JSON.parse(Buffer.concat(parts).toString()); return json({ clipId: 'workflow-clip' });
            }
            if (path.startsWith('/clip/workflow-clip/assets/')) {
                let size = 0; for await (const chunk of req) size += chunk.length;
                if (path.endsWith('/clip')) uploads.videoBytes = size; else uploads.posterBytes = size;
                return json({ success: true });
            }
            if (path === '/clip/workflow-clip/complete') {
                uploads.complete = true; return json({ clip: { id: 'workflow-clip', name: uploads.metadata.name } });
            }
            next();
        });
    } }] : [],
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, ws, call;
try {
    await server.listen();
    browser = spawn(binary, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-precise-memory-info',
        '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    let port;
    for (let i = 0; i < 100; i++) {
        try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
        catch { await delay(100); }
    }
    if (!port) throw new Error('Browser debugging endpoint unavailable.');
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
    let id = 0; const pending = new Map();
    ws.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
        if (message.method === 'Runtime.consoleAPICalled') {
            const values = message.params.args.map(arg => arg.value ?? arg.description);
            if (values[0] === '[Background loop benchmark]' || message.params.type === 'error') console.log(...values);
        }
    });
    call = (method, params = {}) => new Promise(resolve => { pending.set(++id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    async function evaluate(expression) {
        const message = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (message.error || message.result?.exceptionDetails) throw new Error(JSON.stringify(message));
        return message.result.result.value;
    }
    await call('Runtime.enable');
    await call('Page.navigate', { url: server.resolvedUrls.local[0] + (integration ? '?create=true' : 'background-loop-lab.html') });
    if (integration) {
        await evaluate(`(async () => { for (let i = 0; !document.querySelector('.file-output-choice') && i < 400; i++) await new Promise(r => setTimeout(r, 100)); if (!document.querySelector('.file-output-choice')) throw new Error('Creator did not mount.'); await import('/scripts/background-loop-workflow-browser.js'); return await backgroundLoopWorkflow.setup(); })()`);
    } else await evaluate(`(async () => { for (let i = 0; !document.querySelector('h1') && i < 100; i++) await new Promise(r => setTimeout(r, 100)); if (!document.querySelector('h1')) throw new Error('Prototype UI did not mount.'); return true; })()`);
    for (const [name, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
        await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const overflow = await evaluate('document.documentElement.scrollWidth > innerWidth');
        if (overflow) throw new Error(`Prototype UI overflows horizontally at ${width}px.`);
        if (integration) {
            const overflow = await evaluate(`(() => { const preview = document.querySelector('.background-source-preview'); const controls = preview?.querySelector('.video-controls'); return controls && controls.getBoundingClientRect().right > preview.getBoundingClientRect().right + 1; })()`);
            if (overflow) throw new Error(`Source playback controls overflow at ${width}px.`);
            const panelOverflow = await evaluate(`(() => { const panel = document.querySelector('.texture-creator-content .p-scrollpanel-content'); return panel && panel.scrollWidth > panel.clientWidth + 1; })()`);
            if (panelOverflow) throw new Error(`Creator content overflows horizontally at ${width}px.`);
        }
        const screenshot = await call('Page.captureScreenshot', { format: 'png' });
        await writeFile(join(outputDir, `lab-${name}.png`), Buffer.from(screenshot.result.data, 'base64'));
    }
    await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    if (integration) {
        const report = await evaluate('backgroundLoopWorkflow.run()');
        if (!uploads.complete || uploads.videoBytes !== report.outputBytes || !uploads.posterBytes) throw new Error('Clip upload did not transfer/finalize the expected video and poster.');
        await call('Page.navigate', { url: server.resolvedUrls.local[0] + '?create=true' });
        Object.assign(report, await evaluate(`(async () => { for (let i = 0; !document.querySelector('.file-output-choice') && i < 400; i++) await new Promise(r => setTimeout(r, 100)); await import('/scripts/background-loop-workflow-browser.js'); return await backgroundLoopWorkflow.recover(); })()`));
        for (const [name, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
            await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
            await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
            if (await evaluate('document.documentElement.scrollWidth > innerWidth')) throw new Error('Result screen overflows horizontally.');
            const screenshot = await call('Page.captureScreenshot', { format: 'png' });
            await writeFile(join(outputDir, `result-${name}.png`), Buffer.from(screenshot.result.data, 'base64'));
        }
        await writeFile(join(outputDir, 'report.json'), JSON.stringify({ ...report, uploads }, null, 2));
        console.log(JSON.stringify({ ...report, uploads }, null, 2));
    } else {
    await evaluate(`(async () => { await import('/scripts/background-loop-benchmark-browser.js'); return true; })()`);
    const report = await evaluate(`backgroundLoopBenchmark.benchmark({ quick: ${quick} })`);
    report.host = { cpu: cpus()[0]?.model, platform: platform(), release: release() };
    for (const result of report.results) {
        const poster = result.metadata.posterDataUrl;
        delete result.metadata.posterDataUrl;
        await writeFile(join(outputDir, `${result.plan.size}-poster.png`), Buffer.from(poster.split(',')[1], 'base64'));
    }
    await writeFile(join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
    // Download the final browser Blob in bounded chunks, without a giant base64 evaluation response.
    const finalJob = report.results.at(-1).jobId;
    const size = await evaluate(`(async () => { const { getBackgroundLoopBlob } = await import('/src/services/backgroundLoopStorage.js'); window.benchmarkBlob = await getBackgroundLoopBlob(${JSON.stringify(finalJob)}); return benchmarkBlob.size; })()`);
    const chunks = [];
    for (let offset = 0; offset < size; offset += 1024 * 1024) {
        const encoded = await evaluate(`(async () => { const bytes = new Uint8Array(await benchmarkBlob.slice(${offset}, ${offset + 1024 * 1024}).arrayBuffer()); let value = ''; for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(value); })()`);
        chunks.push(Buffer.from(encoded, 'base64'));
    }
    await writeFile(join(outputDir, 'sampled-background.mp4'), Buffer.concat(chunks));
    console.log(JSON.stringify({ outputDir, validation: report.validation, results: report.results.map(({ plan, totalMs, assemblyMs, outputBytes, stageTotals, observedJsHeapPeakBytes }) =>
        ({ size: plan.size, phases: plan.phaseCount, totalMs, assemblyMs, outputBytes, stageTotals, observedJsHeapPeakBytes })) }, null, 2));
    }
} finally {
    if (ws?.readyState === WebSocket.OPEN) { await Promise.race([call('Browser.close'), delay(1000)]); ws.close(); }
    browser?.kill(); await server.close();
    const tempRoot = resolve(tmpdir());
    if (!resolve(profile).startsWith(tempRoot + '\\') && !resolve(profile).startsWith(tempRoot + '/')) throw new Error('Unexpected temporary profile path.');
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
