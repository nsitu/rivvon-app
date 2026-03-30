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
let pendingEncodes = 0;  // track in-flight KTX2 encodings

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

    // ── Start / Stop ───────────────────────────────────────────────────

    /**
     * Start realtime capture and processing.
     * No viewer context needed — capture is fully independent.
     */
    async function startRealtime() {
        if (isCapturing.value) return;

        if (!hasStartedOnce) {
            detectDefaults();
            hasStartedOnce = true;
        }

        // Clear previous results
        completedKtx2Buffers.value = [];
        gridTiles.value = [];
        completedTileIds.length = 0;

        // Init camera
        camera = new RealtimeCamera({ resolution: cameraResolution.value });

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
     */
    async function stopRealtime() {
        if (!isCapturing.value) return;
        isCapturing.value = false;

        // Abort frame loop
        if (frameLoopAbort) {
            frameLoopAbort.abort();
            frameLoopAbort = null;
        }

        // Stop camera
        if (camera) {
            camera.stop();
            camera = null;
        }
        cameraStream.value = null;
        currentPreviewCanvas.value = null;

        // Clean up tile builder
        if (tileBuilder) {
            tileBuilder.dispose();
            tileBuilder = null;
        }

        // Terminate worker pool — only if no encodings are in-flight.
        // Otherwise the last encoding to finish will clean up.
        if (workerPool && pendingEncodes === 0) {
            workerPool.terminate();
            workerPool = null;
        }

        console.log(`[RealtimeSlyce] Stopped. ${completedKtx2Buffers.value.length} KTX2 buffers ready for apply.${pendingEncodes > 0 ? ` (${pendingEncodes} encoding(s) still in flight)` : ''}`);
    }

    // ── Frame loop ─────────────────────────────────────────────────────

    async function runFrameLoop(signal) {
        try {
            for await (const frame of camera.getFrameStream()) {
                if (signal.aborted) {
                    if (frame?.close) frame.close();
                    break;
                }

                // Expose camera stream for <video> binding (once available)
                if (!cameraStream.value && camera) {
                    cameraStream.value = camera.getMediaStream();
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

    function handleTileComplete(payload) {
        const { tileId, canvasSet, images } = payload;
        encodingTiles.value++;

        // Snapshot the first canvas layer for the tile grid
        const previewCanvas = document.createElement('canvas');
        previewCanvas.width = canvasSet[0].width;
        previewCanvas.height = canvasSet[0].height;
        previewCanvas.getContext('2d').drawImage(canvasSet[0], 0, 0);

        // Add to unified grid immediately as encoding
        gridTiles.value.push({
            id: tileId, canvas: previewCanvas,
            status: 'encoding', layer: 0, layerTotal: images.length
        });
        // Grab the reactive proxy so mutations trigger updates
        const gridEntry = gridTiles.value[gridTiles.value.length - 1];

        encodeAndFinalise(tileId, canvasSet, images, gridEntry);
    }

    async function encodeAndFinalise(tileId, canvasSet, images, gridEntry) {
        pendingEncodes++;
        try {
            const ktx2Buffer = await KTX2Assembler.encodeParallelWithPool(workerPool, images, (completed, total) => {
                gridEntry.layer = completed;
                gridEntry.layerTotal = total;
            });

            // Store buffer and mark grid entry as completed
            completedKtx2Buffers.value.push(ktx2Buffer);
            completedTileIds.push(tileId);
            gridEntry.status = 'completed';
            completedTiles.value++;
            encodingTiles.value = Math.max(0, encodingTiles.value - 1);

            // FIFO eviction (oldest completed first)
            // In waves mode, target is exact — no eviction needed.
            // In planes mode, evict when exceeding maxTiles.
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
        } catch (err) {
            console.error(`[RealtimeSlyce] KTX2 encoding failed for tile ${tileId}:`, err);
            encodingTiles.value = Math.max(0, encodingTiles.value - 1);

            // Remove failed entry from grid
            const idx = gridTiles.value.findIndex(t => t.id === tileId);
            if (idx !== -1) gridTiles.value.splice(idx, 1);

            // Release canvas set even on failure
            if (tileBuilder) {
                tileBuilder.releaseCanvasSet(canvasSet);
            }
        } finally {
            pendingEncodes--;

            // If capture has stopped and this was the last in-flight encoding,
            // clean up the worker pool now.
            if (!isCapturing.value && pendingEncodes === 0 && workerPool) {
                workerPool.terminate();
                workerPool = null;
                console.log('[RealtimeSlyce] All encodings complete — worker pool terminated.');
            }
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
        // Update stream ref after toggle
        cameraStream.value = camera.getMediaStream();
        console.log(`[RealtimeSlyce] Camera toggled to: ${newMode}`);
        return newMode;
    }

    function setResolution(res) {
        cameraResolution.value = res;
        if (camera) {
            camera.setResolution(res);
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
    });

    // ── Public API ─────────────────────────────────────────────────────

    return {
        // State
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
        currentPreviewCanvas,
        completedKtx2Buffers,
        gridTiles,

        // Methods
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
