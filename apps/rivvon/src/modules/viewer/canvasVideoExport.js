import { createSdrVideoExport } from './sdrVideoExport.js';
import { drawExportLogoOverlay, loadExportLogoAsset } from './exportLogoOverlay.js';
import { collectExportEnvironment, completeExportColourReport } from './exportColourReport.js';
import { inspectMp4Colour } from './videoColourMetadata.js';
import { repairMissingSpsColour } from './repairWebCodecsColour.js';

// Shared encoder choice and diagnostics for all three public video entry points.
export async function createCanvasVideoExport(canvas, options) {
    const format = options.format ?? 'mp4';
    const encodingMethod = format === 'webm' ? 'webcodecs' : (options.encodingMethod ?? 'ffmpeg');
    if (!['ffmpeg', 'webcodecs'].includes(encodingMethod)) throw new Error('Unknown video encoding method.');
    if (format === 'mp4' && encodingMethod === 'ffmpeg') return createSdrVideoExport(canvas, options);
    if (typeof VideoEncoder === 'undefined') throw new Error('WebCodecs API is not available in this browser.');
    const MB = await import('mediabunny');
    const { width, height, fps, quality, logoOverlayEnabled, logoOverlayCorner, signal, onColourMetadata } = options;
    const report = { schemaVersion: 1, phase: 'encoding', encodingMethod, format,
        pipeline: 'Canvas → VideoFrame → browser encoder → Mediabunny', encoder: 'WebCodecs (implementation not exposed)',
        width, height, fps, quality, logo: Boolean(logoOverlayEnabled), hardwareAcceleration: options.hardwareAcceleration ?? 'no-preference',
        environment: await collectExportEnvironment(options.renderContext), videoFrame: null, decoderConfig: null, encoderConfig: null,
        decoderColourSpaces: [] };
    const logo = logoOverlayEnabled ? await loadExportLogoAsset() : null;
    let sourceCanvas = canvas, context;
    if (logo) {
        sourceCanvas = document.createElement('canvas'); sourceCanvas.width = width; sourceCanvas.height = height;
        context = sourceCanvas.getContext('2d', { alpha: true, colorSpace: 'srgb' });
        if (!context) throw new Error('Failed to create export overlay compositor.');
    }
    const output = new MB.Output({ format: format === 'webm' ? new MB.WebMOutputFormat() : new MB.Mp4OutputFormat(), target: new MB.BufferTarget() });
    const qualityMap = { 'very-low': MB.QUALITY_VERY_LOW, low: MB.QUALITY_LOW, medium: MB.QUALITY_MEDIUM,
        high: MB.QUALITY_HIGH, 'very-high': MB.QUALITY_VERY_HIGH };
    const source = new MB.CanvasSource(sourceCanvas, { codec: format === 'webm' ? 'vp9' : 'avc',
        bitrate: qualityMap[quality] ?? MB.QUALITY_VERY_HIGH, hardwareAcceleration: report.hardwareAcceleration,
        onEncoderConfig(config) { report.encoderConfig = { ...config }; },
        onEncodedPacket(_packet, meta) {
            const cfg = meta?.decoderConfig;
            if (cfg?.colorSpace && !report.decoderColourSpaces.some(c => JSON.stringify(c) === JSON.stringify(cfg.colorSpace))) {
                report.decoderColourSpaces.push({ ...cfg.colorSpace });
            }
            // Preserve the first decoder config that actually declares colour.
            if (cfg && (!report.decoderConfig || (!report.decoderConfig.colorSpace && cfg.colorSpace))) {
                report.decoderConfig = { codec: cfg.codec, codedWidth: cfg.codedWidth, codedHeight: cfg.codedHeight,
                    colorSpace: cfg.colorSpace ? { ...cfg.colorSpace } : null };
            }
        },
    });
    output.addVideoTrack(source);
    const repairController = new AbortController();
    let disposed = false;
    const dispose = async () => {
        repairController.abort();
        signal?.removeEventListener('abort', abort);
        if (!disposed) { disposed = true; await output.cancel(); }
    };
    const abort = () => { void dispose(); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
        if (signal?.aborted) throw new DOMException('Video export cancelled', 'AbortError');
        await output.start();
        return {
            async add(time, duration) {
                if (signal?.aborted) throw new DOMException('Video export cancelled', 'AbortError');
                if (context) {
                    context.clearRect(0, 0, width, height); context.drawImage(canvas, 0, 0, width, height);
                    drawExportLogoOverlay(context, logo.image, width, height, logo.aspectRatio, logoOverlayCorner);
                }
                if (!report.videoFrame) {
                    // Observe the same canvas constructor/options used by CanvasSource;
                    // do not override or relabel the source's colour space.
                    const frame = new VideoFrame(sourceCanvas, { timestamp: Math.trunc(time * 1e6), duration: Math.trunc(duration * 1e6) || undefined });
                    try { report.videoFrame = { format: frame.format, colorSpace: frame.colorSpace.toJSON() }; }
                    finally { frame.close(); }
                    onColourMetadata?.({ ...report });
                }
                await source.add(time, duration);
            },
            async finalize() {
                await output.finalize();
                if (signal?.aborted) throw new DOMException('Video export cancelled', 'AbortError');
                disposed = true;
                let metadata = null, inspectionError = null;
                let data = new Uint8Array(output.target.buffer);
                if (format === 'mp4') {
                    options.onStatus?.('Checking H.264 colour declarations…');
                    try { metadata = inspectMp4Colour(data); }
                    catch (error) { inspectionError = error.message; }
                    // Developer comparison hook: this is the identical encoded
                    // stream before metadata repair, rather than another encode.
                    await options.onBeforeSpsRepair?.(new Blob([data], { type: 'video/mp4' }), metadata);
                    if (signal?.aborted || repairController.signal.aborted) throw new DOMException('Video export cancelled', 'AbortError');
                    if (!inspectionError) {
                        let result;
                        try {
                            result = await repairMissingSpsColour(data, { decoderColourSpaces: report.decoderColourSpaces,
                                signal: repairController.signal, onStatus: options.onStatus });
                        } finally { signal?.removeEventListener('abort', abort); }
                        data = result.data; report.spsRepair = result.repair;
                        if (result.repair.status === 'added') report.pipeline += ' → FFmpeg h264_metadata (stream copy)';
                        metadata = inspectMp4Colour(data);
                    } else report.spsRepair = { status: 'skipped', reason: 'The completed MP4 could not be inspected.' };
                }
                signal?.removeEventListener('abort', abort);
                if (signal?.aborted || repairController.signal.aborted) throw new DOMException('Video export cancelled', 'AbortError');
                const finalReport = completeExportColourReport(report, metadata, inspectionError);
                onColourMetadata?.(finalReport);
                if (import.meta.env.DEV) console.info('[Rivvon export colour]', finalReport);
                return new Blob([data], { type: format === 'webm' ? 'video/webm' : 'video/mp4' });
            },
            dispose,
        };
    } catch (error) { await dispose(); throw error; }
}
