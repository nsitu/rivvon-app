// Development-only benchmark. Uses the production renderer, compositor options,
// converter and export writer; none of this module is imported by the app.
import * as THREE from 'three';
import { TileManager } from '../src/modules/viewer/tileManager.js';
import { RibbonSeries } from '../src/modules/viewer/ribbonSeries.js';
import { applyRendererDisplayConfig } from '../src/modules/viewer/rendererConfig.js';
import { createColourChartRgba } from '../src/modules/viewer/colourTestChart.js';
import { createExportYuvConversion } from '../src/modules/viewer/exportYuvConversion.js';
import { createCanvasVideoExport } from '../src/modules/viewer/canvasVideoExport.js';
import { SDR_VIDEO_COLOUR } from '../src/modules/viewer/exportColour.js';

const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const sizes = [[960, 540], [1920, 1080], [3840, 2160]];
const percentile = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};
const summarize = values => ({ medianMs: percentile(values, .5), p95Ms: percentile(values, .95),
    minMs: Math.min(...values), maxMs: Math.max(...values), samples: values });

function fixture(width, height, content) {
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    applyRendererDisplayConfig(renderer); renderer.setPixelRatio(1); renderer.setSize(width, height);
    const bytes = createColourChartRgba(width, height);
    if (content === 'noise') {
        let seed = 123456789;
        for (let i = 0; i < bytes.length; i += 4) {
            for (let channel = 0; channel < 3; channel++) {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; bytes[i + channel] = seed >>> 24;
            }
        }
    }
    const texture = new THREE.DataArrayTexture(new Uint8Array(bytes), width, height, 1);
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.flipY = false; texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    const tm = new TileManager({ renderer, tileCount: 1, repeatMode: 'wrap', edgeNoiseTransparencyMax: 0, filmstripStyleEnabled: false });
    tm.arrayTextures = [texture]; tm.layerCount = 1; tm.setFlowEnabled(true);
    const scene = new THREE.Scene();
    let camera;
    if (content === 'ribbon') {
        const ribbons = new RibbonSeries(scene); ribbons.setTileManager(tm);
        const points = Array.from({ length: 24 }, (_, i) => {
            const t = i / 23 * Math.PI * 3;
            return new THREE.Vector3(Math.cos(t) * 1.7, (i / 23 - .5) * 3.5, Math.sin(t) * .5);
        });
        ribbons.buildFromPoints(points, .55); ribbons.initFlowMaterials();
        camera = new THREE.PerspectiveCamera(40, width / height, .1, 100);
        camera.position.set(0, 0, 8); camera.lookAt(0, 0, 0);
    } else {
        const geometry = new THREE.PlaneGeometry(2.2, 2.2);
        geometry.setAttribute('maskV', new THREE.Float32BufferAttribute([1, 1, 0, 0], 1));
        scene.add(new THREE.Mesh(geometry, tm.createFlowMaterial(0)));
        camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10); camera.position.z = 2;
    }
    const gl = renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
        canvas: renderer.domElement, gl,
        environment: { userAgent: navigator.userAgent, gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
            hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGiB: navigator.deviceMemory,
            crossOriginIsolated, renderContext: gl.getParameter(gl.VERSION) },
        render(frame) {
            scene.rotation.z = Math.sin(frame * .03) * .06;
            if (content === 'ribbon') scene.rotation.y = Math.sin(frame * .02) * .25;
            renderer.render(scene, camera);
        },
        dispose() {
            scene.traverse(object => { object.geometry?.dispose();
                if (Array.isArray(object.material)) object.material.forEach(material => material.dispose()); else object.material?.dispose(); });
            texture.dispose(); renderer.dispose(); renderer.forceContextLoss();
            renderer.domElement.width = renderer.domElement.height = 1;
        },
    };
}

function conversionBlock(source, width, height, method, frames, warmup, offset) {
    const start = performance.now();
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb', willReadFrequently: method === 'cpu' });
    const converter = createExportYuvConversion(width, height, { method });
    const target = new Uint8Array(width * height * 3 / 2);
    const setupMs = performance.now() - start;
    if (converter.info.method !== method) throw new Error(`Unexpected fallback: ${JSON.stringify(converter.info)}`);
    const samples = [];
    function run(frame) {
        const t0 = performance.now(); source.render(frame);
        const t1 = performance.now();
        context.fillStyle = '#000'; context.fillRect(0, 0, width, height);
        context.drawImage(source.canvas, 0, 0, width, height);
        const t2 = performance.now(); converter.convert(canvas, target);
        const t3 = performance.now();
        const videoFrame = new VideoFrame(target, { format: 'I420', codedWidth: width, codedHeight: height,
            timestamp: frame * 33333, colorSpace: SDR_VIDEO_COLOUR });
        videoFrame.close();
        const t4 = performance.now();
        return { renderMs: t1 - t0, compositeMs: t2 - t1, conversionMs: t3 - t2,
            frameConstructionMs: t4 - t3, totalMs: t4 - t0 };
    }
    return (async () => {
        try {
            const coldFrame = run(offset);
            for (let i = 0; i < warmup; i++) { run(offset + i + 1); if (i % 4 === 3) await pause(); }
            for (let i = 0; i < frames; i++) { samples.push(run(offset + warmup + i + 1)); if (i % 4 === 3) await pause(); }
            if (converter.info.method !== method) throw new Error('Converter changed method during measurement.');
            return { method, setupMs, coldFrame, readbackBytesPerFrame: converter.info.readbackBytesPerFrame,
                stages: Object.fromEntries(Object.keys(samples[0]).map(key => [key, summarize(samples.map(sample => sample[key]))])) };
        } finally { converter.dispose(); canvas.width = canvas.height = 1; }
    })();
}

export async function benchmarkConversion({ rounds = 3, frames = 24, warmup = 8 } = {}) {
    const results = [];
    let environment;
    for (const [width, height] of sizes) for (const content of ['ribbon', 'noise']) {
        const source = fixture(width, height, content); environment ??= source.environment;
        const blocks = [];
        try {
            for (let round = 0; round < rounds; round++) {
                for (const method of (round % 2 ? ['gpu', 'cpu'] : ['cpu', 'gpu'])) {
                    blocks.push({ round, ...await conversionBlock(source, width, height, method, frames, warmup, round * 100) });
                }
                console.info('[YUV benchmark]', `${width}x${height} ${content}: conversion round ${round + 1}/${rounds}`);
            }
            const methods = {};
            for (const method of ['cpu', 'gpu']) {
                const chosen = blocks.filter(block => block.method === method);
                methods[method] = { total: summarize(chosen.flatMap(block => block.stages.totalMs.samples)),
                    stages: Object.fromEntries(Object.keys(chosen[0].stages).map(stage => [stage, summarize(chosen.flatMap(block => block.stages[stage].samples))])) };
            }
            results.push({ width, height, content, methods,
                speedup: methods.cpu.total.medianMs / methods.gpu.total.medianMs, blocks });
        } finally { source.dispose(); }
        await pause();
    }
    return { environment, rounds, framesPerBlock: frames, warmupFramesPerBlock: warmup, results };
}

async function exportClip(source, width, height, method, frames, tag) {
    let report;
    performance.mark(tag + ':start');
    const t0 = performance.now();
    const writer = await createCanvasVideoExport(source.canvas, { width, height, fps: 30, totalFrames: frames,
        format: 'mp4', encodingMethod: 'webcodecs', hardwareAcceleration: 'prefer-hardware',
        quality: 'very-high', videoRange: 'limited', yuvConversion: method, logoOverlayEnabled: false,
        renderContext: source.gl, onColourMetadata: value => { report = value; } });
    const t1 = performance.now();
    try {
        for (let frame = 0; frame < frames; frame++) { source.render(frame); await writer.add(frame / 30, 1 / 30); }
        const t2 = performance.now(); const blob = await writer.finalize(); const t3 = performance.now();
        if (report.yuvConversion.method !== method || !report.verification.matchesRequestedColour) throw new Error('Export method/colour verification failed.');
        return { method, frames, tag, setupMs: t1 - t0, renderAndSubmitMs: t2 - t1, finalizeMs: t3 - t2,
            totalMs: t3 - t0, framesPerSecond: frames * 1000 / (t3 - t0), bytes: blob.size,
            report: { conversion: report.yuvConversion, verification: report.verification, encoderConfig: report.encoderConfig, spsRepair: report.spsRepair } };
    } finally { await writer.dispose(); performance.mark(tag + ':end'); }
}

export async function warmupExports() {
    const results = [];
    for (const [width, height] of sizes) {
        const source = fixture(width, height, 'ribbon');
        try { results.push({ width, height, ...await exportClip(source, width, height, 'gpu', 4, `warmup-${width}`) }); }
        finally { source.dispose(); }
    }
    return results;
}

export async function benchmarkExports({ rounds = 3, frames = 60 } = {}) {
    const results = [];
    for (const [width, height] of sizes) {
        const source = fixture(width, height, 'ribbon');
        const runs = [];
        try {
            for (let round = 0; round < rounds; round++) {
                for (const method of (round % 2 ? ['gpu', 'cpu'] : ['cpu', 'gpu'])) {
                    runs.push({ round, ...await exportClip(source, width, height, method, frames, `export-${width}-${method}-${round}`) });
                }
                console.info('[YUV benchmark]', `${width}x${height}: export round ${round + 1}/${rounds}`);
            }
            const methods = Object.fromEntries(['cpu', 'gpu'].map(method => {
                const chosen = runs.filter(run => run.method === method);
                return [method, { total: summarize(chosen.map(run => run.totalMs)),
                    medianFramesPerSecond: percentile(chosen.map(run => run.framesPerSecond), .5),
                    renderAndSubmit: summarize(chosen.map(run => run.renderAndSubmitMs)), finalize: summarize(chosen.map(run => run.finalizeMs)) }];
            }));
            results.push({ width, height, runs, methods, speedup: methods.cpu.total.medianMs / methods.gpu.total.medianMs });
        } finally { source.dispose(); }
        await pause();
    }
    return { framesPerExport: frames, rounds, results };
}
