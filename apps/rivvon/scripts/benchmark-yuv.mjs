// Balanced, end-to-end CPU/GPU conversion and production export benchmark.
// Runs sequentially: concurrent Vite instances can invalidate dependency caches.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { cpus, homedir, platform, release, tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const binary = process.env.BROWSER_BINARY || [
    join(homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(existsSync);
if (!binary) throw new Error('Set BROWSER_BINARY to Chrome or Edge.');
const output = resolve(process.env.COLOUR_OUTPUT_DIR || join(root, 'colour-test-output/yuv-benchmark'));
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'rivvon-yuv-benchmark-'));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false } });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, ws, call, finishTrace;
const trace = [];
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
    ws = new WebSocket(pages.find(page => page.type === 'page' && page.url === 'about:blank').webSocketDebuggerUrl);
    await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
    let id = 0; const pending = new Map();
    ws.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
        if (message.method === 'Tracing.dataCollected') trace.push(...message.params.value);
        if (message.method === 'Tracing.tracingComplete') finishTrace?.();
        if (message.method === 'Runtime.consoleAPICalled') {
            const args = message.params.args.map(arg => arg.value).filter(value => typeof value === 'string');
            if (args[0] === '[YUV benchmark]') console.log(args.join(' '));
        }
    });
    call = (method, params = {}) => new Promise(resolve => { pending.set(++id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    async function evaluate(expression) {
        const message = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 600000 });
        if (message.error || message.result?.exceptionDetails) throw new Error(JSON.stringify(message));
        return message.result.result.value;
    }
    await call('Runtime.enable');
    await call('Page.navigate', { url: server.resolvedUrls.local[0] + 'colour-test.html?width=320&height=240&frames=1' });
    await evaluate(`(async () => {
        for (let n=0; !window.colourLab && n<200; n++) await new Promise(resolve => setTimeout(resolve,100));
        if (!window.colourLab) throw new Error('Colour lab failed to load.');
        window.yuvBenchmark = await import('/scripts/benchmark-yuv-browser.js');
        return true;
    })()`);
    const conversion = await evaluate('yuvBenchmark.benchmarkConversion()');
    await writeFile(join(output, 'conversion.json'), JSON.stringify(conversion, null, 2));
    // Trace only warm-up exports. Timed samples run with tracing disabled.
    await call('Tracing.start', { categories: 'media,blink.user_timing', transferMode: 'ReportEvents' });
    const warmup = await evaluate('yuvBenchmark.warmupExports()');
    const tracingDone = new Promise(resolve => { finishTrace = resolve; });
    await call('Tracing.end'); await tracingDone;
    for (const entry of warmup) {
        const start = trace.find(event => event.name === entry.tag + ':start')?.ts;
        const end = trace.find(event => event.name === entry.tag + ':end')?.ts;
        const events = trace.filter(event => event.ts >= start && event.ts <= end);
        entry.hardwarePathObserved = events.some(event => /MediaFoundationVideoEncodeAccelerator::ProcessInput/.test(event.name))
            && events.some(event => /Initialize/.test(event.name) && event.args?.config?.includes('required_encoder_type: hardware'));
    }
    await writeFile(join(output, 'warmup-trace.json'), JSON.stringify(trace.filter(event => /encoder|encodeaccelerator|warmup-/i.test(event.name)), null, 2));
    const exports = await evaluate('yuvBenchmark.benchmarkExports()');
    const report = { date: new Date().toISOString(), host: { cpu: cpus()[0]?.model, platform: platform(), release: release() }, conversion, warmup, exports,
        methodology: { range: 'BT.709 limited I420', conversion: 'GPU canvas render + opaque sRGB composition + readback/conversion + raw VideoFrame construction and close',
            cpuCompositorWillReadFrequently: true, gpuCompositorWillReadFrequently: false,
            order: 'CPU/GPU, GPU/CPU, CPU/GPU; per-block warm-up excluded',
            exports: '60-frame/30fps animated ribbon, production WebCodecs writer, prefer-hardware, very-high quality, no logo; includes finalization, metadata repair/verification',
            tracing: 'Enabled only during warm-up exports, disabled during all timed samples',
            caveats: ['One machine, headless Chromium; no claim for other GPUs/browsers.',
                'GPU work can be charged to a later synchronous readback/composition stage; total time is the comparison metric.',
                'Stage medians need not sum to total medians. Timed exports use already-fetched dependencies; first-use WASM download/compilation is recorded only in warmup.',
                'Noise is a stress case; ribbon is representative production geometry/materials.',
                'Offline throughput measurements, not a realtime playback deadline.'] } };
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ conversion: conversion.results.map(({ width, height, content, methods, speedup }) => ({ width, height, content,
        cpuMs: methods.cpu.total.medianMs, gpuMs: methods.gpu.total.medianMs, speedup })),
        exports: exports.results.map(({ width, height, methods, speedup }) => ({ width, height,
            cpuMs: methods.cpu.total.medianMs, gpuMs: methods.gpu.total.medianMs, speedup })),
        warmupHardware: warmup.map(({ width, hardwarePathObserved }) => ({ width, hardwarePathObserved })) }, null, 2));
} finally {
    if (ws?.readyState === WebSocket.OPEN) { await Promise.race([call('Browser.close'), delay(500)]); ws.close(); }
    browser?.kill(); await server.close();
    const tempRoot = resolve(tmpdir());
    if (resolve(profile).startsWith(tempRoot + '\\') || resolve(profile).startsWith(tempRoot + '/')) {
        await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
}
