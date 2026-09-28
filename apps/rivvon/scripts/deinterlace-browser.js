import { Input, MPEG_TS, BlobSource } from 'mediabunny';
import { createPinia, setActivePinia } from 'pinia';
import { read as readKtx } from 'ktx-parse';
import { getVideoProcessingFile, getInterlacedSource } from '../src/modules/slyce/videoPreview.js';
import { decodeSonyFrames, sonyVideoSamples } from '../src/modules/slyce/deinterlace/sonyVideoSamples.js';
import { GpuBwdif } from '../src/modules/slyce/deinterlace/gpuBwdif.js';
import { VideoFileFrameSource } from '../src/modules/slyce/samplingSources.js';
import { useSlyceStore } from '../src/stores/slyceStore.js';
import { getMetaData } from '../src/modules/slyce/metaDataExtractor.js';
import { useTilePlan } from '../src/composables/slyce/useTilePlan.js';
import { processVideo } from '../src/modules/slyce/videoProcessor.js';

const assert = (value, message) => { if (!value) throw new Error(message); };
const log = message => console.log(`[Deinterlace test] ${message}`);
const sha256 = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
const golden = [
    ['a89b26f26df953789f860ccc2d1cd2a3ec97c86601f542c89c680976bdc063de', '95b4b6ef08570a8419c7a6a3ba207f46cb56db80ab5662362e390e5176010887'],
    ['c4f032223aa22dbe92dd0d21f9c8f3420d258129615862d2ddb42f9e17f165f9', 'dd9ff313e6cdb090b7bd33ac0c6af59ff0aeaf0ff51fdb6ce5bdefe5d328d992'],
    ['742ead0fafcc7a286b9bf4248f9cad3f312b7f16e048299ea191611b7f446756', '43b81d8bf6d6af9e683216a2b4de28a751c529283478373d9d51c68e7a6437db'],
];

window.deinterlaceTest = (async () => {
    const started = performance.now();
    const response = await fetch(new URL('../../../00023.MTS', import.meta.url));
    assert(response.ok, 'Missing tracked 00023.MTS fixture.');
    const file = new File([await response.blob()], '00023.MTS');
    const prepared = await getVideoProcessingFile(file);
    const source = getInterlacedSource(prepared);
    assert(source?.profile.frameCount === 960, 'Expected 960 progressive fields.');
    const preview = document.createElement('video');
    const previewUrl = URL.createObjectURL(prepared);
    preview.src = previewUrl;
    await new Promise((resolve, reject) => { preview.onloadedmetadata = resolve; preview.onerror = () => reject(new Error('Preview remux failed to load.')); });
    const previewInfo = { width: preview.videoWidth, height: preview.videoHeight, duration: preview.duration };
    assert(previewInfo.width === 1920 && previewInfo.height === 1080 && Math.abs(previewInfo.duration - 16.016) < 0.001, 'Incorrect preview dimensions/timeline.');
    for (const time of [8, 15.99]) {
        await new Promise((resolve, reject) => {
            preview.onseeked = resolve;
            preview.onerror = () => reject(new Error('Preview seek failed.'));
            preview.currentTime = time;
        });
        assert(preview.readyState >= 2, 'Preview has no decoded frame after seeking.');
    }
    URL.revokeObjectURL(previewUrl); preview.removeAttribute('src'); preview.load();
    log(`Setup preview: ${JSON.stringify(previewInfo)}`);
    const input = new Input({ formats: [MPEG_TS], source: new BlobSource(file) });
    const retained = new Map();
    let count = 0;
    try {
        for await (const frame of decodeSonyFrames(await input.getPrimaryVideoTrack(), source.profile)) {
            if ([0, 1, 298, 299, 300, 478, 479].includes(count)) retained.set(count, frame.clone());
            count++;
        }
    } finally { input.dispose(); }
    assert(count === 480, `Decoded ${count}, expected 480 complete field pairs.`);
    log('All 480 native frames decoded. Checking GPU YUV against native FFmpeg BWDIF.');
    const gpu = await GpuBwdif.create(1920, 1080);
    const readback = gpu.device.createBuffer({ size: gpu.byteCount * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const readOutput = async () => {
        const encoder = gpu.device.createCommandEncoder();
        encoder.copyBufferToBuffer(gpu.output, 0, readback, 0, gpu.byteCount * 4);
        gpu.device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const bytes = Uint8Array.from(new Uint32Array(readback.getMappedRange()));
        readback.unmap(); return bytes;
    };
    try {
        for (const [test, indices] of [[0, [0, 0, 1]], [1, [298, 299, 300]], [2, [478, 479, 479]]]) {
            for (let slot = 0; slot < 3; slot++) await gpu.upload(retained.get(indices[slot]), slot);
            for (let field = 0; field < 2; field++) {
                (await gpu.frame(0, 1, 2, field, (test === 0 && field === 0) || (test === 2 && field === 1), 0, 16683)).close();
                const hash = await sha256(await readOutput());
                assert(hash === golden[test][field], `Reference mismatch at group ${test}, field ${field}: ${hash}`);
            }
        }
        // Alternating one-pixel lines expose vertical-detail loss that a flat image misses.
        const bytes = new Uint8Array(gpu.byteCount).fill(128);
        for (let y = 0; y < 1080; y++) bytes.fill(y % 2 ? 235 : 16, y * 1920, (y + 1) * 1920);
        const pattern = new VideoFrame(bytes, { format: 'I420', codedWidth: 1920, codedHeight: 1080, timestamp: 0 });
        try { for (let slot = 0; slot < 3; slot++) await gpu.upload(pattern, slot); }
        finally { pattern.close(); }
        for (let field = 0; field < 2; field++) {
            (await gpu.frame(0, 1, 2, field, false, 0, 16683)).close();
            assert(await sha256(await readOutput()) === await sha256(bytes), 'Static one-pixel detail was lost.');
        }
    } finally { readback.destroy(); gpu.dispose(); for (const frame of retained.values()) frame.close(); }
    log('Six reference fields match exactly; static one-pixel detail preserved.');

    const frameSource = new VideoFileFrameSource({ file: prepared, fileInfo: { duration: 16.016, nb_frames: 960 },
        tilePlan: { tiles: [{ start: 1, end: 960 }] }, frameEnd: 960 });
    count = 0;
    for await (const item of frameSource.frames()) {
        count++;
        assert(item.videoFrame.timestamp === Math.round((count - 1) * 1001 / 60000 * 1e6), 'Incorrect field timestamp.');
        assert(item.videoFrame.displayWidth === 1920 && item.videoFrame.displayHeight === 1080, 'Incorrect dimensions.');
        item.videoFrame.close();
    }
    assert(count === 960, `Sampling stopped at ${count}/960.`);
    for (const [start, end] of [[2, 5], [599, 602], [959, 960]]) {
        let number = start;
        for await (const sample of sonyVideoSamples(source, start, end)) {
            assert(Math.abs(sample.timestamp - (number - 1) * 1001 / 60000) < 0.000001, 'Range field order changed.');
            number++;
        }
        assert(number === end + 1, 'Incomplete selected range.');
    }
    const abort = new AbortController();
    let aborted = false;
    try { for await (const _sample of sonyVideoSamples(source, 1, 960, abort.signal)) abort.abort(); }
    catch (error) { assert(error.name === 'AbortError', error.message); aborted = true; }
    assert(aborted, 'Cancellation failed.');
    log('All 960 full-resolution samples, selected ranges, and cancellation passed. Creating three texture tiles.');

    setActivePinia(createPinia());
    const app = useSlyceStore();
    app.file = prepared;
    await getMetaData();
    assert(app.fileInfo.height === 1080 && app.frameCount === 960, 'Incorrect setup metadata.');
    app.frameStart = 1; app.frameEnd = 960; app.potResolution = 256; app.crossSectionCount = 60;
    const tilePlan = useTilePlan().tilePlan.value;
    await processVideo({ tilePlan, fileInfo: app.fileInfo, frameCount: app.frameCount, config: app.config,
        samplingMode: 'rows', crossSectionType: 'waves', crossSectionCount: 60,
        frameInterpolationFactor: 1, tileBuilderBackend: 'webgpu-array' });
    const deadline = performance.now() + 60000;
    while (app.processingProgress && performance.now() < deadline) {
        assert(!Object.keys(app.status).some(key => key.includes('Error')), JSON.stringify(app.status));
        await new Promise(r => setTimeout(r, 100));
    }
    assert(!Object.keys(app.status).some(key => key.includes('Error')), JSON.stringify(app.status));
    assert(app.processingPhaseSummary?.completedTileCount === 3, `Tiles incomplete: ${JSON.stringify(app.status)}`);
    const tiles = [];
    for (const url of Object.values(app.ktx2BlobURLs)) {
        const buffer = new Uint8Array(await (await fetch(url)).arrayBuffer());
        const texture = readKtx(buffer);
        assert(texture.pixelWidth === 256 && texture.pixelHeight === 256 && texture.layerCount === 60, 'Invalid texture dimensions/layers.');
        tiles.push(buffer.byteLength);
    }
    assert(tiles.length === 3, 'Expected three encoded KTX2 textures.');
    log('Three 256×256×60 KTX2 textures completed.');
    // A decoder EOF used to leave the processing UI stuck indefinitely.
    const originalFrames = VideoFileFrameSource.prototype.frames;
    try {
        VideoFileFrameSource.prototype.frames = async function* () {};
        const result = await processVideo({ tilePlan, fileInfo: app.fileInfo, crossSectionCount: 60, frameInterpolationFactor: 1 });
        assert(result === false && app.status['Processing Error']?.includes('0 of 768'), 'Premature EOF was not surfaced.');
        assert(app.processingProgress === null, 'Premature EOF left progress running.');
    } finally { VideoFileFrameSource.prototype.frames = originalFrames; }
    app.clearAllStatus();
    const originalCreate = GpuBwdif.create;
    try {
        GpuBwdif.create = async () => { throw new Error('WebGPU unavailable (test)'); };
        const result = await processVideo({ tilePlan, fileInfo: app.fileInfo, crossSectionCount: 60, frameInterpolationFactor: 1 });
        assert(result === false && app.status['Processing Error'] === 'WebGPU unavailable (test)', 'GPU failure was not surfaced.');
        assert(app.processingProgress === null, 'GPU failure left progress running.');
    } finally { GpuBwdif.create = originalCreate; app.revokeBlobURLs(); }
    log('Premature EOF and GPU initialization errors stop processing with visible errors.');
    return { nativeFrames: 480, progressiveFrames: count, referenceFields: 6, preview: previewInfo, tiles, elapsedSeconds: (performance.now() - started) / 1000 };
})();
