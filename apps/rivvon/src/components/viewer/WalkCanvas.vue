<script setup>
    import { ref, computed, onMounted, watch } from 'vue';
    import 'leaflet/dist/leaflet.css';
    import { useWalking } from '../../composables/viewer/useWalking';
    import { useViewerStore } from '../../stores/viewerStore';
    import { formatWalkTileFilter } from '../../modules/viewer/walkTileFilter.js';

    const props = defineProps({
        active: {
            type: Boolean,
            default: false
        }
    });

    const mapRef = ref(null);
    const app = useViewerStore();

    const {
        walkingManager,
        errorMessage,
        pointCount,
        distanceMeters,
        accuracyMeters,
        hasLocated,
        initWalking,
        setWalkingMode,
        finalizeWalk,
        clearWalk
    } = useWalking();

    const isMapVisible = computed(() => props.active && hasLocated.value);
    const showLocatingOverlay = computed(() => props.active && !hasLocated.value);

    const formattedDistance = computed(() => {
        if (distanceMeters.value >= 1000) {
            return `${(distanceMeters.value / 1000).toFixed(2)} km`;
        }

        return `${Math.round(distanceMeters.value)} m`;
    });

    const formattedAccuracy = computed(() => {
        if (!Number.isFinite(accuracyMeters.value)) {
            return null;
        }

        return `±${Math.round(accuracyMeters.value)} m`;
    });

    const showStats = computed(() => pointCount.value > 0 || !!formattedAccuracy.value);
    const walkMapStyleVars = computed(() => ({
        '--walk-map-tile-filter': formatWalkTileFilter(
            app.walkTileBrightnessMultiplier,
            app.walkTileContrastMultiplier
        )
    }));

    onMounted(() => {
        if (mapRef.value) {
            initWalking(mapRef.value);
        }

        if (props.active) {
            setWalkingMode(true);
        }
    });

    watch(() => props.active, (isActive) => {
        setWalkingMode(isActive);
    });

    watch(isMapVisible, (visible) => {
        if (!visible) return;

        console.log('[Walking] Revealing map after first location fix');

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                walkingManager.value?.map?.invalidateSize(false);
                walkingManager.value?.tileLayer?.redraw?.();
            });
        });
    });

    defineExpose({
        finalizeWalk,
        clearWalk
    });
</script>

<template>
    <div
        class="walk-canvas"
        :class="{ active: props.active }"
        :style="walkMapStyleVars"
    >
        <div
            ref="mapRef"
            class="walk-map"
        ></div>

        <div
            v-if="showLocatingOverlay"
            class="walk-locating"
        >
            <div class="walk-locating-spinner"></div>
            <div class="walk-locating-title">Finding your location</div>
            <p
                v-if="errorMessage"
                class="walk-locating-copy"
            >{{ errorMessage }}</p>
        </div>

        <div class="walk-hud">
            <div
                v-if="showStats"
                class="walk-stats"
            >
                <span>{{ pointCount }} pts</span>
                <span v-if="pointCount > 1">{{ formattedDistance }}</span>
                <span v-if="formattedAccuracy">{{ formattedAccuracy }}</span>
            </div>

            <p
                v-if="errorMessage"
                class="walk-message"
            >{{ errorMessage }}</p>
        </div>
    </div>
</template>

<style scoped>
    .walk-canvas {
        position: absolute;
        inset: 0;
        z-index: 2;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
        background:
            radial-gradient(circle at top, rgba(34, 197, 94, 0.14), transparent 35%),
            linear-gradient(180deg, #06111b 0%, #030712 100%);
    }

    .walk-canvas.active {
        opacity: 1;
        pointer-events: auto;
    }

    .walk-map {
        position: absolute;
        inset: 0;
        z-index: 0;
    }

    .walk-locating {
        position: absolute;
        inset: 0;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.85rem;
        padding: 2rem;
        text-align: center;
        color: rgba(255, 255, 255, 0.92);
        pointer-events: none;
        background:
            radial-gradient(circle at top, rgba(34, 197, 94, 0.14), transparent 35%),
            linear-gradient(180deg, #06111b 0%, #030712 100%);
    }

    .walk-locating-spinner {
        width: 2.75rem;
        height: 2.75rem;
        border-radius: 999px;
        border: 2px solid rgba(255, 255, 255, 0.14);
        border-top-color: rgba(134, 239, 172, 0.92);
        animation: walk-spin 0.8s linear infinite;
    }

    .walk-locating-title {
        font-size: 1.05rem;
        font-weight: 600;
        letter-spacing: 0.02em;
    }

    .walk-locating-copy {
        max-width: 24rem;
        margin: 0;
        color: rgba(255, 255, 255, 0.7);
        line-height: 1.5;
    }

    .walk-hud {
        position: absolute;
        top: 6rem;
        left: 1rem;
        right: 1rem;
        z-index: 2;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        pointer-events: none;
    }

    .walk-stats,
    .walk-message {
        align-self: flex-start;
        background: rgba(15, 23, 42, 0.72);
        border: 1px solid rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(12px);
        color: rgba(255, 255, 255, 0.92);
    }

    .walk-stats {
        display: flex;
        gap: 0.8rem;
        padding: 0.55rem 0.85rem;
        border-radius: 999px;
        font-size: 0.86rem;
    }

    .walk-message {
        max-width: min(34rem, 100%);
        margin: 0;
        padding: 0.8rem 1rem;
        border-radius: 16px;
        line-height: 1.4;
        font-size: 0.92rem;
    }

    .walk-message {
        color: #fecaca;
        border-color: rgba(248, 113, 113, 0.35);
    }

    :deep(.leaflet-container) {
        background: #020617;
    }

    :deep(.leaflet-container img.leaflet-tile) {
        mix-blend-mode: normal;
        opacity: 1;
        filter: var(--walk-map-tile-filter);
    }

    :deep(.leaflet-container img.leaflet-tile.leaflet-tile-loaded) {
        visibility: visible !important;
        opacity: 1 !important;
    }

    :deep(.leaflet-bottom) {
        bottom: 5.5rem;
    }

    :deep(.leaflet-control-attribution) {
        background: rgba(15, 23, 42, 0.78);
        color: rgba(255, 255, 255, 0.52);
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: none;
    }


    :deep(.leaflet-control-attribution a) {
        color: rgba(226, 232, 240, 0.72);
        transition: color 0.2s ease;
    }

    :deep(.leaflet-control-attribution a:hover) {
        color: rgba(248, 250, 252, 0.9);
    }

    @media (max-width: 768px) {
        .walk-hud {
            top: 5.5rem;
            left: 0.75rem;
            right: 0.75rem;
        }

        .walk-message {
            font-size: 0.88rem;
        }
    }

    @keyframes walk-spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>