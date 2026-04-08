// src/composables/viewer/useRenderLoop.js
// Render loop lifecycle: start/stop, pause/resume, tab visibility & GPU recovery

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
            const now = performance.now();
            const elapsedTime = now / 1000;
            // Compute per-frame delta; clamp to avoid jumps after tab-switch
            const deltaSec = lastFrameTime === 0 ? 0.016 : Math.min((now - lastFrameTime) / 1000, 0.1);
            lastFrameTime = now;
            
            animationId = requestAnimationFrame(animate);
            
            // Advance KTX2 layer cycling and tile flow (for texture animation)
            // Tick all TileManagers (multi-texture mode)
            if (ctx.tileManagers.value && ctx.tileManagers.value.length > 1) {
                for (const tm of ctx.tileManagers.value) {
                    tm.tick?.(now);
                }
            } else if (ctx.tileManager.value?.tick) {
                ctx.tileManager.value.tick(now);
            }
            
            // Update ribbon materials for tile flow effect (conveyor belt animation)
            if (ctx.ribbonSeries.value?.updateFlowMaterials) {
                ctx.ribbonSeries.value.updateFlowMaterials();
            }
            
            // Update ribbon with current time for wave animation
            if (ctx.ribbonSeries.value) {
                ctx.ribbonSeries.value.update(elapsedTime);
            }
            
            // Cinematic camera tick (when playing, controls are disabled)
            if (ctx.cinematicCamera.isPlaying.value) {
                ctx.cinematicCamera.tick(deltaSec);
            }

            if (ctx.app.viewerControlMode === 'headTracking' && !ctx.cinematicCamera.isPlaying.value) {
                ctx.headTracking?.tick?.(now);
            }
            
            // Call custom render callback if provided
            if (renderCallback) {
                renderCallback();
            }
            
            // Update controls (skip when cinematic is driving the camera)
            if (
                ctx.controls.value
                && !ctx.cinematicCamera.isPlaying.value
                && ctx.app.viewerControlMode === 'orbit'
            ) {
                ctx.controls.value.update();
            }
            
            // Render scene
            if (ctx.renderer.value && ctx.scene.value && ctx.camera.value) {
                ctx.renderer.value.render(ctx.scene.value, ctx.camera.value);
            }
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
    }

    // ── Cleanup ────────────────────────────────────────────────────────

    /**
     * Remove the visibility-change listener (call from onUnmounted)
     */
    function cleanupVisibility() {
        document.removeEventListener('visibilitychange', _onVisibilityChange);
    }

    return {
        startRenderLoop,
        stopRenderLoop,
        pauseRenderLoop,
        resumeRenderLoop,
        resetState,
        cleanupVisibility
    };
}
