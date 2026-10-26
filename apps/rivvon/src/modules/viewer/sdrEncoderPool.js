import { getSdrEncodeArgs, getSdrMuxArgs } from './exportColour.js';
import { assertSdrSps, inspectAnnexBSps } from './videoColourMetadata.js';
import { getRuntimeAssetUrl } from '../shared/runtimeAssets.js';

const abortError = () => new DOMException('Video export cancelled', 'AbortError');

export function getSdrWorkerLimit(requested = 4, nav = globalThis.navigator) {
    const cores = Number(nav?.hardwareConcurrency);
    const available = Number.isFinite(cores) && cores > 0 ? Math.max(1, Math.floor(cores) - 1) : 2;
    const limit = Number.isFinite(requested) ? Math.floor(requested) : 4;
    return Math.max(1, Math.min(4, available, limit));
}

// Each FFmpeg instance already owns a Web Worker. Keep x264 single-threaded
// inside each instance, so this pool requires neither shared memory nor COEP.
export async function createSdrEncoderPool({ width, height, fps, quality, signal, onStatus, workerLimit = 4 }) {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const slots = [], chunks = [];
    let limit = getSdrWorkerLimit(workerLimit);
    let disposed = false, failure = null, submittedFrames = 0, encodedFrames = 0, batchCount = 0;
    let peakWorkers = 0;
    const dispose = () => {
        if (disposed) return;
        signal?.removeEventListener('abort', dispose);
        disposed = true;
        for (const slot of slots) slot.ffmpeg.terminate();
        chunks.length = 0;
    };
    const check = () => {
        if (signal?.aborted) throw abortError();
        if (failure) throw failure;
        if (disposed) throw abortError();
    };
    const status = (phase) => onStatus?.(phase, { encodedFrames });
    const reportActive = () => {
        const active = slots.filter(slot => slot.batch).map(slot => slot.batch);
        active.sort((a, b) => a.first - b.first);
        status(active.length
            ? `Encoding SDR frames ${active.map(batch => `${batch.first}–${batch.last}`).join(', ')} (${active.length} ${active.length === 1 ? 'worker' : 'workers'})…`
            : 'Rendering SDR frames…');
    };
    async function exec(slot, args) {
        check();
        if (await slot.ffmpeg.exec(args) !== 0) throw new Error(`SDR video encoder failed: ${slot.logs.slice(-8).join('\n')}`);
        check();
    }
    async function spawn() {
        check();
        const slot = { ffmpeg: new FFmpeg(), logs: [], task: null, batch: null };
        slots.push(slot);
        slot.ffmpeg.on('log', ({ message }) => {
            slot.logs.push(message);
            if (slot.logs.length > 30) slot.logs.shift();
        });
        try {
            const base = `${import.meta.env.BASE_URL}vendor/ffmpeg/0.12.10/`;
            await slot.ffmpeg.load({ coreURL: `${base}ffmpeg-core-stackfix.js`, wasmURL: getRuntimeAssetUrl('ffmpegCoreWasm') });
            check();
            peakWorkers = Math.max(peakWorkers, slots.length);
            return slot;
        } catch (error) {
            slot.ffmpeg.terminate();
            slots.splice(slots.indexOf(slot), 1);
            throw error;
        }
    }
    async function acquire() {
        while (true) {
            check();
            const idle = slots.find(slot => !slot.task);
            if (idle) return idle;
            if (slots.length < limit) {
                try { return await spawn(); }
                catch (error) {
                    check();
                    // An additional instance may exceed the device's resources.
                    // Continue with the healthy workers already in the pool.
                    limit = slots.length;
                }
            }
            await Promise.race(slots.map(slot => slot.task).filter(Boolean));
        }
    }
    signal?.addEventListener('abort', dispose, { once: true });
    try {
        check();
        status('Loading SDR video encoder…');
        await spawn();
        return {
            check,
            get workerLimit() { return limit; },
            get workerCount() { return peakWorkers; },
            // Backpressure: acquire a worker BEFORE copying the reusable raw
            // buffer. There is no unbounded queue of waiting raw batches.
            async submit(readFrames, frames) {
                const slot = await acquire();
                check();
                const data = readFrames();
                const index = batchCount++;
                const batch = { first: submittedFrames + 1, last: submittedFrames + frames };
                submittedFrames += frames;
                slot.batch = batch;
                const run = async () => {
                    await slot.ffmpeg.writeFile('frames.yuv', data);
                    await exec(slot, getSdrEncodeArgs({ width, height, fps, frames, quality }));
                    const chunk = await slot.ffmpeg.readFile('chunk.h264');
                    check();
                    assertSdrSps(inspectAnnexBSps(chunk), { width, height });
                    await slot.ffmpeg.deleteFile('frames.yuv');
                    await slot.ffmpeg.deleteFile('chunk.h264');
                    check();
                    // Completion order can differ from playback order.
                    chunks[index] = chunk;
                    encodedFrames += frames;
                };
                // Observe every rejection immediately, even while the producer
                // renders. check() surfaces the original error on add/finalize.
                slot.task = run().then(() => {
                    slot.batch = null;
                    if (!disposed) reportActive();
                }).catch(error => {
                    if (!disposed) { failure = error; dispose(); }
                }).finally(() => {
                    slot.task = null;
                    slot.batch = null;
                });
                reportActive();
            },
            async mux() {
                await Promise.all(slots.map(slot => slot.task).filter(Boolean));
                check();
                // Release extra WASM heaps before allocating the joined stream.
                for (const slot of slots.slice(1)) slot.ffmpeg.terminate();
                slots.length = 1;
                status('Muxing and verifying SDR video…');
                const joined = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
                let offset = 0;
                for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
                chunks.length = 0;
                const slot = slots[0];
                await slot.ffmpeg.writeFile('video.h264', joined);
                await exec(slot, getSdrMuxArgs(fps));
                const data = await slot.ffmpeg.readFile('video.mp4');
                check();
                return data;
            },
            dispose,
        };
    } catch (error) { dispose(); if (signal?.aborted) throw abortError(); throw error; }
}
