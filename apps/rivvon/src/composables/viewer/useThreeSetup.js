// src/composables/viewer/useThreeSetup.js
// Three.js initialization composable for rivvon
//
// This is the top-level coordinator that wires together the sub-composables.
// The public API surface is unchanged — consumers import { useThreeSetup }.

import { ref, shallowRef, onUnmounted } from 'vue';
import { useViewerStore } from '../../stores/viewerStore';
import { initThree as initThreeModule } from '../../modules/viewer/threeSetup';
import { TileManager } from '../../modules/viewer/tileManager';
import { useCinematicCamera } from './useCinematicCamera';
import { useHeadTracking } from './useHeadTracking';
import { useMouseTilt } from './useMouseTilt';
import { useRenderFilter } from './useRenderFilter';
import { useRenderLoop } from './useRenderLoop';
import { useSceneBackground } from './useSceneBackground';
import { useRibbonBuilder } from './useRibbonBuilder';
import { useTextureLoader } from './useTextureLoader';
import { useSceneExport } from './useSceneExport';

export function useThreeSetup() {
    const app = useViewerStore();
    
    // ── Shared reactive state ──────────────────────────────────────────

    // Use shallowRef for complex objects to avoid deep reactivity overhead
    const scene = shallowRef(null);
    const camera = shallowRef(null);
    const renderer = shallowRef(null);
    const controls = shallowRef(null);
    const tileManager = shallowRef(null);
    const tileManagers = shallowRef([]); // Array of TileManagers for multi-texture mode
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
    const headTracking = useHeadTracking({
        app,
        scene,
        camera,
        renderer,
        controls,
        tileManager,
        tileManagers,
        ribbon,
        ribbonSeries,
        isInitialized,
        resetCamera,
        backgroundTexture,
        isDeviceLost,
        isRecovering,
        cinematicCamera,
    });

    // Context object shared by all sub-composables
    const ctx = {
        app,
        scene, camera, renderer, controls,
        tileManager, tileManagers,
        ribbon, ribbonSeries,
        isInitialized, resetCamera, backgroundTexture,
        isDeviceLost, isRecovering,
        cinematicCamera,
        headTracking,
    };

    const mouseTilt = useMouseTilt(ctx);
    ctx.mouseTilt = mouseTilt;
    const renderFilter = useRenderFilter(ctx);

    // ── Sub-composables ────────────────────────────────────────────────
    //
    // Some sub-composables depend on functions from others. We use a
    // mutable deps object for the render loop (which needs teardownViewer,
    // defined below) to break the circular reference.

    const renderLoopDeps = {};
    const renderLoop = useRenderLoop(ctx, renderLoopDeps);

    const background = useSceneBackground(ctx);
    const ribbons = useRibbonBuilder(ctx);

    const textures = useTextureLoader(ctx, {
        rebuildRibbonsWithNewTextures: ribbons.rebuildRibbonsWithNewTextures,
        setBackgroundFromTileManager: background.setBackgroundFromTileManager,
        setFlowState: ribbons.setFlowState
    });

    const exporter = useSceneExport(ctx, {
        pauseRenderLoop: renderLoop.pauseRenderLoop,
        resumeRenderLoop: renderLoop.resumeRenderLoop,
        renderScene: renderFilter.renderScene,
    });

    // ── Initialization ─────────────────────────────────────────────────

    /**
     * Initialize Three.js scene
     */
    async function initThree(rendererType, container) {
        if (isInitialized.value) {
            console.warn('[ThreeSetup] Already initialized');
            return;
        }

        try {
            const result = await initThreeModule(rendererType);
            scene.value = result.scene;
            camera.value = result.camera;
            renderer.value = result.renderer;
            controls.value = result.controls;
            resetCamera.value = result.resetCamera;
            headTracking.attach(result.camera, result.controls);
            mouseTilt.attach(result.camera, result.controls);
            await renderFilter.initRenderFilter(result.rendererType);
            
            // Store context in app store for access by other components
            app.setThreeContext({
                scene: result.scene,
                camera: result.camera,
                renderer: result.renderer,
                controls: result.controls,
                headTracking,
                rendererType: result.rendererType,
                pauseRenderLoop: renderLoop.pauseRenderLoop,
                resumeRenderLoop: renderLoop.resumeRenderLoop,
                teardownViewer
            });

            // Initialize tile manager with default texture
            tileManager.value = new TileManager({
                renderer: result.renderer,
                rendererType: result.rendererType,
                rotate90: true,
                repeatMode: app.textureRepeatMode,
                flowAlignmentEnabled: app.flowCycleAlignmentEnabled,
                layerAnimationEnabled: app.textureAnimationEnabled,
                webgpuMaterialMode: 'node'
            });
            await tileManager.value.loadAllTiles();

            // Sync flow animation state from store
            ribbons.setFlowState(app.flowState);

            // Set blurred background from the first tile texture
            await background.setBackgroundFromTileManager();

            // Initialize cinematic camera system
            cinematicCamera.init(result.camera, result.controls);
            await headTracking.syncWithSelectedMode();
            mouseTilt.syncWithMode(app.viewerControlMode);

            // Register device-loss handler (works for both WebGPU and WebGL)
            if (result.onDeviceLost) {
                result.onDeviceLost((info) => {
                    console.warn(`[ThreeSetup] GPU device lost (${info.api}): ${info.message}`);
                    isDeviceLost.value = true;
                    renderLoop.stopRenderLoop();
                });
            }

            // Reset recovery flag on successful init
            isDeviceLost.value = false;
            isRecovering.value = false;

            isInitialized.value = true;
            console.log(`[ThreeSetup] Initialized with ${result.rendererType}`);
            
            return result;
        } catch (error) {
            console.error('[ThreeSetup] Initialization failed:', error);
            throw error;
        }
    }

    // ── Teardown ───────────────────────────────────────────────────────

    /**
     * Tear down the entire viewer — dispose all GPU resources, remove canvas,
     * and reset state so initThree can be called again.
     * Unlike onUnmounted cleanup, this preserves threeContext so the store
     * can still call reinitialize later.
     */
    function teardownViewer() {
        renderLoop.resetState();
        headTracking.detach({ releaseDetector: false });
        mouseTilt.deactivate({ restoreBaseline: false });
        cinematicCamera.dispose();
        renderFilter.disposeRenderFilter();

        background.disposeBackground();
        if (ribbon.value) { ribbon.value.dispose(); ribbon.value = null; }
        if (ribbonSeries.value) { ribbonSeries.value.dispose(); ribbonSeries.value = null; }
        // Dispose all TileManagers (multi-texture mode)
        for (const tm of tileManagers.value) {
            if (tm !== tileManager.value) tm.dispose?.();
        }
        tileManagers.value = [];
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

        console.log('[ThreeSetup] Viewer torn down (full GPU resource release)');
    }

    // Wire the circular dependency: render loop recovery needs teardownViewer
    renderLoopDeps.teardownViewer = teardownViewer;
    renderLoopDeps.renderScene = renderFilter.renderScene;

    // ── Cleanup on unmount ─────────────────────────────────────────────

    onUnmounted(() => {
        // Remove visibility listener
        renderLoop.cleanupVisibility();

        renderLoop.stopRenderLoop();
        headTracking.detach({ releaseDetector: true });
        cinematicCamera.dispose();
        renderFilter.disposeRenderFilter();
        
        background.disposeBackground();
        if (ribbon.value) {
            ribbon.value.dispose();
            ribbon.value = null;
        }
        if (ribbonSeries.value) {
            ribbonSeries.value.dispose();
            ribbonSeries.value = null;
        }
        // Dispose all TileManagers (multi-texture mode)
        for (const tm of tileManagers.value) {
            if (tm !== tileManager.value) tm.dispose?.();
        }
        tileManagers.value = [];
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

    // ── Public API (unchanged surface) ─────────────────────────────────

    return {
        // State
        scene,
        camera,
        renderer,
        controls,
        tileManager,
        tileManagers,
        ribbon,
        ribbonSeries,
        isInitialized,
        isDeviceLost,
        isRecovering,
        resetCamera,
        
        // Methods
        initThree,
        startRenderLoop: renderLoop.startRenderLoop,
        stopRenderLoop: renderLoop.stopRenderLoop,
        pauseRenderLoop: renderLoop.pauseRenderLoop,
        resumeRenderLoop: renderLoop.resumeRenderLoop,
        fps: renderLoop.fps,
        teardownViewer,
        createRibbon: ribbons.createRibbon,
        createRibbonSeries: ribbons.createRibbonSeries,
        createRibbonFromDrawing: ribbons.createRibbonFromDrawing,
        clearMultiTextureState: textures.clearMultiTextureState,
        loadTextures: textures.loadTextures,
        loadTexturesFromRemote: textures.loadTexturesFromRemote,
        loadTexturesFromLocal: textures.loadTexturesFromLocal,
        loadMultipleTextures: textures.loadMultipleTextures,
        setFlowState: ribbons.setFlowState,
        setFlowSpeed: ribbons.setFlowSpeed,
        setFlowCycleAlignmentEnabled: ribbons.setFlowCycleAlignmentEnabled,
        setTextureAnimationEnabled: ribbons.setTextureAnimationEnabled,
        setTextureRepeatMode: ribbons.setTextureRepeatMode,
        setHelixMode: ribbons.setHelixMode,
        exportImage: exporter.exportImage,
        exportVideo: exporter.exportVideo,
        exportVideoLegacy: exporter.exportVideoLegacy,
        renderFrameAtTime: exporter.renderFrameAtTime,
        getExportInfo: exporter.getExportInfo,
        setBackgroundFromUrl: background.setBackgroundFromUrl,
        setBackgroundFromTileManager: background.setBackgroundFromTileManager,
        cinematicCamera,
        headTracking,
        mouseTilt,
    };
}
