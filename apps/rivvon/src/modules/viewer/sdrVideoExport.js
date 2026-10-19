import { rgbaToBt709I420, validateSdrDimensions } from './exportColour.js';
import { assertSdrMp4, restoreCfrMp4Timing } from './videoColourMetadata.js';
import { drawExportLogoOverlay, loadExportLogoAsset } from './exportLogoOverlay.js';
import { collectExportEnvironment, completeExportColourReport } from './exportColourReport.js';
import { createSdrEncoderPool } from './sdrEncoderPool.js';

const RAW_BATCH_BYTES = 32 * 1024 * 1024;
const abortError = () => new DOMException('Video export cancelled', 'AbortError');

// Pinned, single-threaded x264 per worker, with up to four independent workers.
// Raw memory is bounded; compressed output remains in memory as before.
export async function createSdrVideoExport(canvas, options = {}) {
    const { width = canvas.width, height = canvas.height, fps = 30, quality = 'very-high', signal,
        onStatus, onColourMetadata, logoOverlayEnabled = true, logoOverlayCorner = 'bottomLeft' } = options;
    validateSdrDimensions(width, height, fps);
    if (signal?.aborted) throw abortError();
    let pool = null;
    let terminated = false, count = 0, pending = 0, raw = null;
    const frameBytes = width * height * 3 / 2;
    const batchFrames = Math.max(1, Math.min(Math.floor(RAW_BATCH_BYTES / frameBytes),
        options.totalFrames > 0 ? Math.ceil(options.totalFrames) : Infinity));
    const dispose = () => {
        signal?.removeEventListener('abort', abort);
        if (!terminated) { terminated = true; pool?.dispose(); }
        raw = null;
    };
    const abort = () => dispose();
    signal?.addEventListener('abort', abort, { once: true });
    const check = () => { if (signal?.aborted || terminated) throw abortError(); pool?.check(); };
    try {
        check();
        const batches = options.totalFrames > 0 ? Math.ceil(options.totalFrames / batchFrames) : 4;
        pool = await createSdrEncoderPool({ width, height, fps, quality, signal, onStatus,
            workerLimit: Math.min(options.wasmWorkerCount ?? 4, batches) });
        check();
        const logo = logoOverlayEnabled ? await loadExportLogoAsset() : null;
        check();
        const compositor = document.createElement('canvas');
        compositor.width = width; compositor.height = height;
        const context = compositor.getContext('2d', { alpha: false, colorSpace: 'srgb', willReadFrequently: true });
        if (!context || context.getContextAttributes?.().colorSpace !== 'srgb') throw new Error('An sRGB export canvas is required.');
        raw = new Uint8Array(batchFrames * frameBytes);
        const report = { schemaVersion: 1, phase: 'encoding', encodingMethod: 'ffmpeg', format: 'mp4',
            pipeline: 'sRGB → BT.709 transfer → limited I420 → x264', encoder: '@ffmpeg/core 0.12.10 / libx264',
            width, height, fps, quality, logo: Boolean(logo),
            workerLimit: pool.workerLimit, workerCount: pool.workerCount,
            environment: await collectExportEnvironment(options.renderContext) };
        check();
        onColourMetadata?.(report);
        if (import.meta.env.DEV) console.info('[Rivvon export colour]', report);
        async function flush() {
            if (!pending) return;
            // Copy only once a slot is free; writeFile transfers this copy.
            await pool.submit(() => raw.slice(0, pending * frameBytes), pending);
            pending = 0;
        }
        return {
            async add() {
                check();
                context.fillStyle = '#000'; context.fillRect(0, 0, width, height);
                context.drawImage(canvas, 0, 0, width, height);
                if (logo) drawExportLogoOverlay(context, logo.image, width, height, logo.aspectRatio, logoOverlayCorner);
                rgbaToBt709I420(context.getImageData(0, 0, width, height).data, width, height,
                    raw.subarray(pending * frameBytes, (pending + 1) * frameBytes));
                count++; pending++;
                if (pending === batchFrames) await flush();
                // Allow rendering progress and AbortController events between batches.
                if (count % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0));
                check();
            },
            async finalize() {
                try {
                    check();
                    if (!count) throw new Error('Cannot export an empty video.');
                    await flush(); raw = null;
                    const data = await pool.mux();
                    restoreCfrMp4Timing(data, { fps, frames: count });
                    const metadata = assertSdrMp4(data, { width, height, fps, frames: count });
                    onColourMetadata?.(completeExportColourReport({ ...report,
                        workerLimit: pool.workerLimit, workerCount: pool.workerCount }, metadata));
                    if (import.meta.env.DEV) console.info('[Rivvon export colour verified]', metadata);
                    return new Blob([data], { type: 'video/mp4' });
                } finally { dispose(); }
            },
            dispose,
        };
    } catch (error) { dispose(); if (signal?.aborted) throw abortError(); throw error; }
}
