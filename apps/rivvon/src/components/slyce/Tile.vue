<script setup>

    import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
    import { useSlyceStore } from '../../stores/slyceStore';
    import { registerTileCanvas, unregisterTileCanvas } from '../../modules/slyce/tileSnapshotPreview.js';
    const app = useSlyceStore()  // Pinia store

    const props = defineProps({
        width: Number,
        height: Number,
        start: Number,
        end: Number,
        aspectRatio: { type: String, default: '1/1' },
        skip: { type: Boolean, default: false },
        previewUrl: { type: String, default: null },
        tileIndex: { type: Number, default: -1 },
        showOverlayDetails: { type: Boolean, default: true },
        processingOverlayState: { type: String, default: 'none' }
    });

    const overlayClasses = computed(() => {
        return [
            'tile-processing-overlay',
            `tile-processing-overlay-${props.processingOverlayState || 'none'}`,
        ];
    });

    const showCompletionBadge = computed(() => props.processingOverlayState === 'complete');

    const canvasRef = ref(null);

    onMounted(() => {
        if (props.tileIndex >= 0 && canvasRef.value) {
            registerTileCanvas(props.tileIndex, canvasRef.value);
        }
    });

    onBeforeUnmount(() => {
        if (props.tileIndex >= 0) {
            unregisterTileCanvas(props.tileIndex);
        }
    });

    const tileClasses = computed(() => {
        let classes = ['tile', 'tile-row', 'tile-square']
        if (props.previewUrl) classes.push('tile-has-preview')
        return classes
    })



    const tileStyle = computed(() => {
        let style = '';
        if (props.previewUrl) {
            style += `background: url(${props.previewUrl}) center / cover no-repeat;`
        }
        return style
    })

</script>
<template>

    <div
        :class="tileClasses"
        :style="tileStyle"
        class="flex flex-col items-center justify-center"
    >

        <!-- Live canvas: owned by this component, drawn to by tileSnapshotPreview via registry -->
        <canvas
            v-if="tileIndex >= 0"
            ref="canvasRef"
            class="tile-preview-canvas"
        ></canvas>

        <div :class="overlayClasses"></div>

        <div
            v-if="showCompletionBadge"
            class="tile-complete-badge"
            aria-hidden="true"
        >
            <span class="tile-complete-badge-check"></span>
        </div>

        <div
            v-if="props.showOverlayDetails"
            class="tile-labels"
        >
            <div class="flex items-center">
                <span class="small-icon material-symbols-outlined">crop_free</span>
                <span>{{ width }}</span>
                <span style="font-variant: small-caps;">px</span><sup>2</sup>
            </div>
            <div class="flex items-center">
                <span style="font-variant: small-caps;">f</span>
                <span> {{ start }} </span>
                <span style="font-variant: small-caps;">-</span>
                <span> {{ end }} </span>
            </div>
        </div>
    </div>

</template>
<style scoped>
    .small-icon {
        font-size: 0.875rem;
    }

    @media (min-width: 640px) {
        .small-icon {
            font-size: 1.125rem;
        }
    }

    .flipped-icon {
        transform: rotate(90deg);
    }


    .tile {
        padding: 0.5rem;
        min-height: 120px;
        min-width: 120px;
        font-size: 0.875rem;
        position: relative;
        overflow: hidden;
    }

    /* Live canvas: starts invisible, becomes visible via data-has-content
       set by tileSnapshotPreview.snapshot() (direct DOM, no Vue) */
    .tile-preview-canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        z-index: 0;
        opacity: 0;
        image-rendering: pixelated;
    }

    .tile-preview-canvas[data-has-content] {
        opacity: 1;
    }

    .tile-processing-overlay {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        opacity: 0;
        transition: opacity 160ms ease, background-color 160ms ease;
    }

    .tile-processing-overlay-ready {
        opacity: 1;
        background: rgba(156, 163, 175, 0.38);
    }

    .tile-processing-overlay-encoding {
        opacity: 1;
        background: rgba(134, 239, 172, 0.3);
    }

    .tile-processing-overlay-complete,
    .tile-processing-overlay-none {
        opacity: 0;
        background: transparent;
    }

    .tile-complete-badge {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 2rem;
        height: 2rem;
        border-radius: 999px;
        background: rgba(34, 197, 94, 0.96);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        transform: translate(-50%, -50%);
    }

    .tile-complete-badge-check {
        width: 0.5rem;
        height: 0.95rem;
        border-right: 0.18rem solid #ffffff;
        border-bottom: 0.18rem solid #ffffff;
        transform: rotate(40deg) translate(-0.05rem, -0.05rem);
        display: block;
    }

    .tile-row {
        background: repeating-linear-gradient(0deg,
                var(--bg-secondary),
                var(--bg-secondary) 0.25rem,
                var(--bg-muted-alt) 0.25rem,
                var(--bg-muted-alt) 0.5rem);
        /* background-size: 100% 50%;
        animation: move-stripes 4s linear infinite; */
    }

    /* While It is possible to make the stripes animate 
    I don't think it helps to communicate the concept per-se. */

    /* @keyframes move-stripes {
        0% {  background-position: 0 0;  } 
        100% { background-position: 0 100%;  }
    } */

    .tile-square {
        aspect-ratio: 1/1;
    }

    /* Backdrop for text labels — ensures readability over preview images */
    .tile-labels {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.125rem;
        position: relative;
        z-index: 2;
    }

    .tile-has-preview .tile-labels,
    .tile:has(.tile-preview-canvas[data-has-content]) .tile-labels {
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(4px);
        padding: 0.25rem 0.5rem;
        border-radius: 0.25rem;
    }

</style>