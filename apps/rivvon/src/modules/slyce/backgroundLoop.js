import { Input, ALL_FORMATS, BlobSource, VideoSampleSink, EncodedPacketSink,
    EncodedVideoPacketSource, Output, Mp4OutputFormat, AppendOnlyStreamTarget, canEncodeVideo, QUALITY_HIGH } from 'mediabunny';
import { TileBuilder } from './tileBuilder.js';
import { getVideoProcessingFile, getInterlacedSource } from './videoPreview.js';
import { createRealtimeCanvas } from './realtimeCanvasSupport.js';
import { planBackgroundLoop } from './backgroundLoopPlan.js';
import { createCanvasVideoExport } from '../viewer/canvasVideoExport.js';
import { saveBackgroundLoopJob, getBackgroundLoopJob, saveBackgroundLoopPart,
    getBackgroundLoopPart, deleteBackgroundLoopParts, getBackgroundLoopBlob } from '../../services/backgroundLoopStorage.js';

const now = () => performance.now();
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const release = canvas => { if (canvas) { canvas.width = 1; canvas.height = 1; } };

export async function inspectBackgroundLoopSource(file, { signal } = {}) {
    signal?.throwIfAborted();
    const prepared = await getVideoProcessingFile(file);
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(prepared) });
    const abort = () => input.dispose();
    signal?.addEventListener('abort', abort, { once: true });
    try {
        const track = await input.getPrimaryVideoTrack();
        const interlaced = getInterlacedSource(prepared);
        if (!track || (!interlaced && !await track.canDecode())) throw new Error('This browser cannot decode the source video.');
        const stats = await track.computePacketStats();
        signal?.throwIfAborted();
        return { file: prepared, name: file.name || 'Source video',
            width: interlaced?.profile.width ?? track.displayWidth,
            height: interlaced?.profile.height ?? track.displayHeight,
            frameCount: interlaced?.profile.frameCount ?? stats.packetCount,
            fps: stats.averagePacketRate, interlaced: Boolean(interlaced) };
    } catch (error) { signal?.throwIfAborted(); throw error; }
    finally { signal?.removeEventListener('abort', abort); input.dispose(); }
}

// Uses the existing Canvas tile builder; only this batch of global phases exists in memory.
// Source frames are counted in presentation order, avoiding CFR/zero-PTS assumptions.
export async function sampleBackgroundLoopBatch(source, plan, phaseOffset, { signal, onFrame } = {}) {
    signal?.throwIfAborted();
    const phaseCount = Math.min(plan.batchSize, plan.phaseCount - phaseOffset);
    if (phaseCount < 1) throw new Error('The phase batch is outside the planned loop.');
    const tilePlan = { width: plan.size, height: plan.size, rotate: plan.samplingMode === 'columns' ? 90 : 0,
        tiles: [{ start: 1, end: plan.sourceFrames }] };
    const builder = new TileBuilder({ fileInfo: source, tilePlan, tileNumber: 0,
        samplingMode: plan.samplingMode, crossSectionType: 'waves', crossSectionCount: phaseCount,
        frameCount: plan.sourceFrames, phaseOffset, phaseCount: plan.phaseCount });
    const normalized = createRealtimeCanvas(source.width, source.height);
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(source.file) });
    const abort = () => input.dispose();
    signal?.addEventListener('abort', abort, { once: true });
    let completed = null, success = false, decodedFrames = 0, sampledFrames = 0, decodeMs = 0, drawMs = 0;
    builder.on('complete', ({ canvasSet }) => { completed = canvasSet; });
    try {
        const track = await input.getPrimaryVideoTrack();
        const interlaced = getInterlacedSource(source.file);
        const samples = interlaced
            ? (await import('./deinterlace/sonyVideoSamples.js')).sonyVideoSamples(interlaced, 1,
                plan.sourceStartFrame + plan.sourceFrames - 1, signal)
            : new VideoSampleSink(track).samples();
        const iterator = samples[Symbol.asyncIterator]();
        try {
            while (sampledFrames < plan.sourceFrames) {
                signal?.throwIfAborted();
                const beforeDecode = now();
                const item = await iterator.next();
                decodeMs += now() - beforeDecode;
                if (item.done) throw new Error(`Source ended after ${sampledFrames} of ${plan.sourceFrames} required samples.`);
                const sample = item.value;
                try {
                    decodedFrames++;
                    if (decodedFrames < plan.sourceStartFrame) continue;
                    const beforeDraw = now();
                    sample.draw(normalized.ctx, 0, 0, source.width, source.height);
                    const frame = new VideoFrame(normalized.canvas, { timestamp: Math.round(sample.timestamp * 1e6) });
                    try { builder.processFrame({ videoFrame: frame, frameNumber: ++sampledFrames }); }
                    finally { frame.close(); }
                    drawMs += now() - beforeDraw;
                    if (sampledFrames % 32 === 0) {
                        onFrame?.(sampledFrames);
                        await pause();
                    }
                } finally { sample.close(); }
            }
        } finally { await iterator.return?.(); }
        signal?.throwIfAborted();
        if (!completed) throw new Error('The sampling batch did not complete.');
        success = true;
        return { canvases: completed, metrics: { decodedFrames, sampledFrames, decodeMs, drawMs } };
    } catch (error) { signal?.throwIfAborted(); throw error; }
    finally {
        signal?.removeEventListener('abort', abort);
        input.dispose();
        release(normalized.canvas);
        release(builder.sourceFrameSurface?.canvas);
        if (!success) for (const canvas of completed ?? builder.canvasses ?? []) release(canvas);
        builder.dispose();
    }
}

export async function generateBackgroundLoop(source, options = {}) {
    const { signal, onProgress, encodingMethod = 'ffmpeg', quality = 'high', onSampledBatch } = options;
    const plan = planBackgroundLoop(source, options);
    if (!['ffmpeg', 'webcodecs'].includes(encodingMethod)) throw new Error('Choose FFmpeg or WebCodecs encoding.');
    if (encodingMethod === 'webcodecs' && !await canEncodeVideo('avc', {
        width: plan.size, height: plan.size, frameRate: plan.fps, bitrate: QUALITY_HIGH,
    })) throw new Error('This browser cannot encode the requested square with WebCodecs. Choose FFmpeg or a smaller size.');
    signal?.throwIfAborted();
    const job = { id: crypto.randomUUID(), createdAt: Date.now(), sourceName: source.name, plan,
        encodingMethod, quality, status: 'sampling', batches: [], outputParts: 0 };
    await saveBackgroundLoopJob(job);
    const started = now();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = plan.size;
    const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
    try {
        for (let offset = 0; offset < plan.phaseCount; offset += plan.batchSize) {
            signal?.throwIfAborted();
            const batchStarted = now();
            onProgress?.({ jobId: job.id, phase: 'sampling', offset, total: plan.phaseCount });
            const { canvases, metrics } = await sampleBackgroundLoopBatch(source, plan, offset, { signal,
                onFrame: frame => onProgress?.({ jobId: job.id, phase: 'sampling', offset, total: plan.phaseCount, sourceFrame: frame }) });
            let encoder;
            try {
                await onSampledBatch?.(canvases, offset);
                onProgress?.({ jobId: job.id, phase: 'encoding', offset, total: plan.phaseCount });
                const encodeStarted = now();
                encoder = await createCanvasVideoExport(canvas, { width: plan.size, height: plan.size,
                    fps: plan.fps, quality, format: 'mp4', encodingMethod, videoRange: 'limited',
                    logoOverlayEnabled: false, signal, totalFrames: canvases.length, wasmWorkerCount: 1 });
                for (let i = 0; i < canvases.length; i++) {
                    ctx.drawImage(canvases[i], 0, 0);
                    await encoder.add(i / plan.fps, 1 / plan.fps);
                    release(canvases[i]);
                }
                const blob = await encoder.finalize();
                metrics.encodeMs = now() - encodeStarted;
                const persistStarted = now();
                // Await the transaction commit before allocating the next sampling batch.
                await saveBackgroundLoopPart(job.id, 'batch', job.batches.length, blob);
                metrics.persistMs = now() - persistStarted;
                job.batches.push({ offset, frames: canvases.length, bytes: blob.size,
                    ...metrics, totalMs: now() - batchStarted });
                await saveBackgroundLoopJob(job);
            } finally {
                await encoder?.dispose();
                for (const surface of canvases) release(surface);
            }
        }
        job.samplingMs = now() - started;
        job.status = 'sampled';
        await saveBackgroundLoopJob(job);
        return await assembleBackgroundLoop(job.id, { signal, onProgress });
    } catch (error) {
        // Preserve completed encoded batches for inspection/reassembly; never claim a partial job is complete.
        error.backgroundLoopJobId = job.id;
        throw error;
    } finally { release(canvas); }
}

function configSignature(config) {
    return JSON.stringify({ codec: config.codec, width: config.codedWidth, height: config.codedHeight,
        color: config.colorSpace, description: Array.from(new Uint8Array(config.description ?? [])) });
}

export async function assembleBackgroundLoop(id, { signal, onProgress } = {}) {
    const job = await getBackgroundLoopJob(id);
    if (!job || job.batches.reduce((n, batch) => n + batch.frames, 0) !== job.plan.phaseCount) {
        throw new Error('All encoded phase batches must be present before assembly.');
    }
    const started = now();
    signal?.throwIfAborted();
    await deleteBackgroundLoopParts(id, 'output');
    job.status = 'assembling'; job.outputParts = 0;
    await saveBackgroundLoopJob(job);
    let output, packetSource, signature, frames = 0;
    try {
        const target = new AppendOnlyStreamTarget(new WritableStream({
            async write(data) {
                signal?.throwIfAborted();
                await saveBackgroundLoopPart(id, 'output', job.outputParts++, new Blob([data]));
            },
        }));
        output = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 1 }), target });
        for (let index = 0; index < job.batches.length; index++) {
            signal?.throwIfAborted();
            const batch = job.batches[index];
            onProgress?.({ jobId: id, phase: 'assembling', offset: batch.offset, total: job.plan.phaseCount });
            const blob = await getBackgroundLoopPart(id, 'batch', index);
            if (!blob) throw new Error(`Encoded batch ${index + 1} is missing.`);
            const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
            try {
                const track = await input.getPrimaryVideoTrack();
                const config = await track.getDecoderConfig();
                if (!packetSource) {
                    signature = configSignature(config);
                    packetSource = new EncodedVideoPacketSource(await track.getCodec());
                    output.addVideoTrack(packetSource, { frameRate: job.plan.fps });
                    await output.start();
                } else if (configSignature(config) !== signature) {
                    throw new Error('Encoded batches changed decoder configuration. Retry using the FFmpeg encoder.');
                }
                let localFrame = 0;
                const presentationFrames = new Set();
                for await (const packet of new EncodedPacketSink(track).packets()) {
                    signal?.throwIfAborted();
                    if (!localFrame && packet.type !== 'key') throw new Error('An encoded batch does not start with a keyframe.');
                    // Preserve presentation order even if a native encoder emits B frames in decode order.
                    const presentationFrame = Math.round(packet.timestamp * job.plan.fps);
                    if (Math.abs(packet.timestamp - presentationFrame / job.plan.fps) > 0.0001
                        || presentationFrame < 0 || presentationFrame >= batch.frames || presentationFrames.has(presentationFrame)) {
                        throw new Error('The batch encoder produced unexpected frame timestamps.');
                    }
                    presentationFrames.add(presentationFrame);
                    await packetSource.add(packet.clone({ timestamp: (batch.offset + presentationFrame) / job.plan.fps, duration: 1 / job.plan.fps,
                        sequenceNumber: frames }), localFrame ? undefined : { decoderConfig: config });
                    localFrame++; frames++;
                }
                if (localFrame !== batch.frames) throw new Error('An encoded batch has the wrong frame count.');
            } finally { input.dispose(); }
        }
        await output.finalize();
        signal?.throwIfAborted();
        job.status = 'complete'; job.assemblyMs = now() - started;
        await saveBackgroundLoopJob(job);
        const blob = await getBackgroundLoopBlob(id);
        return { job, blob };
    } catch (error) {
        await output?.cancel().catch(() => {});
        job.status = 'sampled'; job.outputParts = 0;
        await saveBackgroundLoopJob(job);
        throw error;
    }
}
