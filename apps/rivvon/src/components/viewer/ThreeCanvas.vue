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
        isInitialized,
        resetCamera,
        initThree,
        startRenderLoop,
        stopRenderLoop,
        createRibbon,
        createRibbonSeries,
        createRibbonFromDrawing,
        loadTextures,
        loadTexturesFromRemote,
        loadTexturesFromLocal,
        setFlowState
    } = useThreeSetup();

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
                tileManager: tileManager.value
            });

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

    // Expose methods for parent component
    defineExpose({
        scene,
        camera,
        renderer,
        controls,
        tileManager,
        isInitialized,
        resetCamera,
        createRibbon,
        createRibbonSeries,
        createRibbonFromDrawing,
        loadTextures,
        loadTexturesFromRemote,
        loadTexturesFromLocal,
        setFlowState
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
