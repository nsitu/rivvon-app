// src/composables/useThreeSetup.js
// Three.js initialization composable for rivvon

import { ref, shallowRef, onUnmounted } from 'vue';
import { useAppStore } from '../stores/appStore';
import * as THREE from 'three';

// Import existing modules (these work as-is)
import { initThree as initThreeModule } from '../modules/threeSetup';
import { TileManager } from '../modules/tileManager';
import { Ribbon } from '../modules/ribbon';
import { RibbonSeries } from '../modules/ribbonSeries';

export function useThreeSetup() {
    const app = useAppStore();
    
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
    
    let animationId = null;
    let renderCallback = null;

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
                rendererType: ctx.rendererType
            });

            // Initialize tile manager with default texture
            tileManager.value = new TileManager({
                renderer: ctx.renderer,
                rendererType: ctx.rendererType,
                rotate90: true,
                webgpuMaterialMode: 'node'
            });
            await tileManager.value.loadAllTiles();

            // Get thumbnail URL for blurred background
            const thumbnailUrl = tileManager.value.getThumbnailUrl();
            if (thumbnailUrl) {
                app.setThumbnailUrl(thumbnailUrl);
            }

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
        
        function animate() {
            const elapsedTime = performance.now() / 1000; // or use a clock
            
            animationId = requestAnimationFrame(animate);
            
            // Advance KTX2 layer cycling and tile flow (for texture animation)
            if (tileManager.value?.tick) {
                tileManager.value.tick(performance.now());
            }
            
            // Update ribbon materials for tile flow effect (conveyor belt animation)
            if (ribbonSeries.value?.updateFlowMaterials) {
                ribbonSeries.value.updateFlowMaterials();
            }
            
            // Update ribbon with current time for wave animation
            if (ribbonSeries.value) {
                ribbonSeries.value.update(elapsedTime);
            }
            
            // Call custom render callback if provided
            if (renderCallback) {
                renderCallback();
            }
            
            // Update controls
            if (controls.value) {
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
        
        // Update thumbnail
        const thumbnailUrl = tileManager.value.getThumbnailUrl();
        if (thumbnailUrl) {
            app.setThumbnailUrl(thumbnailUrl);
        }

        // Rebuild ribbons with new textures
        rebuildRibbonsWithNewTextures();
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
            }

            return success;
        } catch (error) {
            console.error('[ThreeSetup] Failed to load remote textures:', error);
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
     * Toggle flow animation
     */
    function setFlowEnabled(enabled) {
        if (tileManager.value) {
            tileManager.value.setFlowEnabled(enabled);
        }
        app.flowEnabled = enabled;
    }

    /**
     * Clean up on unmount
     */
    onUnmounted(() => {
        stopRenderLoop();
        
        if (ribbon.value) {
            ribbon.value.dispose();
        }
        if (ribbonSeries.value) {
            ribbonSeries.value.dispose();
        }
    });

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
        resetCamera,
        
        // Methods
        initThree,
        startRenderLoop,
        stopRenderLoop,
        createRibbon,
        createRibbonSeries,
        createRibbonFromDrawing,
        loadTextures,
        loadTexturesFromRemote,
        setFlowEnabled
    };
}
