<template>
    <div class="tile-preview">
        <h3 class="text-xl mb-3">Summary of Tiles to be Created</h3>
        <div
            v-if="tiles?.length"
            class="tile-preview-row"
        >

            <div class="tile-preview-notes">
                <p class="note-line">
                    <span class="material-symbols-outlined note-icon">grid_view</span>
                    {{ tiles.length }} tile{{ tiles.length !== 1 ? 's' : '' }}
                </p>
                <p class="note-line">
                    <span class="material-symbols-outlined note-icon">aspect_ratio</span>
                    {{ width }}×{{ height }}px per tile
                </p>
                <p
                    v-if="app.crossSectionCount"
                    class="note-line"
                >
                    <span class="material-symbols-outlined note-icon">layers</span>
                    {{ app.crossSectionCount }} layers per tile
                </p>
                <p
                    v-if="props.tilePlan.skipping"
                    class="note-line"
                >
                    <span class="material-symbols-outlined note-icon">step_over</span>
                    Skip {{ props.tilePlan.skipping }} frames
                </p>
                <p
                    v-if="props.tilePlan.isScaled && props.tilePlan.scaleTo !== props.tilePlan.scaleFrom"
                    class="note-line"
                >
                    <span class="material-symbols-outlined note-icon">{{ props.tilePlan.scaleTo <
                        props.tilePlan.scaleFrom
                        ? 'close_fullscreen'
                        : 'open_in_full'
                            }}</span
                        >
                            Scale {{ props.tilePlan.scaleFrom }}px → {{ props.tilePlan.scaleTo }}px
                </p>
                <p
                    v-if="props.tilePlan.rotate"
                    class="note-line"
                >
                    <span class="material-symbols-outlined note-icon">rotate_90_degrees_cw</span>
                    Rotating {{ props.tilePlan.rotate }}°
                </p>
                <p
                    v-if="app.framesToSample > 0 && app.framesToSample < app.frameCount"
                    class="note-line"
                >
                    <span class="material-symbols-outlined note-icon">content_cut</span>
                    Frames {{ app.frameStart.toLocaleString() }}–{{ app.frameEnd.toLocaleString() }}
                </p>
                <p class="note-line">
                    <span class="material-symbols-outlined note-icon">tag</span>
                    {{ app.framesToSample.toLocaleString() }} of {{ app.frameCount.toLocaleString() }} frames
                </p>
                <p
                    v-if="app.cropMode"
                    class="note-line"
                >
                    <span class="material-symbols-outlined note-icon">crop</span>
                    {{ app.cropWidth }}×{{ app.cropHeight }}px region
                </p>
                <template v-if="props.tilePlan.notices?.length">
                    <p
                        v-for="(notice, i) in props.tilePlan.notices"
                        :key="i"
                        class="note-line note-warning"
                    >
                        <span class="material-symbols-outlined note-icon">warning</span>
                        {{ notice }}
                    </p>
                </template>
            </div>
            <!-- Tiles displayed vertically -->
            <div class="tile-column-slot">
                <div class="tile-container-cols">
                    <template
                        v-for="(tile, index) in tiles"
                        :key="`col-${tile.start}`"
                    >
                        <Tile
                            :start="tile.start"
                            :end="tile.end"
                            :width="width"
                            :height="height"
                            :tileIndex="index"
                            :previewUrl="previewUrls[index]"
                        />
                    </template>
                </div>
            </div>
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
        --tile-column-width: 10rem;
    }

    .tile-preview-row {
        display: flex;
        flex-direction: row;
        align-items: flex-start;
        gap: 1rem;
        position: relative;
    }

    .tile-column-slot {
        position: relative;
        flex: 0 0 var(--tile-column-width);
        width: var(--tile-column-width);
        align-self: stretch;
    }

    /* Tiles displayed vertically — absolutely positioned inside a reserved slot */
    .tile-container-cols {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: end;
        gap: 0.5rem;
        overflow-y: auto;
        overflow-x: hidden;
        padding-right: 0.5rem;
        width: 100%;
        scrollbar-gutter: stable;
        scroll-snap-type: y mandatory;
    }

    .tile-container-cols> :deep(.tile) {
        flex-shrink: 0;
        scroll-snap-align: start;
    }

    /* Custom scrollbar styling */
    .tile-container-cols::-webkit-scrollbar {
        width: 8px;
    }

    .tile-container-cols::-webkit-scrollbar-track {
        background: #f1f1f1;
        border-radius: 4px;
    }

    .tile-container-cols::-webkit-scrollbar-thumb {
        background: #10b981;
        border-radius: 4px;
    }

    .tile-container-cols::-webkit-scrollbar-thumb:hover {
        background: #059669;
    }

    .tile-preview-notes {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        align-self: flex-start;
        flex: 1 1 auto;
        min-width: 0;
    }

    .note-line {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 1rem;
        color: rgba(255, 255, 255, 0.6);
        line-height: 1.4;
        margin: 0;
    }

    .note-icon {
        font-size: 1rem;
        flex-shrink: 0;
    }

    .note-warning {
        color: rgba(255, 180, 80, 0.7);
    }

    /* Progress info */
    .tile-preview-info {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.5);
        margin-top: 0.25rem;
    }
</style>
