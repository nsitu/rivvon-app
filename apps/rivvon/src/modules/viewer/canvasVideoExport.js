import { createSdrVideoExport } from './sdrVideoExport.js';
import { drawExportLogoOverlay, loadExportLogoAsset } from './exportLogoOverlay.js';
import { collectExportEnvironment, completeExportColourReport } from './exportColourReport.js';
import { inspectMp4Colour } from './videoColourMetadata.js';
import { SDR_VIDEO_COLOUR, validateSdrDimensions } from './exportColour.js';
import { getBasicVideoQuality, resolveVideoRateControl } from './videoRateControl.js';
import { createExportYuvConversion } from './exportYuvConversion.js';
import { createExportBlob } from './exportBlob.js';
import { inspectAv1ColourObus } from './av1ColourMetadata.js';

// Shared encoder choice and diagnostics for all three public video entry points.
export async function createCanvasVideoExport(canvas, options) {
    const format = options.format ?? 'mp4';
    const videoCodec = options.videoCodec ?? (format === 'webm' ? 'vp9' : 'avc');
    if (!(format === 'mp4' ? ['avc', 'av1'] : format === 'webm' ? ['vp9'] : []).includes(videoCodec)) throw new Error('Unsupported video format and codec combination.');
    const encodingMethod = format === 'webm' || videoCodec === 'av1' ? 'webcodecs' : (options.encodingMethod ?? 'ffmpeg');
    if (!['ffmpeg', 'webcodecs'].includes(encodingMethod)) throw new Error('Unknown video encoding method.');
    if (format === 'mp4' && encodingMethod === 'ffmpeg') return createSdrVideoExport(canvas, options);
    if (typeof VideoEncoder === 'undefined') throw new Error('WebCodecs API is not available in this browser.');
    const { width, height, fps, quality, logoOverlayEnabled, logoOverlayCorner, signal, onColourMetadata } = options;
    const videoRange = format === 'mp4' ? (options.videoRange ?? 'auto') : 'auto';
    if (!['auto', 'limited', 'full'].includes(videoRange)) throw new Error('Unknown video colour range.');
    const explicitYuv = videoRange !== 'auto';
    if (explicitYuv) validateSdrDimensions(width, height, fps);
    if (signal?.aborted) throw new DOMException('Video export cancelled', 'AbortError');
    const control = resolveVideoRateControl({ ...options, format, encodingMethod });
    const MB = await import('mediabunny');
    const report = { schemaVersion: 1, phase: 'encoding', encodingMethod, format, videoCodec,
        pipeline: explicitYuv ? `sRGB → BT.709 transfer → ${videoRange} I420 → browser encoder → Mediabunny`
            : 'Canvas → VideoFrame → browser encoder → Mediabunny', encoder: 'WebCodecs (implementation not exposed)',
        videoRange, explicitYuv,
        width, height, fps, targetBitrate: control.bitrate, bitrateMode: control.bitrateMode, quantizer: control.quantizer,
        ...(control.bitrateMode === 'basic' ? { requestedRateControl: 'basic', qualityLevel: control.quality } : {}),
        logo: Boolean(logoOverlayEnabled), hardwareAcceleration: options.hardwareAcceleration ?? 'no-preference',
        environment: await collectExportEnvironment(options.renderContext), videoFrame: null, decoderConfig: null, encoderConfig: null,
        decoderColourSpaces: [], ...(videoCodec === 'av1' ? { sequenceHeaders: [] } : {}) };
    let av1InspectionError = null;
    const logo = logoOverlayEnabled ? await loadExportLogoAsset() : null;
    let sourceCanvas = canvas, context;
    if (logo || explicitYuv) {
        sourceCanvas = document.createElement('canvas'); sourceCanvas.width = width; sourceCanvas.height = height;
        context = sourceCanvas.getContext('2d', { alpha: !explicitYuv, colorSpace: 'srgb', willReadFrequently: explicitYuv && options.yuvConversion === 'cpu' });
        if (!context) throw new Error('Failed to create export overlay compositor.');
        if (explicitYuv && context.getContextAttributes?.().colorSpace !== 'srgb') throw new Error('An sRGB export canvas is required.');
    }
    let measuredBytes = 0;
    const output = new MB.Output({ format: format === 'webm' ? new MB.WebMOutputFormat()
        : new MB.Mp4OutputFormat(options.measurementOnly ? { fastStart: false } : {}),
        target: options.measurementOnly ? new MB.NullTarget() : new MB.BufferTarget() });
    const config = { codec: videoCodec,
        quality: new MB.Quality(control.bitrateMode === 'basic' ? control.quality : control.bitrateMode === 'quantizer'
            ? { quantizer: control.quantizer } : { bitrate: control.bitrate, bitrateMode: control.bitrateMode }),
        hardwareAcceleration: report.hardwareAcceleration,
        onEncoderConfig(config) {
            report.encoderConfig = { ...config };
            if (control.bitrateMode === 'basic') {
                report.bitrateMode = config.bitrateMode;
                report.targetBitrate = config.bitrate ?? null;
                report.quantizer = config.bitrateMode === 'quantizer'
                    ? getBasicVideoQuality(control.quality, { videoCodec, width, height }).quantizer : null;
            }
        },
        onEncodedPacket(_packet, meta) {
            if (options.measurementOnly) { measuredBytes += _packet.data.byteLength; return; }
            if (videoCodec === 'av1' && !av1InspectionError) {
                try {
                    for (const header of inspectAv1ColourObus(_packet.data)) {
                        if (!report.sequenceHeaders.some(existing => JSON.stringify(existing) === JSON.stringify(header))) report.sequenceHeaders.push(header);
                    }
                } catch (error) { av1InspectionError = error.message; }
            }
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
    };
    const source = explicitYuv ? new MB.VideoSampleSource(config) : new MB.CanvasSource(sourceCanvas, config);
    const yuv = explicitYuv ? new Uint8Array(width * height * 3 / 2) : null;
    output.addVideoTrack(source, { frameRate: fps });
    const repairController = new AbortController();
    let disposed = false, converter = null, firstTimestamp = Infinity, endTimestamp = -Infinity;
    const recordFrame = (time, duration) => {
        firstTimestamp = Math.min(firstTimestamp, time);
        endTimestamp = Math.max(endTimestamp, time + duration);
    };
    const dispose = async () => {
        repairController.abort();
        converter?.dispose();
        signal?.removeEventListener('abort', abort);
        if (!disposed) { disposed = true; await output.cancel(); }
    };
    const abort = () => { void dispose(); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
        if (signal?.aborted) throw new DOMException('Video export cancelled', 'AbortError');
        if (explicitYuv) {
            converter = createExportYuvConversion(width, height, { method: options.yuvConversion ?? 'gpu', fullRange: videoRange === 'full' });
            report.yuvConversion = converter.info;
        }
        await output.start();
        return {
            async add(time, duration) {
                if (signal?.aborted || disposed) throw new DOMException('Video export cancelled', 'AbortError');
                if (context) {
                    if (explicitYuv) { context.fillStyle = '#000'; context.fillRect(0, 0, width, height); }
                    else context.clearRect(0, 0, width, height);
                    context.drawImage(canvas, 0, 0, width, height);
                    if (logo) drawExportLogoOverlay(context, logo.image, width, height, logo.aspectRatio, logoOverlayCorner);
                }
                if (explicitYuv) {
                    converter.convert(sourceCanvas, yuv);
                    const previousMethod = report.yuvConversion.method;
                    report.yuvConversion = converter.info;
                    if (previousMethod !== report.yuvConversion.method) onColourMetadata?.({ ...report });
                    const frame = new VideoFrame(yuv, { format: 'I420', codedWidth: width, codedHeight: height,
                        timestamp: Math.round(time * 1e6), duration: Math.round(duration * 1e6) || undefined,
                        colorSpace: { ...SDR_VIDEO_COLOUR, fullRange: videoRange === 'full' } });
                    let sample;
                    try {
                        if (!report.videoFrame) {
                            report.videoFrame = { format: frame.format, colorSpace: frame.colorSpace.toJSON() };
                            onColourMetadata?.({ ...report });
                        }
                        sample = new MB.VideoSample(frame);
                        await source.add(sample);
                        recordFrame(time, duration);
                    } finally { sample?.close(); frame.close(); }
                    return;
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
                recordFrame(time, duration);
            },
            async finalize() {
                await output.finalize();
                converter?.dispose();
                if (signal?.aborted) throw new DOMException('Video export cancelled', 'AbortError');
                disposed = true;
                if (options.measurementOnly) {
                    signal?.removeEventListener('abort', abort);
                    return { measurementOnly: true, size: measuredBytes, duration: endTimestamp - firstTimestamp,
                        frames: Math.round((endTimestamp - firstTimestamp) * fps) };
                }
                let metadata = null, inspectionError = null, repairedBlob = null;
                let data = new Uint8Array(output.target.buffer);
                if (format === 'mp4') {
                    options.onStatus?.(`Checking ${videoCodec === 'av1' ? 'AV1' : 'H.264'} colour declarations…`);
                    try { metadata = inspectMp4Colour(data); }
                    catch (error) { inspectionError = error.message; }
                    // Developer comparison hook: this is the identical encoded
                    // stream before metadata repair, rather than another encode.
                    if (options.onBeforeSpsRepair) {
                        await options.onBeforeSpsRepair(await createExportBlob(data, { signal: repairController.signal }), metadata);
                    }
                    if (signal?.aborted || repairController.signal.aborted) throw new DOMException('Video export cancelled', 'AbortError');
                    if (videoCodec === 'avc' && !inspectionError && options.repairSpsColour === true) {
                        // Diagnostic comparisons may opt in; normal exports
                        // retain the original bytes without a WASM remux/copy.
                        const { repairMissingSpsColour } = await import('./repairWebCodecsColour.js');
                        const result = await repairMissingSpsColour(data, { decoderColourSpaces: report.decoderColourSpaces,
                            signal: repairController.signal, onStatus: options.onStatus });
                        data = result.data; report.spsRepair = result.repair;
                        repairedBlob = result.blob;
                        if (result.repair.status === 'added') report.pipeline += ' → FFmpeg h264_metadata (stream copy)';
                        metadata = inspectMp4Colour(data);
                    } else if (videoCodec === 'avc') report.spsRepair = inspectionError
                        ? { status: 'skipped', reason: 'The completed MP4 could not be inspected.' }
                        : { status: 'not-requested', reason: 'Original encoder output retained; automatic metadata repair is disabled.' };
                }
                if (signal?.aborted || repairController.signal.aborted) throw new DOMException('Video export cancelled', 'AbortError');
                inspectionError ??= av1InspectionError;
                const finalReport = completeExportColourReport({ ...report,
                    output: { bytes: data.byteLength, duration: endTimestamp - firstTimestamp },
                }, metadata, inspectionError ?? av1InspectionError);
                if (explicitYuv && (inspectionError || finalReport.verification.conflictsWithRequestedColour
                    || (videoRange === 'full' && !finalReport.verification.matchesRequestedColour))) {
                    throw new Error(`The browser did not establish the requested BT.709 ${videoRange}-range output. Try FFmpeg WASM for limited-range export or another encoder preference.`);
                }
                const blob = repairedBlob ?? await createExportBlob(data, {
                    type: format === 'webm' ? 'video/webm' : 'video/mp4', signal: repairController.signal,
                });
                signal?.removeEventListener('abort', abort);
                onColourMetadata?.(finalReport);
                if (import.meta.env.DEV) console.info('[Rivvon export colour]', finalReport);
                return blob;
            },
            dispose,
        };
    } catch (error) { await dispose(); throw error; }
}
