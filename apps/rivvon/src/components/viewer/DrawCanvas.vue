<script setup>
    import { ref, onMounted, onUnmounted, watch } from 'vue';
    import { useViewerStore } from '../../stores/viewerStore';
    import { useDrawing } from '../../composables/viewer/useDrawing';

    const props = defineProps({
        active: {
            type: Boolean,
            default: false
        }
    });

    const emit = defineEmits(['drawing-complete', 'stroke-change']);

    const app = useViewerStore();
    const canvasRef = ref(null);

    const {
        drawingManager,
        initDrawing,
        setDrawingMode,
        finalizeDrawing,
        clearDrawing
    } = useDrawing();

    onMounted(() => {
        if (canvasRef.value) {
            // Set canvas size to window size
            resizeCanvas();

            // Initialize drawing manager
            initDrawing(
                canvasRef.value,
                (normalizedStrokes) => {
                    emit('drawing-complete', normalizedStrokes);
                },
                (strokeCount) => {
                    emit('stroke-change', strokeCount);
                }
            );

            // Listen for window resize
            window.addEventListener('resize', resizeCanvas);
        }
    });

    onUnmounted(() => {
        window.removeEventListener('resize', resizeCanvas);
    });

    function resizeCanvas() {
        if (canvasRef.value) {
            canvasRef.value.width = window.innerWidth;
            canvasRef.value.height = window.innerHeight;
        }
    }

    // Watch for active prop changes
    watch(() => props.active, (isActive) => {
        setDrawingMode(isActive);
    });

    // Expose methods for parent
    defineExpose({
        finalizeDrawing,
        clearDrawing
    });
</script>

<template>
    <canvas
        ref="canvasRef"
        class="draw-canvas"
        :class="{ active: props.active }"
    ></canvas>
</template>

<style scoped>
    .draw-canvas {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 2;
        pointer-events: none;
    }

    .draw-canvas.active {
        pointer-events: auto;
        /* cursor: crosshair; */
        cursor: url("/circle-cursor.svg") 16 16, auto;
    }
</style>
