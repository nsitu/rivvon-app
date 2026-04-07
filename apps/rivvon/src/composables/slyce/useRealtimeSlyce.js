/**
 * useRealtimeSlyce — Orchestrator composable for realtime webcam mode.
 *
 * Singleton pattern: all state lives at module scope so every call to
 * useRealtimeSlyce() returns the same shared refs. This allows
 * RealtimeSampler.vue (captures) and RibbonView.vue (applies) to
 * share the accumulated KTX2 buffers.
 *
 * Fully decoupled from the viewer during capture. Wires together:
 * RealtimeCamera → RealtimeTileBuilder → KTX2 encoding → buffer accumulation.
 *
 * Tile lifecycle: building → encoding → complete (buffer stored)
 * FIFO eviction when completedTiles >= maxTiles.
 */

import { ref, shallowRef, computed, onUnmounted } from 'vue';
import { RealtimeTileBuilder } from '../../modules/slyce/realtimeTileBuilder.js';
import { KTX2WorkerPool } from '../../modules/slyce/ktx2-worker-pool.js';
import { KTX2Assembler } from '../../modules/slyce/ktx2-assembler.js';
import { getCached2dContext, readCanvasSetImages } from '../../modules/slyce/samplingRuntime.js';
import { runSamplingPipeline } from '../../modules/slyce/samplingPipeline.js';
import { CameraFrameSource } from '../../modules/slyce/samplingSources.js';
import { createRefLocalSaveController } from '../../modules/slyce/localSaveController.js';
import { saveProcessedTextureSetLocally } from '../../modules/slyce/localTexturePersistence.js';

const DEFAULT_CROSS_SECTION_COUNT = 30;
const MIN_CROSS_SECTION_COUNT = 1;
const MAX_CROSS_SECTION_COUNT = 240;

function clampCrossSectionCount(count) {
    const parsed = Number(count);
    if (!Number.isFinite(parsed)) return DEFAULT_CROSS_SECTION_COUNT;
    return Math.min(MAX_CROSS_SECTION_COUNT, Math.max(MIN_CROSS_SECTION_COUNT, Math.round(parsed)));
}

function createPerfSnapshot() {
    return {
        frameIntervalMs: 0,
        samplingMs: 0,
        previewMs: 0,
        readbackMs: 0,
        encodeQueueMs: 0,
        encodeMs: 0
    };
}

function createPerfAccumulator() {
    return {
        frameIntervalTotal: 0,
        frameIntervalCount: 0,
        samplingTotal: 0,
        samplingCount: 0,
        previewTotal: 0,
        previewCount: 0,
        readbackTotal: 0,
        readbackCount: 0,
        encodeQueueTotal: 0,
        encodeQueueCount: 0,
        encodeTotal: 0,
        encodeCount: 0
    };
}

function averageMs(total, count) {
    if (count === 0) return 0;
    return Math.round((total / count) * 10) / 10;
}

function createPerfSnapshotFromAccumulator(accumulator) {
    return {
        frameIntervalMs: averageMs(accumulator.frameIntervalTotal, accumulator.frameIntervalCount),
        samplingMs: averageMs(accumulator.samplingTotal, accumulator.samplingCount),
        previewMs: averageMs(accumulator.previewTotal, accumulator.previewCount),
        readbackMs: averageMs(accumulator.readbackTotal, accumulator.readbackCount),
        encodeQueueMs: averageMs(accumulator.encodeQueueTotal, accumulator.encodeQueueCount),
        encodeMs: averageMs(accumulator.encodeTotal, accumulator.encodeCount)
    };
}

// ── Shared reactive state (module-level singleton) ─────────────────
const isCameraActive = ref(false);
const isCapturing = ref(false);
const currentTileIndex = ref(0);
const currentRow = ref(0);
const completedTiles = ref(0);
const encodingTiles = ref(0);
const maxTiles = ref(16);
const potResolution = ref(256);
const crossSectionCount = ref(DEFAULT_CROSS_SECTION_COUNT);
const fps = ref(0);
const cameraResolution = ref('240p');
const cameraFacingMode = ref('user');
const crossSectionType = ref('waves');  // 'planes' or 'waves'
const targetTileCount = ref(4);          // how many tiles to capture in waves mode
const globalFrameIndex = ref(0);         // total frames processed (for countdown)
// Sampling screen state
const cameraStream = shallowRef(null);           // MediaStream for <video> binding
const cameraFrameRate = ref(null);                // Actual camera FPS (from getSettings)
const currentPreviewCanvas = shallowRef(null);    // Live-building canvas (first layer)
const completedKtx2Buffers = ref([]);              // KTX2 ArrayBuffers for handoff
const perfStats = ref(createPerfSnapshot());
const localSave = createRefLocalSaveController();
const isSavingLocally = localSave.isSavingLocally;
const saveLocalProgress = localSave.saveLocalProgress;
const saveLocalError = localSave.saveLocalError;
const savedLocalTextureId = localSave.savedLocalTextureId;

// Unified tile grid: encoding + completed tiles in display order
// Each entry: { id, canvas, status: 'encoding'|'completed', layer, layerTotal }
const gridTiles = ref([]);

// ── Shared internal state ──────────────────────────────────────────
let cameraSource = null;
let tileBuilder = null;
let workerPool = null;
let frameLoopAbort = null;
let hasStartedOnce = false;

// Generation counter — incremented on each startRealtime() to invalidate
// in-flight encodes from previous sessions.
let captureGeneration = 0;

// Realtime mode is intentionally conservative: keep only one tile encode in
// flight and one worker active so capture stays closer to camera rate on
// lower-powered devices. File-mode processing uses its own worker strategy.
const REALTIME_MAX_CONCURRENT_ENCODES = 1;
const REALTIME_WORKER_COUNT = 1;

// Ordered list of completed tile IDs for FIFO eviction
const completedTileIds = [];

// FPS tracking
let frameCount = 0;
let lastFpsTime = 0;
let lastFrameStartTime = 0;
let perfWindowStart = 0;
let perfAccumulator = createPerfAccumulator();
let perfSessionAccumulator = createPerfAccumulator();
let autoSaveRequestedGeneration = 0;
let currentCaptureName = '';
let currentThumbnailBlob = null;

export function useRealtimeSlyce() {

    function createThumbnailFromCanvas(canvas, options = {}) {
        const { maxSize = 512, quality = 0.85 } = options;
        const width = canvas.width;
        const height = canvas.height;

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

        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = thumbWidth;
        thumbCanvas.height = thumbHeight;
        const thumbCtx = getCached2dContext(thumbCanvas);
        if (!thumbCtx) {
            throw new Error('Unable to acquire thumbnail canvas context.');
        }

        thumbCtx.imageSmoothingEnabled = true;
        thumbCtx.imageSmoothingQuality = 'high';
        thumbCtx.drawImage(canvas, 0, 0, thumbWidth, thumbHeight);

        return new Promise((resolve, reject) => {
            thumbCanvas.toBlob(blob => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('Failed to create realtime thumbnail blob.'));
                }
            }, 'image/jpeg', quality);
        });
    }

    function snapshotKtx2BlobsFromBuffers() {
        const blobs = {};
        for (let i = 0; i < completedKtx2Buffers.value.length; i++) {
            blobs[i] = new Blob([completedKtx2Buffers.value[i]], { type: 'image/ktx2' });
        }
        return blobs;
    }

    function buildRealtimeSourceMetadata() {
        const trackSettings = cameraStream.value?.getVideoTracks?.()[0]?.getSettings?.() ?? {};
        const effectiveFps = cameraFrameRate.value || fps.value || 30;
        return {
            filename: currentCaptureName,
            width: trackSettings.width ?? null,
            height: trackSettings.height ?? null,
            duration: globalFrameIndex.value > 0 ? globalFrameIndex.value / effectiveFps : 0,
            frame_count: globalFrameIndex.value,
            frame_rate: effectiveFps,
            source: 'realtime-camera',
        };
    }

    async function persistResultsLocally(force = false) {
        if (completedKtx2Buffers.value.length === 0) return null;

        if (!force) {
            if (isCapturing.value || encodingTiles.value > 0) return null;
            if (isSavingLocally.value || savedLocalTextureId.value || autoSaveRequestedGeneration === captureGeneration) {
                return savedLocalTextureId.value;
            }
            autoSaveRequestedGeneration = captureGeneration;
        }

        return saveProcessedTextureSetLocally(
            localSave.controller,
            {
                ktx2Blobs: snapshotKtx2BlobsFromBuffers(),
                textureName: currentCaptureName,
                effectiveFrameCount: globalFrameIndex.value,
                tileCount: completedKtx2Buffers.value.length,
                tileResolution: potResolution.value,
                layerCount: crossSectionCount.value,
                crossSectionType: crossSectionType.value,
                thumbnailBlob: currentThumbnailBlob,
                sourceMetadata: buildRealtimeSourceMetadata(),
            }
        );
    }

    function maybePersistResultsLocally() {
        if (isCapturing.value || encodingTiles.value > 0 || completedKtx2Buffers.value.length === 0) return;
        void persistResultsLocally(false);
    }

    function hasPerfSamples(accumulator = perfAccumulator) {
        return accumulator.frameIntervalCount > 0
            || accumulator.samplingCount > 0
            || accumulator.previewCount > 0
            || accumulator.readbackCount > 0
            || accumulator.encodeQueueCount > 0
            || accumulator.encodeCount > 0;
    }

    function resetPerfInstrumentation(now = performance.now()) {
        perfStats.value = createPerfSnapshot();
        perfAccumulator = createPerfAccumulator();
        perfSessionAccumulator = createPerfAccumulator();
        perfWindowStart = now;
        lastFrameStartTime = 0;
    }

    function publishPerfStats(now = performance.now()) {
        if (!hasPerfSamples()) {
            perfWindowStart = now;
            return;
        }

        perfStats.value = createPerfSnapshotFromAccumulator(perfAccumulator);

        perfAccumulator = createPerfAccumulator();
        perfWindowStart = now;
    }

    function recordPerfMetric(metric, duration, now = performance.now()) {
        if (!Number.isFinite(duration) || duration < 0) return;

        const totalKey = `${metric}Total`;
        const countKey = `${metric}Count`;
        if (!(totalKey in perfAccumulator) || !(countKey in perfAccumulator)) return;

        perfAccumulator[totalKey] += duration;
        perfAccumulator[countKey] += 1;
        perfSessionAccumulator[totalKey] += duration;
        perfSessionAccumulator[countKey] += 1;

        if (perfWindowStart === 0) {
            perfWindowStart = now;
        } else if (now - perfWindowStart >= 1000) {
            publishPerfStats(now);
        }
    }

    function recordPreviewFrame(duration) {
        if (!isCapturing.value) return;
        recordPerfMetric('preview', duration);
    }

    // ── Resource detection ─────────────────────────────────────────────

    function detectDefaults() {
        const cores = navigator.hardwareConcurrency || 4;
        const memory = navigator.deviceMemory || 8;

        if (cores < 4 || memory < 4) {
            potResolution.value = 128;
            maxTiles.value = 8;
            console.log('[RealtimeSlyce] Low-spec device detected — using 128² tiles, max 8');
        }
    }

    // ── Camera lifecycle (independent of capture) ───────────────────────

    /**
     * Start the webcam so the user can preview / flip before sampling.
     */
    async function startCamera() {
        if (cameraSource) return; // already running

        if (!hasStartedOnce) {
            detectDefaults();
            hasStartedOnce = true;
        }

        cameraSource = new CameraFrameSource({
            resolution: cameraResolution.value,
            facingMode: cameraFacingMode.value,
        });
        await cameraSource.start();
        cameraStream.value = cameraSource.getMediaStream();
        cameraFrameRate.value = cameraSource.frameRate;
        isCameraActive.value = true;
        console.log(`[RealtimeSlyce] Camera started (${cameraResolution.value}, ${cameraFrameRate.value}fps, facing=${cameraFacingMode.value})`);
    }

    /**
     * Stop the webcam and release resources.
     */
    function stopCamera() {
        if (cameraSource) {
            cameraSource.stop();
            cameraSource = null;
        }
        cameraStream.value = null;
        cameraFrameRate.value = null;
        isCameraActive.value = false;
    }

    // ── Start / Stop capture ───────────────────────────────────────────

    /**
     * Start realtime capture and processing.
     * Camera must already be running via startCamera().
     */
    async function startRealtime() {
        if (isCapturing.value) return;
        if (!cameraSource) {
            console.warn('[RealtimeSlyce] Cannot start capture — camera not running');
            return;
        }

        // Bump generation so any in-flight encodes from a previous session
        // will silently discard their results instead of touching current state.
        captureGeneration++;
        autoSaveRequestedGeneration = 0;
        currentCaptureName = `realtime-${new Date().toISOString().replace(/[.:]/g, '-')}`;
        // Kill any orphaned worker pool from a previous session
        if (workerPool) {
            workerPool.terminate();
            workerPool = null;
        }

        // Clear previous results
        completedKtx2Buffers.value = [];
        gridTiles.value = [];
        completedTileIds.length = 0;
        currentThumbnailBlob = null;
        localSave.resetLocalSaveState();

        const isWave = crossSectionType.value === 'waves';
        const totalFrames = isWave
            ? potResolution.value * targetTileCount.value
            : null;
        tileBuilder = null;

        // Realtime mode uses a single worker so worker-side Basis encoding does
        // not compete as aggressively with live sampling on constrained devices.
        workerPool = new KTX2WorkerPool(REALTIME_WORKER_COUNT);
        await workerPool.init();

        isCapturing.value = true;
        currentTileIndex.value = 0;
        currentRow.value = 0;
        completedTiles.value = 0;
        encodingTiles.value = 0;
        globalFrameIndex.value = 0;
        frameCount = 0;
        lastFpsTime = performance.now();
        resetPerfInstrumentation(lastFpsTime);

        // Start frame loop
        frameLoopAbort = new AbortController();
        runFrameLoop(frameLoopAbort.signal);

        console.log(`[RealtimeSlyce] Started: ${potResolution.value}² tiles, layers=${crossSectionCount.value}, max ${maxTiles.value}, camera=${cameraResolution.value}, type=${crossSectionType.value}${isWave ? ', totalFrames=' + totalFrames : ''}`);
    }

    /**
     * Stop realtime capture. Preserves completed KTX2 buffers for Apply.
     * Camera keeps running so the user can start another capture.
     */
    async function stopRealtime() {
        if (!isCapturing.value) return;
        isCapturing.value = false;

        const samplingMode = tileBuilder?.samplingSourceMode ?? 'unknown';
        const expectedTileCount = crossSectionType.value === 'waves'
            ? targetTileCount.value
            : maxTiles.value;
        const pendingEncodeCount = encodingTiles.value;

        // Abort frame loop
        if (frameLoopAbort) {
            frameLoopAbort.abort();
            frameLoopAbort = null;
        }

        publishPerfStats();

        const stats = createPerfSnapshotFromAccumulator(perfSessionAccumulator);
        if (hasPerfSamples(perfSessionAccumulator)) {
            console.log(
                `[RealtimeSlyce] Perf summary (${samplingMode}): `
                + `frame=${stats.frameIntervalMs.toFixed(1)}ms, `
                + `sample=${stats.samplingMs.toFixed(1)}ms/frame, `
                + `preview=${stats.previewMs.toFixed(1)}ms/raf, `
                + `readback=${stats.readbackMs.toFixed(1)}ms/tile, `
                + `queue=${stats.encodeQueueMs.toFixed(1)}ms/tile, `
                + `encode=${stats.encodeMs.toFixed(1)}ms/tile`
            );
        }

        currentPreviewCanvas.value = null;

        // Clean up tile builder
        if (tileBuilder) {
            tileBuilder.dispose();
            tileBuilder = null;
        }

        // Keep the worker pool alive so in-flight encodes can finish.
        // The pool will be terminated by encodeAndFinalise once all
        // pending encodes drain (encodingTiles reaches 0).
        // If nothing is encoding, terminate immediately.
        if (workerPool && encodingTiles.value === 0) {
            workerPool.terminate();
            workerPool = null;
        }

        maybePersistResultsLocally();

        if (crossSectionType.value === 'waves' && completedKtx2Buffers.value.length < expectedTileCount) {
            if (pendingEncodeCount > 0) {
                console.log(`[RealtimeSlyce] Wave capture sampled all frames; waiting for ${pendingEncodeCount} tile encode(s) to finish (${completedKtx2Buffers.value.length}/${expectedTileCount} ready).`);
            } else {
                console.warn(`[RealtimeSlyce] Waves capture stopped early: ${completedKtx2Buffers.value.length}/${expectedTileCount} tiles encoded.`);
            }
        }

        console.log(`[RealtimeSlyce] Stopped. ${completedKtx2Buffers.value.length} KTX2 buffers ready, ${encodingTiles.value} still encoding.`);
    }

    // ── Frame loop ─────────────────────────────────────────────────────

    async function runFrameLoop(signal) {
        await runSamplingPipeline({
            source: cameraSource,
            signal,
            getBuilderKey() {
                return 'realtime';
            },
            createBuilder() {
                const isWave = crossSectionType.value === 'waves';
                const totalFrames = isWave
                    ? potResolution.value * targetTileCount.value
                    : null;

                return new RealtimeTileBuilder({
                    potResolution: potResolution.value,
                    crossSectionCount: crossSectionCount.value,
                    crossSectionType: crossSectionType.value,
                    totalFrames
                });
            },
            async onBuilderCreated({ builder }) {
                tileBuilder = builder;
            },
            async processItem({ builder, item }) {
                const frame = item.videoFrame;
                const frameStart = performance.now();
                if (lastFrameStartTime !== 0) {
                    recordPerfMetric('frameInterval', frameStart - lastFrameStartTime, frameStart);
                }
                lastFrameStartTime = frameStart;

                // Process frame (tile builder handles sampling + close)
                const samplingStart = performance.now();
                builder.processFrame(frame);
                const samplingEnd = performance.now();
                recordPerfMetric('sampling', samplingEnd - samplingStart, samplingEnd);

                return true;
            },
            onItemProcessed({ builder }) {

                // Expose current preview canvas AFTER processFrame so the
                // ref always tracks the active canvas set (avoids exposing
                // a just-completed canvas that has stale pixels).
                if (builder) {
                    currentPreviewCanvas.value = builder.getCurrentPreviewCanvas();
                }

                // Update reactive state
                currentTileIndex.value = builder.currentTileId;
                currentRow.value = builder.currentRow;
                globalFrameIndex.value = builder.globalFrameIndex;

                // Auto-stop in waves mode when all frames have been captured
                if (builder.isComplete) {
                    console.log('[RealtimeSlyce] Wave capture complete — all target frames sampled.');
                    stopRealtime();
                    return false;
                }

                // FPS tracking
                frameCount++;
                const now = performance.now();
                if (now - lastFpsTime >= 1000) {
                    fps.value = Math.round(frameCount * 1000 / (now - lastFpsTime));
                    frameCount = 0;
                    lastFpsTime = now;
                }

                return true;
            },
            onTileComplete({ payload }) {
                handleTileComplete(payload);
            },
            retainBuilderOnComplete: true,
            onError(err) {
                if (err.name !== 'AbortError') {
                    console.error('[RealtimeSlyce] Frame loop error:', err);
                }
                return true;
            }
        });
    }

    // ── Tile completion handler ────────────────────────────────────────

    // Encoding concurrency gate — resolvers waiting for a slot
    let encodeSlots = REALTIME_MAX_CONCURRENT_ENCODES;
    const encodeWaiters = [];

    function acquireEncodeSlot() {
        if (encodeSlots > 0) {
            encodeSlots--;
            return Promise.resolve();
        }
        return new Promise(resolve => encodeWaiters.push(resolve));
    }

    function releaseEncodeSlot() {
        if (encodeWaiters.length > 0) {
            encodeWaiters.shift()();
        } else {
            encodeSlots++;
        }
    }

    function handleTileComplete(payload) {
        const { tileId, canvasSet } = payload;
        const gen = captureGeneration;

        encodingTiles.value++;

        // Snapshot the first canvas layer for the tile grid
        const previewCanvas = document.createElement('canvas');
        previewCanvas.width = canvasSet[0].width;
        previewCanvas.height = canvasSet[0].height;
        const previewCtx = getCached2dContext(previewCanvas);
        if (previewCtx) {
            previewCtx.drawImage(canvasSet[0], 0, 0);
        }

        if (tileId === 0 && !currentThumbnailBlob) {
            void createThumbnailFromCanvas(previewCanvas).then(blob => {
                if (gen === captureGeneration && !currentThumbnailBlob) {
                    currentThumbnailBlob = blob;
                }
            }).catch(err => {
                console.warn('[RealtimeSlyce] Failed to create local thumbnail:', err);
            });
        }

        // Add to unified grid immediately as encoding
        gridTiles.value.push({
            id: tileId, canvas: previewCanvas,
            status: 'encoding', layer: 0, layerTotal: canvasSet.length
        });
        // Grab the reactive proxy so mutations trigger updates
        const gridEntry = gridTiles.value[gridTiles.value.length - 1];

        encodeAndFinalise(gen, tileId, canvasSet, gridEntry);
    }

    async function encodeAndFinalise(gen, tileId, canvasSet, gridEntry) {
        // Wait for a slot so we never saturate the main thread with
        // concurrent ktx-parse assembly work.
        const queueStart = performance.now();
        await acquireEncodeSlot();
        const queueEnd = performance.now();
        recordPerfMetric('encodeQueue', queueEnd - queueStart, queueEnd);

        // If generation has changed, this encode belongs to an old session — discard.
        if (gen !== captureGeneration) {
            releaseEncodeSlot();
            return;
        }

        // Extract RGBA data from canvases. This runs after acquiring the
        // encode slot (not inside processFrame) so the expensive
        // getImageData calls never block the frame loop.
        const readbackStart = performance.now();
        const images = readCanvasSetImages(canvasSet);
        const readbackEnd = performance.now();
        recordPerfMetric('readback', readbackEnd - readbackStart, readbackEnd);

        // Capture a local reference to the pool for this encode.
        const pool = workerPool;
        if (!pool) {
            releaseEncodeSlot();
            return;
        }

        let encodeStart = 0;
        let encodeRecorded = false;
        try {
            encodeStart = performance.now();
            const ktx2Buffer = await KTX2Assembler.encodeParallelWithPool(pool, images, (completed, total) => {
                if (gen !== captureGeneration) return; // stale
                gridEntry.layer = completed;
                gridEntry.layerTotal = total;
            });
            const encodeEnd = performance.now();
            recordPerfMetric('encode', encodeEnd - encodeStart, encodeEnd);
            encodeRecorded = true;

            // Stale check after async work
            if (gen !== captureGeneration) return;

            // Store buffer and mark grid entry as completed
            completedKtx2Buffers.value.push(ktx2Buffer);
            completedTileIds.push(tileId);
            gridEntry.status = 'completed';
            completedTiles.value++;
            encodingTiles.value = Math.max(0, encodingTiles.value - 1);

            // FIFO eviction (oldest completed first)
            const limit = crossSectionType.value === 'waves'
                ? targetTileCount.value
                : maxTiles.value;
            while (completedTileIds.length > limit) {
                completedTileIds.shift();
                completedKtx2Buffers.value.shift();
                const idx = gridTiles.value.findIndex(t => t.status === 'completed');
                if (idx !== -1) gridTiles.value.splice(idx, 1);
            }

            // Release canvas set back to pool
            if (tileBuilder) {
                tileBuilder.releaseCanvasSet(canvasSet);
            }

            const expectedTileCount = crossSectionType.value === 'waves'
                ? targetTileCount.value
                : maxTiles.value;
            console.log(`[RealtimeSlyce] Tile ${tileId} encoded (${completedKtx2Buffers.value.length}/${expectedTileCount})`);

            // If capture has stopped and all encodes have drained,
            // terminate the worker pool (deferred cleanup from stopRealtime).
            if (!isCapturing.value && encodingTiles.value === 0 && workerPool) {
                workerPool.terminate();
                workerPool = null;
            }

            maybePersistResultsLocally();
        } catch (err) {
            if (gen !== captureGeneration) return; // stale — pool was terminated
            if (encodeStart !== 0 && !encodeRecorded) {
                const encodeEnd = performance.now();
                recordPerfMetric('encode', encodeEnd - encodeStart, encodeEnd);
            }
            console.error(`[RealtimeSlyce] KTX2 encoding failed for tile ${tileId}:`, err);
            encodingTiles.value = Math.max(0, encodingTiles.value - 1);

            // Remove failed entry from grid
            const idx = gridTiles.value.findIndex(t => t.id === tileId);
            if (idx !== -1) gridTiles.value.splice(idx, 1);

            // Release canvas set even on failure
            if (tileBuilder) {
                tileBuilder.releaseCanvasSet(canvasSet);
            }

            // Deferred pool cleanup on failure path too
            if (!isCapturing.value && encodingTiles.value === 0 && workerPool) {
                workerPool.terminate();
                workerPool = null;
            }

            maybePersistResultsLocally();
        } finally {
            releaseEncodeSlot();
        }
    }

    // ── Apply / Discard ────────────────────────────────────────────────

    /**
     * Bulk-load accumulated KTX2 buffers into the viewer.
     * Called when the user clicks "Apply" on the sampling screen.
     *
     * @param {Object} tileManager - TileManager instance (raw, not ref)
     * @param {Object} ribbonSeries - RibbonSeries instance (raw, not ref)
     * @param {Object} options
     * @param {Function|null} options.setBackgroundFromTileManager - Viewer background refresh hook
     */
    async function applyToViewer(tileManager, ribbonSeries, options = {}) {
        const { setBackgroundFromTileManager = null } = options;
        const buffers = completedKtx2Buffers.value;
        const expectedTileCount = crossSectionType.value === 'waves'
            ? targetTileCount.value
            : maxTiles.value;
        if (buffers.length === 0) {
            console.warn('[RealtimeSlyce] No KTX2 buffers to apply');
            return;
        }

        if (crossSectionType.value === 'waves' && buffers.length < expectedTileCount) {
            console.warn(`[RealtimeSlyce] Applying partial waves capture: ${buffers.length}/${expectedTileCount} tiles completed.`);
        }

        // Prepare TileManager for new tiles
        tileManager.clearAllTiles();
        tileManager.variant = crossSectionType.value;
        tileManager.isKTX2 = true;
        tileManager.tileCount = buffers.length;

        // Load all tiles
        for (let i = 0; i < buffers.length; i++) {
            await tileManager.addTileFromBuffer(buffers[i], i);
        }

        tileManager.resetAnimationState?.();

        if (ribbonSeries?.setTileManager) {
            ribbonSeries.setTileManager(tileManager);
        }

        // Single material rebuild
        if (ribbonSeries?.initFlowMaterials) {
            ribbonSeries.initFlowMaterials();
        }

        await setBackgroundFromTileManager?.();

        console.log(`[RealtimeSlyce] Applied ${buffers.length} tiles to viewer (layerCount=${tileManager.layerCount})`);

        // Clear in-memory buffers after successful apply, but preserve
        // any completed local save state for the current capture.
        completedKtx2Buffers.value = [];
        gridTiles.value = [];
        completedTileIds.length = 0;
        completedTiles.value = 0;
    }

    /**
     * Discard accumulated results without applying.
     */
    function discardResults() {
        completedKtx2Buffers.value = [];
        gridTiles.value = [];
        completedTileIds.length = 0;
        completedTiles.value = 0;
        currentThumbnailBlob = null;
        autoSaveRequestedGeneration = 0;
        localSave.resetLocalSaveState();
    }

    // ── Camera controls ────────────────────────────────────────────────

    async function toggleCamera() {
        if (!cameraSource) return;
        const newMode = await cameraSource.toggleCamera();
        cameraFacingMode.value = newMode;
        cameraStream.value = cameraSource.getMediaStream();
        cameraFrameRate.value = cameraSource.frameRate;
        console.log(`[RealtimeSlyce] Camera toggled to: ${newMode} (${cameraFrameRate.value}fps)`);
        return newMode;
    }

    async function setResolution(res) {
        cameraResolution.value = res;
        if (cameraSource) {
            cameraSource.setResolution(res);
            // If camera is active but not capturing, restart it to apply new resolution
            if (isCameraActive.value && !isCapturing.value) {
                stopCamera();
                await startCamera();
            }
        }
    }

    function setMaxTiles(n) {
        maxTiles.value = n;
    }

    function setPotResolution(res) {
        potResolution.value = res;
    }

    function setCrossSectionCount(count) {
        crossSectionCount.value = clampCrossSectionCount(count);
    }

    function setCrossSectionType(type) {
        crossSectionType.value = type;
    }

    function setTargetTileCount(n) {
        targetTileCount.value = n;
    }

    // ── Cleanup ────────────────────────────────────────────────────────

    onUnmounted(() => {
        stopRealtime();
        stopCamera();
    });

    // ── Public API ─────────────────────────────────────────────────────

    return {
        // State
        isCameraActive,
        isCapturing,
        currentTileIndex,
        currentRow,
        completedTiles,
        encodingTiles,
        maxTiles,
        potResolution,
        crossSectionCount,
        minCrossSectionCount: MIN_CROSS_SECTION_COUNT,
        maxCrossSectionCount: MAX_CROSS_SECTION_COUNT,
        fps,
        cameraResolution,
        cameraFacingMode,
        crossSectionType,
        targetTileCount,
        globalFrameIndex,
        tileHeight: computed(() => potResolution.value),
        totalFrames: computed(() => potResolution.value * targetTileCount.value),
        countdownSeconds: computed(() => {
            if (crossSectionType.value !== 'waves') return null;
            const total = potResolution.value * targetTileCount.value;
            const remaining = Math.max(0, total - globalFrameIndex.value);
            const currentFps = fps.value || 30; // estimate 30 if not yet known
            return remaining / currentFps;
        }),

        // Sampling screen state
        cameraStream,
        cameraFrameRate,
        currentPreviewCanvas,
        completedKtx2Buffers,
        gridTiles,
        perfStats,
        isSavingLocally,
        saveLocalProgress,
        saveLocalError,
        savedLocalTextureId,

        // Methods
        startCamera,
        stopCamera,
        startRealtime,
        stopRealtime,
        applyToViewer,
        discardResults,
        toggleCamera,
        setResolution,
        setMaxTiles,
        setPotResolution,
        setCrossSectionCount,
        setCrossSectionType,
        setTargetTileCount,
        recordPreviewFrame,
        persistResultsLocally,
    };
}
