<script setup>
    import { ref, onMounted, onUnmounted, watch } from 'vue';
    import { useViewerStore } from '../../stores/viewerStore';
    import { useThreeSetup } from '../../composables/viewer/useThreeSetup';

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
        ribbonSeries,
        isInitialized,
        isDeviceLost,
        isRecovering,
        resetCamera,
        initThree,
        startRenderLoop,
        stopRenderLoop,
        pauseRenderLoop,
        resumeRenderLoop,
        teardownViewer,
        createRibbon,
        createRibbonSeries,
        createRibbonFromDrawing,
        clearMultiTextureState,
        loadTextures,
        loadTexturesFromRemote,
        loadTexturesFromLocal,
        loadMultipleTextures,
        setFlowState,
        setHelixMode,
        exportImage,
        exportVideo,
        exportVideoLegacy,
        renderFrameAtTime,
        getExportInfo,
        setBackgroundFromUrl,
        setBackgroundFromTileManager,
        cinematicCamera
    } = useThreeSetup();

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
                cinematicCamera
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
                cinematicCamera
            });

            // Register reinitialize callback on the store so it survives teardown
            app.setReinitCallback(reinitialize);

            console.log('[ThreeCanvas] Initialization complete');
        } catch (error) {
            console.error('[ThreeCanvas] Failed to initialize:', error);
        }
    });

    onUnmounted(() => {
        stopRenderLoop();
    });

    // Watch for flow state changes
    watch(() => app.flowState, (state) => {
        setFlowState(state);
    });

    // Watch for helix mode/option changes and rebuild ribbons
    watch(() => app.helixOptions, (options) => {
        setHelixMode(options);
    }, { deep: true });

    // Expose methods for parent component
    defineExpose({
        scene,
        camera,
        renderer,
        controls,
        tileManager,
        ribbonSeries,
        isInitialized,
        isDeviceLost,
        isRecovering,
        resetCamera,
        createRibbon,
        createRibbonSeries,
        createRibbonFromDrawing,
        clearMultiTextureState,
        loadTextures,
        loadTexturesFromRemote,
        loadTexturesFromLocal,
        loadMultipleTextures,
        setFlowState,
        setHelixMode,
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
        cinematicCamera
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
