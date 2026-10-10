<script setup>
    import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
    import { useViewerStore } from '../../stores/viewerStore';
    import { useThreeSetup } from '../../composables/viewer/useThreeSetup';
    import {
        registerRendererAdjustments,
        clearRendererAdjustments,
    } from '../../modules/viewer/rendererAdjustmentBus';

    const props = defineProps({
        rendererType: {
            type: String,
            default: 'webgl'
        }
    });

    const emit = defineEmits(['initialized', 'render']);

    const app = useViewerStore();
    const containerRef = ref(null);

    const {
        scene,
        camera,
        renderer,
        controls,
        tileManager,
        tileManagers,
        ribbonSeries,
        isInitialized,
        isDeviceLost,
        isRecovering,
        resetCamera,
        initThree,
        startRenderLoop,
        stopRenderLoop,
        fps,
        perfTelemetry,
        pauseRenderLoop,
        resumeRenderLoop,
        teardownViewer,
        createRibbon,
        createRibbonSeries,
        createRibbonFromDrawing,
        createProceduralRibbon,
        updateProceduralRibbon,
        updateProceduralRibbonSettings,
        clearMultiTextureState,
        loadTextures,
        loadTexturesFromRemote,
        loadTexturesFromSession,
        loadTexturesFromLocal,
        loadTexturesFromTileRecords,
        loadMultipleTextures,
        setFlowState,
        setFlowSpeed,
        setFlowCycleAlignmentEnabled,
        setTextureAnimationEnabled,
        setTextureAnimationReversed,
        setTextureRepeatMode,
        setTextureFlipVertical,
        setNormalizeTextureOrientation,
        updateBackground,
        syncSceneColorAdjustments,
        setContrast,
        setSaturation,
        setEdgeDriftEnabled,
        setEdgeNoiseTransparencyMax,
        setEdgeNoisePatternLength,
        setEdgeNoiseMirrored,
        setFilmstripStyleEnabled,
        setFilmstripGapLength,
        setFilmstripMotionEnabled,
        setFilmstripMotionSpeed,
        setFilmstripHoleLength,
        setFilmstripAperture,
        setFilmstripHoleRoundedness,
        setHelixMode,
        cameraMotion,
        captureImagePreview,
        captureScene,
        restoreScene,
        captureImagePreviewWithSettings,
        captureImageBlobWithSettings,
        exportImageWithSettings,
        exportImage,
        exportVideo,
        exportVideoLegacy,
        renderFrameAtTime,
        getExportInfo,
        setBackgroundFromUrl,
        setBackgroundFromTileManager,
        cinematicCamera,
        headTracking,
        mouseTilt,
        scrollTilt
    } = useThreeSetup();

    const viewerControlMode = computed(() => app.viewerControlMode);

    /**
     * Fully reinitialize the viewer after a teardown.
     * Recreates renderer, scene, camera, controls, TileManager, and default textures.
     */
    async function reinitialize() {
        console.log('[ThreeCanvas] Reinitializing viewer...');
        try {
            await initThree(props.rendererType);

            // Position the new canvas
            if (renderer.value?.domElement) {
                renderer.value.domElement.style.position = 'fixed';
                renderer.value.domElement.style.top = '0';
                renderer.value.domElement.style.left = '0';
                renderer.value.domElement.style.zIndex = '0';
                renderer.value.domElement.style.filter = 'none';
                renderer.value.domElement.style.webkitFilter = 'none';
            }

            // Restart render loop
            startRenderLoop(() => { emit('render'); });

            // Notify parent so it can rebuild the ribbon, background, etc.
            emit('initialized', {
                scene: scene.value,
                camera: camera.value,
                renderer: renderer.value,
                controls: controls.value,
                tileManager: tileManager.value,
                cinematicCamera,
                headTracking,
                scrollTilt,
                viewerControlMode: viewerControlMode.value
            });

            console.log('[ThreeCanvas] Reinitialization complete');
        } catch (error) {
            console.error('[ThreeCanvas] Reinitialization failed:', error);
        }
    }

    onMounted(async () => {
        console.log('[ThreeCanvas] Mounted, containerRef:', containerRef.value);
        try {
            await initThree(props.rendererType);
            console.log('[ThreeCanvas] Three.js initialized, renderer:', renderer.value);

            // The renderer canvas is already appended to document.body by threeSetup
            // We just need to ensure it has proper styling
            if (renderer.value && renderer.value.domElement) {
                renderer.value.domElement.style.position = 'fixed';
                renderer.value.domElement.style.top = '0';
                renderer.value.domElement.style.left = '0';
                renderer.value.domElement.style.zIndex = '0';
                renderer.value.domElement.style.filter = 'none';
                renderer.value.domElement.style.webkitFilter = 'none';
            }

            // Start render loop with custom callback
            startRenderLoop(() => {
                emit('render');
            });

            emit('initialized', {
                scene: scene.value,
                camera: camera.value,
                renderer: renderer.value,
                controls: controls.value,
                tileManager: tileManager.value,
                cinematicCamera,
                headTracking,
                scrollTilt,
                viewerControlMode: viewerControlMode.value
            });

            // Register reinitialize callback on the store so it survives teardown
            app.setReinitCallback(reinitialize);

            // Expose drag-time renderer setters so slider controls can bypass
            // Pinia/Vue reactivity during continuous input. Pinia is still updated
            // on commit (@change) via the regular watcher path below.
            registerRendererAdjustments({
                setContrast,
                setSaturation,
            });

            console.log('[ThreeCanvas] Initialization complete');
        } catch (error) {
            console.error('[ThreeCanvas] Failed to initialize:', error);
        }
    });

    onUnmounted(() => {
        clearRendererAdjustments();
        stopRenderLoop();
    });

    // Watch for flow state changes
    watch(() => app.flowState, (state) => {
        if (app.isRestoringPreset) return;
        setFlowState(state);
    });

    watch(() => app.flowSpeed, (speed) => {
        if (app.isRestoringPreset) return;
        setFlowSpeed(speed);
    });

    watch(() => app.flowCycleAlignmentEnabled, (enabled) => {
        if (app.isRestoringPreset) return;
        setFlowCycleAlignmentEnabled(enabled);
    });

    watch(() => app.textureAnimationEnabled, (enabled) => {
        if (app.isRestoringPreset) return;
        setTextureAnimationEnabled(enabled);
    });

    watch(() => app.textureAnimationReversed, (reversed) => {
        if (app.isRestoringPreset) return;
        setTextureAnimationReversed(reversed);
    });

    watch(() => app.animatedBackgroundEnabled, () => {
        if (app.isRestoringPreset) return;
        setBackgroundFromTileManager().catch((error) => {
        if (app.isRestoringPreset) return;
            console.error('[ThreeCanvas] Failed to update animated scene background:', error);
        });
    });

    watch(() => app.backgroundLayerIndex, () => {
        if (app.isRestoringPreset) return;
        updateBackground();
    });

    watch(() => app.backgroundBlurEnabled, () => {
        if (app.isRestoringPreset) return;
        setBackgroundFromTileManager().catch((error) => {
        if (app.isRestoringPreset) return;
            console.error('[ThreeCanvas] Failed to update scene background blur:', error);
        });
    });

    watch(() => [app.backgroundTextureEnabled, app.backgroundTexture], () => {
        if (app.isRestoringPreset) return;
        setBackgroundFromTileManager().catch((error) => {
        if (app.isRestoringPreset) return;
            console.error('[ThreeCanvas] Failed to update scene background texture:', error);
        });
    });

    watch(() => app.backgroundBaseEnabled, () => {
        if (app.isRestoringPreset) return;
        updateBackground();
    });

    watch(() => [app.backgroundSphericalLayersEnabled, app.backgroundCurvature], () => {
        if (app.isRestoringPreset) return;
        updateBackground();
    });

    watch(() => [
        app.backgroundWaterEnabled,
        app.backgroundWaterColor,
        app.backgroundWaterFlow,
        app.backgroundWaterScale,
        app.backgroundWaterSpeed,
        app.backgroundWaterStrength,
    ], () => {
        if (app.isRestoringPreset) return;
        updateBackground();
    });

    watch(() => [app.backgroundOverlayEnabled, app.backgroundOverlayColor, app.backgroundOverlayOpacity], () => {
        if (app.isRestoringPreset) return;
        updateBackground();
    });

    watch(() => app.renderFilterMode, () => {
        if (app.isRestoringPreset) return;
        syncSceneColorAdjustments();
    });

    watch(() => app.contrast, (value) => {
        if (app.isRestoringPreset) return;
        setContrast(value);
    });

    watch(() => app.saturation, (value) => {
        if (app.isRestoringPreset) return;
        setSaturation(value);
    });

    watch(() => app.textureRepeatMode, (mode) => {
        if (app.isRestoringPreset) return;
        setTextureRepeatMode(mode);
    });

    watch(() => app.textureFlipVertical, (enabled) => {
        if (app.isRestoringPreset) return;
        setTextureFlipVertical(enabled);
    });

    watch(() => app.normalizeTextureOrientation, (enabled) => {
        if (app.isRestoringPreset) return;
        setNormalizeTextureOrientation(enabled);
    });

    watch(() => app.edgeDriftEnabled, (enabled) => {
        if (app.isRestoringPreset) return;
        setEdgeDriftEnabled(enabled);
    });

    watch(() => app.edgeNoiseTransparencyMax, (value) => {
        if (app.isRestoringPreset) return;
        setEdgeNoiseTransparencyMax(value);
    });

    watch(() => app.edgeNoisePatternLength, (value) => {
        if (app.isRestoringPreset) return;
        setEdgeNoisePatternLength(value);
    });

    watch(() => app.edgeNoiseMirrored, (enabled) => {
        if (app.isRestoringPreset) return;
        setEdgeNoiseMirrored(enabled);
    });

    watch(() => app.filmstripStyleEnabled, (enabled) => {
        if (app.isRestoringPreset) return;
        setFilmstripStyleEnabled(enabled);
    });

    watch(() => app.filmstripMotionEnabled, enabled => { if (!app.isRestoringPreset) setFilmstripMotionEnabled(enabled); });
    watch(() => app.filmstripMotionSpeed, speed => { if (!app.isRestoringPreset) setFilmstripMotionSpeed(speed); });

    watch(() => app.filmstripGapLength, (value) => {
        if (app.isRestoringPreset) return;
        setFilmstripGapLength(value);
    });

    watch(() => app.filmstripHoleLength, (value) => {
        if (app.isRestoringPreset) return;
        setFilmstripHoleLength(value);
    });

    watch(() => app.filmstripAperture, (value) => {
        if (app.isRestoringPreset) return;
        setFilmstripAperture(value);
    });

    watch(() => app.filmstripHoleRoundedness, (value) => {
        if (app.isRestoringPreset) return;
        setFilmstripHoleRoundedness(value);
    });

    // Watch for helix mode/option changes and rebuild ribbons
    watch(() => app.helixOptions, (options) => {
        if (app.isRestoringPreset) return;
        setHelixMode(options);
    }, { deep: true });

    // Expose methods for parent component
    defineExpose({
        scene,
        camera,
        renderer,
        controls,
        tileManager,
        tileManagers,
        ribbonSeries,
        isInitialized,
        isDeviceLost,
        isRecovering,
        resetCamera,
        createRibbon,
        createRibbonSeries,
        createRibbonFromDrawing,
        createProceduralRibbon,
        updateProceduralRibbon,
        updateProceduralRibbonSettings,
        clearMultiTextureState,
        loadTextures,
        loadTexturesFromRemote,
        loadTexturesFromSession,
        loadTexturesFromLocal,
        loadTexturesFromTileRecords,
        loadMultipleTextures,
        setFlowState,
        setFlowSpeed,
        setFlowCycleAlignmentEnabled,
        setTextureAnimationEnabled,
        setTextureAnimationReversed,
        setTextureRepeatMode,
        setTextureFlipVertical,
        setNormalizeTextureOrientation,
        setEdgeDriftEnabled,
        setEdgeNoiseTransparencyMax,
        setEdgeNoisePatternLength,
        setEdgeNoiseMirrored,
        setFilmstripStyleEnabled,
        setFilmstripGapLength,
        setFilmstripMotionEnabled,
        setFilmstripMotionSpeed,
        setFilmstripHoleLength,
        setFilmstripAperture,
        setFilmstripHoleRoundedness,
        setHelixMode,
        captureImagePreview,
        captureScene,
        restoreScene,
        captureImagePreviewWithSettings,
        captureImageBlobWithSettings,
        exportImageWithSettings,
        exportImage,
        exportVideo,
        exportVideoLegacy,
        renderFrameAtTime,
        getExportInfo,
        setBackgroundFromUrl,
        setBackgroundFromTileManager,
        pauseRenderLoop,
        resumeRenderLoop,
        teardownViewer,
        reinitialize,
        fps,
        perfTelemetry,
        cinematicCamera,
        cameraMotion,
        headTracking,
        mouseTilt,
        scrollTilt,
        viewerControlMode
    });
</script>

<template>
    <!-- Container is a placeholder - the actual canvas is appended to body by Three.js -->
    <div
        ref="containerRef"
        class="three-container-placeholder"
    ></div>
</template>

<style scoped>
    .three-container-placeholder {
        /* This is just a placeholder - the actual Three.js canvas is appended to body */
        display: none;
    }
</style>
