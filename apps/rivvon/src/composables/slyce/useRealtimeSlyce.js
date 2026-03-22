/**
 * useRealtimeSlyce — Orchestrator composable for realtime webcam mode.
 *
 * Wires together: RealtimeCamera → RealtimeTileBuilder → PreviewTexture
 * → KTX2WorkerPool/KTX2Assembler → TileManager
 *
 * Tile lifecycle: building → encoding → complete
 * FIFO eviction when completedTiles >= maxTiles.
 */

import { ref, computed, onUnmounted } from 'vue';
import { RealtimeCamera } from '../../modules/slyce/realtimeCamera.js';
import { RealtimeTileBuilder } from '../../modules/slyce/realtimeTileBuilder.js';
import { PreviewTexture } from '../../modules/viewer/previewTexture.js';
import { KTX2WorkerPool } from '../../modules/slyce/ktx2-worker-pool.js';
import { KTX2Assembler } from '../../modules/slyce/ktx2-assembler.js';

/**
 * @typedef {'building'|'encoding'|'complete'} TileState
 */

export function useRealtimeSlyce() {
    // ── Reactive state ─────────────────────────────────────────────────
    const isCapturing = ref(false);
    const currentTileIndex = ref(0);
    const currentRow = ref(0);
    const completedTiles = ref(0);
    const encodingTiles = ref(0);
    const maxTiles = ref(16);
    const potResolution = ref(256);
    const crossSectionCount = ref(30);
    const fps = ref(0);
    const cameraResolution = ref('240p');

    // ── Internal state ─────────────────────────────────────────────────
    let camera = null;
    let tileBuilder = null;
    let previewTexture = null;
    let workerPool = null;
    let frameLoopAbort = null;
    let hasStartedOnce = false;

    // Tile state tracking: Map<tileId, { state, canvasSet?, ktx2Buffer?, tileIndex }>
    const tileStates = new Map();
    // Ordered list of completed tile IDs for FIFO eviction
    const completedTileIds = [];

    // Viewer context references (set on startRealtime)
    let viewerTileManager = null;
    let viewerRibbonSeries = null;

    // FPS tracking
    let frameCount = 0;
    let lastFpsTime = 0;

    // ── Resource detection ─────────────────────────────────────────────

    function detectDefaults() {
        const cores = navigator.hardwareConcurrency || 4;
        const memory = navigator.deviceMemory || 8; // deviceMemory API (Chrome only)

        if (cores < 4 || memory < 4) {
            potResolution.value = 128;
            maxTiles.value = 8;
            console.log('[RealtimeSlyce] Low-spec device detected — using 128² tiles, max 8');
        }
    }

    /**
     * Refresh ribbon material assignments so segments map to the current
     * set of active tiles. Called whenever activeTileCount changes.
     */
    function refreshRibbonMaterials() {
        if (viewerRibbonSeries?.initFlowMaterials) {
            viewerRibbonSeries.initFlowMaterials();
        }
    }

    // ── Start / Stop ───────────────────────────────────────────────────

    /**
     * Start realtime capture and processing.
     *
     * @param {Object} viewerContext — refs from ThreeCanvas / useThreeSetup
     * @param {import('vue').ShallowRef} viewerContext.tileManager
     * @param {import('vue').ShallowRef} viewerContext.ribbonSeries
     */
    async function startRealtime(viewerContext) {
        if (isCapturing.value) return;

        // Only apply hardware-detected defaults on the very first start;
        // after that, respect user-chosen values from the UI.
        if (!hasStartedOnce) {
            detectDefaults();
            hasStartedOnce = true;
        }

        // Handle both ref-wrapped and raw values (defineExpose auto-unwraps refs)
        const tm = viewerContext.tileManager;
        const rs = viewerContext.ribbonSeries;
        viewerTileManager = tm?.value ?? tm;
        viewerRibbonSeries = rs?.value ?? rs;

        if (!viewerTileManager) {
            console.error('[RealtimeSlyce] No TileManager available');
            return;
        }

        // Clear existing textures and lock to realtime settings
        viewerTileManager.clearAllTiles();
        viewerTileManager.variant = 'planes';
        viewerTileManager.isKTX2 = true;
        viewerTileManager.tileCount = maxTiles.value;
        // Set layerCount so tick() runs the ping-pong layer cycling
        // immediately — preview canvases need this to animate.
        viewerTileManager.layerCount = crossSectionCount.value;
        viewerTileManager.currentLayer = 0;
        viewerTileManager.direction = 1;

        // Disable flow animation during realtime (not meaningful for growing tiles)
        viewerTileManager.setFlowEnabled(false);

        // Push cleared state to all ribbon segments (transparent fallback)
        refreshRibbonMaterials();

        // Init camera
        camera = new RealtimeCamera({ resolution: cameraResolution.value });

        // Init tile builder
        tileBuilder = new RealtimeTileBuilder({
            potResolution: potResolution.value,
            crossSectionCount: crossSectionCount.value
        });

        // Init preview texture manager (renderer-aware for correct UV transforms)
        previewTexture = new PreviewTexture({
            rendererType: viewerTileManager.rendererType,
            rotate90: viewerTileManager.rotate90
        });

        // Wire preview updates into TileManager's per-frame tick so
        // canvas-based preview textures get needsUpdate = true each frame.
        viewerTileManager._onTick = (currentLayer) => {
            if (previewTexture) {
                previewTexture.update(currentLayer);
            }
        };

        // Init KTX2 worker pool (capped at 2 for realtime)
        workerPool = new KTX2WorkerPool(2);
        await workerPool.init();

        // Register tile-complete handler
        tileBuilder.on('complete', handleTileComplete);

        // Register first tile's preview
        const firstCanvasSet = tileBuilder._currentCanvasSet;
        const { material } = previewTexture.addPreviewTile(0, firstCanvasSet);
        viewerTileManager.setPreviewMaterial(0, material);
        tileStates.set(0, { state: 'building', canvasSet: firstCanvasSet, tileIndex: 0 });

        // Refresh ribbon so the first preview tile covers the whole ribbon
        refreshRibbonMaterials();

        isCapturing.value = true;
        currentTileIndex.value = 0;
        currentRow.value = 0;
        completedTiles.value = 0;
        encodingTiles.value = 0;
        frameCount = 0;
        lastFpsTime = performance.now();

        // Start frame loop
        frameLoopAbort = new AbortController();
        runFrameLoop(frameLoopAbort.signal);

        console.log(`[RealtimeSlyce] Started: ${potResolution.value}² tiles, max ${maxTiles.value}, camera=${cameraResolution.value}, builder.potResolution=${tileBuilder.potResolution}, crossSections=${crossSectionCount.value}`);
    }

    /**
     * Stop realtime capture. Completed KTX2 tiles remain on the ribbon.
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

        // Unhook preview tick callback
        if (viewerTileManager) {
            viewerTileManager._onTick = null;
        }

        // Remove any remaining preview tiles
        if (previewTexture) {
            previewTexture.dispose();
            previewTexture = null;
        }

        // Clean up tile builder
        if (tileBuilder) {
            tileBuilder.dispose();
            tileBuilder = null;
        }

        // Terminate worker pool
        if (workerPool) {
            workerPool.terminate();
            workerPool = null;
        }

        // Clear non-complete tile states and remove their materials
        for (const [tileId, state] of tileStates) {
            if (state.state !== 'complete') {
                // Remove material from TileManager for non-complete tiles
                if (viewerTileManager) {
                    viewerTileManager.removeTile(state.tileIndex % viewerTileManager.tileCount);
                }
                tileStates.delete(tileId);
            }
        }

        // Recalculate activeTileCount based on surviving materials
        if (viewerTileManager && viewerTileManager.realtimeMode) {
            let maxIdx = -1;
            for (let i = 0; i < viewerTileManager.tileCount; i++) {
                if (viewerTileManager.materials[i]) maxIdx = i;
            }
            viewerTileManager.activeTileCount = maxIdx + 1;
            refreshRibbonMaterials();
        }

        console.log('[RealtimeSlyce] Stopped. Completed tiles remain on ribbon.');
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

                // Update reactive state
                currentTileIndex.value = tileBuilder.currentTileId;
                currentRow.value = tileBuilder.currentRow;

                // FPS tracking
                frameCount++;
                const now = performance.now();
                if (now - lastFpsTime >= 1000) {
                    fps.value = Math.round(frameCount * 1000 / (now - lastFpsTime));
                    console.log(`[RealtimeSlyce] FPS: ${fps.value}, processFrame avg: ${frameCount > 0 ? ((now - lastFpsTime) / frameCount).toFixed(1) : '?'}ms, potRes=${tileBuilder?.potResolution}, row=${tileBuilder?.currentRow}/${tileBuilder?.tileHeight}`);
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

        // Transition tile to 'encoding' — canvasSet retained for preview
        tileStates.set(tileId, { state: 'encoding', canvasSet, tileIndex: tileId });
        encodingTiles.value++;

        // Preview is already registered (it was set up during 'building' phase)
        // No need to re-register with PreviewTexture

        // Register next tile's preview (it just started building)
        const nextTileId = tileBuilder.currentTileId;
        const nextCanvasSet = tileBuilder._currentCanvasSet;
        const prevActiveTileCount = viewerTileManager?.activeTileCount ?? 0;

        if (previewTexture) {
            const { material } = previewTexture.addPreviewTile(nextTileId, nextCanvasSet);
            if (viewerTileManager) {
                viewerTileManager.setPreviewMaterial(nextTileId % viewerTileManager.tileCount, material);
            }
        }
        tileStates.set(nextTileId, { state: 'building', canvasSet: nextCanvasSet, tileIndex: nextTileId });

        // If a new tile slot was populated, refresh ribbon material mapping
        // so segments redistribute across the growing set of tiles
        if (viewerTileManager && viewerTileManager.activeTileCount > prevActiveTileCount) {
            refreshRibbonMaterials();
        }

        // Kick off async KTX2 encoding
        encodeAndFinalise(tileId, canvasSet, images);
    }

    async function encodeAndFinalise(tileId, canvasSet, images) {
        try {
            const ktx2Buffer = await KTX2Assembler.encodeParallelWithPool(workerPool, images);

            // Check if we've been stopped during encoding
            if (!isCapturing.value && !tileStates.has(tileId)) return;

            // Transition to 'complete'
            const tileIndex = tileId % viewerTileManager.tileCount;

            // Add KTX2 tile to viewer (replaces preview material in materials[])
            await viewerTileManager.addTileFromBuffer(ktx2Buffer, tileIndex);

            // Refresh ribbon materials FIRST so meshes pick up the new KTX2
            // material before we dispose the old preview material/texture.
            if (viewerRibbonSeries?.initFlowMaterials) {
                viewerRibbonSeries.initFlowMaterials();
            }

            // Now safe to remove preview (meshes no longer reference it)
            if (previewTexture) {
                previewTexture.removePreviewTile(tileId);
            }

            // Release canvas set back to pool
            if (tileBuilder) {
                tileBuilder.releaseCanvasSet(canvasSet);
            }

            tileStates.set(tileId, { state: 'complete', tileIndex });
            completedTileIds.push(tileId);
            completedTiles.value++;
            encodingTiles.value = Math.max(0, encodingTiles.value - 1);

            // FIFO eviction
            while (completedTileIds.length > maxTiles.value) {
                const evictId = completedTileIds.shift();
                const evictState = tileStates.get(evictId);
                if (evictState) {
                    viewerTileManager.removeTile(evictState.tileIndex);
                    tileStates.delete(evictId);
                }
            }

            console.log(`[RealtimeSlyce] Tile ${tileId} complete (${completedTiles.value}/${maxTiles.value})`);
        } catch (err) {
            console.error(`[RealtimeSlyce] KTX2 encoding failed for tile ${tileId}:`, err);
            encodingTiles.value = Math.max(0, encodingTiles.value - 1);

            // Release canvas set even on failure
            if (tileBuilder) {
                tileBuilder.releaseCanvasSet(canvasSet);
            }
        }
    }

    // ── Preview update (call from render loop) ─────────────────────────

    /**
     * Called each render frame. Updates all active preview textures
     * to show the current animation layer.
     *
     * @param {number} currentLayer — From TileManager's layer cycling
     */
    function updatePreview(currentLayer) {
        if (previewTexture) {
            previewTexture.update(currentLayer);
        }
    }

    // ── Camera controls ────────────────────────────────────────────────

    async function toggleCamera() {
        if (!camera) return;
        const newMode = await camera.toggleCamera();
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
        tileHeight: computed(() => potResolution.value),

        // Methods
        startRealtime,
        stopRealtime,
        updatePreview,
        toggleCamera,
        setResolution,
        setMaxTiles,
        setPotResolution
    };
}
