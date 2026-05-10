// src/composables/viewer/useRenderLoop.js
// Render loop lifecycle: start/stop, pause/resume, tab visibility & GPU recovery

import { ref } from 'vue';

const PERF_SAMPLE_WINDOW_MS = 250;
const PERF_HISTORY_LIMIT = 60;

function createPerfTelemetrySnapshot() {
    return {
        fpsHistory: [],
        frameMsHistory: [],
        lastFrameMs: 0,
        avgFrameMs: 0,
        maxFrameMs: 0,
        lastTileTickMs: 0,
        avgTileTickMs: 0,
        lastFlowUpdateMs: 0,
        avgFlowUpdateMs: 0,
        lastRibbonUpdateMs: 0,
        avgRibbonUpdateMs: 0,
        lastControlsMs: 0,
        avgControlsMs: 0,
        lastRenderMs: 0,
        avgRenderMs: 0,
        wrapEventsWindow: 0,
        wrapEventsTotal: 0,
        lastWrapAgeMs: null,
        lastWrapIntervalMs: null,
        lastWrapTiles: 0,
        lastWrapFlowUpdateMs: 0,
        lastWrapFrameMs: 0,
        lastWrapMaterialCount: 0,
        activeFlowMaterialCount: 0,
        cachedFlowMaterialCount: 0,
        flowEnabled: false,
        flowSpeed: 0,
        requestedFlowSpeed: 0,
        effectiveTileCount: 0,
        tileFlowOffset: 0,
        flowOffset: 0,
        layerCount: 0,
        currentLayer: 0,
        repeatMode: 'wrap',
        tileWrapPeriod: 0,
        flowCyclePeriod: 0,
        textureCyclePeriod: 0,
        flowCycleMultiple: null,
        flowAligned: false,
        flowAlignmentEnabled: false,
        flowAlignmentCapable: false,
    };
}

function pushHistoryValue(history, value) {
    const source = Array.isArray(history) ? history : [];
    const next = source.length >= PERF_HISTORY_LIMIT
        ? source.slice(source.length - PERF_HISTORY_LIMIT + 1)
        : source.slice();
    next.push(value);
    return next;
}

function roundMetric(value, digits = 2) {
    if (!Number.isFinite(value)) {
        return 0;
    }

    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

/**
 * Manages the Three.js animation loop, tab-visibility pausing,
 * and GPU device-loss recovery.
 *
 * @param {Object} ctx  - Shared refs from useThreeSetup
 * @param {Object} deps - Mutable deps object; populated after construction
 * @param {Function} [deps.teardownViewer] - Full teardown for GPU recovery
 */
export function useRenderLoop(ctx, deps = {}) {
    let animationId = null;
    let renderCallback = null;
    let renderLoopPaused = false;
    let lastFrameTime = 0;
    let pausedByVisibility = false; // tracks tab-hidden pausing (separate from Slyce)

    // FPS measurement — updates ~4 times per second
    const fps = ref(0);
    let fpsFrameCount = 0;
    let fpsLastSampleTime = 0;
    const perfTelemetry = ref(createPerfTelemetrySnapshot());

    let perfWindowStart = 0;
    let perfWindowFrameCount = 0;
    let perfWindowFrameTotalMs = 0;
    let perfWindowMaxFrameMs = 0;
    let perfWindowTileTickTotalMs = 0;
    let perfWindowFlowUpdateTotalMs = 0;
    let perfWindowRibbonUpdateTotalMs = 0;
    let perfWindowControlsTotalMs = 0;
    let perfWindowRenderTotalMs = 0;
    let perfWindowWrapEvents = 0;

    let perfLastFrameMs = 0;
    let perfLastTileTickMs = 0;
    let perfLastFlowUpdateMs = 0;
    let perfLastRibbonUpdateMs = 0;
    let perfLastControlsMs = 0;
    let perfLastRenderMs = 0;
    let perfWrapEventsTotal = 0;
    let perfLastWrapTimeMs = 0;
    let perfLastWrapIntervalMs = null;
    let perfLastWrapTiles = 0;
    let perfLastWrapFlowUpdateMs = 0;
    let perfLastWrapFrameMs = 0;
    let perfLastWrapMaterialCount = 0;

    function resetPerfWindow(now = 0) {
        perfWindowStart = now;
        perfWindowFrameCount = 0;
        perfWindowFrameTotalMs = 0;
        perfWindowMaxFrameMs = 0;
        perfWindowTileTickTotalMs = 0;
        perfWindowFlowUpdateTotalMs = 0;
        perfWindowRibbonUpdateTotalMs = 0;
        perfWindowControlsTotalMs = 0;
        perfWindowRenderTotalMs = 0;
        perfWindowWrapEvents = 0;
    }

    function resetPerfTelemetry(now = 0) {
        perfTelemetry.value = createPerfTelemetrySnapshot();
        perfLastFrameMs = 0;
        perfLastTileTickMs = 0;
        perfLastFlowUpdateMs = 0;
        perfLastRibbonUpdateMs = 0;
        perfLastControlsMs = 0;
        perfLastRenderMs = 0;
        perfWrapEventsTotal = 0;
        perfLastWrapTimeMs = 0;
        perfLastWrapIntervalMs = null;
        perfLastWrapTiles = 0;
        perfLastWrapFlowUpdateMs = 0;
        perfLastWrapFrameMs = 0;
        perfLastWrapMaterialCount = 0;
        resetPerfWindow(now);
    }

    function publishPerfTelemetry(now = performance.now()) {
        const primaryTileManager = ctx.tileManager.value;
        const flowAlignmentInfo = primaryTileManager?.getFlowAlignmentInfo?.() ?? null;
        const avgFrameMs = perfWindowFrameCount > 0
            ? perfWindowFrameTotalMs / perfWindowFrameCount
            : perfLastFrameMs;
        const avgTileTickMs = perfWindowFrameCount > 0
            ? perfWindowTileTickTotalMs / perfWindowFrameCount
            : perfLastTileTickMs;
        const avgFlowUpdateMs = perfWindowFrameCount > 0
            ? perfWindowFlowUpdateTotalMs / perfWindowFrameCount
            : perfLastFlowUpdateMs;
        const avgRibbonUpdateMs = perfWindowFrameCount > 0
            ? perfWindowRibbonUpdateTotalMs / perfWindowFrameCount
            : perfLastRibbonUpdateMs;
        const avgControlsMs = perfWindowFrameCount > 0
            ? perfWindowControlsTotalMs / perfWindowFrameCount
            : perfLastControlsMs;
        const avgRenderMs = perfWindowFrameCount > 0
            ? perfWindowRenderTotalMs / perfWindowFrameCount
            : perfLastRenderMs;
        const flowSpeed = primaryTileManager?.getFlowSpeed?.() ?? 0;
        const effectiveTileCount = primaryTileManager?.getEffectiveTileCount?.() ?? 0;

        perfTelemetry.value = {
            ...perfTelemetry.value,
            fpsHistory: pushHistoryValue(perfTelemetry.value.fpsHistory, fps.value || 0),
            frameMsHistory: pushHistoryValue(
                perfTelemetry.value.frameMsHistory,
                roundMetric(perfWindowMaxFrameMs || avgFrameMs, 1)
            ),
            lastFrameMs: roundMetric(perfLastFrameMs),
            avgFrameMs: roundMetric(avgFrameMs),
            maxFrameMs: roundMetric(perfWindowMaxFrameMs || perfLastFrameMs),
            lastTileTickMs: roundMetric(perfLastTileTickMs),
            avgTileTickMs: roundMetric(avgTileTickMs),
            lastFlowUpdateMs: roundMetric(perfLastFlowUpdateMs),
            avgFlowUpdateMs: roundMetric(avgFlowUpdateMs),
            lastRibbonUpdateMs: roundMetric(perfLastRibbonUpdateMs),
            avgRibbonUpdateMs: roundMetric(avgRibbonUpdateMs),
            lastControlsMs: roundMetric(perfLastControlsMs),
            avgControlsMs: roundMetric(avgControlsMs),
            lastRenderMs: roundMetric(perfLastRenderMs),
            avgRenderMs: roundMetric(avgRenderMs),
            wrapEventsWindow: perfWindowWrapEvents,
            wrapEventsTotal: perfWrapEventsTotal,
            lastWrapAgeMs: perfLastWrapTimeMs ? Math.max(0, Math.round(now - perfLastWrapTimeMs)) : null,
            lastWrapIntervalMs: perfLastWrapIntervalMs == null ? null : Math.round(perfLastWrapIntervalMs),
            lastWrapTiles: perfLastWrapTiles,
            lastWrapFlowUpdateMs: roundMetric(perfLastWrapFlowUpdateMs),
            lastWrapFrameMs: roundMetric(perfLastWrapFrameMs),
            lastWrapMaterialCount: perfLastWrapMaterialCount,
            activeFlowMaterialCount: primaryTileManager?.getActiveFlowMaterialCount?.()
                ?? primaryTileManager?.flowMaterials?.length
                ?? 0,
            cachedFlowMaterialCount: primaryTileManager?.getCachedFlowMaterialCount?.()
                ?? primaryTileManager?.flowMaterialCache?.size
                ?? 0,
            flowEnabled: primaryTileManager?.isFlowEnabled?.() ?? false,
            flowSpeed: roundMetric(flowSpeed, 4),
            requestedFlowSpeed: roundMetric(primaryTileManager?.getRequestedFlowSpeed?.() ?? 0, 4),
            effectiveTileCount,
            tileFlowOffset: primaryTileManager?.getTileFlowOffset?.() ?? 0,
            flowOffset: roundMetric(primaryTileManager?.getFlowOffset?.() ?? 0, 4),
            layerCount: primaryTileManager?.getLayerCount?.() ?? 0,
            currentLayer: primaryTileManager?.currentLayer ?? 0,
            repeatMode: primaryTileManager?.getRepeatMode?.() ?? 'wrap',
            tileWrapPeriod: roundMetric(flowSpeed ? (1 / Math.abs(flowSpeed)) : 0, 4),
            flowCyclePeriod: roundMetric(flowAlignmentInfo?.flowCyclePeriod ?? 0, 4),
            textureCyclePeriod: roundMetric(flowAlignmentInfo?.textureCyclePeriod ?? 0, 4),
            flowCycleMultiple: flowAlignmentInfo?.cycleMultiple ?? null,
            flowAligned: !!flowAlignmentInfo?.aligned,
            flowAlignmentEnabled: !!flowAlignmentInfo?.enabled,
            flowAlignmentCapable: !!flowAlignmentInfo?.canAlign,
        };

        resetPerfWindow(now);
    }

    function recordPerfFrame({
        now,
        totalFrameMs,
        tileTickMs,
        flowUpdateMs,
        ribbonUpdateMs,
        controlsMs,
        renderMs,
        wrapTiles = 0,
        wrapMaterialCount = 0,
    }) {
        if (!perfWindowStart) {
            perfWindowStart = now;
        }

        perfLastFrameMs = totalFrameMs;
        perfLastTileTickMs = tileTickMs;
        perfLastFlowUpdateMs = flowUpdateMs;
        perfLastRibbonUpdateMs = ribbonUpdateMs;
        perfLastControlsMs = controlsMs;
        perfLastRenderMs = renderMs;

        perfWindowFrameCount += 1;
        perfWindowFrameTotalMs += totalFrameMs;
        perfWindowMaxFrameMs = Math.max(perfWindowMaxFrameMs, totalFrameMs);
        perfWindowTileTickTotalMs += tileTickMs;
        perfWindowFlowUpdateTotalMs += flowUpdateMs;
        perfWindowRibbonUpdateTotalMs += ribbonUpdateMs;
        perfWindowControlsTotalMs += controlsMs;
        perfWindowRenderTotalMs += renderMs;

        if (wrapTiles !== 0) {
            perfWindowWrapEvents += 1;
            perfWrapEventsTotal += 1;
            perfLastWrapIntervalMs = perfLastWrapTimeMs ? now - perfLastWrapTimeMs : null;
            perfLastWrapTimeMs = now;
            perfLastWrapTiles = wrapTiles;
            perfLastWrapFlowUpdateMs = flowUpdateMs;
            perfLastWrapFrameMs = totalFrameMs;
            perfLastWrapMaterialCount = wrapMaterialCount;
        }

        if (now - perfWindowStart >= PERF_SAMPLE_WINDOW_MS) {
            publishPerfTelemetry(now);
        }
    }

    // ── Pause / Resume ─────────────────────────────────────────────────

    /**
     * Pause the render loop to free GPU/CPU resources
     * (e.g., during Slyce video processing)
     */
    function pauseRenderLoop() {
        if (renderLoopPaused) return;
        renderLoopPaused = true;
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        console.log('[ThreeSetup] Render loop paused');
    }

    /**
     * Resume a previously paused render loop
     */
    function resumeRenderLoop() {
        if (!renderLoopPaused) return;
        renderLoopPaused = false;
        if (renderCallback) {
            startRenderLoop(renderCallback);
        }
        console.log('[ThreeSetup] Render loop resumed');
    }

    // ── Tab-visibility & GPU device-loss recovery ──────────────────────
    //
    // Browsers may reclaim GPU resources from background tabs.  We handle
    // this by:
    //   1.  Pausing the render loop when the tab is hidden (saves GPU).
    //   2.  Listening for device/context loss via the setup modules.
    //   3.  When the tab becomes visible again after a loss, performing a
    //       full teardown → reinitialize cycle so the user never needs to
    //       manually refresh.

    /**
     * Handle document.visibilitychange events.
     * - hidden  → pause rendering proactively to save GPU
     * - visible → resume, or recover if the GPU device was lost
     */
    async function _onVisibilityChange() {
        if (document.visibilityState === 'hidden') {
            ctx.headTracking?.pauseForVisibility?.();

            // Only pause if we initiated it (don't interfere with Slyce pausing)
            if (ctx.isInitialized.value && !renderLoopPaused && !ctx.isDeviceLost.value) {
                pausedByVisibility = true;
                pauseRenderLoop();
                console.log('[ThreeSetup] Tab hidden — render loop paused to conserve GPU');
            }
        } else if (document.visibilityState === 'visible') {
            if (ctx.isDeviceLost.value) {
                // GPU device was lost while backgrounded — need full recovery
                pausedByVisibility = false;
                await _recoverFromDeviceLoss();
            } else if (pausedByVisibility) {
                // Normal un-hide — resume the loop we paused
                pausedByVisibility = false;
                resumeRenderLoop();
                await ctx.headTracking?.resumeFromVisibility?.();
                console.log('[ThreeSetup] Tab visible — render loop resumed');
            }
        }
    }

    /**
     * Full recovery: tear down the dead renderer and reinitialize everything
     * from scratch (renderer, scene, camera, textures, ribbon, etc.).
     * Uses the reinitCallback registered on the viewer store by ThreeCanvas.
     */
    async function _recoverFromDeviceLoss() {
        if (ctx.isRecovering.value) return; // guard re-entrancy
        ctx.isRecovering.value = true;
        console.log('[ThreeSetup] Recovering from GPU device loss…');

        try {
            // Tear down all GPU resources (sets isInitialized = false)
            if (deps.teardownViewer) deps.teardownViewer();

            // Reinitialize via the callback registered by ThreeCanvas.vue.
            // This recreates renderer, scene, tile manager, default ribbon, etc.
            if (ctx.app.reinitCallback) {
                await ctx.app.reinitCallback();
                console.log('[ThreeSetup] GPU recovery complete — viewer restored');
            } else {
                console.error('[ThreeSetup] No reinitCallback available — user must refresh');
            }
        } catch (e) {
            console.error('[ThreeSetup] GPU recovery failed:', e);
        } finally {
            ctx.isRecovering.value = false;
            ctx.isDeviceLost.value = false;
        }
    }

    // Attach the listener once per composable instance
    document.addEventListener('visibilitychange', _onVisibilityChange);

    // ── Start / Stop ───────────────────────────────────────────────────

    /**
     * Start the render loop
     */
    function startRenderLoop(callback) {
        if (!ctx.renderer.value) {
            console.error('[ThreeSetup] Cannot start render loop - not initialized');
            return;
        }

        renderCallback = callback;

        // If the loop is paused (e.g., during Slyce processing), store the
        // callback but don't actually start animating. resumeRenderLoop will
        // kick it off when ready.
        if (renderLoopPaused) return;
        
        function animate() {
            const frameStartMs = performance.now();
            const now = frameStartMs;
            const elapsedTime = now / 1000;
            // Compute per-frame delta; clamp to avoid jumps after tab-switch
            const deltaSec = lastFrameTime === 0 ? 0.016 : Math.min((now - lastFrameTime) / 1000, 0.1);
            lastFrameTime = now;

            let tileTickMs = 0;
            let flowUpdateMs = 0;
            let ribbonUpdateMs = 0;
            let controlsMs = 0;
            let renderMs = 0;

            // FPS measurement — sample every 250ms
            fpsFrameCount++;
            if (now - fpsLastSampleTime >= 250) {
                fps.value = Math.round(fpsFrameCount / ((now - fpsLastSampleTime) / 1000));
                fpsFrameCount = 0;
                fpsLastSampleTime = now;
            }
            
            animationId = requestAnimationFrame(animate);

            const scrollTiltDrivesTextureLayers = ctx.app.viewerControlMode === 'scrollTilt'
                && !ctx.cinematicCamera.isPlaying.value
                && ctx.app.textureAnimationEnabled;
            const scrollTiltDrivesFlow = ctx.app.viewerControlMode === 'scrollTilt'
                && !ctx.cinematicCamera.isPlaying.value
                && ctx.app.flowState !== 'off';
            const scrollTiltDrivesUndulation = ctx.app.viewerControlMode === 'scrollTilt'
                && !ctx.cinematicCamera.isPlaying.value
                && ctx.app.undulationEnabled;
            
            // Advance KTX2 layer cycling and tile flow (for texture animation)
            // Tick all TileManagers (multi-texture mode)
            const tileTickStartMs = performance.now();
            if (ctx.tileManagers.value && ctx.tileManagers.value.length > 1) {
                for (const tm of ctx.tileManagers.value) {
                    tm.tick?.(now, {
                        suppressLayerAnimation: scrollTiltDrivesTextureLayers,
                        suppressFlowAnimation: scrollTiltDrivesFlow,
                    });
                }
            } else if (ctx.tileManager.value?.tick) {
                ctx.tileManager.value.tick(now, {
                    suppressLayerAnimation: scrollTiltDrivesTextureLayers,
                    suppressFlowAnimation: scrollTiltDrivesFlow,
                });
            }
            tileTickMs = performance.now() - tileTickStartMs;

            const pendingFlowWrapTiles = ctx.tileManager.value?.getPendingFlowWrapTiles?.() || 0;
            
            // Update ribbon materials for tile flow effect (conveyor belt animation)
            const flowUpdateStartMs = performance.now();
            if (ctx.ribbonSeries.value?.updateFlowMaterials) {
                ctx.ribbonSeries.value.updateFlowMaterials();
            }
            flowUpdateMs = performance.now() - flowUpdateStartMs;
            
            // Update ribbon with current time for wave animation
            const ribbonUpdateStartMs = performance.now();
            if (ctx.ribbonSeries.value && !scrollTiltDrivesUndulation) {
                ctx.ribbonSeries.value.update(elapsedTime);
            }
            ribbonUpdateMs = performance.now() - ribbonUpdateStartMs;
            
            // Cinematic camera tick (when playing, controls are disabled)
            if (ctx.cinematicCamera.isPlaying.value) {
                ctx.cinematicCamera.tick(deltaSec);
            }

            if (ctx.app.viewerControlMode === 'headTracking' && !ctx.cinematicCamera.isPlaying.value) {
                ctx.headTracking?.tick?.(now);
            }

            if (ctx.app.viewerControlMode === 'mouseTilt' && !ctx.cinematicCamera.isPlaying.value) {
                ctx.mouseTilt?.tick?.();
            }

            if (ctx.app.viewerControlMode === 'scrollTilt' && !ctx.cinematicCamera.isPlaying.value) {
                ctx.scrollTilt?.tick?.(deltaSec, now);
            }
            
            // Call custom render callback if provided
            if (renderCallback) {
                renderCallback();
            }
            
            // Update controls (skip when cinematic is driving the camera)
            const controlsStartMs = performance.now();
            if (
                ctx.controls.value
                && !ctx.cinematicCamera.isPlaying.value
                && ctx.app.viewerControlMode === 'orbit'
            ) {
                ctx.controls.value.update();
            }
            controlsMs = performance.now() - controlsStartMs;
            
            // Render scene
            const renderStartMs = performance.now();
            if (ctx.renderer.value && ctx.scene.value && ctx.camera.value) {
                if (deps.renderScene) {
                    deps.renderScene();
                } else {
                    ctx.renderer.value.render(ctx.scene.value, ctx.camera.value);
                }
            }
            renderMs = performance.now() - renderStartMs;

            const frameEndMs = performance.now();
            recordPerfFrame({
                now: frameEndMs,
                totalFrameMs: frameEndMs - frameStartMs,
                tileTickMs,
                flowUpdateMs,
                ribbonUpdateMs,
                controlsMs,
                renderMs,
                wrapTiles: pendingFlowWrapTiles,
                wrapMaterialCount: ctx.ribbonSeries.value?._flowMaterials?.length ?? 0,
            });
        }
        
        animate();
    }

    /**
     * Stop the render loop
     */
    function stopRenderLoop() {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        renderCallback = null;
    }

    /**
     * Full reset — stop the loop and clear all internal flags.
     * Used by teardownViewer before reinitialization.
     */
    function resetState() {
        stopRenderLoop();
        renderLoopPaused = false;
        pausedByVisibility = false;
        lastFrameTime = 0;
        resetPerfTelemetry(performance.now());
    }

    // ── Cleanup ────────────────────────────────────────────────────────

    /**
     * Remove the visibility-change listener (call from onUnmounted)
     */
    function cleanupVisibility() {
        document.removeEventListener('visibilitychange', _onVisibilityChange);
    }

    return {
        fps,
        perfTelemetry,
        startRenderLoop,
        stopRenderLoop,
        pauseRenderLoop,
        resumeRenderLoop,
        resetState,
        cleanupVisibility
    };
}
