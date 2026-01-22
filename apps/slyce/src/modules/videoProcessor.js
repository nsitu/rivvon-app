import { useAppStore } from '../stores/appStore';
import { Input, ALL_FORMATS, BlobSource, VideoSampleSink } from 'mediabunny';
import { resourceUsageReport } from './resourceMonitor.js';
import { encodeVideo } from './videoEncoder.js';
import { TileBuilder } from './tileBuilder.js';
import { KTX2Assembler } from './ktx2-assembler.js';
import { KTX2WorkerPool } from './ktx2-worker-pool.js';

// Singleton worker pool for KTX2 encoding (reused across all tiles)
let ktx2WorkerPool = null;

// Abort controller for cancelling processing
let abortController = null;

/**
 * Create a thumbnail blob from RGBA image data
 * Uses the first layer of the first tile as the thumbnail
 * @param {Object} imageData - { rgba: Uint8ClampedArray, width: number, height: number }
 * @param {Object} options - { maxSize: number, quality: number }
 * @returns {Promise<Blob>} - JPEG blob
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
};

const processVideo = async (settings) => {

    // Abort any previous processing
    abortProcessing();

    // Create new abort controller for this processing run
    abortController = new AbortController();
    const abortSignal = abortController.signal;

    let frameNumber = 0;

    const tileBuilders = {};  // to store builder for each tileNumber
    let completedTiles = 0;  // Track completed tiles 

    const {
        tilePlan,
        fileInfo,
        samplingMode,
        outputMode,
        config,
        crossSectionCount,
        crossSectionType
    } = settings

    const app = useAppStore()  // Pinia store 

    // go to the processing tab.
    app.set('currentTab', '2')
    app.set('readerIsFinished', false)

    // Calculate how many frames will actually be used vs skipped
    const lastTileEnd = tilePlan.tiles[tilePlan.tiles.length - 1].end;
    const framesUsed = lastTileEnd;
    const effectiveFrameCount = app.framesToSample > 0 ? Math.min(app.framesToSample, app.frameCount) : app.frameCount;
    const framesSkippedByTiling = effectiveFrameCount - framesUsed;
    const framesSkippedByLimit = app.frameCount - effectiveFrameCount;

    // Log upfront information about the processing plan
    if (framesSkippedByLimit > 0) {
        app.setStatus('Frame Limit', `Using ${effectiveFrameCount} of ${app.frameCount} total frames`);
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

    // Create mediabunny input and video sample sink
    const input = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(app.file),
    });

    const videoTrack = await input.getPrimaryVideoTrack();
    const sink = new VideoSampleSink(videoTrack);

    // Iterate through decoded video samples
    // VideoSampleSink automatically decodes frames using WebCodecs (non-blocking)
    for await (const videoSample of sink.samples()) {

        // Check if processing was aborted
        if (abortSignal.aborted) {
            console.log('[VideoProcessor] Processing aborted, stopping...');
            videoSample.close();
            break;
        }

        // Convert VideoSample to VideoFrame for compatibility with tileBuilder
        const videoFrame = videoSample.toVideoFrame();

        // Upfront downsampling: preprocess frame if strategy is 'upfront' and scaling is needed
        let processedFrame = videoFrame;
        let effectiveFileInfo = fileInfo;

        try {
            // Step 1: Apply cropping if enabled
            if (tilePlan.isCropping) {
                const cropCanvas = new OffscreenCanvas(tilePlan.cropWidth, tilePlan.cropHeight);
                const cropCtx = cropCanvas.getContext('2d');

                // Draw only the cropped region
                cropCtx.drawImage(videoFrame,
                    tilePlan.cropX, tilePlan.cropY, tilePlan.cropWidth, tilePlan.cropHeight,  // Source rect
                    0, 0, tilePlan.cropWidth, tilePlan.cropHeight                              // Dest rect
                );

                // Create new VideoFrame from cropped canvas
                processedFrame = new VideoFrame(cropCanvas, {
                    timestamp: videoFrame.timestamp
                });

                // Update fileInfo to reflect cropped dimensions
                effectiveFileInfo = {
                    ...fileInfo,
                    width: tilePlan.cropWidth,
                    height: tilePlan.cropHeight
                };

                // Clean up original frame
                videoFrame.close();
            }

            // Step 2: Apply scaling if needed (now operates on cropped frame)
            if (tilePlan.isScaled && app.downsampleStrategy === 'upfront') {
                // Calculate scale factor (maintains aspect ratio)
                const scaleFactor = tilePlan.scaleTo / tilePlan.scaleFrom;
                const scaledWidth = Math.floor(effectiveFileInfo.width * scaleFactor);
                const scaledHeight = Math.floor(effectiveFileInfo.height * scaleFactor);

                // Create temporary canvas for downsampling
                const tempCanvas = new OffscreenCanvas(scaledWidth, scaledHeight);
                const tempCtx = tempCanvas.getContext('2d');

                // Set image smoothing quality for better results
                tempCtx.imageSmoothingEnabled = true;
                tempCtx.imageSmoothingQuality = 'high';

                // Downsample entire frame (use processedFrame which may be cropped)
                tempCtx.drawImage(processedFrame,
                    0, 0, effectiveFileInfo.width, effectiveFileInfo.height,    // Source: effective frame
                    0, 0, scaledWidth, scaledHeight                              // Dest: scaled frame
                );

                // Store reference to frame that needs closing
                const frameToClose = processedFrame;

                // Create new VideoFrame from downsampled canvas
                processedFrame = new VideoFrame(tempCanvas, {
                    timestamp: frameToClose.timestamp
                });

                // Update fileInfo to reflect scaled dimensions
                effectiveFileInfo = {
                    ...effectiveFileInfo,
                    width: scaledWidth,
                    height: scaledHeight
                };

                // Clean up the previous frame (may be original or cropped)
                frameToClose.close();
            }

            frameNumber++;
            app.frameNumber = frameNumber;
            app.trackFrame();

            // Determine the tile number based on the frame number
            const tileNumber = tilePlan.tiles.findIndex(
                (tile) => frameNumber >= tile.start && frameNumber <= tile.end
            );

            if (tileNumber === -1) {
                // This frame is outside all tile ranges (remainder frames)
                // We already logged this upfront, so just skip silently
                processedFrame.close();
                videoSample.close();
                continue;
            }

            // if tile builder doesn't exist yet for this tile, create it
            if (!tileBuilders[tileNumber]) {
                tileBuilders[tileNumber] = new TileBuilder({
                    tileNumber,
                    tilePlan,
                    fileInfo: effectiveFileInfo,  // Use effectiveFileInfo instead of fileInfo
                    samplingMode,
                    outputMode,
                    crossSectionCount,
                    crossSectionType,
                    // Base wavelength on frames we actually process (up to lastTileEnd)
                    frameCount: framesUsed,
                    outputFormat: app.outputFormat  // Pass output format to TileBuilder
                });

                // listen for when the tile is complete
                tileBuilders[tileNumber].on('complete', async (payload) => {
                    delete tileBuilders[tileNumber];

                    const { images, kind } = payload;
                    const totalTiles = tilePlan.tiles.length;

                    // Capture thumbnail from first layer of first tile
                    if (tileNumber === 0 && kind === 'ktx2' && images.length > 0) {
                        try {
                            const thumbnailBlob = await createThumbnailFromRGBA(images[0]);
                            app.set('thumbnailBlob', thumbnailBlob);
                        } catch (err) {
                            console.warn('[VideoProcessor] Failed to create thumbnail:', err);
                        }
                    }

                    if (kind === 'ktx2') {
                        // KTX2 mode: Encode RGBA frames to KTX2 using parallel workers
                        try {
                            console.log(`[KTX2] Encoding tile ${tileNumber} with ${images.length} layers (parallel)`);

                            // Create worker pool if it doesn't exist yet (shared across all tiles)
                            if (!ktx2WorkerPool) {
                                ktx2WorkerPool = new KTX2WorkerPool();
                                await ktx2WorkerPool.init();
                                console.log(`[KTX2] Worker pool created and will be reused for all tiles`);
                            }

                            // Per-tile progress callback
                            const onProgress = (layersEncoded, totalLayers) => {
                                app.setStatus(`Tile ${tileNumber + 1}`, `Encoding layer ${layersEncoded} of ${totalLayers}`);
                            };

                            // Use parallel encoding with shared worker pool
                            const ktx2Buffer = await KTX2Assembler.encodeParallelWithPool(ktx2WorkerPool, images, onProgress);
                            const blob = new Blob([ktx2Buffer], { type: 'image/ktx2' });

                            // Register KTX2 blob URL using new helper
                            app.registerBlobURL('ktx2', tileNumber, blob);

                            // Remove per-tile status when this tile is done
                            app.removeStatus(`Tile ${tileNumber + 1}`);

                            console.log(`[KTX2] Tile ${tileNumber} encoded: ${(blob.size / 1024).toFixed(1)}KB`);
                        } catch (error) {
                            console.error(`[KTX2] Failed to encode tile ${tileNumber}:`, error);
                            app.setStatus(`Tile ${tileNumber + 1} Error`, error.message);
                        }
                    } else {
                        // WebM mode: Use existing video encoder
                        const blob = await encodeVideo(images, tilePlan, tileNumber, crossSectionType);
                        app.registerBlobURL('webm', tileNumber, blob);
                    }

                    // Track completion and cleanup when all tiles are done
                    completedTiles++;

                    // Update overall progress
                    app.setStatus('KTX2 Encoding', `Encoded ${completedTiles} of ${totalTiles} tiles`);

                    // Show next tile as 'Queued' if there are more tiles
                    if (completedTiles < totalTiles) {
                        app.setStatus(`Tile ${completedTiles + 1}`, 'Queued');
                    }

                    if (completedTiles === totalTiles) {
                        console.log(`[VideoProcessor] All ${completedTiles} tiles completed`);
                        // Remove all processing status messages
                        app.removeStatus('KTX2 Encoding');
                        app.removeStatus('Processing');
                        app.removeStatus('Frame Limit');
                        app.removeStatus('Decoding');
                        app.removeStatus('System');
                        // Cleanup KTX2 worker pool if it was used
                        if (app.outputFormat === 'ktx2') {
                            cleanupKTX2Workers();
                        }
                    }
                });
            }

            // process the frame within that tile builder (now uses scaled frame if upfront strategy)
            tileBuilders[tileNumber].processFrame({
                videoFrame: processedFrame,
                frameNumber
            });

            // Update resource usage
            // TODO: ensure that the worker reports
            // the Queue size 
            resourceUsageReport();

            // Note: videoFrame.close() is called by tileBuilder after drawing
            // Close the videoSample (separate from videoFrame)
            videoSample.close();

        } catch (error) {
            // If any error occurs, make sure to close the frames to prevent leaks
            console.error('[VideoProcessor] Error processing frame:', error);
            if (processedFrame && !processedFrame.closed) {
                processedFrame.close();
            }
            videoSample.close();
            throw error; // Re-throw to stop processing
        }

    }

}

export { processVideo, cleanupKTX2Workers, abortProcessing }