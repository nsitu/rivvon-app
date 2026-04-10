<template>
    <div class="tile-preview">
        <!-- Columns mode: simple horizontal scroll -->
        <div
            v-if="tiles?.length && outputMode === 'columns'"
            class="tile-container-columns"
        >
            <Tile
                v-for="(tile, index) in tiles"
                :key="`col-${tile.start}`"
                :start="tile.start"
                :end="tile.end"
                :width="width"
                :height="height"
                :tileIndex="index"
                :previewUrl="previewUrls[index]"
            />
        </div>

        <!-- Rows mode: horizontal scroll with flow arrows between tiles -->
        <div
            v-if="tiles?.length && outputMode === 'rows'"
            class="tile-container-rows"
        >
            <template
                v-for="(tile, index) in tiles"
                :key="`row-${tile.start}`"
            >
                <Tile
                    :start="tile.start"
                    :end="tile.end"
                    :width="width"
                    :height="height"
                    :tileIndex="index"
                    :previewUrl="previewUrls[index]"
                />
                <!-- Arrow between tiles (not after the last one) -->
                <img
                    v-if="index < tiles.length - 1"
                    src="/row-flow.svg"
                    alt=""
                    class="row-flow-arrow"
                    aria-hidden="true"
                />
            </template>
        </div>

        <!-- Progress info (only during processing) -->
        <div
            v-if="showProgress && snapshotPreview"
            class="tile-preview-info"
        >
            {{ snapshotPreview.framesSeen }} / {{ snapshotPreview.totalFrames }} frames
            · {{ snapshotPreview.tileCount }} / {{ tiles.length }} tiles
        </div>
    </div>
</template>

<script setup>
    import { computed, watch, onBeforeUnmount } from 'vue';
    import { useSlyceStore } from '../../stores/slyceStore';
    import { TileSnapshotPreview, clearCanvasRegistry } from '../../modules/slyce/tileSnapshotPreview.js';
    import Tile from './Tile.vue';

    const app = useSlyceStore();

    const props = defineProps({
        /** The tile plan object from useTilePlan or the store */
        tilePlan: {
            type: Object,
            default: () => ({})
        }
    });

    // Derived from tilePlan for convenience
    const tiles = computed(() => props.tilePlan?.tiles || []);
    const width = computed(() => props.tilePlan?.width || 0);
    const height = computed(() => props.tilePlan?.height || 0);
    const outputMode = computed(() => app.outputMode);

    // Baked blob URLs keyed by tile index (after tile completion)
    const previewUrls = computed(() => app.tilePreviewUrls);

    // Whether to show the progress overlay
    const showProgress = computed(() => {
        return Object.keys(app.status).length > 0;
    });

    /** @type {TileSnapshotPreview|null} */
    let snapshotPreview = null;

    /**
     * Initialize the headless snapshot preview module.
     * Called when processing starts (tilePlan appears in store and mode is static).
     */
    function initSnapshot() {
        disposeSnapshot();

        if (!props.tilePlan?.tiles?.length) return;

        snapshotPreview = new TileSnapshotPreview({ tilePlan: props.tilePlan });

        // When a tile is baked to a blob URL, push it to the store
        snapshotPreview.onBaked = (tileIndex, blobUrl) => {
            app.setTilePreviewUrl(tileIndex, blobUrl);
        };

        // Expose on store so videoProcessor can call snapshot() and bake()
        app.set('tileSnapshotPreview', snapshotPreview);

        console.log('[TilePreview.vue] Snapshot preview initialized');
    }

    function disposeSnapshot() {
        if (snapshotPreview) {
            snapshotPreview.dispose();
            snapshotPreview = null;
        }
        if (app.tileSnapshotPreview) {
            app.set('tileSnapshotPreview', null);
        }
    }

    // Watch for processing start: store tilePlan gets populated
    watch(() => app.tilePlan?.tiles?.length, (len) => {
        if (len > 0) {
            initSnapshot();
        }
    });

    onBeforeUnmount(() => {
        disposeSnapshot();
    });
</script>

<style scoped>
    .tile-preview {
        position: relative;
        width: 100%;
    }

    .tile-container-columns {
        display: flex;
        flex-direction: row;
        gap: 0.25rem;
        overflow-x: auto;
        overflow-y: hidden;
        padding-bottom: 0.5rem;
        width: 100%;
        max-width: calc(120px * 2.5 + 0.5rem);
        scroll-snap-type: x mandatory;
    }

    @media (min-width: 640px) {
        .tile-container-columns {
            max-width: calc(120px * 3.5 + 0.75rem);
        }
    }

    .tile-container-columns> :deep(*) {
        flex-shrink: 0;
        scroll-snap-align: start;
    }

    /* Rows mode: horizontal scroll with flow arrows */
    .tile-container-rows {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 0.15rem;
        overflow-x: auto;
        overflow-y: hidden;
        padding-bottom: 0.5rem;
        width: 100%;
        max-width: calc(120px * 2.5 + 32px);
        scroll-snap-type: x mandatory;
    }

    @media (min-width: 640px) {
        .tile-container-rows {
            max-width: calc(120px * 3.5 + 32px);
        }
    }

    .tile-container-rows> :deep(.tile) {
        flex-shrink: 0;
        scroll-snap-align: start;
    }

    /* Arrow graphic between tiles in rows mode */
    .row-flow-arrow {
        flex-shrink: 0;
        height: 120px;
        width: auto;
        opacity: 0.5;
    }

    /* Custom scrollbar styling */
    .tile-container-columns::-webkit-scrollbar,
    .tile-container-rows::-webkit-scrollbar {
        height: 8px;
    }

    .tile-container-columns::-webkit-scrollbar-track,
    .tile-container-rows::-webkit-scrollbar-track {
        background: #f1f1f1;
        border-radius: 4px;
    }

    .tile-container-columns::-webkit-scrollbar-thumb,
    .tile-container-rows::-webkit-scrollbar-thumb {
        background: #10b981;
        border-radius: 4px;
    }

    .tile-container-columns::-webkit-scrollbar-thumb:hover,
    .tile-container-rows::-webkit-scrollbar-thumb:hover {
        background: #059669;
    }

    /* Progress info */
    .tile-preview-info {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.5);
        margin-top: 0.25rem;
    }
</style>
