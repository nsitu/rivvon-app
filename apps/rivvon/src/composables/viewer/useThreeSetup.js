// src/composables/viewer/useThreeSetup.js
// Three.js initialization composable for rivvon

import { ref, shallowRef, onUnmounted } from 'vue';
import { useViewerStore } from '../../stores/viewerStore';
import * as THREE from 'three';

// Import existing modules (these work as-is)
import { initThree as initThreeModule } from '../../modules/viewer/threeSetup';
import { TileManager } from '../../modules/viewer/tileManager';
import { Ribbon } from '../../modules/viewer/ribbon';
import { RibbonSeries } from '../../modules/viewer/ribbonSeries';
import { useCinematicCamera } from './useCinematicCamera';

export function useThreeSetup() {
    const app = useViewerStore();
    
    // Use shallowRef for complex objects to avoid deep reactivity overhead
    const scene = shallowRef(null);
    const camera = shallowRef(null);
    const renderer = shallowRef(null);
    const controls = shallowRef(null);
    const tileManager = shallowRef(null);
    const ribbon = shallowRef(null);
    const ribbonSeries = shallowRef(null);
    
    const isInitialized = ref(false);
    const resetCamera = ref(null);
    const backgroundTexture = shallowRef(null);

    // GPU device loss & recovery state
    const isDeviceLost = ref(false);
    const isRecovering = ref(false);

    // Cinematic camera system
    const cinematicCamera = useCinematicCamera();
    
    let animationId = null;
    let renderCallback = null;
    let renderLoopPaused = false;
    let lastFrameTime = 0;
    let pausedByVisibility = false; // tracks tab-hidden pausing (separate from Slyce)

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
            // Only pause if we initiated it (don't interfere with Slyce pausing)
            if (isInitialized.value && !renderLoopPaused && !isDeviceLost.value) {
                pausedByVisibility = true;
                pauseRenderLoop();
                console.log('[ThreeSetup] Tab hidden — render loop paused to conserve GPU');
            }
        } else if (document.visibilityState === 'visible') {
            if (isDeviceLost.value) {
                // GPU device was lost while backgrounded — need full recovery
                pausedByVisibility = false;
                await _recoverFromDeviceLoss();
            } else if (pausedByVisibility) {
                // Normal un-hide — resume the loop we paused
                pausedByVisibility = false;
                resumeRenderLoop();
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
        if (isRecovering.value) return; // guard re-entrancy
        isRecovering.value = true;
        console.log('[ThreeSetup] Recovering from GPU device loss…');

        try {
            // Tear down all GPU resources (sets isInitialized = false)
            teardownViewer();

            // Reinitialize via the callback registered by ThreeCanvas.vue.
            // This recreates renderer, scene, tile manager, default ribbon, etc.
            if (app.reinitCallback) {
                await app.reinitCallback();
                console.log('[ThreeSetup] GPU recovery complete — viewer restored');
            } else {
                console.error('[ThreeSetup] No reinitCallback available — user must refresh');
            }
        } catch (e) {
            console.error('[ThreeSetup] GPU recovery failed:', e);
        } finally {
            isRecovering.value = false;
            isDeviceLost.value = false;
        }
    }

    // Attach the listener once per composable instance
    document.addEventListener('visibilitychange', _onVisibilityChange);

    /**
     * Initialize Three.js scene
     */
    async function initThree(rendererType, container) {
        if (isInitialized.value) {
            console.warn('[ThreeSetup] Already initialized');
            return;
        }

        try {
            const ctx = await initThreeModule(rendererType);
            scene.value = ctx.scene;
            camera.value = ctx.camera;
            renderer.value = ctx.renderer;
            controls.value = ctx.controls;
            resetCamera.value = ctx.resetCamera;
            
            // Store context in app store for access by other components
            app.setThreeContext({
                scene: ctx.scene,
                camera: ctx.camera,
                renderer: ctx.renderer,
                controls: ctx.controls,
                rendererType: ctx.rendererType,
                pauseRenderLoop,
                resumeRenderLoop,
                teardownViewer
            });

            // Initialize tile manager with default texture
            tileManager.value = new TileManager({
                renderer: ctx.renderer,
                rendererType: ctx.rendererType,
                rotate90: true,
                webgpuMaterialMode: 'node'
            });
            await tileManager.value.loadAllTiles();

            // Sync flow animation state from store
            setFlowState(app.flowState);

            // Set blurred background from the first tile texture
            await setBackgroundFromTileManager();

            // Initialize cinematic camera system
            cinematicCamera.init(ctx.camera, ctx.controls);

            // Register device-loss handler (works for both WebGPU and WebGL)
            if (ctx.onDeviceLost) {
                ctx.onDeviceLost((info) => {
                    console.warn(`[ThreeSetup] GPU device lost (${info.api}): ${info.message}`);
                    isDeviceLost.value = true;
                    stopRenderLoop();
                });
            }

            // Reset recovery flag on successful init
            isDeviceLost.value = false;
            isRecovering.value = false;

            isInitialized.value = true;
            console.log(`[ThreeSetup] Initialized with ${ctx.rendererType}`);
            
            return ctx;
        } catch (error) {
            console.error('[ThreeSetup] Initialization failed:', error);
            throw error;
        }
    }

    /**
     * Start the render loop
     */
    function startRenderLoop(callback) {
        if (!renderer.value) {
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
            if (tileManager.value?.tick) {
                tileManager.value.tick(now);
            }
            
            // Update ribbon materials for tile flow effect (conveyor belt animation)
            if (ribbonSeries.value?.updateFlowMaterials) {
                ribbonSeries.value.updateFlowMaterials();
            }
            
            // Update ribbon with current time for wave animation
            if (ribbonSeries.value) {
                ribbonSeries.value.update(elapsedTime);
            }
            
            // Cinematic camera tick (when playing, controls are disabled)
            if (cinematicCamera.isPlaying.value) {
                cinematicCamera.tick(deltaSec);
            }
            
            // Call custom render callback if provided
            if (renderCallback) {
                renderCallback();
            }
            
            // Update controls (skip when cinematic is driving the camera)
            if (controls.value && !cinematicCamera.isPlaying.value) {
                controls.value.update();
            }
            
            // Render scene
            if (renderer.value && scene.value && camera.value) {
                renderer.value.render(scene.value, camera.value);
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
     * Export the current scene as a PNG image
     * @param {string} filename - Optional filename (default: 'rivvon-export.png')
     */
    function exportImage(filename = 'rivvon-export.png') {
        if (!renderer.value || !scene.value || !camera.value) {
            console.error('[ThreeSetup] Cannot export image - not initialized');
            return;
        }

        try {
            // Force a render to ensure the latest frame is captured
            renderer.value.render(scene.value, camera.value);

            // Get the canvas data URL
            const canvas = renderer.value.domElement;
            const dataURL = canvas.toDataURL('image/png');

            // Create a download link and trigger download
            const link = document.createElement('a');
            link.download = filename;
            link.href = dataURL;
            link.click();

            console.log('[ThreeSetup] Image exported:', filename);
        } catch (error) {
            console.error('[ThreeSetup] Failed to export image:', error);
        }
    }

    /**
     * Export the current scene as a video clip using MediaRecorder (legacy)
     * @param {Object} options - Export options
     * @param {number} options.duration - Duration in seconds (default: 5)
     * @param {number} options.fps - Frames per second (default: 30)
     * @param {string} options.filename - Output filename (default: 'rivvon-export.webm')
     * @param {Function} options.onProgress - Progress callback receiving value 0-1
     * @param {Function} options.onStart - Called when recording starts
     * @param {Function} options.onComplete - Called when recording completes with blob
     * @returns {Promise<Blob>} The recorded video blob
     */
    async function exportVideoLegacy(options = {}) {
        const {
            duration = 5,
            fps = 30,
            filename = 'rivvon-export.webm',
            onProgress = null,
            onStart = null,
            onComplete = null
        } = options;

        if (!renderer.value || !scene.value || !camera.value) {
            console.error('[ThreeSetup] Cannot export video - not initialized');
            return null;
        }

        const canvas = renderer.value.domElement;
        const stream = canvas.captureStream(fps);

        // Check for codec support - prefer VP9 for better quality
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
            ? 'video/webm;codecs=vp9'
            : 'video/webm';

        const recorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: 8000000 // 8 Mbps for good quality
        });

        const chunks = [];

        console.log(`[ThreeSetup] Starting video export: ${duration}s at ${fps}fps, codec: ${mimeType}`);

        return new Promise((resolve, reject) => {
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunks.push(e.data);
                }
            };

            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: mimeType });
                const url = URL.createObjectURL(blob);

                // Trigger download
                const link = document.createElement('a');
                link.download = filename;
                link.href = url;
                link.click();

                // Clean up
                setTimeout(() => URL.revokeObjectURL(url), 1000);

                console.log('[ThreeSetup] Video exported:', filename, `(${(blob.size / 1024 / 1024).toFixed(2)} MB)`);

                if (onComplete) onComplete(blob);
                resolve(blob);
            };

            recorder.onerror = (event) => {
                console.error('[ThreeSetup] Video export failed:', event.error);
                reject(event.error);
            };

            // Start recording
            recorder.start(100); // Collect data every 100ms for smoother progress
            if (onStart) onStart();

            // Progress tracking
            const startTime = performance.now();
            const durationMs = duration * 1000;

            const progressInterval = setInterval(() => {
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / durationMs, 1);
                if (onProgress) onProgress(progress);
            }, 100);

            // Stop after duration
            setTimeout(() => {
                clearInterval(progressInterval);
                if (recorder.state === 'recording') {
                    recorder.stop();
                }
                if (onProgress) onProgress(1);
            }, durationMs);
        });
    }

    /**
     * Create a ribbon from points
     * Note: Uses RibbonSeries internally for consistent animation behavior
     */
    async function createRibbon(points, options = {}) {
        if (!scene.value || !tileManager.value) {
            console.error('[ThreeSetup] Cannot create ribbon - not initialized');
            return null;
        }

        // Remove existing ribbon if any
        if (ribbon.value) {
            ribbon.value.dispose();
            ribbon.value = null;
        }
        
        // Remove existing series if any
        if (ribbonSeries.value) {
            ribbonSeries.value.cleanup();
        }

        // Use RibbonSeries even for single path to ensure consistent animation
        // (wave undulation and texture flow work the same way)
        ribbonSeries.value = new RibbonSeries(scene.value);
        ribbonSeries.value.setTileManager(tileManager.value);
        
        // Build from single path (wrapped in array)
        ribbonSeries.value.buildFromMultiplePaths([points], options.width || 1.2);
        ribbonSeries.value.initFlowMaterials();

        // New geometry invalidates all previous ROIs
        cinematicCamera.clearROIs();

        console.log('[ThreeSetup] Created ribbon (via series) with 1 path');

        return ribbonSeries.value;
    }

    /**
     * Create ribbon series from multiple paths
     */
    async function createRibbonSeries(pointsArray, options = {}) {
        if (!scene.value || !tileManager.value) {
            console.error('[ThreeSetup] Cannot create ribbon series - not initialized');
            return null;
        }

        // Remove existing ribbon if any
        if (ribbon.value) {
            ribbon.value.dispose();
            ribbon.value = null;
        }
        
        // Remove existing series if any
        if (ribbonSeries.value) {
            ribbonSeries.value.cleanup();
        }

        // Create new ribbon series - constructor only takes scene
        ribbonSeries.value = new RibbonSeries(scene.value);
        ribbonSeries.value.setTileManager(tileManager.value);
        
        // Build from multiple paths
        ribbonSeries.value.buildFromMultiplePaths(pointsArray, options.width || 1.2);
        ribbonSeries.value.initFlowMaterials();

        // New geometry invalidates all previous ROIs
        cinematicCamera.clearROIs();

        console.log('[ThreeSetup] Created ribbon series with', pointsArray.length, 'paths');

        return ribbonSeries.value;
    }

    /**
     * Create ribbon from raw drawing points (2D screen coordinates)
     * This handles the conversion from {x,y} to THREE.Vector3 internally
     * Note: Uses RibbonSeries internally for consistent animation behavior
     */
    async function createRibbonFromDrawing(drawPoints, options = {}) {
        if (!scene.value || !tileManager.value) {
            console.error('[ThreeSetup] Cannot create ribbon - not initialized');
            return null;
        }

        if (!drawPoints || drawPoints.length < 2) {
            console.warn('[ThreeSetup] Not enough points for ribbon');
            return null;
        }

        // Remove existing ribbon if any
        if (ribbon.value) {
            ribbon.value.dispose();
            ribbon.value = null;
        }
        
        // Remove existing series if any
        if (ribbonSeries.value) {
            ribbonSeries.value.cleanup();
        }

        // Create a temporary Ribbon to process the drawing points
        // (normalization, smoothing, etc.)
        const tempRibbon = new Ribbon(scene.value);
        
        // Get the processed points without actually building the ribbon
        const normalizedPoints = tempRibbon.normalizeDrawingPoints(drawPoints);
        const points3D = normalizedPoints.map(p => new THREE.Vector3(p.x, p.y, 0));
        const sanitizedPoints = tempRibbon.sanitizePoints(points3D);
        const smoothedPoints = tempRibbon.smoothPoints(sanitizedPoints, 150);

        // Use RibbonSeries for consistent animation behavior
        ribbonSeries.value = new RibbonSeries(scene.value);
        ribbonSeries.value.setTileManager(tileManager.value);
        
        // Build from processed points
        ribbonSeries.value.buildFromMultiplePaths([smoothedPoints], options.width || 1.2);
        ribbonSeries.value.initFlowMaterials();

        // New geometry invalidates all previous ROIs
        cinematicCamera.clearROIs();

        console.log('[ThreeSetup] Created ribbon from drawing (via series) with', drawPoints.length, 'input points');

        return ribbonSeries.value;
    }

    /**
     * Load new texture set
     */
    async function loadTextures(source) {
        if (!renderer.value) {
            console.error('[ThreeSetup] Cannot load textures - not initialized');
            return;
        }

        // Create new TileManager with the specified source
        const oldTileManager = tileManager.value;
        
        tileManager.value = new TileManager({
            source,
            renderer: renderer.value,
            rendererType: app.rendererType,
            rotate90: true,
            webgpuMaterialMode: 'node'
        });
        await tileManager.value.loadAllTiles();

        // Sync flow animation state from store
        setFlowState(app.flowState);
        
        // Rebuild ribbons with new textures
        rebuildRibbonsWithNewTextures();

        // Update scene background from new textures
        await setBackgroundFromTileManager();
    }

    /**
     * Load textures from remote API (texture browser)
     * @param {Object} textureSet - Texture set data from API
     * @param {Function} onProgress - Progress callback (stage, current, total)
     */
    async function loadTexturesFromRemote(textureSet, onProgress = null) {
        if (!tileManager.value) {
            console.error('[ThreeSetup] Cannot load remote textures - not initialized');
            return false;
        }

        try {
            const success = await tileManager.value.loadFromRemote(textureSet, onProgress);

            if (success) {
                console.log(`[ThreeSetup] Remote texture loaded: ${tileManager.value.getTileCount()} tiles`);
                
                // Rebuild ribbons with new textures
                rebuildRibbonsWithNewTextures();

                // Update scene background from new textures
                await setBackgroundFromTileManager();
            }

            return success;
        } catch (error) {
            console.error('[ThreeSetup] Failed to load remote textures:', error);
            throw error;
        }
    }

    /**
     * Load textures from local IndexedDB storage
     * @param {Object} textureSet - Texture set metadata from localStorage service
     * @param {Function} getTiles - Function to get tiles: (textureSetId) => Promise<Array>
     * @param {Function} onProgress - Progress callback (stage, current, total)
     */
    async function loadTexturesFromLocal(textureSet, getTiles, onProgress = null) {
        if (!tileManager.value) {
            console.error('[ThreeSetup] Cannot load local textures - not initialized');
            return false;
        }

        try {
            const success = await tileManager.value.loadFromLocal(textureSet, getTiles, onProgress);

            if (success) {
                console.log(`[ThreeSetup] Local texture loaded: ${tileManager.value.getTileCount()} tiles`);
                
                // Rebuild ribbons with new textures
                rebuildRibbonsWithNewTextures();

                // Update scene background from new textures
                await setBackgroundFromTileManager();
            }

            return success;
        } catch (error) {
            console.error('[ThreeSetup] Failed to load local textures:', error);
            throw error;
        }
    }

    /**
     * Rebuild existing ribbons with new textures
     */
    function rebuildRibbonsWithNewTextures() {
        console.log('[ThreeSetup] Rebuilding ribbons with new textures');

        // Update ribbon/series with new tileManager
        if (ribbon.value) {
            ribbon.value.setTileManager(tileManager.value);
            // Rebuild ribbon with new textures
            if (ribbon.value.lastPoints && ribbon.value.lastPoints.length >= 2) {
                ribbon.value.buildFromPoints(ribbon.value.lastPoints, ribbon.value.lastWidth || 1.2);
                console.log(`[ThreeSetup] Rebuilt single ribbon: ${ribbon.value.meshSegments?.length || 0} segments`);
            }
        }
        if (ribbonSeries.value) {
            ribbonSeries.value.setTileManager(tileManager.value);
            // Rebuild ribbon series with new textures
            if (ribbonSeries.value.lastPathsPoints && ribbonSeries.value.lastPathsPoints.length > 0) {
                ribbonSeries.value.buildFromMultiplePaths(
                    ribbonSeries.value.lastPathsPoints, 
                    ribbonSeries.value.lastWidth || 1.2
                );
                ribbonSeries.value.initFlowMaterials();
                console.log(`[ThreeSetup] Rebuilt ribbon series: ${ribbonSeries.value.getTotalSegmentCount()} segments`);
            }
        }
    }

    /**
     * Set flow animation state
     * @param {string} state - 'off' | 'forward' | 'backward'
     */
    function setFlowState(state) {
        if (tileManager.value) {
            const baseSpeed = app.flowSpeed || 0.25;
            if (state === 'off') {
                tileManager.value.setFlowEnabled(false);
            } else {
                // Set speed based on direction
                const speed = state === 'forward' ? baseSpeed : -baseSpeed;
                tileManager.value.setFlowSpeed(speed);
                tileManager.value.setFlowEnabled(true);
            }
        }
        app.setFlowState(state);
    }

    /**
     * Tear down the entire viewer — dispose all GPU resources, remove canvas,
     * and reset state so initThree can be called again.
     * Unlike onUnmounted cleanup, this preserves threeContext so the store
     * can still call reinitialize later.
     */
    function teardownViewer() {
        stopRenderLoop();

        if (backgroundTexture.value) {
            backgroundTexture.value.dispose();
            backgroundTexture.value = null;
            if (scene.value) scene.value.background = null;
        }
        if (ribbon.value) { ribbon.value.dispose(); ribbon.value = null; }
        if (ribbonSeries.value) { ribbonSeries.value.dispose(); ribbonSeries.value = null; }
        if (tileManager.value) { tileManager.value.dispose(); tileManager.value = null; }
        if (controls.value) { controls.value.dispose?.(); controls.value = null; }
        if (renderer.value) {
            if (renderer.value.domElement?.parentNode) {
                renderer.value.domElement.parentNode.removeChild(renderer.value.domElement);
            }
            renderer.value.dispose?.();
            renderer.value = null;
        }
        if (scene.value) {
            scene.value.traverse((object) => {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(m => m.dispose?.());
                    } else {
                        object.material.dispose?.();
                    }
                }
            });
            scene.value = null;
        }
        camera.value = null;
        resetCamera.value = null;
        isInitialized.value = false;
        renderLoopPaused = false;

        console.log('[ThreeSetup] Viewer torn down (full GPU resource release)');
    }

    /**
     * Clean up on unmount
     */
    onUnmounted(() => {
        // Remove visibility listener
        document.removeEventListener('visibilitychange', _onVisibilityChange);

        stopRenderLoop();
        
        if (backgroundTexture.value) {
            backgroundTexture.value.dispose();
            backgroundTexture.value = null;
            if (scene.value) {
                scene.value.background = null;
            }
        }
        if (ribbon.value) {
            ribbon.value.dispose();
            ribbon.value = null;
        }
        if (ribbonSeries.value) {
            ribbonSeries.value.dispose();
            ribbonSeries.value = null;
        }
        if (tileManager.value) {
            tileManager.value.dispose?.();
            tileManager.value = null;
        }
        if (controls.value) {
            controls.value.dispose?.();
            controls.value = null;
        }
        if (renderer.value) {
            // Remove canvas from DOM
            if (renderer.value.domElement && renderer.value.domElement.parentNode) {
                renderer.value.domElement.parentNode.removeChild(renderer.value.domElement);
            }
            renderer.value.dispose?.();
            renderer.value = null;
        }
        if (scene.value) {
            // Dispose all objects in scene
            scene.value.traverse((object) => {
                if (object.geometry) {
                    object.geometry.dispose();
                }
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(m => m.dispose?.());
                    } else {
                        object.material.dispose?.();
                    }
                }
            });
            scene.value = null;
        }
        camera.value = null;
        isInitialized.value = false;
        
        // Clear the context from app store
        app.setThreeContext(null);
        
        console.log('[ThreeSetup] Cleanup complete');
    });

    /**
     * Render a single frame at a precise synthetic time.
     * Used by the frame-accurate video export pipeline.
     * Advances animation state by deltaSec and renders at the given wave time.
     *
     * @param {number} waveTime - Elapsed time in seconds (for undulation phase)
     * @param {number} deltaSec - Time step since last frame (for texture cycling)
     */
    function renderFrameAtTime(waveTime, deltaSec) {
        if (!renderer.value || !scene.value || !camera.value) return;

        // 1. Advance texture layer cycling + flow with deterministic delta
        if (tileManager.value?.tickDeterministic) {
            tileManager.value.tickDeterministic(deltaSec);
        }

        // 2. Swap texture pairs if flow offset crossed threshold
        if (ribbonSeries.value?.updateFlowMaterials) {
            ribbonSeries.value.updateFlowMaterials();
        }

        // 3. Update wave undulation at the exact synthetic time
        if (ribbonSeries.value) {
            ribbonSeries.value.update(waveTime);
        }

        // 4. Render
        renderer.value.render(scene.value, camera.value);
    }

    /**
     * Frame-accurate video export using WebCodecs via mediabunny.
     * Pauses the live render loop, resizes the renderer, renders each frame
     * under a synthetic clock, encodes via CanvasSource, and restores state.
     *
     * @param {Object} options
     * @param {number} options.width - Output width in pixels (default: 1920)
     * @param {number} options.height - Output height in pixels (default: 1080)
     * @param {number} options.fps - Frames per second (default: 30)
     * @param {string} options.format - 'mp4' | 'webm' (default: 'mp4')
     * @param {number|null} options.duration - Duration in seconds, or null for auto (one seamless loop)
     * @param {string} options.filename - Output filename
     * @param {Function} options.onProgress - Progress callback (0-1)
     * @param {Function} options.onStatus - Status text callback
     * @param {AbortSignal} options.signal - Optional AbortSignal to cancel export
     * @param {string} options.cameraMovement - 'none' | 'cinematic'
     * @param {string} options.quality - 'very-low' | 'low' | 'medium' | 'high' | 'very-high' (default: 'high')
     * @returns {Promise<Blob|null>} The encoded video blob, or null on cancel
     */
    async function exportVideo(options = {}) {
        const {
            width = 1920,
            height = 1080,
            fps = 30,
            format = 'mp4',
            duration = null,
            filename = null,
            onProgress = null,
            onStatus = null,
            signal = null,
            cameraMovement = 'none',
            quality = 'high'
        } = options;

        if (!renderer.value || !scene.value || !camera.value || !tileManager.value) {
            console.error('[ThreeSetup] Cannot export video — not initialized');
            return null;
        }

        // Lazy-import mediabunny to keep it tree-shaken out of the main bundle
        const MB = await import('mediabunny');

        // Check WebCodecs support
        if (typeof VideoEncoder === 'undefined') {
            throw new Error('WebCodecs API is not available in this browser. Use Chrome 94+, Edge 94+, or Firefox 130+.');
        }

        // --- Determine codec ---
        let OutputFormat, codec;
        if (format === 'webm') {
            OutputFormat = MB.WebMOutputFormat;
            codec = 'vp9';
        } else {
            OutputFormat = MB.Mp4OutputFormat;
            codec = 'avc';
        }

        // --- Calculate duration ---
        const loopDuration = tileManager.value.getSeamlessLoopDuration?.() || 3.0;
        // When cinematic is active and no explicit duration, use the cinematic timeline duration.
        // Note: exportDuration may be updated later by prepareForExport if auto-ROIs are generated.
        let exportDuration;
        if (duration != null) {
            exportDuration = duration;
        } else if (cameraMovement === 'cinematic' && cinematicCamera.hasROIs.value) {
            exportDuration = cinematicCamera.getLoopDuration();
        } else {
            exportDuration = loopDuration;
        }
        const deltaSec = 1 / fps;

        // --- Save current state ---
        const savedWidth = renderer.value.domElement.width;
        const savedHeight = renderer.value.domElement.height;
        const savedAspect = camera.value.aspect;
        const savedPixelRatio = renderer.value.getPixelRatio();
        const savedCameraPos = camera.value.position.clone();
        const savedCameraQuat = camera.value.quaternion.clone();

        // --- Cinematic camera setup for export ---
        let cinematicReady = false;
        if (cameraMovement === 'cinematic') {
            const inst = cinematicCamera.getInstance();
            if (inst) {
                // Pass ribbonSeries so auto-ROIs can be generated if none exist
                cinematicReady = inst.prepareForExport(ribbonSeries.value);
                if (cinematicReady) {
                    // Re-compute duration from the (possibly auto-generated) timeline
                    if (duration == null) {
                        exportDuration = inst.getLoopDuration();
                    }
                    console.log(`[ThreeSetup] Cinematic camera export: ${inst.roiCount} ROIs, ${inst.getLoopDuration().toFixed(1)}s loop`);
                }
            }
            if (!cinematicReady) {
                console.warn('[ThreeSetup] Cinematic camera requested but no ROIs — camera will stay fixed');
            }
        }

        // Compute total frames (after cinematic setup which may have updated exportDuration)
        const totalFrames = Math.ceil(exportDuration * fps);

        console.log(`[ThreeSetup] Frame-accurate export: ${totalFrames} frames, ${exportDuration.toFixed(2)}s @ ${fps}fps, ${format}/${codec}, ${width}×${height}`);
        if (onStatus) onStatus(`Preparing ${format.toUpperCase()} export…`);

        // --- Pause live render loop ---
        pauseRenderLoop();

        try {
            // --- Resize renderer for export ---
            renderer.value.setPixelRatio(1); // Exact pixel output
            renderer.value.setSize(width, height);
            camera.value.aspect = width / height;
            camera.value.updateProjectionMatrix();

            // Disable orbit control damping during export
            if (controls.value) controls.value.enabled = false;

            // --- Reset animation to t=0 ---
            tileManager.value.resetAnimationState();

            // --- Create mediabunny output ---
            const output = new MB.Output({
                format: new OutputFormat(),
                target: new MB.BufferTarget()
            });

            // Map quality preset to mediabunny subjective quality constants
            const qualityMap = {
                'very-low': MB.QUALITY_VERY_LOW,
                'low': MB.QUALITY_LOW,
                'medium': MB.QUALITY_MEDIUM,
                'high': MB.QUALITY_HIGH,
                'very-high': MB.QUALITY_VERY_HIGH,
            };
            const bitrate = qualityMap[quality] ?? MB.QUALITY_HIGH;

            const videoSource = new MB.CanvasSource(renderer.value.domElement, {
                codec,
                bitrate
            });
            output.addVideoTrack(videoSource);

            await output.start();

            if (onStatus) onStatus(`Encoding ${totalFrames} frames…`);

            // --- Frame loop ---
            for (let frame = 0; frame < totalFrames; frame++) {
                // Check for cancellation
                if (signal?.aborted) {
                    console.log('[ThreeSetup] Export cancelled by user');
                    await output.finalize();
                    return null;
                }

                const t = frame * deltaSec;

                // --- Cinematic camera animation ---
                if (cinematicReady) {
                    cinematicCamera.getInstance().updateAtTime(t);
                }

                // Render this frame at the exact synthetic time
                renderFrameAtTime(t, deltaSec);

                // Feed the rendered frame to mediabunny
                await videoSource.add(t, deltaSec);

                // Report progress
                if (onProgress) onProgress((frame + 1) / totalFrames);
            }

            // --- Finalize ---
            if (onStatus) onStatus('Finalizing…');
            await output.finalize();

            const buffer = output.target.buffer;
            const mimeType = format === 'webm' ? 'video/webm' : 'video/mp4';
            const blob = new Blob([buffer], { type: mimeType });

            console.log(`[ThreeSetup] Export complete: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);

            // --- Auto-download if filename provided ---
            if (filename) {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.download = filename;
                link.href = url;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 5000);
            }

            return blob;
        } finally {
            // --- Restore renderer state ---
            renderer.value.setPixelRatio(savedPixelRatio);
            renderer.value.setSize(
                savedWidth / savedPixelRatio,
                savedHeight / savedPixelRatio
            );
            camera.value.aspect = savedAspect;
            camera.value.updateProjectionMatrix();

            if (controls.value) controls.value.enabled = true;

            // Restore camera position and orientation
            camera.value.position.copy(savedCameraPos);
            camera.value.quaternion.copy(savedCameraQuat);

            // Reset animation state back so live view starts clean
            tileManager.value.resetAnimationState();

            // Resume live render loop
            resumeRenderLoop();
        }
    }

    /**
     * Get export metadata for the UI (cycle duration, available codecs, etc.)
     * @returns {Object} Export info
     */
    function getExportInfo() {
        const tm = tileManager.value;
        return {
            seamlessLoopDuration: tm?.getSeamlessLoopDuration?.() ?? 3.0,
            layerCyclePeriod: tm?.getLayerCyclePeriod?.() ?? 1.0,
            undulationPeriod: tm?.getOptimalUndulationPeriod?.(3.0) ?? 3.0,
            layerCount: tm?.getLayerCount?.() ?? 0,
            fps: tm?.getFps?.() ?? 30,
            flowEnabled: tm?.isFlowEnabled?.() ?? false,
            flowSpeed: tm?.getFlowSpeed?.() ?? 0,
            tileCount: tm?.getTileCount?.() ?? 0,
            hasWebCodecs: typeof VideoEncoder !== 'undefined',
            hasROIs: cinematicCamera.hasROIs.value,
            cinematicDuration: cinematicCamera.getLoopDuration()
        };
    }

    return {
        // State
        scene,
        camera,
        renderer,
        controls,
        tileManager,
        ribbon,
        ribbonSeries,
        isInitialized,
        isDeviceLost,
        isRecovering,
        resetCamera,
        
        // Methods
        initThree,
        startRenderLoop,
        stopRenderLoop,
        pauseRenderLoop,
        resumeRenderLoop,
        teardownViewer,
        createRibbon,
        createRibbonSeries,
        createRibbonFromDrawing,
        loadTextures,
        loadTexturesFromRemote,
        loadTexturesFromLocal,
        setFlowState,
        exportImage,
        exportVideo,
        exportVideoLegacy,
        renderFrameAtTime,
        getExportInfo,
        setBackgroundFromUrl,
        setBackgroundFromTileManager,
        cinematicCamera
    };

    /**
     * Set scene background from the first tile of the current tileManager
     * This avoids CORS issues since the KTX2 textures are already loaded via fetch()
     * Uses the first layer of the first tile as the background source
     * @param {Object} options - Blur options
     * @param {number} options.blurRadius - Blur radius in pixels (default: 15)
     * @param {number} options.saturation - Saturation multiplier (default: 1.2)
     * @param {number} options.opacity - Background opacity 0-1 (default: 0.7)
     */
    async function setBackgroundFromTileManager(options = {}) {
         const {
        blurRadius = 40,    // Amount of blur (higher = more blur)
        saturation = 1,   // Color saturation multiplier
        opacity = 0.7       // Background opacity (0-1)
    } = options;

        // Dispose previous background texture
        if (backgroundTexture.value) {
            backgroundTexture.value.dispose();
            backgroundTexture.value = null;
        }

        if (!scene.value || !renderer.value || !tileManager.value) {
            console.warn('[ThreeSetup] Cannot set background - not initialized');
            return;
        }

        // Get the first array texture from the tile manager
        const arrayTexture = tileManager.value.getArrayTexture(0);
        if (!arrayTexture) {
            console.warn('[ThreeSetup] No array texture available for background');
            return;
        }

        const isWebGPU = app.rendererType === 'webgpu';

        try {
            if (isWebGPU) {
                await setBackgroundFromArrayTextureWebGPU(arrayTexture, blurRadius, saturation, opacity);
            } else {
                await setBackgroundFromArrayTextureWebGL(arrayTexture, blurRadius, saturation, opacity);
            }
        } catch (error) {
            console.error('[ThreeSetup] Failed to set background from tile:', error);
        }
    }

    /**
     * Set scene background from an image URL with pre-applied blur
     * This renders the background as part of the Three.js scene so it appears in exports
     * Uses GPU shader blur for both WebGL (GLSL) and WebGPU (TSL/NodeMaterial)
     * @param {string|null} imageUrl - URL of the image, or null to clear
     * @param {Object} options - Blur options
     * @param {number} options.blurRadius - Blur radius in pixels (default: 15)
     * @param {number} options.saturation - Saturation multiplier (default: 1.2)
     * @param {number} options.opacity - Background opacity 0-1 (default: 0.7)
     */
    async function setBackgroundFromUrl(imageUrl, options = {}) {
        const {
            blurRadius = 15,
            saturation = 1.2,
            opacity = 0.7
        } = options;

        // Dispose previous background texture
        if (backgroundTexture.value) {
            backgroundTexture.value.dispose();
            backgroundTexture.value = null;
        }

        if (!imageUrl) {
            if (scene.value) {
                scene.value.background = null;
            }
            return;
        }

        if (!scene.value || !renderer.value) {
            console.warn('[ThreeSetup] Cannot set background - scene/renderer not initialized');
            return;
        }

        const isWebGPU = app.rendererType === 'webgpu';

        try {
            if (isWebGPU) {
                await setBackgroundWithNodeShaderBlur(imageUrl, blurRadius, saturation, opacity);
            } else {
                await setBackgroundWithShaderBlur(imageUrl, blurRadius, saturation, opacity);
            }
        } catch (error) {
            // CORS errors are common with CDN-served images, especially on iOS Safari
            // Log but don't crash - the app works fine without the blurred background
            const isCorsError = error.message?.includes('Failed to load') || 
                               error.message?.includes('CORS') ||
                               error.message?.includes('access control');
            
            if (isCorsError) {
                console.warn('[ThreeSetup] Background image blocked by CORS - skipping blur effect. This is usually a CDN caching issue.');
            } else {
                console.error('[ThreeSetup] Failed to set background:', error);
            }
            // Continue without background - don't throw
        }
    }

    /**
     * GPU shader blur for WebGPU using TSL (Three Shading Language) NodeMaterial
     * Uses Kawase blur for efficient high-quality results
     */
    async function setBackgroundWithNodeShaderBlur(imageUrl, blurRadius, saturation, opacity) {
        // Dynamic import of TSL nodes for WebGPU
        const {
            texture: textureNode,
            uv,
            uniform,
            vec2,
            vec3,
            vec4,
            float,
            dot,
            mix,
            add,
            div,
            mul
        } = await import('three/tsl');
        const { MeshBasicNodeMaterial } = await import('three/webgpu');

        // Load the image as a Three.js texture
        const loader = new THREE.TextureLoader();
        loader.crossOrigin = 'anonymous'; // Required for CORS when loading from CDN
        const sourceTexture = await new Promise((resolve, reject) => {
            loader.load(
                imageUrl,
                resolve,
                undefined,
                () => reject(new Error('Failed to load background image'))
            );
        });
        sourceTexture.colorSpace = THREE.SRGBColorSpace;

        // Use low resolution for blur (512px max)
        const maxSize = 512;
        const aspect = sourceTexture.image.width / sourceTexture.image.height;
        const width = aspect > 1 ? maxSize : Math.round(maxSize * aspect);
        const height = aspect > 1 ? Math.round(maxSize / aspect) : maxSize;

        // Create render targets for ping-pong blur
        const rtOptions = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            colorSpace: THREE.SRGBColorSpace
        };
        let rtA = new THREE.RenderTarget(width, height, rtOptions);
        let rtB = new THREE.RenderTarget(width, height, rtOptions);

        // Create Kawase blur node material factory
        // We need to create a new material for each texture since TSL texture() requires a concrete texture
        const createBlurMaterial = (inputTexture, offsetVal, saturationVal, opacityVal) => {
            const material = new MeshBasicNodeMaterial();
            
            // Get UV coordinates
            const uvCoord = uv();
            
            // Create uniforms for non-texture values
            const uOffset = uniform(float(offsetVal));
            const uResolution = uniform(vec2(width, height));
            const uSaturation = uniform(float(saturationVal));
            const uOpacity = uniform(float(opacityVal));
            
            // Calculate texel size based on offset and resolution
            const texelSize = div(uOffset, uResolution);
            
            // Kawase blur - sample at 4 corners using the actual texture
            const sample1 = textureNode(inputTexture, add(uvCoord, vec2(mul(texelSize.x, float(-1)), mul(texelSize.y, float(-1)))));
            const sample2 = textureNode(inputTexture, add(uvCoord, vec2(texelSize.x, mul(texelSize.y, float(-1)))));
            const sample3 = textureNode(inputTexture, add(uvCoord, vec2(mul(texelSize.x, float(-1)), texelSize.y)));
            const sample4 = textureNode(inputTexture, add(uvCoord, vec2(texelSize.x, texelSize.y)));
            
            // Average the samples
            const blurredColor = div(add(add(add(sample1, sample2), sample3), sample4), float(4.0));
            
            // Apply saturation adjustment
            const gray = dot(blurredColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            const saturatedColor = mix(vec3(gray, gray, gray), blurredColor.rgb, uSaturation);
            
            // Apply opacity
            const finalColor = vec4(saturatedColor, mul(blurredColor.a, uOpacity));
            
            material.colorNode = finalColor;
            
            return material;
        };

        // Create scene and camera for blur passes
        const blurScene = new THREE.Scene();
        const blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const blurGeometry = new THREE.PlaneGeometry(2, 2);

        // Calculate number of blur passes
        const passes = Math.max(1, Math.round(blurRadius / 3));

        console.log(`[ThreeSetup] Applying GPU blur (WebGPU TSL): ${passes} passes at ${width}x${height}`);

        // First pass: render source texture to rtA
        let blurMaterial = createBlurMaterial(sourceTexture, 1.0, 1.0, 1.0);
        let blurQuad = new THREE.Mesh(blurGeometry, blurMaterial);
        blurScene.add(blurQuad);

        renderer.value.setRenderTarget(rtA);
        renderer.value.render(blurScene, blurCamera);

        // Clean up first pass material
        blurScene.remove(blurQuad);
        blurMaterial.dispose();

        // Ping-pong blur passes
        for (let i = 0; i < passes; i++) {
            const isLastPass = i === passes - 1;

            // Swap render targets
            const temp = rtA;
            rtA = rtB;
            rtB = temp;

            // Create new material with the previous pass's texture
            const offsetVal = i + 0.5;
            const satVal = isLastPass ? saturation : 1.0;
            const opacVal = isLastPass ? opacity : 1.0;
            
            blurMaterial = createBlurMaterial(rtB.texture, offsetVal, satVal, opacVal);
            blurQuad = new THREE.Mesh(blurGeometry, blurMaterial);
            blurScene.add(blurQuad);

            renderer.value.setRenderTarget(rtA);
            renderer.value.render(blurScene, blurCamera);

            // Clean up pass material
            blurScene.remove(blurQuad);
            blurMaterial.dispose();
        }

        renderer.value.setRenderTarget(null);

        // Use the render target texture directly as background
        backgroundTexture.value = rtA.texture;
        scene.value.background = rtA.texture;

        // Cleanup
        sourceTexture.dispose();
        rtB.dispose();
        blurGeometry.dispose();

        console.log('[ThreeSetup] Background set with GPU shader blur (WebGPU TSL mode)');
    }

    /**
     * GPU shader blur for WebGL using GLSL ShaderMaterial
     * Uses Kawase blur for efficient high-quality results
     */
    async function setBackgroundWithShaderBlur(imageUrl, blurRadius, saturation, opacity) {
        // Load the image as a Three.js texture
        const loader = new THREE.TextureLoader();
        loader.crossOrigin = 'anonymous'; // Required for CORS when loading from CDN
        const sourceTexture = await new Promise((resolve, reject) => {
            loader.load(
                imageUrl,
                resolve,
                undefined,
                () => reject(new Error('Failed to load background image'))
            );
        });
        sourceTexture.colorSpace = THREE.SRGBColorSpace;

        // Create blur shader material (Kawase blur)
        const blurShader = {
            uniforms: {
                tDiffuse: { value: null },
                uResolution: { value: new THREE.Vector2() },
                uOffset: { value: 1.0 },
                uSaturation: { value: saturation },
                uOpacity: { value: opacity }
            },
            vertexShader: `
                precision highp float;
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                uniform sampler2D tDiffuse;
                uniform vec2 uResolution;
                uniform float uOffset;
                uniform float uSaturation;
                uniform float uOpacity;
                varying vec2 vUv;
                
                vec3 adjustSaturation(vec3 color, float saturation) {
                    float gray = dot(color, vec3(0.2126, 0.7152, 0.0722));
                    return mix(vec3(gray), color, saturation);
                }
                
                void main() {
                    vec2 texelSize = uOffset / uResolution;
                    
                    vec4 color = vec4(0.0);
                    color += texture2D(tDiffuse, vUv + vec2(-texelSize.x, -texelSize.y));
                    color += texture2D(tDiffuse, vUv + vec2( texelSize.x, -texelSize.y));
                    color += texture2D(tDiffuse, vUv + vec2(-texelSize.x,  texelSize.y));
                    color += texture2D(tDiffuse, vUv + vec2( texelSize.x,  texelSize.y));
                    color /= 4.0;
                    
                    color.rgb = adjustSaturation(color.rgb, uSaturation);
                    color.a *= uOpacity;
                    
                    gl_FragColor = color;
                }
            `
        };

        // Use low resolution for blur (512px max)
        const maxSize = 512;
        const aspect = sourceTexture.image.width / sourceTexture.image.height;
        const width = aspect > 1 ? maxSize : Math.round(maxSize * aspect);
        const height = aspect > 1 ? Math.round(maxSize / aspect) : maxSize;

        // Create render targets for ping-pong blur
        const rtOptions = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            colorSpace: THREE.SRGBColorSpace
        };
        let rtA = new THREE.WebGLRenderTarget(width, height, rtOptions);
        let rtB = new THREE.WebGLRenderTarget(width, height, rtOptions);

        // Create scene and camera for blur passes
        const blurScene = new THREE.Scene();
        const blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const blurMaterial = new THREE.ShaderMaterial(blurShader);
        const blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMaterial);
        blurScene.add(blurQuad);

        blurMaterial.uniforms.uResolution.value.set(width, height);

        // Calculate number of blur passes
        const passes = Math.max(1, Math.round(blurRadius / 3));

        console.log(`[ThreeSetup] Applying GPU blur (WebGL GLSL): ${passes} passes at ${width}x${height}`);

        // First pass: render source texture
        blurMaterial.uniforms.tDiffuse.value = sourceTexture;
        blurMaterial.uniforms.uOffset.value = 1.0;
        blurMaterial.uniforms.uSaturation.value = 1.0;
        blurMaterial.uniforms.uOpacity.value = 1.0;

        renderer.value.setRenderTarget(rtA);
        renderer.value.render(blurScene, blurCamera);

        // Ping-pong blur passes
        for (let i = 0; i < passes; i++) {
            const isLastPass = i === passes - 1;

            const temp = rtA;
            rtA = rtB;
            rtB = temp;

            blurMaterial.uniforms.tDiffuse.value = rtB.texture;
            blurMaterial.uniforms.uOffset.value = i + 0.5;

            if (isLastPass) {
                blurMaterial.uniforms.uSaturation.value = saturation;
                blurMaterial.uniforms.uOpacity.value = opacity;
            }

            renderer.value.setRenderTarget(rtA);
            renderer.value.render(blurScene, blurCamera);
        }

        renderer.value.setRenderTarget(null);

        // Copy result to texture
        const resultTexture = rtA.texture.clone();
        resultTexture.needsUpdate = true;
        backgroundTexture.value = resultTexture;

        scene.value.background = resultTexture;

        // Cleanup
        sourceTexture.dispose();
        rtA.dispose();
        rtB.dispose();
        blurMaterial.dispose();
        blurQuad.geometry.dispose();

        console.log('[ThreeSetup] Background set with GPU shader blur (WebGL GLSL mode)');
    }

    /**
     * Set background from DataArrayTexture using WebGL
     * Samples the first layer and applies Kawase blur
     */
    async function setBackgroundFromArrayTextureWebGL(arrayTexture, blurRadius, saturation, opacity) {
        // Create shader that samples from layer 0 of the array texture
        // Must use GLSL ES 3.0 for sampler2DArray support
        // Note: Swap and flip UV to match WebGPU/tileManager orientation (90° CCW rotation)
        const sampleShader = {
            uniforms: {
                tArray: { value: arrayTexture },
                uLayer: { value: 0 }
            },
            glslVersion: THREE.GLSL3,
            vertexShader: `
                precision highp float;
                out vec2 vUv;
                void main() {
                    vUv = vec2(1.0 - uv.y, uv.x);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                precision highp sampler2DArray;
                uniform sampler2DArray tArray;
                uniform int uLayer;
                in vec2 vUv;
                out vec4 fragColor;
                void main() {
                    fragColor = texture(tArray, vec3(vUv, float(uLayer)));
                }
            `
        };

        // Use the array texture dimensions (or a reasonable max)
        const maxSize = 512;
        const width = Math.min(arrayTexture.image.width, maxSize);
        const height = Math.min(arrayTexture.image.height, maxSize);

        // Create render target to sample the array texture layer
        const rtOptions = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            colorSpace: THREE.SRGBColorSpace
        };
        const sampleRT = new THREE.WebGLRenderTarget(width, height, rtOptions);
        let rtA = new THREE.WebGLRenderTarget(width, height, rtOptions);
        let rtB = new THREE.WebGLRenderTarget(width, height, rtOptions);

        // Sample the array texture to a 2D texture
        const sampleScene = new THREE.Scene();
        const sampleCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const sampleMaterial = new THREE.ShaderMaterial(sampleShader);
        const sampleQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sampleMaterial);
        sampleScene.add(sampleQuad);

        renderer.value.setRenderTarget(sampleRT);
        renderer.value.render(sampleScene, sampleCamera);

        // Now apply blur using the sampled texture
        const blurShader = {
            uniforms: {
                tDiffuse: { value: null },
                uResolution: { value: new THREE.Vector2(width, height) },
                uOffset: { value: 1.0 },
                uSaturation: { value: 1.0 },
                uOpacity: { value: 1.0 }
            },
            vertexShader: `
                precision highp float;
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                uniform sampler2D tDiffuse;
                uniform vec2 uResolution;
                uniform float uOffset;
                uniform float uSaturation;
                uniform float uOpacity;
                varying vec2 vUv;
                
                vec3 adjustSaturation(vec3 color, float saturation) {
                    float gray = dot(color, vec3(0.2126, 0.7152, 0.0722));
                    return mix(vec3(gray), color, saturation);
                }
                
                void main() {
                    vec2 texelSize = uOffset / uResolution;
                    vec4 color = vec4(0.0);
                    color += texture2D(tDiffuse, vUv + vec2(-texelSize.x, -texelSize.y));
                    color += texture2D(tDiffuse, vUv + vec2( texelSize.x, -texelSize.y));
                    color += texture2D(tDiffuse, vUv + vec2(-texelSize.x,  texelSize.y));
                    color += texture2D(tDiffuse, vUv + vec2( texelSize.x,  texelSize.y));
                    color /= 4.0;
                    color.rgb = adjustSaturation(color.rgb, uSaturation);
                    color.a *= uOpacity;
                    gl_FragColor = color;
                }
            `
        };

        const blurScene = new THREE.Scene();
        const blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const blurMaterial = new THREE.ShaderMaterial(blurShader);
        const blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMaterial);
        blurScene.add(blurQuad);

        const passes = Math.max(1, Math.round(blurRadius / 3));
        console.log(`[ThreeSetup] Applying GPU blur from tile (WebGL): ${passes} passes at ${width}x${height}`);

        // First blur pass from sampled texture
        blurMaterial.uniforms.tDiffuse.value = sampleRT.texture;
        blurMaterial.uniforms.uOffset.value = 1.0;
        renderer.value.setRenderTarget(rtA);
        renderer.value.render(blurScene, blurCamera);

        // Ping-pong blur passes
        for (let i = 0; i < passes; i++) {
            const isLastPass = i === passes - 1;
            const temp = rtA;
            rtA = rtB;
            rtB = temp;

            blurMaterial.uniforms.tDiffuse.value = rtB.texture;
            blurMaterial.uniforms.uOffset.value = i + 0.5;

            if (isLastPass) {
                blurMaterial.uniforms.uSaturation.value = saturation;
                blurMaterial.uniforms.uOpacity.value = opacity;
            }

            renderer.value.setRenderTarget(rtA);
            renderer.value.render(blurScene, blurCamera);
        }

        renderer.value.setRenderTarget(null);

        // Use result as background - keep rtA alive, don't dispose it!
        backgroundTexture.value = rtA.texture;
        scene.value.background = rtA.texture;

        // Cleanup - but NOT rtA since we're using its texture as background
        sampleRT.dispose();
        rtB.dispose();
        sampleMaterial.dispose();
        sampleQuad.geometry.dispose();
        blurMaterial.dispose();
        blurQuad.geometry.dispose();

        console.log('[ThreeSetup] Background set from tile texture (WebGL mode)');
    }

    /**
     * Set background from DataArrayTexture using WebGPU TSL
     * Samples the first layer and applies Kawase blur
     */
    async function setBackgroundFromArrayTextureWebGPU(arrayTexture, blurRadius, saturation, opacity) {
        const {
            texture: textureNode,
            uv,
            uniform,
            vec2,
            vec3,
            vec4,
            float,
            int,
            dot,
            mix,
            add,
            div,
            mul
        } = await import('three/tsl');
        const { MeshBasicNodeMaterial } = await import('three/webgpu');

        const maxSize = 512;
        const width = Math.min(arrayTexture.image.width, maxSize);
        const height = Math.min(arrayTexture.image.height, maxSize);

        const rtOptions = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            colorSpace: THREE.SRGBColorSpace
        };
        const sampleRT = new THREE.RenderTarget(width, height, rtOptions);
        let rtA = new THREE.RenderTarget(width, height, rtOptions);
        let rtB = new THREE.RenderTarget(width, height, rtOptions);

        // Use the existing tileManager material to sample layer 0
        // This correctly handles array texture sampling for WebGPU
        const existingMaterial = tileManager.value.getMaterial(0);
        if (!existingMaterial) {
            console.warn('[ThreeSetup] No material available from tileManager');
            return;
        }

        // Clone the material and set layer to 0
        const sampleMaterial = existingMaterial.clone();
        if (sampleMaterial.uniforms?.uLayer) {
            sampleMaterial.uniforms.uLayer.value = 0;
        }

        const sampleScene = new THREE.Scene();
        const sampleCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const sampleGeometry = new THREE.PlaneGeometry(2, 2);
        const sampleQuad = new THREE.Mesh(sampleGeometry, sampleMaterial);
        sampleScene.add(sampleQuad);

        renderer.value.setRenderTarget(sampleRT);
        renderer.value.render(sampleScene, sampleCamera);

        sampleScene.remove(sampleQuad);
        sampleMaterial.dispose();

        // Now blur the sampled 2D texture
        const createBlurMaterial = (inputTexture, offsetVal, saturationVal, opacityVal) => {
            const material = new MeshBasicNodeMaterial();
            const uvCoord = uv();
            const uOffset = uniform(float(offsetVal));
            const uResolution = uniform(vec2(width, height));
            const uSaturation = uniform(float(saturationVal));
            const uOpacity = uniform(float(opacityVal));

            const texelSize = div(uOffset, uResolution);

            const sample1 = textureNode(inputTexture, add(uvCoord, vec2(mul(texelSize.x, float(-1)), mul(texelSize.y, float(-1)))));
            const sample2 = textureNode(inputTexture, add(uvCoord, vec2(texelSize.x, mul(texelSize.y, float(-1)))));
            const sample3 = textureNode(inputTexture, add(uvCoord, vec2(mul(texelSize.x, float(-1)), texelSize.y)));
            const sample4 = textureNode(inputTexture, add(uvCoord, vec2(texelSize.x, texelSize.y)));

            const blurredColor = div(add(add(add(sample1, sample2), sample3), sample4), float(4.0));
            const gray = dot(blurredColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            const saturatedColor = mix(vec3(gray, gray, gray), blurredColor.rgb, uSaturation);
            const finalColor = vec4(saturatedColor, mul(blurredColor.a, uOpacity));

            material.colorNode = finalColor;
            return material;
        };

        const blurScene = new THREE.Scene();
        const blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const blurGeometry = new THREE.PlaneGeometry(2, 2);

        const passes = Math.max(1, Math.round(blurRadius / 3));
        console.log(`[ThreeSetup] Applying GPU blur from tile (WebGPU TSL): ${passes} passes at ${width}x${height}`);

        // First blur pass
        let blurMaterial = createBlurMaterial(sampleRT.texture, 1.0, 1.0, 1.0);
        let blurQuad = new THREE.Mesh(blurGeometry, blurMaterial);
        blurScene.add(blurQuad);

        renderer.value.setRenderTarget(rtA);
        renderer.value.render(blurScene, blurCamera);
        blurScene.remove(blurQuad);
        blurMaterial.dispose();

        // Ping-pong blur passes
        for (let i = 0; i < passes; i++) {
            const isLastPass = i === passes - 1;
            const temp = rtA;
            rtA = rtB;
            rtB = temp;

            const offsetVal = i + 0.5;
            const satVal = isLastPass ? saturation : 1.0;
            const opacVal = isLastPass ? opacity : 1.0;

            blurMaterial = createBlurMaterial(rtB.texture, offsetVal, satVal, opacVal);
            blurQuad = new THREE.Mesh(blurGeometry, blurMaterial);
            blurScene.add(blurQuad);

            renderer.value.setRenderTarget(rtA);
            renderer.value.render(blurScene, blurCamera);
            blurScene.remove(blurQuad);
            blurMaterial.dispose();
        }

        renderer.value.setRenderTarget(null);

        backgroundTexture.value = rtA.texture;
        scene.value.background = rtA.texture;

        // Cleanup
        sampleRT.dispose();
        rtB.dispose();
        sampleGeometry.dispose();
        blurGeometry.dispose();

        console.log('[ThreeSetup] Background set from tile texture (WebGPU TSL mode)');
    }
}
