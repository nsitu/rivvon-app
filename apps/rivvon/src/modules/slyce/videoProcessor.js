import { useSlyceStore } from '../../stores/slyceStore';
import { useViewerStore } from '../../stores/viewerStore';
import { resourceUsageReport } from './resourceMonitor.js';
import { readCanvasSetImages } from './samplingRuntime.js';
import { TileBuilder } from './tileBuilder.js';
import { WebGLTileBuilder } from './webglTileBuilder.js';
import { KTX2Assembler } from './ktx2-assembler.js';
import { KTX2WorkerPool } from './ktx2-worker-pool.js';
import { getSharedBackgroundEncodeConfig } from './encodingPolicy.js';
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
        builderType: 'canvas2d',
        builderLabel: 'Canvas 2D',
        note,
    };
}

function createWebGL2Telemetry(report, builderSettings) {
    const layout = report?.layout;
    const sourceWidth = builderSettings.fileInfo?.width ?? 0;
    const sourceHeight = builderSettings.fileInfo?.height ?? 0;

    if (!layout) {
        return {
            builderType: 'webgl2',
            builderLabel: 'WebGL2',
            note: 'Atlas layout unavailable.',
        };
    }

    const estimatedAtlasBytes = layout.width * layout.height * 4;
    const estimatedSourceTextureBytes = sourceWidth * sourceHeight * 4;

    return {
        builderType: 'webgl2',
        builderLabel: 'WebGL2 Atlas',
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

function updateWebGL2Telemetry(app, updater) {
    const current = app.processingResourceTelemetry;
    if (!current || current.builderType !== 'webgl2') {
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

function incrementWebGL2AtlasCount(app) {
    updateWebGL2Telemetry(app, current => {
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

function decrementWebGL2AtlasCount(app) {
    updateWebGL2Telemetry(app, current => {
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

const processVideo = async (settings) => {

    // Abort any previous processing
    abortProcessing();

    // Suspend the viewer to free GPU/CPU resources for encoding
    const viewerStore = useViewerStore();
    const slyceStore = useSlyceStore();
    viewerStore.suspendViewer(true);

    // Create new abort controller for this processing run
    const abortController = createProcessingAbortController();
    const abortSignal = abortController.signal;

    let frameNumber = 0;
    let absoluteFrameNumber = 0;

    const tileBuilders = {};  // to store builder for each tileNumber
    let completedTiles = 0;  // Track completed tiles 

    const {
        tilePlan,
        fileInfo,
        samplingMode,
        config,
        crossSectionCount,
        crossSectionType,
        useWebGL2Builder = true,
    } = settings

    const app = useSlyceStore()  // Pinia store 
    const localSave = app.getLocalSaveController();
    const publish = app.getPublishController();

    // Store tilePlan so TilePreview and other consumers can access it
    app.set('tilePlan', tilePlan);
    localSave.resetLocalSaveState();
    publish.resetPublishState();
    app.set('autoDeriveResolutions', []);
    app.set('publishDestination', 'google-drive');
    app.set('thumbnailBlob', null);
    app.set('processingResourceTelemetry', null);
    app.set('processingProgress', null);

    // go to the processing tab.
    app.set('currentStep', '3')
    app.set('readerIsFinished', false)

    // Calculate how many frames will actually be used vs skipped
    const totalTiles = tilePlan.tiles.length;
    const lastTileEnd = tilePlan.tiles[totalTiles - 1].end;
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
        tilePlan,
        frameStart,
        frameEnd,
        frameInterpolationFactor: settings.frameInterpolationFactor ?? app.effectiveInterpolationFactor,
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
    let sampledTileBuilderType = null;
    let webglSupportReport = null;
    let currentEncodingStartedAt = 0;
    const tileProgress = tilePlan.tiles.map(() => ({
        decodeProgress: 0,
        encodeProgress: 0,
    }));
    const seenProcessingLegendStates = {
        queued: false,
        decoding: false,
        encoding: false,
        complete: false,
    };

    const processingProgressWeights = {
        decode: 0.35,
        encode: 0.65,
    };

    console.log(`[VideoProcessor] Encode policy: max ${encodeConfig.maxConcurrentTileEncodes} tile(s), ${encodeConfig.layerWorkerCount} layer worker(s) (${encodeConfig.reason})`);

    function getTileFrameProgress(tileNumber, frameNumber) {
        const tile = tilePlan.tiles[tileNumber];
        const frameCount = Math.max(1, tile.end - tile.start + 1);
        const frameIndex = Math.min(frameCount, Math.max(1, frameNumber - tile.start + 1));
        return { frameIndex, frameCount };
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
        createBuilder(item, tileNumber) {
            const builderSettings = {
                tileNumber,
                tilePlan,
                fileInfo: item.effectiveFileInfo,
                samplingMode,
                crossSectionCount,
                crossSectionType,
                // Base wavelength on frames we actually process (up to lastTileEnd)
                frameCount: framesUsed,
                outputFormat: app.outputFormat,
            };

            if (sampledTileBuilderType === null) {
                if (!useWebGL2Builder) {
                    sampledTileBuilderType = 'canvas2d';
                    app.set('processingResourceTelemetry', createCanvasTelemetry('No GPU atlas allocated for tile assembly.'));
                    console.log('[VideoProcessor] WebGL2 tile builder disabled; using 2D canvas sampling.');
                } else {
                    webglSupportReport = WebGLTileBuilder.getSupportReport(builderSettings);
                    if (webglSupportReport.supported) {
                        sampledTileBuilderType = 'webgl2';
                        app.set('processingResourceTelemetry', createWebGL2Telemetry(webglSupportReport, builderSettings));
                        console.log(`[VideoProcessor] Using WebGL2 tile builder (${webglSupportReport.reason})`);
                    } else {
                        sampledTileBuilderType = 'canvas2d';
                        app.set('processingResourceTelemetry', createCanvasTelemetry(`WebGL2 unavailable: ${webglSupportReport.reason}`));
                        console.warn(`[VideoProcessor] WebGL2 tile builder unavailable (${webglSupportReport.reason}); falling back to 2D canvas sampling.`);
                    }
                }
            }

            if (sampledTileBuilderType === 'webgl2') {
                try {
                    return new WebGLTileBuilder({
                        ...builderSettings,
                        supportReport: webglSupportReport,
                    });
                } catch (error) {
                    sampledTileBuilderType = 'canvas2d';
                    app.set('processingResourceTelemetry', createCanvasTelemetry('WebGL2 initialization failed; using canvas assembly.'));
                    console.warn('[VideoProcessor] Failed to initialize WebGL2 tile builder; falling back to 2D canvas sampling:', error);
                }
            }

            return new TileBuilder(builderSettings);
        },
        onBuilderCreated({ builderKey, builder }) {
            tileBuilders[builderKey] = builder;

            if (builder instanceof WebGLTileBuilder) {
                incrementWebGL2AtlasCount(app);
            }
        },
        async processItem({ builder, item }) {
            frameNumber = item.frameNumber;
            absoluteFrameNumber = item.absoluteFrameNumber;
            app.frameNumber = frameNumber;
            app.trackFrame();

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

            if (queuedTileEncodeCount > 0 && tileBuilders[builderKey] === builder) {
                app.setStatus(`Tile ${builderKey + 1}`, 'Queued for Decoding');
            }

            await waitForEncodeQueueHeadroomIfNeeded();
            return true;
        },
        onTileComplete: async ({ builderKey, builder, payload }) => {
            delete tileBuilders[builderKey];

            const { tileId = builderKey, canvasSet = null, readImages = null } = payload;

            updateTileProgress(tileId, { decodeProgress: 1 });
            updateProcessingStatus();
            app.setStatus(`Tile ${tileId + 1}`, 'Ready for Encoding');

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
                            updateTileProgress(tileId, { encodeProgress: 1 });
                            const blob = new Blob([ktx2Buffer], { type: 'image/ktx2' });
                            app.registerBlobURL(tileId, blob);
                            app.setStatus(`Tile ${tileId + 1}`, 'Complete');
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
                if (builder instanceof WebGLTileBuilder) {
                    decrementWebGL2AtlasCount(app);
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