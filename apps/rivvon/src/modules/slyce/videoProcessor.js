import { useSlyceStore } from '../../stores/slyceStore';
import { useViewerStore } from '../../stores/viewerStore';
import { resourceUsageReport } from './resourceMonitor.js';
import { readCanvasSetImages } from './samplingRuntime.js';
import { TileBuilder } from './tileBuilder.js';
import { KTX2Assembler } from './ktx2-assembler.js';
import { KTX2WorkerPool } from './ktx2-worker-pool.js';
import { getSharedBackgroundEncodeConfig } from './encodingPolicy.js';
import { runSamplingPipeline } from './samplingPipeline.js';
import { VideoFileFrameSource } from './samplingSources.js';

// Singleton worker pool for KTX2 encoding (reused across all tiles)
let ktx2WorkerPool = null;

// Abort controller for cancelling processing
let abortController = null;

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

/**
 * Cleanup function to terminate the worker pool when done
 */
const cleanupKTX2Workers = () => {
    if (ktx2WorkerPool) {
        console.log('[KTX2] Cleaning up worker pool');
        ktx2WorkerPool.terminate();
        ktx2WorkerPool = null;
    }
};

/**
 * Abort any ongoing video processing
 */
const abortProcessing = () => {
    if (abortController) {
        console.log('[VideoProcessor] Aborting processing...');
        abortController.abort();
        abortController = null;
    }
    cleanupKTX2Workers();
    // Resume the viewer if it was suspended for processing
    try {
        const viewerStore = useViewerStore();
        viewerStore.resumeViewer();
    } catch (e) {
        // Store may not be initialized yet during early abort
    }
};

const processVideo = async (settings) => {

    // Abort any previous processing
    abortProcessing();

    // Suspend the viewer to free GPU/CPU resources for encoding
    const viewerStore = useViewerStore();
    const slyceStore = useSlyceStore();
    viewerStore.suspendViewer(true);

    // Create new abort controller for this processing run
    abortController = new AbortController();
    const abortSignal = abortController.signal;

    let frameNumber = 0;
    let absoluteFrameNumber = 0;

    const tileBuilders = {};  // to store builder for each tileNumber
    const encodedTileBlobs = {};
    let completedTiles = 0;  // Track completed tiles 

    const {
        tilePlan,
        fileInfo,
        samplingMode,
        config,
        crossSectionCount,
        crossSectionType
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

    // go to the processing tab.
    app.set('currentStep', '3')
    app.set('readerIsFinished', false)

    // Calculate how many frames will actually be used vs skipped
    const lastTileEnd = tilePlan.tiles[tilePlan.tiles.length - 1].end;
    const framesUsed = lastTileEnd;
    const effectiveFrameCount = app.framesToSample > 0 ? Math.min(app.framesToSample, app.frameCount) : app.frameCount;
    const frameStart = app.frameStart || 1;
    const frameEnd = app.frameEnd || app.frameCount;
    const framesSkippedByTiling = effectiveFrameCount - framesUsed;
    const framesSkippedByLimit = app.frameCount - effectiveFrameCount;

    // Log upfront information about the processing plan
    if (framesSkippedByLimit > 0) {
        app.setStatus('Frame Range', `Using frames ${frameStart}–${frameEnd} (${effectiveFrameCount} of ${app.frameCount} total)`);
    }
    if (framesSkippedByTiling > 0) {
        const skippedStart = lastTileEnd + 1;
        const skippedEnd = effectiveFrameCount;
        app.setStatus('Processing',
            `${tilePlan.tiles.length} tile(s) using frames 1-${lastTileEnd}. ` +
            `Frames ${skippedStart}-${skippedEnd} (${framesSkippedByTiling} frames) are outside tile boundaries and will be skipped.`);
    } else {
        app.setStatus('Processing', `${tilePlan.tiles.length} tile(s) using all ${framesUsed} frames.`);
    }

    // Initialize encoding status
    app.setStatus('KTX2 Encoding', `Encoded 0 of ${tilePlan.tiles.length} tiles`);
    app.setStatus('Tile 1', 'Queued');

    const source = new VideoFileFrameSource({
        file: app.file,
        fileInfo,
        tilePlan,
        frameStart,
        frameEnd,
        onSeekProgress(currentFrame) {
            app.setStatus('Seeking', `Skipping to frame ${frameStart} (at frame ${currentFrame})`);
        },
        onRangeStart() {
            app.removeStatus('Seeking');
        }
    });

    const encodeConfig = getSharedBackgroundEncodeConfig();
    let activeTileEncodeCount = 0;
    const tileEncodeWaiters = [];

    console.log(`[VideoProcessor] Encode policy: max ${encodeConfig.maxConcurrentTileEncodes} tile(s), ${encodeConfig.layerWorkerCount} layer worker(s) (${encodeConfig.reason})`);

    function acquireTileEncodeSlot() {
        if (abortSignal.aborted) {
            return Promise.reject(new DOMException('Video processing aborted.', 'AbortError'));
        }

        if (activeTileEncodeCount < encodeConfig.maxConcurrentTileEncodes) {
            activeTileEncodeCount++;
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            const resume = () => {
                cleanupAbort();
                activeTileEncodeCount++;
                resolve();
            };

            const onAbort = () => {
                cleanupAbort();
                const waiterIndex = tileEncodeWaiters.indexOf(resume);
                if (waiterIndex !== -1) {
                    tileEncodeWaiters.splice(waiterIndex, 1);
                }
                reject(new DOMException('Video processing aborted.', 'AbortError'));
            };

            const cleanupAbort = () => {
                abortSignal.removeEventListener('abort', onAbort);
            };

            abortSignal.addEventListener('abort', onAbort, { once: true });
            tileEncodeWaiters.push(resume);
        });
    }

    function releaseTileEncodeSlot() {
        activeTileEncodeCount = Math.max(0, activeTileEncodeCount - 1);

        while (tileEncodeWaiters.length > 0 && activeTileEncodeCount < encodeConfig.maxConcurrentTileEncodes) {
            const resume = tileEncodeWaiters.shift();
            resume();
        }
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
            return new TileBuilder({
                        tileNumber,
                        tilePlan,
                        fileInfo: item.effectiveFileInfo,
                        samplingMode,
                        crossSectionCount,
                        crossSectionType,
                        // Base wavelength on frames we actually process (up to lastTileEnd)
                        frameCount: framesUsed,
                        outputFormat: app.outputFormat  // Pass output format to TileBuilder
                    });
        },
        onBuilderCreated({ builderKey, builder }) {
            tileBuilders[builderKey] = builder;
        },
        async processItem({ builder, item }) {
            frameNumber = item.frameNumber;
            absoluteFrameNumber = item.absoluteFrameNumber;
            app.frameNumber = frameNumber;
            app.trackFrame();

            builder.processFrame({
                videoFrame: item.videoFrame,
                frameNumber: item.frameNumber
            });

            return true;
        },
        onItemProcessed({ builderKey, builder }) {
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
            return true;
        },
        onTileComplete: async ({ builderKey, payload }) => {
            delete tileBuilders[builderKey];

            const { tileId = builderKey, canvasSet } = payload;
            const totalTiles = tilePlan.tiles.length;
            let images = [];

            app.setStatus(`Tile ${tileId + 1}`, 'Queued');

            try {
                await acquireTileEncodeSlot();
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error(`[VideoProcessor] Failed to queue tile ${tileId}:`, error);
                }
                return;
            }

            try {
                if (abortSignal.aborted) return;

                // Bake the live preview canvas to a static blob URL
                if (app.tileSnapshotPreview) {
                    try {
                        await app.tileSnapshotPreview.bake(tileId);
                    } catch (e) {
                        // Non-critical
                    }
                }

                try {
                    images = readCanvasSetImages(canvasSet);
                } catch (error) {
                    console.error(`[VideoProcessor] Failed to read back tile ${tileId}:`, error);
                    app.setStatus(`Tile ${tileId + 1} Error`, error.message);
                }

                if (abortSignal.aborted) return;

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

                        if (!ktx2WorkerPool) {
                            ktx2WorkerPool = new KTX2WorkerPool(encodeConfig.layerWorkerCount);
                            await ktx2WorkerPool.init();
                            console.log(`[KTX2] Worker pool created with ${encodeConfig.layerWorkerCount} workers and will be reused for all tiles`);
                        }

                        const onProgress = (layersEncoded, totalLayers) => {
                            app.setStatus(`Tile ${tileId + 1}`, `Encoding layer ${layersEncoded} of ${totalLayers}`);
                        };

                        const ktx2Buffer = await KTX2Assembler.encodeParallelWithPool(ktx2WorkerPool, images, onProgress);
                        const blob = new Blob([ktx2Buffer], { type: 'image/ktx2' });
                        encodedTileBlobs[tileId] = blob;
                        app.registerBlobURL(tileId, blob);
                        app.removeStatus(`Tile ${tileId + 1}`);

                        console.log(`[KTX2] Tile ${tileId} encoded: ${(blob.size / 1024).toFixed(1)}KB`);
                    } catch (error) {
                        if (abortSignal.aborted || error.name === 'AbortError') {
                            return;
                        }
                        console.error(`[KTX2] Failed to encode tile ${tileId}:`, error);
                        app.setStatus(`Tile ${tileId + 1} Error`, error.message);
                    }
                }

                if (abortSignal.aborted) return;

                completedTiles++;
                app.setStatus('KTX2 Encoding', `Encoded ${completedTiles} of ${totalTiles} tiles`);

                if (completedTiles === totalTiles) {
                    console.log(`[VideoProcessor] All ${completedTiles} tiles completed`);
                    app.removeStatus('KTX2 Encoding');
                    app.removeStatus('Processing');
                    app.removeStatus('Frame Range');
                    app.removeStatus('Seeking');
                    app.removeStatus('Decoding');
                    app.removeStatus('System');
                    cleanupKTX2Workers();
                    const viewerStore = useViewerStore();
                    viewerStore.resumeViewer();
                }
            } finally {
                releaseTileEncodeSlot();
            }
        },
        onError(error) {
            console.error('[VideoProcessor] Error processing frame:', error);
            return false;
        }
    });

}

export { processVideo, cleanupKTX2Workers, abortProcessing }