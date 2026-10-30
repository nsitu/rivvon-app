import { Input, ALL_FORMATS, BlobSource, Output, BufferTarget, Mp4OutputFormat, CanvasSource,
    CanvasSink, VideoSampleSink, QUALITY_HIGH } from 'mediabunny';
import { inspectBackgroundLoopSource, sampleBackgroundLoopBatch, generateBackgroundLoop, assembleBackgroundLoop } from '../src/modules/slyce/backgroundLoop.js';
import { planBackgroundLoop } from '../src/modules/slyce/backgroundLoopPlan.js';
import { discardBackgroundLoop, getBackgroundLoopJob } from '../src/services/backgroundLoopStorage.js';
import { inspectClipInput } from '../../../packages/shared-types/src/clipAsset.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const log = message => console.log('[Background loop benchmark]', message);
const hash = canvas => {
    const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let value = 2166136261;
    for (const byte of bytes) value = Math.imul(value ^ byte, 16777619);
    return value >>> 0;
};

export async function createFixture({ width, height, frames, rotation = 0 }) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    const source = new CanvasSource(canvas, { codec: 'avc', bitrate: QUALITY_HIGH, keyFrameInterval: 1 });
    output.addVideoTrack(source, { rotation, frameRate: 30 });
    await output.start();
    for (let i = 0; i < frames; i++) {
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, `hsl(${i * .7 % 360} 80% 35%)`);
        gradient.addColorStop(.5, `hsl(${(i * .7 + 100) % 360} 65% 65%)`);
        gradient.addColorStop(1, `hsl(${(i * .7 + 220) % 360} 80% 30%)`);
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#faf0d0'; ctx.fillRect((i * 7) % width, 0, Math.max(2, width / 24), height);
        ctx.fillStyle = '#172c50'; ctx.fillRect(0, (i * 3) % height, width, Math.max(2, height / 30));
        await source.add(i / 30, 1 / 30);
    }
    await output.finalize(); canvas.width = canvas.height = 1;
    return new File([target.buffer], `synthetic-${width}x${height}.mp4`, { type: 'video/mp4' });
}

async function validateBatches() {
    const results = [];
    for (const rotation of [0, 90]) {
        const file = await createFixture({ width: 128, height: 64, frames: 128, rotation });
        const source = await inspectBackgroundLoopSource(file);
        for (const samplingSide of ['long', 'short']) {
        const plan = planBackgroundLoop(source, { duration: 31 / 30, batchSize: 31, samplingSide });
        const baseline = await sampleBackgroundLoopBatch(source, plan, 0);
        const expected = baseline.canvases.map(hash);
        for (const canvas of baseline.canvases) canvas.width = canvas.height = 1;
        const actual = [];
        for (let offset = 0; offset < 31; offset += 8) {
            const batch = await sampleBackgroundLoopBatch(source, { ...plan, batchSize: 8 }, offset);
            actual.push(...batch.canvases.map(hash));
            for (const canvas of batch.canvases) canvas.width = canvas.height = 1;
        }
        assert(JSON.stringify(actual) === JSON.stringify(expected), 'Raw phases changed across sampling batch boundaries.');
        assert(new Set(expected).size > 20, 'Fixture unexpectedly produced identical phases.');
        const controller = new AbortController();
        let cancelled = false;
        try { await sampleBackgroundLoopBatch(source, plan, 0, { signal: controller.signal, onFrame: () => controller.abort() }); }
        catch (error) { cancelled = error.name === 'AbortError'; }
        assert(cancelled, 'Sampling cancellation was not propagated.');
        results.push({ rotation, samplingSide, samplingMode: plan.samplingMode, phases: 31, bitExactAcrossBatches: true, cancellation: true });
        }
    }
    return results;
}

async function inspectOutput(blob, expectedFrames, expectedSize) {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    try {
        const metadata = await inspectClipInput(input);
        const track = await input.getPrimaryVideoTrack();
        let frames = 0;
        for await (const sample of new VideoSampleSink(track).samples()) {
            try {
                assert(Math.abs(sample.timestamp - frames / 30) < 0.0001, `Unexpected timestamp at frame ${frames}.`);
                frames++;
            } finally { sample.close(); }
        }
        assert(frames === expectedFrames, `Expected ${expectedFrames} decoded frames, received ${frames}.`);
        assert(metadata.width === expectedSize && metadata.height === expectedSize, 'Output is not the planned square.');
        assert(Math.abs(metadata.duration - expectedFrames / 30) < .0001, 'Output has the wrong duration.');
        const sink = new CanvasSink(track, { width: 256, height: 256, fit: 'fill' });
        const poster = await sink.getCanvas(0);
        const dataUrl = poster.canvas.toDataURL('image/png');
        return { ...metadata, decodedFrames: frames, posterDataUrl: dataUrl };
    } finally { input.dispose(); }
}

export async function benchmark({ quick = false } = {}) {
    const validation = await validateBatches();
    log('Raw phase parity, rotated input and cancellation passed.');
    const fixtureStarted = performance.now();
    const sourceFile = await createFixture(quick ? { width: 320, height: 180, frames: 320 }
        : { width: 1920, height: 1080, frames: 1920 });
    const fixtureMs = performance.now() - fixtureStarted;
    const source = await inspectBackgroundLoopSource(sourceFile);
    const cases = quick ? [{ size: 256, duration: 31 / 30, batchSize: 8, encodingMethod: 'ffmpeg' },
        { size: 256, duration: 31 / 30, batchSize: 8, encodingMethod: 'webcodecs' }]
        : [{ size: 512, duration: 1, batchSize: 16 }, { size: 1920, duration: 8, batchSize: 16 }];
    const results = [];
    for (const settings of cases) {
        log(`Starting ${settings.size}-square, ${settings.duration}s, batch ${settings.batchSize}.`);
        const memorySamples = [];
        const started = performance.now();
        let lastOffset = -1;
        const { job, blob } = await generateBackgroundLoop(source, { encodingMethod: 'ffmpeg', ...settings, quality: 'high',
            onProgress(event) {
                if (performance.memory) memorySamples.push(performance.memory.usedJSHeapSize);
                if (event.phase === 'sampling' && event.offset !== lastOffset) {
                    lastOffset = event.offset; log(`Sampling phases ${event.offset + 1}/${event.total}.`);
                }
            },
        });
        const totalMs = performance.now() - started;
        const metadata = await inspectOutput(blob, job.plan.phaseCount, job.plan.size);
        // Reassembly reads only committed work; it does not require the source or raw frames.
        const rebuilt = await assembleBackgroundLoop(job.id);
        assert(rebuilt.blob.size === blob.size, 'Reassembly changed the output size.');
        const storedJob = await getBackgroundLoopJob(job.id);
        const result = { settings, plan: job.plan, totalMs, samplingMs: job.samplingMs, assemblyMs: job.assemblyMs,
            outputBytes: blob.size, encodedBatchBytes: job.batches.reduce((n, b) => n + b.bytes, 0),
            stageTotals: Object.fromEntries(['decodeMs', 'drawMs', 'encodeMs', 'persistMs', 'decodedFrames']
                .map(key => [key, job.batches.reduce((n, batch) => n + batch[key], 0)])),
            batches: job.batches, observedJsHeapPeakBytes: memorySamples.length ? Math.max(...memorySamples) : null,
            metadata, reassembly: storedJob.status === 'complete', jobId: job.id };
        results.push(result);
        log(`Completed ${settings.size}: ${(totalMs / 1000).toFixed(2)}s, ${(blob.size / 1048576).toFixed(2)} MiB.`);
    }
    // Keep the final artifact available for download by the driver, clear smaller benchmark jobs.
    for (const result of results.slice(0, -1)) await discardBackgroundLoop(result.jobId);
    return { date: new Date().toISOString(), browser: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
        fixture: { width: source.width, height: source.height, frames: source.frameCount, bytes: sourceFile.size, fixtureMs }, validation, results,
        caveats: ['Synthetic progressive source; source generation and final decode verification are excluded from generation timing.',
            'Canvas sampling baseline, FFmpeg WASM/x264 with one encoder worker per phase batch. No claim for other devices or footage.',
            'JS heap telemetry excludes GPU surfaces, browser decoder allocations and WASM heaps. Phase surface bytes are an allocation estimate, not total peak memory.',
            'Encoded batches and fragmented MP4 output parts are committed to IndexedDB. Final assembly remuxes packets without decoding or concatenating full byte buffers.',
            'Final Blob uses stored Blob handles; actual browser residency is implementation-dependent.'] };
}

window.backgroundLoopBenchmark = { benchmark };
