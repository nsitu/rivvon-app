import { getSdrEncodeArgs, getSdrMuxArgs, rgbaToBt709I420, validateSdrDimensions } from './exportColour.js';
import { assertSdrMp4, assertSdrSps, inspectAnnexBSps, restoreCfrMp4Timing } from './videoColourMetadata.js';
import { drawExportLogoOverlay, loadExportLogoAsset } from './exportLogoOverlay.js';
import { collectExportEnvironment, completeExportColourReport } from './exportColourReport.js';

const RAW_BATCH_BYTES = 32 * 1024 * 1024;
const abortError = () => new DOMException('Video export cancelled', 'AbortError');

// Local, pinned, single-threaded x264. No native RGB->YUV conversion or encoder
// selection. Raw memory is bounded; compressed output remains in memory as before.
export async function createSdrVideoExport(canvas, options = {}) {
    const { width = canvas.width, height = canvas.height, fps = 30, quality = 'very-high', signal,
        onStatus, onColourMetadata, logoOverlayEnabled = true, logoOverlayCorner = 'bottomLeft' } = options;
    validateSdrDimensions(width, height, fps);
    if (signal?.aborted) throw abortError();
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ffmpeg = new FFmpeg();
    let terminated = false, count = 0, pending = 0, raw = null;
    const chunks = [];
    const logs = [];
    const frameBytes = width * height * 3 / 2;
    const batchFrames = Math.max(1, Math.floor(RAW_BATCH_BYTES / frameBytes));
    const dispose = () => {
        signal?.removeEventListener('abort', abort);
        if (!terminated) { terminated = true; ffmpeg.terminate(); }
        raw = null; chunks.length = 0;
    };
    const abort = () => dispose();
    signal?.addEventListener('abort', abort, { once: true });
    const check = () => { if (signal?.aborted || terminated) throw abortError(); };
    ffmpeg.on('log', ({ message }) => { logs.push(message); if (logs.length > 30) logs.shift(); });
    async function exec(args) {
        check();
        if (await ffmpeg.exec(args) !== 0) throw new Error(`SDR video encoder failed: ${logs.slice(-8).join('\n')}`);
        check();
    }
    try {
        check();
        onStatus?.('Loading SDR video encoder…');
        const base = `${import.meta.env.BASE_URL}vendor/ffmpeg/0.12.10/`;
        await ffmpeg.load({ coreURL: `${base}ffmpeg-core.js`, wasmURL: `${base}ffmpeg-core.wasm` });
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
            environment: await collectExportEnvironment(options.renderContext) };
        check();
        onColourMetadata?.(report);
        if (import.meta.env.DEV) console.info('[Rivvon export colour]', report);
        async function flush() {
            if (!pending) return;
            onStatus?.(`Encoding SDR frames ${count - pending + 1}–${count}…`);
            // writeFile transfers its buffer. Slice to preserve the reusable batch.
            await ffmpeg.writeFile('frames.yuv', raw.slice(0, pending * frameBytes));
            await exec(getSdrEncodeArgs({ width, height, fps, frames: pending, quality }));
            const chunk = await ffmpeg.readFile('chunk.h264');
            assertSdrSps(inspectAnnexBSps(chunk), { width, height });
            chunks.push(chunk);
            await ffmpeg.deleteFile('frames.yuv'); await ffmpeg.deleteFile('chunk.h264');
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
                    onStatus?.('Muxing and verifying SDR video…');
                    const joined = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
                    let offset = 0;
                    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
                    chunks.length = 0;
                    await ffmpeg.writeFile('video.h264', joined);
                    await exec(getSdrMuxArgs(fps));
                    const data = await ffmpeg.readFile('video.mp4');
                    restoreCfrMp4Timing(data, { fps, frames: count });
                    const metadata = assertSdrMp4(data, { width, height, fps, frames: count });
                    onColourMetadata?.(completeExportColourReport(report, metadata));
                    if (import.meta.env.DEV) console.info('[Rivvon export colour verified]', metadata);
                    return new Blob([data], { type: 'video/mp4' });
                } finally { dispose(); }
            },
            dispose,
        };
    } catch (error) { dispose(); if (signal?.aborted) throw abortError(); throw error; }
}
