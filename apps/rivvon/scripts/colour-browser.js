import * as THREE from 'three';
import { TileManager } from '../src/modules/viewer/tileManager.js';
import { RibbonSeries } from '../src/modules/viewer/ribbonSeries.js';
import { applyRendererDisplayConfig } from '../src/modules/viewer/rendererConfig.js';
import { createColourChartRgba } from '../src/modules/viewer/colourTestChart.js';
import { createCanvasVideoExport } from '../src/modules/viewer/canvasVideoExport.js';
import { completeExportColourReport } from '../src/modules/viewer/exportColourReport.js';
import { repairMissingSpsColour } from '../src/modules/viewer/repairWebCodecsColour.js';
import { createExportBlob, readExportBlob } from '../src/modules/viewer/exportBlob.js';
import spsRepairWorkerUrl from '../src/modules/viewer/spsRepairWorker.js?worker&url';
import { getRuntimeAssetUrl } from '../src/modules/shared/runtimeAssets.js';
import { getSdrBitrate } from '../src/modules/viewer/exportColour.js';

const params = new URLSearchParams(location.search);
const width = Number(params.get('width') || 960), height = Number(params.get('height') || 540);
const fps = Number(params.get('fps') || 30), frames = Number(params.get('frames') || 90);
if (!Number.isSafeInteger(frames) || frames < 1) throw new Error('Test frame count must be a positive integer.');
const bytes = createColourChartRgba(width, height);
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
applyRendererDisplayConfig(renderer); renderer.setPixelRatio(1); renderer.setSize(width, height);
const texture = new THREE.DataArrayTexture(new Uint8Array(bytes), width, height, 1);
texture.colorSpace = THREE.LinearSRGBColorSpace; texture.flipY = false;
texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.needsUpdate = true;
const tm = new TileManager({ renderer, tileCount: 1, repeatMode: 'wrap', edgeNoiseTransparencyMax: 0, filmstripStyleEnabled: false });
tm.arrayTextures = [texture]; tm.layerCount = 1;
tm.setFlowEnabled(true);
const material = tm.createFlowMaterial(0);
const geometry = new THREE.PlaneGeometry(2, 2);
// Production tile shaders already invert V for top-origin array texture bytes.
geometry.setAttribute('maskV', new THREE.Float32BufferAttribute([1,1,0,0], 1));
const chartScene = new THREE.Scene(); chartScene.add(new THREE.Mesh(geometry, material));
const chartCamera = new THREE.OrthographicCamera(-1,1,1,-1,0.1,10); chartCamera.position.z = 2;
const chart = document.createElement('canvas'); chart.width = width; chart.height = height;
const chartContext = chart.getContext('2d', { alpha: false, colorSpace: 'srgb', willReadFrequently: true });
function renderChart() { renderer.render(chartScene, chartCamera); chartContext.drawImage(renderer.domElement,0,0); }
renderChart();
const actual = chartContext.getImageData(0,0,width,height).data;
let chartMaxError = 0;
for (let i = 0; i < bytes.length; i++) chartMaxError = Math.max(chartMaxError, Math.abs(bytes[i] - actual[i]));
if (chartMaxError > 1) throw new Error(`Production ribbon shader changed the numeric chart: ${chartMaxError}`);

// Exercise production RibbonSeries geometry/materials with saturated texture
// rather than a test-only shader. Static source frames repeat without a seam.
const ribbonScene = new THREE.Scene();
const ribbons = new RibbonSeries(ribbonScene); ribbons.setTileManager(tm);
const points = Array.from({ length: 24 }, (_, i) => {
    const t = i / 23 * Math.PI * 3;
    return new THREE.Vector3(Math.cos(t) * 1.7, (i / 23 - 0.5) * 3.5, Math.sin(t) * 0.5);
});
ribbons.buildFromPoints(points, 0.55); ribbons.initFlowMaterials();
const ribbonCamera = new THREE.PerspectiveCamera(40, width / height,0.1,100); ribbonCamera.position.set(0,0,8); ribbonCamera.lookAt(0,0,0);
const ribbon = document.createElement('canvas'); ribbon.width = width; ribbon.height = height;
const ribbonContext = ribbon.getContext('2d', { alpha:false, colorSpace:'srgb' });
function renderRibbon() { renderer.render(ribbonScene,ribbonCamera); ribbonContext.fillStyle = '#000'; ribbonContext.fillRect(0,0,width,height); ribbonContext.drawImage(renderer.domElement,0,0); }
renderRibbon();
const ribbonPixels = ribbonContext.getImageData(0,0,width,height).data;
if (!ribbonPixels.some((value,i) => i % 4 === 0 && value > 128 && ribbonPixels[i + 2] < 64)
    || !ribbonPixels.some((value,i) => i % 4 === 2 && value > 128 && ribbonPixels[i - 2] < 64)) {
    throw new Error('Representative ribbon must contain saturated red and blue pixels.');
}
const preview = document.querySelector('#previews');
for (const [label, canvas] of [['Colour chart: production ribbon shader',chart],['Saturated ribbon: production geometry/materials',ribbon]]) {
    const heading = document.createElement('h2'); heading.textContent = label; preview.append(heading,canvas);
    canvas.style.maxWidth = '100%'; canvas.style.height = 'auto';
}
const gl = renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
const environment = { userAgent:navigator.userAgent, gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable',
    outputColorSpace:renderer.outputColorSpace, chartMaxError, width,height,fps,frames };
function report(value) { document.querySelector('#report').textContent = JSON.stringify(value,null,2); console.info('[Colour test]',value); }
report(environment);

async function legacy(canvas, logoEnabled, hardwareAcceleration, metadata) {
    let originalBlob, originalMetadata;
    const writer = await createCanvasVideoExport(canvas,{ width,height,fps,format:'mp4',encodingMethod:'webcodecs',
        quality:'very-high',logoOverlayEnabled:logoEnabled,logoOverlayCorner:'bottomLeft',hardwareAcceleration,repairSpsColour:true,
        renderContext:gl,onBeforeSpsRepair:(blob,meta) => { originalBlob = blob; originalMetadata = meta; },onColourMetadata:meta => {
            metadata.metadata = meta; metadata.videoFrame = meta.videoFrame; metadata.decoderConfig = meta.decoderConfig;
        } });
    try {
        for (let n = 0; n < frames; n++) await writer.add(n / fps,1 / fps);
        const blob = await writer.finalize();
        if (metadata.metadata.phase !== 'complete' || !metadata.metadata.environment.userAgent
            || !metadata.metadata.encoderConfig || !metadata.metadata.videoFrame) throw new Error('WebCodecs colour report is incomplete.');
        return { blob, originalBlob, originalMetadata };
    } finally { await writer.dispose(); }
}
async function save(name,blob,receiver) {
    if (receiver) {
        const response = await fetch(`${receiver}/${name}`,{ method:'POST',body:blob });
        if (!response.ok) throw new Error(`Saving ${name} failed.`);
    } else {
        const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(url),30000);
    }
}
async function desktopPlayback(blob,name,receiver) {
    const video = document.createElement('video');
    video.controls = true; video.loop = true; video.muted = true;
    const heading = document.createElement('h3'); heading.textContent = name; preview.append(heading,video);
    video.style.maxWidth = '100%';
    const url = URL.createObjectURL(blob); video.src = url;
    try {
        await new Promise((resolve,reject) => {
            video.addEventListener('loadeddata',resolve,{ once:true });
            video.addEventListener('error',() => reject(new Error('Desktop playback failed.')),{ once:true });
        });
        await new Promise((resolve,reject) => {
            const timeout = setTimeout(() => reject(new Error('Desktop video did not present a frame.')),10000);
            video.requestVideoFrameCallback(() => { clearTimeout(timeout); video.pause(); resolve(); });
            video.play().catch(reject);
        });
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d',{ alpha:false,colorSpace:'srgb',willReadFrequently:true });
        context.drawImage(video,0,0);
        const rgba = context.getImageData(0,0,width,height).data;
        const patches = [];
        for (let row = 0; row < 4; row++) {
            patches.push(Array.from({ length:8 },(_,col) => {
                const pixel = (Math.floor((row + 0.5) * height / 6) * width + Math.floor((col + 0.5) * width / 8)) * 4;
                return Array.from(rgba.slice(pixel,pixel + 3));
            }));
        }
        await save(name.replace('.mp4','-desktop.png'),await new Promise(resolve => canvas.toBlob(resolve)),receiver);
        if (name.startsWith('chart-') && patches[0][0].some(value => value < 250)) throw new Error('Desktop playback did not display the white chart patch.');
        return patches;
    } catch (error) { URL.revokeObjectURL(url); throw error; }
}
async function checkLargeRepairInput(originalBlob, decoderColourSpaces, paddingMiB) {
    const original = new Uint8Array(await originalBlob.arrayBuffer());
    // A trailing MP4 free box makes a large, valid input without encoding
    // minutes of video or changing sample offsets, colour, or frame timing.
    const paddingBytes = paddingMiB * 1024 * 1024;
    const data = new Uint8Array(original.length + paddingBytes);
    data.set(original);
    new DataView(data.buffer).setUint32(original.length, paddingBytes);
    data.set([0x66, 0x72, 0x65, 0x65], original.length + 4); // free
    let nativeBlobError = null;
    try { new Blob([data]); }
    catch (error) { nativeBlobError = `${error.name}: ${error.message}`; }
    // Reproduce a restricted transfer range even on browsers with a higher
    // limit. The real FFmpeg worker must still read and repair the large file.
    const postMessage = Worker.prototype.postMessage;
    const NativeBlob = Blob;
    if (paddingMiB < 2048) window.Blob = new Proxy(NativeBlob, {
        construct(target, [parts, options], newTarget) {
            for (const part of parts) {
                const buffer = ArrayBuffer.isView(part) ? part.buffer : part;
                if (buffer instanceof ArrayBuffer && buffer.byteLength > 128 * 1024 * 1024) {
                    throw new RangeError('The ArrayBuffer/ArrayBufferView size exceeds the supported range.');
                }
            }
            return Reflect.construct(target, [parts, options], newTarget);
        }
    });
    Worker.prototype.postMessage = function (message, transfer) {
        if (transfer?.some(buffer => buffer instanceof ArrayBuffer && buffer.byteLength > 128 * 1024 * 1024)) {
            throw new RangeError('The ArrayBuffer/ArrayBufferView size exceeds the supported range.');
        }
        return postMessage.call(this, message, transfer);
    };
    let result, packagedBytes, returnedBytes, stage = 'packaging';
    try {
        // Exercise final download packaging too, without flattening the Blob
        // back into an oversized buffer just to inspect it in the test.
        const packaged = await createExportBlob(data);
        packagedBytes = packaged.size;
        stage = 'reading packaged header';
        const header = new Uint8Array(await packaged.slice(0, original.length).arrayBuffer());
        if (!original.every((byte, i) => header[i] === byte)) throw new Error('Large Blob changed the MP4 header.');
        stage = 'reading packaged tail';
        const tail = new Uint8Array(await packaged.slice(-8).arrayBuffer());
        if (packaged.size !== data.length || tail.some(byte => byte !== 0)) throw new Error('Large Blob truncated the MP4.');
        stage = 'repairing mounted input';
        result = await repairMissingSpsColour(data, { decoderColourSpaces });
        stage = 'returning a large worker file';
        // Repair drops the free box, so explicitly read the large mounted file
        // through the same worker to exercise a multi-GB outgoing response too.
        const { FFmpeg } = await import('@ffmpeg/ffmpeg');
        const ffmpeg = new FFmpeg();
        try {
            await ffmpeg.load({ classWorkerURL: spsRepairWorkerUrl,
                coreURL: '/vendor/ffmpeg/0.12.10/ffmpeg-core-stackfix.js', wasmURL: getRuntimeAssetUrl('ffmpegCoreWasm') });
            await ffmpeg.createDir('/input');
            if (!await ffmpeg.mount('WORKERFS', { blobs: [{ name: 'input.mp4', data: packaged }] }, '/input')) {
                throw new Error('Large worker response fixture could not be mounted.');
            }
            // Copy bytes without remuxing, keeping the free box in MEMFS. A
            // full read of WORKERFS itself hits FileReaderSync's buffer limit.
            if (await ffmpeg.exec(['-f', 'data', '-raw_packet_size', '1048576', '-i', '/input/input.mp4',
                '-map', '0:0', '-c', 'copy', '-f', 'data', 'copy.mp4']) !== 0) throw new Error('Large response copy failed.');
            const returned = await ffmpeg.readFile('copy.mp4');
            if (!(returned instanceof NativeBlob) || returned.size !== data.length) throw new Error('Worker did not return the complete Blob.');
            const received = await readExportBlob(returned);
            if (!original.every((byte, i) => received[i] === byte) || received[received.length - 1] !== 0) {
                throw new Error('Large worker response changed the file.');
            }
            returnedBytes = received.byteLength;
        } finally { ffmpeg.terminate(); }
    } catch (error) {
        throw new Error(`Large-input ${stage} failed (${data.length} bytes, native Blob: ${nativeBlobError}): ${error}`);
    } finally { Worker.prototype.postMessage = postMessage; window.Blob = NativeBlob; }
    if (result.repair.status !== 'added' && result.repair.status !== 'not-needed') {
        throw new Error(`Large input repair could not be verified: ${result.repair.reason}`);
    }
    if (data.byteLength !== original.length + paddingBytes || !original.every((byte, i) => data[i] === byte)) {
        throw new Error('Large input repair detached or changed the original MP4.');
    }
    return { inputBytes: data.byteLength, packagedBytes, returnedBytes, nativeBlobError, outputBytes: result.data.byteLength, ...result.repair };
}
async function checkSourceBitrate(sourceUrl, receiver, {
    bitrate, bitrateMode = 'variable', hardwareAcceleration = 'prefer-hardware', name = 'bitrate-regression', saveOutput = true,
} = {}) {
    const MB = await import('mediabunny');
    const input = new MB.Input({ formats: MB.ALL_FORMATS, source: new MB.UrlSource(sourceUrl) });
    let writer;
    try {
        const track = await input.getPrimaryVideoTrack();
        const width = await track.getDisplayWidth(), height = await track.getDisplayHeight(), fps = 30;
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
        let metadata, frames = 0;
        writer = await createCanvasVideoExport(canvas, { width, height, fps, format: 'mp4', encodingMethod: 'webcodecs',
            videoRange: 'limited', quality: 'very-high', bitrate, bitrateMode, hardwareAcceleration, logoOverlayEnabled: false,
            onColourMetadata: report => { metadata = report; } });
        for await (const sample of new MB.VideoSampleSink(track).samples(0, 3)) {
            try {
                context.drawImage(sample.toCanvasImageSource(), 0, 0, width, height);
                await writer.add(frames / fps, 1 / fps); frames++;
            } finally { sample.close(); }
        }
        const blob = await writer.finalize();
        const targetBitrate = bitrate ?? getSdrBitrate(width, height, 'very-high'), duration = frames / fps;
        const actualBitrate = blob.size * 8 / duration;
        if (!frames || metadata.encoderConfig?.bitrateMode !== bitrateMode || metadata.encoderConfig?.bitrate !== targetBitrate) {
            throw new Error('Native encoder configuration did not receive the explicit bitrate/mode.');
        }
        if (!Number.isFinite(metadata.output?.averageBitrate) || Math.abs(metadata.output.averageBitrate - actualBitrate) > 1) {
            throw new Error('Completed report did not measure the output bitrate.');
        }
        // Allow GOP/startup variation while rejecting a return to unconstrained
        // QP encoding (the reported case was about 8x this resolution's target).
        if (actualBitrate > targetBitrate * 1.5) throw new Error(`Native bitrate exceeded the test tolerance: ${actualBitrate}`);
        if (saveOutput) await save(`${name}.mp4`, blob, receiver);
        return { width, height, fps, frames, duration, hardwareAcceleration, bitrateMode, targetBitrate, actualBitrate, bytes: blob.size,
            projected120SecondMiB: actualBitrate * 120 / 8 / 1024 / 1024,
            estimated120SecondMiB: targetBitrate * 120 / 8 / 1024 / 1024,
            encoderConfig: metadata.encoderConfig, rateControlWarnings: metadata.rateControlWarnings };
    } finally { await writer?.dispose(); input.dispose(); }
}
async function exportRateControlSweep({ receiver, saveOutputs = true } = {}) {
    const rateSweep = [];
    const source = params.get('bitrate-source');
    if (!source) throw new Error('Set COLOUR_BITRATE_SOURCE to a representative local source excerpt.');
    for (const hardwareAcceleration of ['no-preference', 'prefer-hardware', 'prefer-software']) {
        for (const bitrateMode of ['variable', 'constant']) for (const bitrate of [50_000_000, 100_000_000]) {
            const name = `rate-sweep-${hardwareAcceleration}-${bitrateMode}-${bitrate / 1_000_000}`;
            try {
                const result = await checkSourceBitrate(source, receiver, { bitrate, bitrateMode, hardwareAcceleration, name, saveOutput: saveOutputs });
                rateSweep.push({ name, ...result });
            } catch (error) { rateSweep.push({ name, hardwareAcceleration, bitrateMode, targetBitrate: bitrate, error: String(error) }); }
            report(rateSweep);
        }
    }
    const results = { ...environment, exports: [], rateSweep };
    if (saveOutputs) await save('rate-control-sweep.json', new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' }), receiver);
    return results;
}
async function checkRateControlModes(receiver) {
    const results = [];
    for (const format of ['mp4', 'webm']) for (const bitrateMode of ['variable', 'constant', 'quantizer']) {
        let metadata;
        const writer = await createCanvasVideoExport(chart, { width, height, fps, format, encodingMethod: 'webcodecs',
            videoRange: 'limited', bitrateMode, bitrate: 2_000_000, quantizer: 23, logoOverlayEnabled: false,
            onColourMetadata: report => { metadata = report; } });
        try {
            for (let frame = 0; frame < 12; frame++) await writer.add(frame / fps, 1 / fps);
            const blob = await writer.finalize();
            if (!blob.size || metadata.encoderConfig?.bitrateMode !== bitrateMode) throw new Error(`Incorrect native rate-control mode: ${format}/${bitrateMode}`);
            if (bitrateMode === 'quantizer') {
                if (metadata.encoderConfig.bitrate != null || metadata.quantizer !== 23 || metadata.targetBitrate !== null) {
                    throw new Error('Quantizer mode acquired a hidden bitrate target.');
                }
            } else if (metadata.encoderConfig.bitrate !== 2_000_000) throw new Error('Native encoder changed the selected bitrate.');
            if (format === 'mp4') await save(`rate-control-webcodecs-${bitrateMode}.mp4`, blob, receiver);
            results.push({ format, bitrateMode, bytes: blob.size, quantizer: metadata.quantizer, encoderConfig: metadata.encoderConfig });
        } finally { await writer.dispose(); }
    }
    for (const bitrateMode of ['variable', 'quantizer']) {
        let metadata;
        const writer = await createCanvasVideoExport(chart, { width, height, fps, format: 'mp4', encodingMethod: 'ffmpeg',
            bitrateMode, bitrate: 2_000_000, quantizer: 23, logoOverlayEnabled: false,
            onColourMetadata: report => { metadata = report; } });
        try {
            for (let frame = 0; frame < 12; frame++) await writer.add(frame / fps, 1 / fps);
            const blob = await writer.finalize();
            if (!metadata.verification.matchesSdrTarget || metadata.bitrateMode !== bitrateMode) throw new Error('FFmpeg rate-control export failed verification.');
            await save(`rate-control-ffmpeg-${bitrateMode}.mp4`, blob, receiver);
            results.push({ format: 'mp4', encodingMethod: 'ffmpeg', bitrateMode, bytes: blob.size, quantizer: metadata.quantizer, targetBitrate: metadata.targetBitrate });
        } finally { await writer.dispose(); }
    }
    return results;
}
async function exportComparisons({ receiver, hardwareAcceleration = 'no-preference', includeLegacy = true, repairPaddingMiB = 256 } = {}) {
    const results = { ...environment, hardwareAcceleration, exports:[] };
    let checkedLargeInput = false;
    for (const [asset,canvas,render] of [['chart',chart,renderChart],['ribbon',ribbon,renderRibbon]]) {
        render(); await save(`${asset}-preview.png`,await new Promise(r => canvas.toBlob(r)),receiver);
        // Normal limited-range exports retain the original WebCodecs bytes,
        // including incomplete SPS declarations, without the repair pass.
        const native = { name: `${asset}-limited-webcodecs.mp4` };
        let original;
        const nativeWriter = await createCanvasVideoExport(canvas, { width, height, fps, format: 'mp4',
            encodingMethod: 'webcodecs', videoRange: 'limited', hardwareAcceleration, quality: 'very-high', logoOverlayEnabled: false,
            onBeforeSpsRepair: blob => { original = blob; }, onColourMetadata: metadata => { native.metadata = metadata; } });
        try {
            for (let n = 0; n < frames; n++) await nativeWriter.add(n / fps, 1 / fps);
            const blob = await nativeWriter.finalize();
            if (native.metadata.spsRepair.status !== 'not-requested' || native.metadata.verification.conflictsWithRequestedColour) {
                throw new Error('Normal limited export unexpectedly repaired or contradicted the requested colour.');
            }
            const before = new Uint8Array(await original.arrayBuffer()), after = new Uint8Array(await blob.arrayBuffer());
            if (before.length !== after.length || !before.every((byte, i) => byte === after[i])) {
                throw new Error('Normal limited export changed the original encoded file.');
            }
            await save(native.name, blob, receiver);
            native.desktopPlaybackPatches = await desktopPlayback(blob, native.name, receiver);
            results.exports.push(native);
        } finally { await nativeWriter.dispose(); }
        for (const logoOverlayEnabled of [false,true]) {
            const name = `${asset}-logo-${logoOverlayEnabled ? 'on':'off'}`;
            if (includeLegacy) {
                const before = { name:`${name}-before.mp4` };
                try {
                    const encoded = await legacy(canvas,logoOverlayEnabled,hardwareAcceleration,before);
                    if (!checkedLargeInput) {
                        checkedLargeInput = true;
                        results.largeInputRepair = await checkLargeRepairInput(encoded.originalBlob, before.metadata.decoderColourSpaces, repairPaddingMiB);
                    }
                    const repaired = { ...before, name:`${name}-webcodecs-repaired.mp4` };
                    before.metadata = completeExportColourReport({ ...before.metadata, spsRepair: { status:'unrepaired-comparison-copy' } }, encoded.originalMetadata);
                    await save(before.name,encoded.originalBlob,receiver);
                    await save(repaired.name,encoded.blob,receiver);
                    repaired.desktopPlaybackPatches = await desktopPlayback(encoded.blob,repaired.name,receiver);
                    results.exports.push(repaired);
                } catch (error) { before.error = String(error); }
                results.exports.push(before);
            }
            const after = { name:`${name}-after.mp4` };
            const writer = await createCanvasVideoExport(canvas,{ width,height,fps,format:'mp4',quality:'very-high',logoOverlayEnabled,
                renderContext:gl,logoOverlayCorner:'bottomLeft',onColourMetadata:meta => { after.metadata = meta; } });
            try {
                for (let n = 0; n < frames; n++) { render(); await writer.add(n / fps,1 / fps); }
                const blob = await writer.finalize(); await save(after.name,blob,receiver);
                after.desktopPlaybackPatches = await desktopPlayback(blob,after.name,receiver);
            } finally { await writer.dispose(); }
            results.exports.push(after); report(results);
        }
    }
    // Binary temporal markers distinguish every frame, including batch seams.
    // Both first and last frames remain meaningful; no repeated end frame.
    const sequence = document.createElement('canvas'); sequence.width = width; sequence.height = height;
    const sequenceContext = sequence.getContext('2d',{ alpha:false,colorSpace:'srgb' });
    const sequenceWriter = await createCanvasVideoExport(sequence,{ width,height,fps,format:'mp4',logoOverlayEnabled:false });
    try {
        for (let n = 0; n < frames; n++) {
            sequenceContext.fillStyle = '#808080'; sequenceContext.fillRect(0,0,width,height);
            for (let bit = 0; bit < 7; bit++) {
                sequenceContext.fillStyle = n & (1 << bit) ? '#fff' : '#000';
                sequenceContext.fillRect(bit * 32,0,32,32);
            }
            await sequenceWriter.add(n / fps,1 / fps);
        }
        await save('sequence-after.mp4',await sequenceWriter.finalize(),receiver);
    } finally { sequenceWriter.dispose(); }
    // Real cancellation during a pending FFmpeg operation, then another export
    // can independently load the core. No partial video is returned.
    const controller = new AbortController();
    const loading = createCanvasVideoExport(chart,{ width,height,fps,format:'mp4',logoOverlayEnabled:false,signal:controller.signal });
    setTimeout(() => controller.abort(),10);
    try { const writer = await loading; writer.dispose(); throw new Error('Cancellation was ignored.'); }
    catch (error) { if (error.name !== 'AbortError') throw error; results.cancellation = 'passed'; }
    if (params.get('bitrate-source')) results.bitrateRegression = await checkSourceBitrate(params.get('bitrate-source'), receiver);
    results.rateControlModes = await checkRateControlModes(receiver);
    await save('browser-report.json',new Blob([JSON.stringify(results,null,2)],{ type:'application/json' }),receiver);
    return results;
}
window.colourLab = { exportComparisons,exportRateControlSweep,environment,renderer,chart,ribbon };
