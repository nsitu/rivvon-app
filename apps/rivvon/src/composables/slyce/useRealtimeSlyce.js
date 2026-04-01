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
import { RealtimeCamera } from '../../modules/slyce/realtimeCamera.js';
import { RealtimeTileBuilder } from '../../modules/slyce/realtimeTileBuilder.js';
import { KTX2WorkerPool } from '../../modules/slyce/ktx2-worker-pool.js';
import { KTX2Assembler } from '../../modules/slyce/ktx2-assembler.js';

// ── Shared reactive state (module-level singleton) ─────────────────
const isCameraActive = ref(false);
const isCapturing = ref(false);
const currentTileIndex = ref(0);
const currentRow = ref(0);
const completedTiles = ref(0);
const encodingTiles = ref(0);
const maxTiles = ref(16);
const potResolution = ref(256);
const crossSectionCount = ref(30);
const fps = ref(0);
const cameraResolution = ref('240p');const crossSectionType = ref('planes');  // 'planes' or 'waves'
const targetTileCount = ref(4);          // how many tiles to capture in waves mode
const globalFrameIndex = ref(0);         // total frames processed (for countdown)
// Sampling screen state
const cameraStream = shallowRef(null);           // MediaStream for <video> binding
const cameraFrameRate = ref(null);                // Actual camera FPS (from getSettings)
const currentPreviewCanvas = shallowRef(null);    // Live-building canvas (first layer)
const completedKtx2Buffers = ref([]);              // KTX2 ArrayBuffers for handoff

// Unified tile grid: encoding + completed tiles in display order
// Each entry: { id, canvas, status: 'encoding'|'completed', layer, layerTotal }
const gridTiles = ref([]);

// ── Shared internal state ──────────────────────────────────────────
let camera = null;
let tileBuilder = null;
let workerPool = null;
let frameLoopAbort = null;
let hasStartedOnce = false;

// Generation counter — incremented on each startRealtime() to invalidate
// in-flight encodes from previous sessions.
let captureGeneration = 0;

// Max tiles that can be encoding concurrently (prevents main-thread saturation
// from ktx-parse read/write during assembly).
const MAX_CONCURRENT_ENCODES = 2;

// Ordered list of completed tile IDs for FIFO eviction
const completedTileIds = [];

// FPS tracking
let frameCount = 0;
let lastFpsTime = 0;

export function useRealtimeSlyce() {

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
        if (camera) return; // already running

        if (!hasStartedOnce) {
            detectDefaults();
            hasStartedOnce = true;
        }

        camera = new RealtimeCamera({ resolution: cameraResolution.value });
        await camera.start();
        cameraStream.value = camera.getMediaStream();
        cameraFrameRate.value = camera.frameRate;
        isCameraActive.value = true;
        console.log(`[RealtimeSlyce] Camera started (${cameraResolution.value}, ${cameraFrameRate.value}fps)`);
    }

    /**
     * Stop the webcam and release resources.
     */
    function stopCamera() {
        if (camera) {
            camera.stop();
            camera = null;
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
        if (!camera) {
            console.warn('[RealtimeSlyce] Cannot start capture — camera not running');
            return;
        }

        // Bump generation so any in-flight encodes from a previous session
        // will silently discard their results instead of touching current state.
        captureGeneration++;
        const gen = captureGeneration;

        // Kill any orphaned worker pool from a previous session
        if (workerPool) {
            workerPool.terminate();
            workerPool = null;
        }

        // Clear previous results
        completedKtx2Buffers.value = [];
        gridTiles.value = [];
        completedTileIds.length = 0;

        // Init tile builder
        const isWave = crossSectionType.value === 'waves';
        const totalFrames = isWave
            ? potResolution.value * targetTileCount.value
            : null;

        tileBuilder = new RealtimeTileBuilder({
            potResolution: potResolution.value,
            crossSectionCount: crossSectionCount.value,
            crossSectionType: crossSectionType.value,
            totalFrames
        });

        // Init KTX2 worker pool (capped at 2 for realtime)
        workerPool = new KTX2WorkerPool(2);
        await workerPool.init();

        // Register tile-complete handler
        tileBuilder.on('complete', handleTileComplete);

        isCapturing.value = true;
        currentTileIndex.value = 0;
        currentRow.value = 0;
        completedTiles.value = 0;
        encodingTiles.value = 0;
        globalFrameIndex.value = 0;
        frameCount = 0;
        lastFpsTime = performance.now();

        // Start frame loop
        frameLoopAbort = new AbortController();
        runFrameLoop(frameLoopAbort.signal);

        console.log(`[RealtimeSlyce] Started: ${potResolution.value}² tiles, max ${maxTiles.value}, camera=${cameraResolution.value}, type=${crossSectionType.value}${isWave ? ', totalFrames=' + totalFrames : ''}`);
    }

    /**
     * Stop realtime capture. Preserves completed KTX2 buffers for Apply.
     * Camera keeps running so the user can start another capture.
     */
    async function stopRealtime() {
        if (!isCapturing.value) return;
        isCapturing.value = false;

        // Abort frame loop
        if (frameLoopAbort) {
            frameLoopAbort.abort();
            frameLoopAbort = null;
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

        console.log(`[RealtimeSlyce] Stopped. ${completedKtx2Buffers.value.length} KTX2 buffers ready, ${encodingTiles.value} still encoding.`);
    }

    // ── Frame loop ─────────────────────────────────────────────────────

    async function runFrameLoop(signal) {
        try {
            for await (const frame of camera.getFrameStream()) {
                if (signal.aborted) {
                    if (frame?.close) frame.close();
                    break;
                }

                // Process frame (tile builder handles sampling + close)
                tileBuilder.processFrame(frame);

                // Expose current preview canvas AFTER processFrame so the
                // ref always tracks the active canvas set (avoids exposing
                // a just-completed canvas that has stale pixels).
                if (tileBuilder) {
                    currentPreviewCanvas.value = tileBuilder.getCurrentPreviewCanvas();
                }

                // Update reactive state
                currentTileIndex.value = tileBuilder.currentTileId;
                currentRow.value = tileBuilder.currentRow;
                globalFrameIndex.value = tileBuilder.globalFrameIndex;

                // Auto-stop in waves mode when all frames have been captured
                if (tileBuilder.isComplete) {
                    console.log('[RealtimeSlyce] Wave capture complete — all target frames sampled.');
                    stopRealtime();
                    break;
                }

                // FPS tracking
                frameCount++;
                const now = performance.now();
                if (now - lastFpsTime >= 1000) {
                    fps.value = Math.round(frameCount * 1000 / (now - lastFpsTime));
                    frameCount = 0;
                    lastFpsTime = now;
                }
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('[RealtimeSlyce] Frame loop error:', err);
            }
        }
    }

    // ── Tile completion handler ────────────────────────────────────────

    // Encoding concurrency gate — resolvers waiting for a slot
    let encodeSlots = MAX_CONCURRENT_ENCODES;
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
        previewCanvas.getContext('2d').drawImage(canvasSet[0], 0, 0);

        // Add to unified grid immediately as encoding
        gridTiles.value.push({
            id: tileId, canvas: previewCanvas,
            status: 'encoding', layer: 0, layerTotal: crossSectionCount.value
        });
        // Grab the reactive proxy so mutations trigger updates
        const gridEntry = gridTiles.value[gridTiles.value.length - 1];

        encodeAndFinalise(gen, tileId, canvasSet, gridEntry);
    }

    async function encodeAndFinalise(gen, tileId, canvasSet, gridEntry) {
        // Wait for a slot so we never saturate the main thread with
        // concurrent ktx-parse assembly work.
        await acquireEncodeSlot();

        // If generation has changed, this encode belongs to an old session — discard.
        if (gen !== captureGeneration) {
            releaseEncodeSlot();
            return;
        }

        // Extract RGBA data from canvases. This runs after acquiring the
        // encode slot (not inside processFrame) so the expensive
        // getImageData calls never block the frame loop.
        const resolution = potResolution.value;
        const images = canvasSet.map(canvas => {
            const ctx = canvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, resolution, resolution);
            return { rgba: imageData.data, width: resolution, height: resolution };
        });

        // Capture a local reference to the pool for this encode.
        const pool = workerPool;
        if (!pool) {
            releaseEncodeSlot();
            return;
        }

        try {
            const ktx2Buffer = await KTX2Assembler.encodeParallelWithPool(pool, images, (completed, total) => {
                if (gen !== captureGeneration) return; // stale
                gridEntry.layer = completed;
                gridEntry.layerTotal = total;
            });

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

            console.log(`[RealtimeSlyce] Tile ${tileId} encoded (${completedKtx2Buffers.value.length}/${maxTiles.value})`);

            // If capture has stopped and all encodes have drained,
            // terminate the worker pool (deferred cleanup from stopRealtime).
            if (!isCapturing.value && encodingTiles.value === 0 && workerPool) {
                workerPool.terminate();
                workerPool = null;
            }
        } catch (err) {
            if (gen !== captureGeneration) return; // stale — pool was terminated
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
     */
    async function applyToViewer(tileManager, ribbonSeries) {
        const buffers = completedKtx2Buffers.value;
        if (buffers.length === 0) {
            console.warn('[RealtimeSlyce] No KTX2 buffers to apply');
            return;
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

        // Single material rebuild
        if (ribbonSeries?.initFlowMaterials) {
            ribbonSeries.initFlowMaterials();
        }

        console.log(`[RealtimeSlyce] Applied ${buffers.length} tiles to viewer`);

        // Clear buffers after successful apply
        discardResults();
    }

    /**
     * Discard accumulated results without applying.
     */
    function discardResults() {
        completedKtx2Buffers.value = [];
        gridTiles.value = [];
        completedTileIds.length = 0;
        completedTiles.value = 0;
    }

    // ── Camera controls ────────────────────────────────────────────────

    async function toggleCamera() {
        if (!camera) return;
        const newMode = await camera.toggleCamera();
        cameraStream.value = camera.getMediaStream();
        cameraFrameRate.value = camera.frameRate;
        console.log(`[RealtimeSlyce] Camera toggled to: ${newMode} (${cameraFrameRate.value}fps)`);
        return newMode;
    }

    async function setResolution(res) {
        cameraResolution.value = res;
        if (camera) {
            camera.setResolution(res);
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
        fps,
        cameraResolution,
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
        setCrossSectionType,
        setTargetTileCount,
    };
}
