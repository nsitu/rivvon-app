// Real single-threaded WASM instances in parallel, without cross-origin
// isolation. Decode binary markers to verify every frame and CFR timestamp.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const binary = process.env.BROWSER_BINARY || ['C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
if (!binary) throw new Error('Set BROWSER_BINARY to Chrome or Edge.');
const minimumWorkers = Number(process.env.POOL_MIN_WORKERS || 1);
if (!Number.isInteger(minimumWorkers) || minimumWorkers < 1 || minimumWorkers > 4) throw new Error('POOL_MIN_WORKERS must be between 1 and 4.');
const output = resolve(process.env.COLOUR_OUTPUT_DIR || join(root, 'colour-test-output', 'worker-pool'));
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'rivvon-pool-check-'));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false,
    headers: { 'Cross-Origin-Opener-Policy': 'unsafe-none', 'Cross-Origin-Embedder-Policy': 'unsafe-none' } },
    plugins: [{ name: 'pool-check', configureServer(server) {
        server.middlewares.use('/__pool_check', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end('<!doctype html><html><body>Pool regression</body></html>');
        });
    } }] });
let browser, ws, call;
try {
    await server.listen();
    browser = spawn(binary, ['--headless=new', '--no-first-run', '--no-default-browser-check',
        '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    let port;
    for (let n = 0; n < 100; n++) {
        try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
        catch { await new Promise(r => setTimeout(r, 100)); }
    }
    if (!port) throw new Error('Browser failed to start');
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r, { once: true }));
    let id = 0; const pending = new Map();
    ws.addEventListener('message', event => {
        const value = JSON.parse(event.data);
        if (value.id) { pending.get(value.id)?.(value); pending.delete(value.id); }
    });
    call = (method, params = {}) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
    await call('Page.navigate', { url: `${server.resolvedUrls.local[0]}__pool_check` });
    await new Promise(r => setTimeout(r, 500));
    const result = await Promise.race([call('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `
        (async () => {
            const {createSdrEncoderPool} = await import('/src/modules/viewer/sdrEncoderPool.js');
            const {restoreCfrMp4Timing,assertSdrMp4} = await import('/src/modules/viewer/videoColourMetadata.js');
            const MB = await import('/@id/mediabunny');
            if (crossOriginIsolated) throw new Error('Test must run without isolation');
            const width=1920,height=1080,fps=30,batchFrames=10,batches=8,pixels=width*height,frameBytes=pixels*3/2;
            let peakActive=0;
            const pool=await createSdrEncoderPool({width,height,fps,quality:'very-high',workerLimit:4,
                onStatus: phase => { const match=phase.match(/\\((\\d+) workers?\\)/); if(match)peakActive=Math.max(peakActive,Number(match[1])); }});
            const started=performance.now();
            try {
                for(let b=0;b<batches;b++) {
                    await pool.submit(() => {
                        const data=new Uint8Array(frameBytes*batchFrames);
                        for(let f=0;f<batchFrames;f++) {
                            const base=f*frameBytes,marker=b*batchFrames+f;
                            let seed=marker+1;
                            for(let n=0;n<pixels;n++){seed=(Math.imul(seed,1664525)+1013904223)|0;data[base+n]=16+((seed>>>24)%220);}
                            data.fill(128,base+pixels,base+frameBytes);
                            for(let y=0;y<64;y++)for(let x=0;x<128;x++)data[base+y*width+x]=(marker>>Math.floor(x/16))&1?235:16;
                        }
                        return data;
                    },batchFrames);
                }
                const data=await pool.mux();
                const frames=batchFrames*batches;
                restoreCfrMp4Timing(data,{fps,frames});
                assertSdrMp4(data,{width,height,fps,frames});
                const elapsed=(performance.now()-started)/1000;
                const input=new MB.Input({formats:MB.ALL_FORMATS,source:new MB.BlobSource(new Blob([data],{type:'video/mp4'}))});
                const track=await input.getPrimaryVideoTrack(),sink=new MB.VideoSampleSink(track);
                const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;
                const ctx=canvas.getContext('2d',{willReadFrequently:true});
                let decoded=0;
                try {
                    for await(const sample of sink.samples()) {
                        try {
                            ctx.drawImage(sample.toCanvasImageSource(),0,0);
                            let marker=0;
                            for(let bit=0;bit<8;bit++){const value=ctx.getImageData(bit*16+8,32,1,1).data[0];if(value>128)marker|=1<<bit;}
                            if(marker!==decoded)throw new Error('Frame order mismatch: '+decoded+' decoded marker '+marker);
                            if(Math.abs(sample.timestamp-decoded/fps)>0.00001)throw new Error('CFR timestamp mismatch');
                            decoded++;
                        }finally{sample.close();}
                    }
                }finally{input.dispose();}
                if(decoded!==frames)throw new Error('Wrong decoded frame count');
                if(peakActive<${minimumWorkers}||peakActive>4)throw new Error('Unexpected active worker count: '+peakActive);
                return {frames,decoded,peakActive,workers:pool.workerCount,crossOriginIsolated,elapsed};
            }finally{pool.dispose();}
        })()
    ` }), new Promise((_, reject) => setTimeout(() => reject(new Error('Worker pool regression timed out after 2 minutes')), 120000).unref())]);
    if (result.error || result.result.exceptionDetails) throw new Error(JSON.stringify(result));
    console.log(JSON.stringify(result.result.result.value));
    await writeFile(join(output, 'four-worker-report.json'), JSON.stringify(result.result.result.value, null, 2));
} finally {
    if (ws?.readyState === WebSocket.OPEN) { await call('Browser.close'); ws.close(); }
    browser?.kill(); await server.close();
    const allowed = resolve(tmpdir());
    if (resolve(profile).startsWith(allowed + '/') || resolve(profile).startsWith(allowed + '\\'))
        await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
