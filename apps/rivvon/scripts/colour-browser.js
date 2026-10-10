import * as THREE from 'three';
import { TileManager } from '../src/modules/viewer/tileManager.js';
import { RibbonSeries } from '../src/modules/viewer/ribbonSeries.js';
import { applyRendererDisplayConfig } from '../src/modules/viewer/rendererConfig.js';
import { createColourChartRgba } from '../src/modules/viewer/colourTestChart.js';
import { createCanvasVideoExport } from '../src/modules/viewer/canvasVideoExport.js';
import { completeExportColourReport } from '../src/modules/viewer/exportColourReport.js';

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
        quality:'very-high',logoOverlayEnabled:logoEnabled,logoOverlayCorner:'bottomLeft',hardwareAcceleration,
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
async function exportComparisons({ receiver, hardwareAcceleration = 'no-preference', includeLegacy = true } = {}) {
    const results = { ...environment, hardwareAcceleration, exports:[] };
    for (const [asset,canvas,render] of [['chart',chart,renderChart],['ribbon',ribbon,renderRibbon]]) {
        render(); await save(`${asset}-preview.png`,await new Promise(r => canvas.toBlob(r)),receiver);
        for (const logoOverlayEnabled of [false,true]) {
            const name = `${asset}-logo-${logoOverlayEnabled ? 'on':'off'}`;
            if (includeLegacy) {
                const before = { name:`${name}-before.mp4` };
                try {
                    const encoded = await legacy(canvas,logoOverlayEnabled,hardwareAcceleration,before);
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
    await save('browser-report.json',new Blob([JSON.stringify(results,null,2)],{ type:'application/json' }),receiver);
    return results;
}
window.colourLab = { exportComparisons,environment,renderer,chart,ribbon };
