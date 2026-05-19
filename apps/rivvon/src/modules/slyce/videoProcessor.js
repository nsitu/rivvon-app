import { useSlyceStore } from '../../stores/slyceStore';
import { useViewerStore } from '../../stores/viewerStore';
import { resourceUsageReport } from './resourceMonitor.js';
import { readCanvasSetImages } from './samplingRuntime.js';
import { TileBuilder } from './tileBuilder.js';
import { WebGLTileBuilder } from './webglTileBuilder.js';
import { WebGPUTileBuilder } from './webgpuTileBuilder.js';
import { KTX2Assembler } from './ktx2-assembler.js';
import { KTX2WorkerPool } from './ktx2-worker-pool.js';
import {
    getDefaultTileBuilderBackend,
    getSharedBackgroundEncodeConfig,
    isLikelyIOSDevice,
    TILE_BUILDER_BACKEND_CANVAS,
    TILE_BUILDER_BACKEND_WEBGL,
    TILE_BUILDER_BACKEND_WEBGPU,
} from './encodingPolicy.js';
import { runSamplingPipeline } from './samplingPipeline.js';
import { VideoFileFrameSource } from './samplingSources.js';
import {
    abortProcessing,
    cleanupKTX2Workers,
    createProcessingAbortController,
    getKtx2WorkerPool,
    registerKtx2WorkerPool,
} from './videoProcessingControl.js';

/**
 * Create a thumbnail blob from RGBA image data.
 * Uses the first layer of the first tile as the thumbnail.
 */
async function createThumbnailFromRGBA(imageData, options = {}) {
    const { maxSize = 512, quality = 0.85 } = options;
    const { rgba, width, height } = imageData;

    // Create canvas with original dimensions
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const imgData = new ImageData(new Uint8ClampedArray(rgba), width, height);
    ctx.putImageData(imgData, 0, 0);

    // Calculate scaled dimensions maintaining aspect ratio
    let thumbWidth = width;
    let thumbHeight = height;
    if (width > maxSize || height > maxSize) {
        const aspectRatio = width / height;
        if (width > height) {
            thumbWidth = maxSize;
            thumbHeight = Math.round(maxSize / aspectRatio);
        } else {
            thumbHeight = maxSize;
            thumbWidth = Math.round(maxSize * aspectRatio);
        }
    }

    // Create thumbnail canvas
    const thumbCanvas = new OffscreenCanvas(thumbWidth, thumbHeight);
    const thumbCtx = thumbCanvas.getContext('2d');
    thumbCtx.imageSmoothingEnabled = true;
    thumbCtx.imageSmoothingQuality = 'high';
    thumbCtx.drawImage(canvas, 0, 0, thumbWidth, thumbHeight);

    // Convert to JPEG blob
    const blob = await thumbCanvas.convertToBlob({ type: 'image/jpeg', quality });
    console.log(`[VideoProcessor] Thumbnail created: ${thumbWidth}x${thumbHeight}, ${(blob.size / 1024).toFixed(1)}KB`);
    return blob;
}

function createCanvasTelemetry(note = null) {
    return {
        builderType: TILE_BUILDER_BACKEND_CANVAS,
        builderLabel: 'Canvas 2D',
        note,
    };
}

function createGpuAtlasTelemetry(builderType, builderLabel, report, builderSettings) {
    const layout = report?.layout;
    const sourceWidth = builderSettings.fileInfo?.width ?? 0;
    const sourceHeight = builderSettings.fileInfo?.height ?? 0;

    if (!layout) {
        return {
            builderType,
            builderLabel,
            note: 'Atlas layout unavailable.',
        };
    }

    const estimatedAtlasBytes = layout.width * layout.height * 4;
    const estimatedSourceTextureBytes = sourceWidth * sourceHeight * 4;

    return {
        builderType,
        builderLabel,
        atlasWidth: layout.width,
        atlasHeight: layout.height,
        atlasColumns: layout.columns,
        atlasRows: layout.rows,
        layerCount: builderSettings.crossSectionCount,
        sourceWidth,
        sourceHeight,
        estimatedAtlasBytes,
        estimatedSourceTextureBytes,
        estimatedTotalGpuBytes: estimatedAtlasBytes + estimatedSourceTextureBytes,
        liveAtlasCount: 0,
        peakAtlasCount: 0,
        estimatedLiveGpuBytes: 0,
        estimatedPeakGpuBytes: 0,
        maxTextureSize: report?.maxTextureSize ?? null,
    };
}

function createWebGLTelemetry(report, builderSettings) {
    return createGpuAtlasTelemetry(TILE_BUILDER_BACKEND_WEBGL, 'WebGL2 Atlas', report, builderSettings);
}

function createWebGPUTelemetry(report, builderSettings) {
    return createGpuAtlasTelemetry(TILE_BUILDER_BACKEND_WEBGPU, 'WebGPU Atlas', report, builderSettings);
}

function updateGpuAtlasTelemetry(app, updater) {
    const current = app.processingResourceTelemetry;
    if (!current || (current.builderType !== TILE_BUILDER_BACKEND_WEBGL && current.builderType !== TILE_BUILDER_BACKEND_WEBGPU)) {
        return;
    }

    const next = updater(current);
    if (!next) {
        return;
    }

    app.set('processingResourceTelemetry', {
        ...current,
        ...next,
    });
}

function incrementGpuAtlasCount(app) {
    updateGpuAtlasTelemetry(app, current => {
        const liveAtlasCount = (current.liveAtlasCount ?? 0) + 1;
        const peakAtlasCount = Math.max(current.peakAtlasCount ?? 0, liveAtlasCount);
        const estimatedPerTileBytes = current.estimatedTotalGpuBytes ?? 0;

        return {
            liveAtlasCount,
            peakAtlasCount,
            estimatedLiveGpuBytes: estimatedPerTileBytes * liveAtlasCount,
            estimatedPeakGpuBytes: estimatedPerTileBytes * peakAtlasCount,
        };
    });
}

function decrementGpuAtlasCount(app) {
    updateGpuAtlasTelemetry(app, current => {
        const liveAtlasCount = Math.max(0, (current.liveAtlasCount ?? 0) - 1);
        const estimatedPerTileBytes = current.estimatedTotalGpuBytes ?? 0;

        return {
            liveAtlasCount,
            estimatedLiveGpuBytes: estimatedPerTileBytes * liveAtlasCount,
        };
    });
}

function formatProgressFps(fps) {
    return Number.isFinite(fps) && fps > 0 ? ` (${Math.round(fps)} FPS)` : '';
}

function formatPhaseDuration(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
        return null;
    }

    return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatPhaseRate(unitCount, durationMs) {
    if (!Number.isFinite(unitCount) || unitCount <= 0 || !Number.isFinite(durationMs) || durationMs <= 0) {
        return null;
    }

    const unitsPerSecond = unitCount / (durationMs / 1000);
    if (!Number.isFinite(unitsPerSecond) || unitsPerSecond <= 0) {
        return null;
    }

    return `${unitsPerSecond.toLocaleString(undefined, {
        minimumFractionDigits: unitsPerSecond < 10 ? 1 : 0,
        maximumFractionDigits: unitsPerSecond < 100 ? 1 : 0,
    })}fps`;
}

function buildDecodeSummaryLine({ decodeDurationMs = null, decodedFrameCount = null } = {}) {
    const decodeDurationLabel = formatPhaseDuration(decodeDurationMs);
    if (!decodeDurationLabel) {
        return null;
    }

    if (!Number.isFinite(decodedFrameCount) || decodedFrameCount <= 0) {
        return decodeDurationLabel;
    }

    const decodeRateLabel = formatPhaseRate(decodedFrameCount, decodeDurationMs);
    const roundedFrameCount = Math.max(1, Math.round(decodedFrameCount));
    const frameLabel = roundedFrameCount === 1 ? 'frame' : 'frames';
    return decodeRateLabel
        ? `${roundedFrameCount.toLocaleString()} ${frameLabel} / ${decodeDurationLabel} (${decodeRateLabel})`
        : `${roundedFrameCount.toLocaleString()} ${frameLabel} / ${decodeDurationLabel}`;
}

function buildEncodeSummaryLine({ encodeDurationMs = null, encodedLayerCount = null } = {}) {
    const encodeDurationLabel = formatPhaseDuration(encodeDurationMs);
    if (!encodeDurationLabel) {
        return null;
    }

    if (!Number.isFinite(encodedLayerCount) || encodedLayerCount <= 0) {
        return encodeDurationLabel;
    }

    const encodeRateLabel = formatPhaseRate(encodedLayerCount, encodeDurationMs);
    const roundedLayerCount = Math.max(1, Math.round(encodedLayerCount));
    const layerLabel = roundedLayerCount === 1 ? 'layer' : 'layers';
    return encodeRateLabel
        ? `${roundedLayerCount.toLocaleString()} ${layerLabel} / ${encodeDurationLabel} (${encodeRateLabel})`
        : `${roundedLayerCount.toLocaleString()} ${layerLabel} / ${encodeDurationLabel}`;
}

function buildDecodeCompletedStatus({ decodeDurationMs = null, decodedFrameCount = null } = {}) {
    const decodeSummaryLine = buildDecodeSummaryLine({
        decodeDurationMs,
        decodedFrameCount,
    });
    if (!decodeSummaryLine) {
        return 'Ready for Encoding';
    }

    return `${decodeSummaryLine}\nReady for Encoding`;
}

function buildTilePhaseSummaryStatus({
    decodeDurationMs = null,
    encodeDurationMs = null,
    decodedFrameCount = null,
    encodedLayerCount = null,
} = {}) {
    const lines = [];
    const decodeSummaryLine = buildDecodeSummaryLine({
        decodeDurationMs,
        decodedFrameCount,
    });
    const encodeSummaryLine = buildEncodeSummaryLine({
        encodeDurationMs,
        encodedLayerCount,
    });

    if (decodeSummaryLine) {
        lines.push(decodeSummaryLine);
    }

    if (encodeSummaryLine) {
        lines.push(encodeSummaryLine);
    }

    return lines.length > 0 ? lines.join('\n') : 'Complete';
}

function buildProcessingPhaseSummary(tilePhaseTimings = []) {
    const completedTimings = tilePhaseTimings.filter((tileTiming) => tileTiming && (
        Number.isFinite(tileTiming.decodeDurationMs)
        || Number.isFinite(tileTiming.encodeDurationMs)
    ));

    if (!completedTimings.length) {
        return null;
    }

    const decodedFrameCount = completedTimings.reduce(
        (sum, tileTiming) => sum + (Number.isFinite(tileTiming.decodedFrameCount) ? tileTiming.decodedFrameCount : 0),
        0
    );
    const encodedLayerCount = completedTimings.reduce(
        (sum, tileTiming) => sum + (Number.isFinite(tileTiming.encodedLayerCount) ? tileTiming.encodedLayerCount : 0),
        0
    );
    const decodeDurationMs = completedTimings.reduce(
        (sum, tileTiming) => sum + (Number.isFinite(tileTiming.decodeDurationMs) ? tileTiming.decodeDurationMs : 0),
        0
    );
    const encodeDurationMs = completedTimings.reduce(
        (sum, tileTiming) => sum + (Number.isFinite(tileTiming.encodeDurationMs) ? tileTiming.encodeDurationMs : 0),
        0
    );

    return {
        completedTileCount: completedTimings.length,
        decodedFrameCount,
        encodedLayerCount,
        decodeDurationMs,
        encodeDurationMs,
        decodeSummaryText: buildDecodeSummaryLine({
            decodeDurationMs,
            decodedFrameCount,
        }),
        encodeSummaryText: buildEncodeSummaryLine({
            encodeDurationMs,
            encodedLayerCount,
        }),
    };
}

function resumeDecodeTiming(tileTiming) {
    if (!tileTiming || Number.isFinite(tileTiming.decodeDurationMs)) {
        return;
    }

    const now = performance.now();

    if (!Number.isFinite(tileTiming.decodeStartedAt)) {
        tileTiming.decodeStartedAt = now;
    }

    if (!Number.isFinite(tileTiming.decodeActiveStartedAt)) {
        tileTiming.decodeActiveStartedAt = now;
    }
}

function pauseDecodeTiming(tileTiming) {
    if (!tileTiming || Number.isFinite(tileTiming.decodeDurationMs) || !Number.isFinite(tileTiming.decodeActiveStartedAt)) {
        return;
    }

    tileTiming.decodeAccumulatedMs = Math.max(
        0,
        (tileTiming.decodeAccumulatedMs ?? 0) + (performance.now() - tileTiming.decodeActiveStartedAt)
    );
    tileTiming.decodeActiveStartedAt = null;
}

function finalizeDecodeTiming(tileTiming) {
    if (!tileTiming || Number.isFinite(tileTiming.decodeDurationMs)) {
        return;
    }

    pauseDecodeTiming(tileTiming);
    tileTiming.decodeDurationMs = Math.max(0, tileTiming.decodeAccumulatedMs ?? 0);
}

const processVideo = async (settings) => {

    const {
        tilePlan,
        fileInfo,
        samplingMode,
        config,
        crossSectionCount,
        crossSectionType,
        tileBuilderBackend = getDefaultTileBuilderBackend(),
    } = settings;

    const requestedTileBuilderBackend = [
        TILE_BUILDER_BACKEND_CANVAS,
        TILE_BUILDER_BACKEND_WEBGL,
        TILE_BUILDER_BACKEND_WEBGPU,
    ].includes(tileBuilderBackend)
        ? tileBuilderBackend
        : getDefaultTileBuilderBackend();

    const app = useSlyceStore();
    const resolvedTilePlan = tilePlan && typeof tilePlan === 'object' && 'value' in tilePlan
        ? tilePlan.value
        : tilePlan;
    const tileEntries = Array.isArray(resolvedTilePlan?.tiles) ? resolvedTilePlan.tiles : [];
    const tilePlanError = tileEntries.length > 0
        ? null
        : resolvedTilePlan?.notices?.find(notice => typeof notice === 'string' && notice.trim())
            || 'Adjust the current settings so at least one tile can be generated before processing.';

    if (tilePlanError) {
        app.set('tilePlan', resolvedTilePlan);
        app.clearAllStatus();
        app.setStatus('Tile Plan', tilePlanError);
        console.warn(`[VideoProcessor] ${tilePlanError}`);
        return false;
    }

    const requestedInterpolationFactor = Math.max(1, Math.round(Number(settings.frameInterpolationFactor ?? app.effectiveInterpolationFactor) || 1));
    if (requestedInterpolationFactor > 1 && isLikelyIOSDevice()) {
        const interpolationUnsupportedMessage = 'Frame interpolation is currently unavailable on iPhone and iPad. The shipped ONNX model cannot initialize reliably within mobile runtime limits yet.';
        app.set('tilePlan', resolvedTilePlan);
        app.clearAllStatus();
        app.setStatus('Interpolation', interpolationUnsupportedMessage);
        console.warn(`[VideoProcessor] ${interpolationUnsupportedMessage}`);
        return false;
    }

    // Abort any previous processing
    abortProcessing();

    // Suspend the viewer to free GPU/CPU resources for encoding
    const viewerStore = useViewerStore();
    viewerStore.suspendViewer(true);

    // Create new abort controller for this processing run
    const abortController = createProcessingAbortController();
    const abortSignal = abortController.signal;

    let frameNumber = 0;
    let absoluteFrameNumber = 0;

    const tileBuilders = {};  // to store builder for each tileNumber
    let completedTiles = 0;  // Track completed tiles 

    const localSave = app.getLocalSaveController();
    const publish = app.getPublishController();

    // Store tilePlan so TilePreview and other consumers can access it
    app.set('tilePlan', resolvedTilePlan);
    localSave.resetLocalSaveState();
    publish.resetPublishState();
    app.set('autoDeriveResolutions', []);
    app.set('publishDestination', 'google-drive');
    app.set('thumbnailBlob', null);
    app.set('processingResourceTelemetry', null);
    app.set('processingPhaseSummary', null);
    app.set('processingProgress', null);

    // go to the processing tab.
    app.set('currentStep', '3')
    app.set('readerIsFinished', false)

    // Calculate how many frames will actually be used vs skipped
    const totalTiles = tileEntries.length;
    const lastTileEnd = tileEntries[totalTiles - 1].end;
    const framesUsed = lastTileEnd;
    const frameStart = app.frameStart || 1;
    const frameEnd = app.frameEnd || app.frameCount;

    // Initialize status
    app.removeStatus('Decoding');
    app.removeStatus('Frame Range');
    app.removeStatus('Interpolation');
    for (let tileIndex = 0; tileIndex < totalTiles; tileIndex++) {
        app.setStatus(`Tile ${tileIndex + 1}`, 'Queued');
    }

    const source = new VideoFileFrameSource({
        file: app.file,
        fileInfo,
        tilePlan: resolvedTilePlan,
        frameStart,
        frameEnd,
        frameInterpolationFactor: requestedInterpolationFactor,
        onSeekProgress(currentFrame) {
            const progressText = currentFrame && currentFrame !== frameStart
                ? `Seeking to frame ${frameStart} (decoder at frame ${currentFrame})`
                : `Seeking to frame ${frameStart}`;
            app.setStatus('Seeking', progressText);
        },
        onRangeStart() {
            app.removeStatus('Seeking');
        },
        onInterpolationStatus(message) {
            if (message) {
                app.setStatus('Interpolation', message);
            } else {
                app.removeStatus('Interpolation');
            }
        }
    });

    const encodeConfig = getSharedBackgroundEncodeConfig();
    let tileEncodeQueue = Promise.resolve();
    let isTileEncodeActive = false;
    let queuedTileEncodeCount = 0;
    let queuedTileHeadroomPromise = null;
    let resolveQueuedTileHeadroom = null;
    let sampledTileBuilderBackend = null;
    let gpuSupportReport = null;
    let currentEncodingStartedAt = 0;
    const tileProgress = resolvedTilePlan.tiles.map(() => ({
        decodeProgress: 0,
        encodeProgress: 0,
    }));
    const seenProcessingLegendStates = {
        queued: false,
        decoding: false,
        encoding: false,
        complete: false,
    };
    const tilePhaseTimings = resolvedTilePlan.tiles.map(() => ({
        decodeStartedAt: null,
        decodeActiveStartedAt: null,
        decodeAccumulatedMs: 0,
        decodeDurationMs: null,
        decodedFrameCount: null,
        encodeStartedAt: null,
        encodeDurationMs: null,
        encodedLayerCount: null,
    }));

    const processingProgressWeights = {
        decode: 0.35,
        encode: 0.65,
    };

    console.log(`[VideoProcessor] Encode policy: max ${encodeConfig.maxConcurrentTileEncodes} tile(s), ${encodeConfig.layerWorkerCount} layer worker(s) (${encodeConfig.reason})`);

    function getTileFrameProgress(tileNumber, frameNumber) {
        const tile = resolvedTilePlan.tiles[tileNumber];
        const frameCount = Math.max(1, tile.end - tile.start + 1);
        const frameIndex = Math.min(frameCount, Math.max(1, frameNumber - tile.start + 1));
        return { frameIndex, frameCount };
    }

    function getTileFrameCount(tileNumber) {
        const tile = resolvedTilePlan.tiles[tileNumber];
        if (!tile) {
            return null;
        }

        return Math.max(1, tile.end - tile.start + 1);
    }

    function clampProgress(value) {
        return Math.max(0, Math.min(1, value ?? 0));
    }

    function updateTileProgress(tileNumber, next) {
        const tile = tileProgress[tileNumber];
        if (!tile) {
            return;
        }

        if (typeof next.decodeProgress === 'number') {
            tile.decodeProgress = clampProgress(next.decodeProgress);
        }

        if (typeof next.encodeProgress === 'number') {
            tile.encodeProgress = clampProgress(next.encodeProgress);
        }
    }

    function getVisibleProcessingLegendStates() {
        return {
            queued: tileProgress.some(tile => tile.decodeProgress <= 0 && tile.encodeProgress <= 0),
            decoding: tileProgress.some(tile => tile.decodeProgress > tile.encodeProgress && tile.decodeProgress > 0),
            encoding: tileProgress.some(tile => tile.encodeProgress > 0 && tile.encodeProgress < 1),
            complete: tileProgress.some(tile => tile.encodeProgress >= 1),
        };
    }

    function updateProcessingStatus() {
        const decodedTilesEquivalent = tileProgress.reduce((sum, tile) => sum + tile.decodeProgress, 0);
        const encodedTilesEquivalent = tileProgress.reduce((sum, tile) => sum + tile.encodeProgress, 0);
        const decodeProgress = totalTiles > 0 ? decodedTilesEquivalent / totalTiles : 1;
        const encodeProgress = totalTiles > 0 ? encodedTilesEquivalent / totalTiles : 1;
        const overallProgress = (decodeProgress * processingProgressWeights.decode)
            + (encodeProgress * processingProgressWeights.encode);
        const overallPercent = Math.round(overallProgress * 100);
        const visibleLegendStates = getVisibleProcessingLegendStates();

        seenProcessingLegendStates.queued ||= visibleLegendStates.queued;
        seenProcessingLegendStates.decoding ||= visibleLegendStates.decoding;
        seenProcessingLegendStates.encoding ||= visibleLegendStates.encoding;
        seenProcessingLegendStates.complete ||= visibleLegendStates.complete;

        app.setStatus(
            'Processing',
            `${overallPercent}% complete`
        );

        app.set('processingProgress', {
            label: `${overallPercent}% complete`,
            overallPercent,
            decodedTilesEquivalent,
            encodedTilesEquivalent,
            totalTiles,
            legendStates: { ...seenProcessingLegendStates },
            tiles: tileProgress.map(tile => ({ ...tile })),
        });
    }

    updateProcessingStatus();

    function incrementQueuedTileEncodeCount() {
        queuedTileEncodeCount++;
        if (!queuedTileHeadroomPromise) {
            queuedTileHeadroomPromise = new Promise(resolve => {
                resolveQueuedTileHeadroom = resolve;
            });
        }
    }

    function decrementQueuedTileEncodeCount() {
        queuedTileEncodeCount = Math.max(0, queuedTileEncodeCount - 1);
        if (queuedTileEncodeCount === 0 && resolveQueuedTileHeadroom) {
            const resolve = resolveQueuedTileHeadroom;
            resolveQueuedTileHeadroom = null;
            queuedTileHeadroomPromise = null;
            resolve();
        }
    }

    function enqueueTileEncode(task) {
        const queuedBehindActiveEncode = isTileEncodeActive || queuedTileEncodeCount > 0;

        if (queuedBehindActiveEncode) {
            incrementQueuedTileEncodeCount();
        }

        const queuedTask = tileEncodeQueue
            .catch(() => { })
            .then(async () => {
                if (queuedBehindActiveEncode) {
                    decrementQueuedTileEncodeCount();
                }

                if (abortSignal.aborted) {
                    throw new DOMException('Video processing aborted.', 'AbortError');
                }

                isTileEncodeActive = true;

                try {
                    return await task();
                } finally {
                    isTileEncodeActive = false;
                }
            });

        tileEncodeQueue = queuedTask.catch(() => { });
        return queuedTask;
    }

    async function waitForEncodeQueueHeadroomIfNeeded() {
        // Keep decoding at most one completed tile ahead of KTX2 encode.
        // If another tile is already waiting behind the active encode, pause
        // decoding until the queue drains back to zero waiting tiles.
        if (queuedTileEncodeCount === 0) {
            return;
        }

        await queuedTileHeadroomPromise;
    }

    // Iterate through decoded video samples
    // VideoSampleSink automatically decodes frames using WebCodecs (non-blocking)
    await runSamplingPipeline({
        source,
        signal: abortSignal,
        getBuilderKey(item) {
            return item.tileNumber;
        },
        async createBuilder(item, tileNumber) {
            const builderSettings = {
                tileNumber,
                tilePlan: resolvedTilePlan,
                fileInfo: item.effectiveFileInfo,
                samplingMode,
                crossSectionCount,
                crossSectionType,
                // Base wavelength on frames we actually process (up to lastTileEnd)
                frameCount: framesUsed,
                outputFormat: app.outputFormat,
            };

            if (sampledTileBuilderBackend === null) {
                if (requestedTileBuilderBackend === TILE_BUILDER_BACKEND_CANVAS) {
                    sampledTileBuilderBackend = TILE_BUILDER_BACKEND_CANVAS;
                    app.set('processingResourceTelemetry', createCanvasTelemetry('Canvas tile builder selected; no GPU atlas allocated.'));
                    console.log('[VideoProcessor] Canvas tile builder selected; using 2D canvas sampling.');
                } else if (requestedTileBuilderBackend === TILE_BUILDER_BACKEND_WEBGPU) {
                    gpuSupportReport = await WebGPUTileBuilder.getSupportReport(builderSettings);
                    if (gpuSupportReport.supported) {
                        sampledTileBuilderBackend = TILE_BUILDER_BACKEND_WEBGPU;
                        app.set('processingResourceTelemetry', createWebGPUTelemetry(gpuSupportReport, builderSettings));
                        console.log(`[VideoProcessor] Using WebGPU tile builder (${gpuSupportReport.reason})`);
                    } else {
                        sampledTileBuilderBackend = TILE_BUILDER_BACKEND_CANVAS;
                        app.set('processingResourceTelemetry', createCanvasTelemetry(`WebGPU unavailable: ${gpuSupportReport.reason}`));
                        console.warn(`[VideoProcessor] WebGPU tile builder unavailable (${gpuSupportReport.reason}); falling back to 2D canvas sampling.`);
                    }
                } else {
                    gpuSupportReport = WebGLTileBuilder.getSupportReport(builderSettings);
                    if (gpuSupportReport.supported) {
                        sampledTileBuilderBackend = TILE_BUILDER_BACKEND_WEBGL;
                        app.set('processingResourceTelemetry', createWebGLTelemetry(gpuSupportReport, builderSettings));
                        console.log(`[VideoProcessor] Using WebGL2 tile builder (${gpuSupportReport.reason})`);
                    } else {
                        sampledTileBuilderBackend = TILE_BUILDER_BACKEND_CANVAS;
                        app.set('processingResourceTelemetry', createCanvasTelemetry(`WebGL2 unavailable: ${gpuSupportReport.reason}`));
                        console.warn(`[VideoProcessor] WebGL2 tile builder unavailable (${gpuSupportReport.reason}); falling back to 2D canvas sampling.`);
                    }
                }
            }

            if (sampledTileBuilderBackend === TILE_BUILDER_BACKEND_WEBGPU) {
                try {
                    return new WebGPUTileBuilder({
                        ...builderSettings,
                        supportReport: gpuSupportReport,
                    });
                } catch (error) {
                    sampledTileBuilderBackend = TILE_BUILDER_BACKEND_CANVAS;
                    app.set('processingResourceTelemetry', createCanvasTelemetry('WebGPU initialization failed; using canvas assembly.'));
                    console.warn('[VideoProcessor] Failed to initialize WebGPU tile builder; falling back to 2D canvas sampling:', error);
                }
            }

            if (sampledTileBuilderBackend === TILE_BUILDER_BACKEND_WEBGL) {
                try {
                    return new WebGLTileBuilder({
                        ...builderSettings,
                        supportReport: gpuSupportReport,
                    });
                } catch (error) {
                    sampledTileBuilderBackend = TILE_BUILDER_BACKEND_CANVAS;
                    app.set('processingResourceTelemetry', createCanvasTelemetry('WebGL2 initialization failed; using canvas assembly.'));
                    console.warn('[VideoProcessor] Failed to initialize WebGL2 tile builder; falling back to 2D canvas sampling:', error);
                }
            }

            return new TileBuilder(builderSettings);
        },
        onBuilderCreated({ builderKey, builder }) {
            tileBuilders[builderKey] = builder;

            if (builder instanceof WebGLTileBuilder || builder instanceof WebGPUTileBuilder) {
                incrementGpuAtlasCount(app);
            }
        },
        async processItem({ builder, item }) {
            frameNumber = item.frameNumber;
            absoluteFrameNumber = item.absoluteFrameNumber;
            app.frameNumber = frameNumber;
            app.trackFrame();

            const tileTiming = tilePhaseTimings[item.tileNumber];
            resumeDecodeTiming(tileTiming);

            const { frameIndex, frameCount } = getTileFrameProgress(item.tileNumber, item.frameNumber);
            updateTileProgress(item.tileNumber, {
                decodeProgress: frameCount > 0 ? frameIndex / frameCount : 1,
            });
            app.setStatus(`Tile ${item.tileNumber + 1}`, `Decoding frame ${frameIndex}/${frameCount}${formatProgressFps(app.fps)}`);
            updateProcessingStatus();

            builder.processFrame({
                videoFrame: item.videoFrame,
                frameNumber: item.frameNumber
            });

            return true;
        },
        async onItemProcessed({ builderKey, builder }) {
            // Snapshot the tile's layer 0 canvas for the static preview.
            // Must be AFTER processFrame so the canvas has the latest pixels.
            if (app.tileSnapshotPreview) {
                try {
                    const layerCanvas = builder.getCurrentPreviewCanvas();
                    if (layerCanvas) {
                        app.tileSnapshotPreview.snapshot(builderKey, layerCanvas);
                    }
                } catch (e) {
                    // Non-critical — don't let preview errors break processing
                }
            }

            resourceUsageReport();

            const tileTiming = tilePhaseTimings[builderKey] || null;
            if (queuedTileEncodeCount > 0 && tileBuilders[builderKey] === builder) {
                pauseDecodeTiming(tileTiming);
                app.setStatus(`Tile ${builderKey + 1}`, 'Queued for Decoding');
            }

            await waitForEncodeQueueHeadroomIfNeeded();
            return true;
        },
        onTileComplete: async ({ builderKey, builder, payload }) => {
            delete tileBuilders[builderKey];

            const { tileId = builderKey, canvasSet = null, readImages = null } = payload;
            const tileTiming = tilePhaseTimings[tileId] || null;
            const decodedFrameCount = getTileFrameCount(tileId);
            finalizeDecodeTiming(tileTiming);
            if (tileTiming) {
                tileTiming.decodedFrameCount = decodedFrameCount;
            }

            updateTileProgress(tileId, { decodeProgress: 1 });
            updateProcessingStatus();
            app.setStatus(`Tile ${tileId + 1}`, buildDecodeCompletedStatus({
                decodeDurationMs: tileTiming?.decodeDurationMs,
                decodedFrameCount,
            }));

            if (abortSignal.aborted) {
                return;
            }

            // Bake the live preview canvas to a static blob URL before the builder is disposed.
            if (app.tileSnapshotPreview) {
                try {
                    await app.tileSnapshotPreview.bake(tileId);
                } catch (e) {
                    // Non-critical
                }
            }

            try {
                await enqueueTileEncode(async () => {
                    if (abortSignal.aborted) return;

                    if (tileTiming) {
                        tileTiming.encodeStartedAt = performance.now();
                    }

                    // Let the KTX2 stage read directly from the completed atlas/canvases.
                    // The queue headroom rule keeps sampling only one tile ahead.
                    let images = [];
                    try {
                        images = typeof readImages === 'function'
                            ? await readImages()
                            : readCanvasSetImages(canvasSet);
                    } catch (error) {
                        console.error(`[VideoProcessor] Failed to read back tile ${tileId}:`, error);
                        app.setStatus(`Tile ${tileId + 1} Error`, error.message);
                        return;
                    }

                    if (tileId === 0 && images.length > 0) {
                        try {
                            const thumbnailBlob = await createThumbnailFromRGBA(images[0]);
                            app.set('thumbnailBlob', thumbnailBlob);
                        } catch (err) {
                            console.warn('[VideoProcessor] Failed to create thumbnail:', err);
                        }
                    }

                    if (images.length > 0) {
                        try {
                            console.log(`[KTX2] Encoding tile ${tileId} with ${images.length} layers (parallel)`);

                            let ktx2WorkerPool = getKtx2WorkerPool();
                            if (!ktx2WorkerPool) {
                                ktx2WorkerPool = registerKtx2WorkerPool(new KTX2WorkerPool(encodeConfig.layerWorkerCount));
                                await ktx2WorkerPool.init();
                                console.log(`[KTX2] Worker pool created with ${encodeConfig.layerWorkerCount} workers and will be reused for all tiles`);
                            }

                            currentEncodingStartedAt = performance.now();
                            app.setStatus(`Tile ${tileId + 1}`, `Encoding layer 0/${images.length}`);
                            updateProcessingStatus();

                            const onProgress = (layersEncoded, totalLayers, phase = 'encoding') => {
                                if (phase === 'assembling') {
                                    updateTileProgress(tileId, {
                                        encodeProgress: totalLayers > 0 ? 0.999 : 0.999,
                                    });
                                    app.setStatus(`Tile ${tileId + 1}`, 'Assembling KTX2 Layers');
                                    updateProcessingStatus();
                                    return;
                                }

                                const encodeProgress = totalLayers > 0
                                    ? (layersEncoded >= totalLayers ? 0.999 : layersEncoded / totalLayers)
                                    : 1;
                                updateTileProgress(tileId, {
                                    encodeProgress,
                                });
                                const elapsedSeconds = Math.max((performance.now() - currentEncodingStartedAt) / 1000, 0.001);
                                const encodingFps = layersEncoded / elapsedSeconds;
                                app.setStatus(`Tile ${tileId + 1}`, `Encoding layer ${layersEncoded}/${totalLayers}${formatProgressFps(encodingFps)}`);
                                updateProcessingStatus();
                            };

                            const ktx2Buffer = await KTX2Assembler.encodeParallelWithPool(ktx2WorkerPool, images, onProgress);
                            if (tileTiming && Number.isFinite(tileTiming.encodeStartedAt)) {
                                tileTiming.encodeDurationMs = Math.max(0, performance.now() - tileTiming.encodeStartedAt);
                            }
                            if (tileTiming) {
                                tileTiming.encodedLayerCount = images.length;
                            }
                            updateTileProgress(tileId, { encodeProgress: 1 });
                            const blob = new Blob([ktx2Buffer], { type: 'image/ktx2' });
                            app.registerBlobURL(tileId, blob);
                            app.setStatus(`Tile ${tileId + 1}`, buildTilePhaseSummaryStatus({
                                ...tileTiming,
                                decodedFrameCount,
                                encodedLayerCount: images.length,
                            }));
                            app.set('processingPhaseSummary', buildProcessingPhaseSummary(tilePhaseTimings));
                            updateProcessingStatus();

                            console.log(`[KTX2] Tile ${tileId} encoded: ${(blob.size / 1024).toFixed(1)}KB`);
                        } catch (error) {
                            updateProcessingStatus();
                            if (abortSignal.aborted || error.name === 'AbortError') {
                                return;
                            }
                            console.error(`[KTX2] Failed to encode tile ${tileId}:`, error);
                            app.setStatus(`Tile ${tileId + 1} Error`, error.message);
                        }
                    }

                    if (abortSignal.aborted) return;

                    completedTiles++;
                    updateProcessingStatus();

                    if (completedTiles === totalTiles) {
                        console.log(`[VideoProcessor] All ${completedTiles} tiles completed`);
                        app.removeStatus('Processing');
                        app.set('processingProgress', null);
                        app.removeStatus('Frame Range');
                        app.removeStatus('Seeking');
                        app.removeStatus('Decoding');
                        app.removeStatus('Interpolation');
                        app.removeStatus('System');
                        cleanupKTX2Workers();
                        const viewerStore = useViewerStore();
                        viewerStore.resumeViewer();
                    }
                });
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error(`[VideoProcessor] Failed to process queued tile ${tileId}:`, error);
                    app.setStatus(`Tile ${tileId + 1} Error`, error.message);
                }
            } finally {
                if (builder instanceof WebGLTileBuilder || builder instanceof WebGPUTileBuilder) {
                    decrementGpuAtlasCount(app);
                }

                builder.dispose?.();
                resourceUsageReport();
            }
        },
        onError(error) {
            console.error('[VideoProcessor] Error processing frame:', error);
            return false;
        }
    });

}

export { processVideo, cleanupKTX2Workers, abortProcessing }