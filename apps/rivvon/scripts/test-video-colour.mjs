// Real Chromium + pinned WASM/x264 regression. Saves files for Android comparison.
// Optional independent native tools: FFPROBE_BINARY and FFMPEG_BINARY.
import { createServer } from 'vite';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rgbaToBt709I420 } from '../src/modules/viewer/exportColour.js';
import { createColourChartRgba } from '../src/modules/viewer/colourTestChart.js';

const root = fileURLToPath(new URL('..',import.meta.url));
const binary = process.env.BROWSER_BINARY || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome','/usr/bin/chromium',
].find(existsSync);
if (!binary) throw new Error('Set BROWSER_BINARY to Chrome or Edge.');
const output = resolve(process.env.COLOUR_OUTPUT_DIR || join(root,'colour-test-output'));
await mkdir(output,{ recursive:true });
const profile = await mkdtemp(join(tmpdir(),'rivvon-colour-test-'));
const server = await createServer({ root, server:{ host:'127.0.0.1',port:0,open:false }, plugins:[{
    name:'colour-test-output',
    configureServer(server) {
        server.middlewares.use('/__colour_output',async (req,res) => {
            const name = decodeURIComponent(req.url.slice(1));
            if (req.method !== 'POST' || name !== basename(name) || !/^[a-z0-9-]+\.(mp4|png|json)$/.test(name)) {
                res.statusCode = 400; res.end(); return;
            }
            try {
                const data = []; for await (const part of req) data.push(part);
                await writeFile(join(output,name),Buffer.concat(data)); res.end('ok');
            } catch (error) { res.statusCode = 500; res.end(String(error)); }
        });
    },
}] });
let browser, ws, call;
const delay = ms => new Promise(r => setTimeout(r,ms));
try {
    await server.listen();
    browser = spawn(binary,['--headless=new','--no-first-run','--no-default-browser-check',
        '--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{ windowsHide:true,stdio:'ignore' });
    browser.on('error',error => console.error(error));
    let port;
    for (let n = 0; n < 100; n++) {
        try { port = (await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]; break; }
        catch { await delay(100); }
    }
    if (!port) throw new Error('Browser did not expose its debugging endpoint.');
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    ws = new WebSocket(pages.find(p => p.type === 'page' && p.url === 'about:blank').webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open',r,{ once:true }));
    let id = 0, rejectBrowserError; const pending = new Map();
    const browserError = new Promise((_,reject) => { rejectBrowserError = reject; });
    ws.addEventListener('message',event => {
        const message = JSON.parse(event.data);
        if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
        if (message.method === 'Runtime.exceptionThrown') rejectBrowserError(new Error(JSON.stringify(message.params.exceptionDetails)));
    });
    call = (method,params = {}) => new Promise(r => { pending.set(++id,r); ws.send(JSON.stringify({ id,method,params })); });
    await call('Runtime.enable');
    const query = new URLSearchParams();
    for (const [key,env] of [['width','COLOUR_WIDTH'],['height','COLOUR_HEIGHT'],['fps','COLOUR_FPS'],['frames','COLOUR_FRAMES']]) {
        if (process.env[env]) query.set(key,process.env[env]);
    }
    await call('Page.navigate',{ url:`${server.resolvedUrls.local[0]}colour-test.html?${query}` });
    const result = await Promise.race([
        browserError,
        call('Runtime.evaluate',{
            expression:`(async () => { while (!window.colourLab) await new Promise(r => setTimeout(r,100)); return await colourLab.exportComparisons({ receiver:'/__colour_output', hardwareAcceleration:${JSON.stringify(process.env.HARDWARE_ACCELERATION || 'no-preference')} }); })()`,
            awaitPromise:true,returnByValue:true,
        }),
        new Promise((_,reject) => setTimeout(() => reject(new Error('Colour regression timed out after 10 minutes.')),600000).unref()),
    ]);
    if (result.error || result.result?.exceptionDetails) throw new Error(JSON.stringify(result));
    const report = result.result.result.value;
    for (const entry of report.exports) {
        if (entry.error) throw new Error(`${entry.name}: ${entry.error}`);
        if (entry.metadata?.phase !== 'complete' || !entry.metadata.environment?.userAgent || !entry.metadata.verification) {
            throw new Error(`Missing completed colour/environment report: ${entry.name}`);
        }
        if (entry.name.endsWith('-after.mp4') && !entry.metadata.verification.matchesSdrTarget) throw new Error('Software colour contract was not verified.');
    }
    const native = [];
    for (const entry of report.exports.filter(e => !e.error)) {
        const file = join(output,entry.name), data = { name:entry.name };
        if (process.env.FFPROBE_BINARY) {
            data.ffprobe = JSON.parse(execFileSync(process.env.FFPROBE_BINARY,['-v','error','-select_streams','v:0','-count_frames',
                '-show_entries','stream=codec_name,pix_fmt,color_range,color_space,color_transfer,color_primaries,width,height,r_frame_rate,avg_frame_rate,duration,nb_read_frames',
                '-of','json',file],{ encoding:'utf8' })).streams[0];
            if (entry.name.endsWith('-after.mp4')) {
                const s = data.ffprobe;
                const [rateNumerator,rateDenominator] = s.avg_frame_rate.split('/').map(Number);
                if (s.codec_name !== 'h264' || s.pix_fmt !== 'yuv420p' || s.color_range !== 'tv'
                    || [s.color_space,s.color_transfer,s.color_primaries].some(c => c !== 'bt709')
                    || s.width !== report.width || s.height !== report.height || Number(s.nb_read_frames) !== report.frames
                    || Math.abs(Number(s.duration) - report.frames / report.fps) > 0.00001
                    || Math.abs(rateNumerator / rateDenominator - report.fps) > 0.000001) throw new Error(`Independent ffprobe validation failed: ${JSON.stringify(s)}`);
            }
        }
        if (process.env.FFMPEG_BINARY) {
            const trace = spawnSync(process.env.FFMPEG_BINARY,['-hide_banner','-i',file,'-map','0:v:0','-c:v','copy','-bsf:v','trace_headers',
                '-frames:v','1','-f','null','-'],{ encoding:'utf8',maxBuffer:8 * 1024 * 1024,windowsHide:true });
            if (trace.status !== 0) throw new Error(trace.stderr);
            data.traceHeaders = trace.stderr.split('\n').filter(line => /chroma_format_idc|bit_depth_(luma|chroma)_minus8|video_full_range_flag|colour_primaries|transfer_characteristics|matrix_coefficients/.test(line));
            await writeFile(join(output,entry.name.replace('.mp4','-sps.txt')),data.traceHeaders.join('\n'));
            if (entry.name.endsWith('-after.mp4')) {
                for (const [field,value] of [['chroma_format_idc',1],['bit_depth_luma_minus8',0],['bit_depth_chroma_minus8',0],
                    ['video_full_range_flag',0],['colour_primaries',1],['transfer_characteristics',1],['matrix_coefficients',1]]) {
                    if (!data.traceHeaders.some(line => line.includes(field) && line.trim().endsWith(`= ${value}`))) throw new Error(`Independent SPS validation failed: ${field}`);
                }
            }
        }
        native.push(data);
    }
    if (process.env.FFMPEG_BINARY) {
        for (const entry of report.exports.filter(e => e.name.endsWith('-webcodecs-repaired.mp4'))) {
            const originalName = entry.name.replace('-webcodecs-repaired.mp4','-before.mp4');
            const decoded = name => execFileSync(process.env.FFMPEG_BINARY,['-v','error','-i',join(output,name),
                '-map','0:v:0','-pix_fmt',entry.metadata.container[0].fullRange ? 'yuvj420p' : 'yuv420p','-f','framemd5','-'],
                { encoding:'utf8',maxBuffer:8 * 1024 * 1024 }).split('\n').filter(line => line && !line.startsWith('#'));
            const original = decoded(originalName), repaired = decoded(entry.name);
            if (JSON.stringify(original) !== JSON.stringify(repaired) || repaired.length !== report.frames) throw new Error('SPS repair changed decoded pixels or sample timing.');
            if (entry.metadata.spsRepair.status === 'added' && entry.metadata.verification.containerAndBitstream !== 'agree') throw new Error('SPS repair failed independent metadata inspection.');
            native.find(e => e.name === entry.name).decodedFramesAndTimingUnchanged = true;
        }
        const sequence = execFileSync(process.env.FFMPEG_BINARY,['-v','error','-i',join(output,'sequence-after.mp4'),
            '-vf','crop=224:32:0:0','-pix_fmt','yuv420p','-f','rawvideo','-'],{ maxBuffer:16 * 1024 * 1024 });
        if (sequence.length !== report.frames * 224 * 32 * 3 / 2) throw new Error('Temporal sequence frame count changed.');
        for (let n = 0; n < report.frames; n++) {
            let decodedNumber = 0;
            for (let bit = 0; bit < 7; bit++) {
                const luma = sequence[n * 224 * 32 * 3 / 2 + 16 * 224 + bit * 32 + 16];
                if (luma > 128) decodedNumber |= 1 << bit;
            }
            if (decodedNumber !== (n & 127)) throw new Error(`Dropped, duplicated or reordered frame at ${n}: decoded ${decodedNumber}.`);
        }
        native.push({ name:'sequence-after.mp4',sequence:'Every frame marker in order, including batch boundaries',frames:report.frames });
        const expected = rgbaToBt709I420(createColourChartRgba(report.width,report.height),report.width,report.height);
        for (const logo of ['off','on']) {
            const file = join(output,`chart-logo-${logo}-after.mp4`);
            const decoded = execFileSync(process.env.FFMPEG_BINARY,['-v','error','-i',file,'-frames:v','1','-pix_fmt','yuv420p','-f','rawvideo','-'],{ maxBuffer:16 * 1024 * 1024 });
            let maxError = 0;
            // Patch interiors, excluding logo and 4:2:0 boundaries.
            for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {
                const x = Math.floor((col + 0.5) * report.width / 8), y = Math.floor((row + 0.5) * report.height / 6);
                for (const index of [y * report.width + x, report.width * report.height + Math.floor(y / 2) * report.width / 2 + Math.floor(x / 2),
                    report.width * report.height * 5 / 4 + Math.floor(y / 2) * report.width / 2 + Math.floor(x / 2)]) {
                    maxError = Math.max(maxError,Math.abs(decoded[index] - expected[index]));
                }
            }
            if (maxError > 4) throw new Error(`Decoded chart ${logo} sample values differ by ${maxError}.`);
            native.find(e => e.name === `chart-logo-${logo}-after.mp4`).patchMaxError = maxError;
        }
    }
    await writeFile(join(output,'native-report.json'),JSON.stringify(native,null,2));
    console.log(JSON.stringify({ userAgent:report.userAgent,gpu:report.gpu,frames:report.frames,fps:report.fps,
        chartMaxError:report.chartMaxError,cancellation:report.cancellation,
        exports:native.map(({ name,ffprobe,patchMaxError }) => ({ name,ffprobe,patchMaxError })) },null,2));
    console.log(`Colour comparison files: ${output}`);
} finally {
    if (ws?.readyState === WebSocket.OPEN) { await call('Browser.close'); ws.close(); }
    browser?.kill(); await server.close();
    const allowed = resolve(tmpdir());
    if (resolve(profile).startsWith(allowed + '/') || resolve(profile).startsWith(allowed + '\\')) await rm(profile,{ recursive:true,force:true,maxRetries:10,retryDelay:200 });
}
