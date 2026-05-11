<template>
    <div class="tile-preview">
        <h3 class="text-xl mb-3">Summary of Tiles to be Created</h3>
        <div
            v-if="tiles?.length"
            class="tile-preview-row"
            :class="{ 'tile-preview-row-status': props.showTileStatuses }"
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
            <div :class="props.showTileStatuses ? 'tile-status-slot' : 'tile-column-slot'">
                <div :class="props.showTileStatuses ? 'tile-status-list' : 'tile-container-cols'">
                    <template
                        v-for="(tile, index) in tiles"
                        :key="`col-${tile.start}`"
                    >
                        <div
                            v-if="props.showTileStatuses"
                            class="tile-status-row"
                        >
                            <Tile
                                :start="tile.start"
                                :end="tile.end"
                                :width="width"
                                :height="height"
                                :tileIndex="index"
                                :previewUrl="previewUrls[index]"
                                :showOverlayDetails="false"
                                :processingOverlayState="tileStatusEntries[index]?.overlayState"
                            />
                            <div class="tile-status-content">
                                <div class="tile-status-heading-group">
                                    <div class="tile-status-heading">Tile {{ index + 1 }}</div>
                                    <div class="tile-status-heading-range"><span
                                            class="tile-status-heading-range-prefix-full"
                                        >Frames </span><span
                                            class="tile-status-heading-range-prefix-mobile">F</span><span
                                            class="tile-status-heading-range-value"
                                        >{{ tileStatusEntries[index]?.frameRangeText }}</span></div>
                                </div>
                                <div class="tile-status-fields">
                                    <div class="tile-status-progress-line">
                                        <span
                                            class="tile-status-progress"
                                            :class="{ 'tile-status-progress-error': tileStatusEntries[index]?.isError }"
                                            :style="getTileStatusIndicatorStyle(index)"
                                        ></span>
                                    </div>
                                    <div class="tile-status-field">
                                        <span
                                            class="tile-status-text"
                                            :class="{ 'tile-status-text-error': tileStatusEntries[index]?.isError }"
                                        >
                                            <span class="tile-status-text-desktop">{{
                                                tileStatusEntries[index]?.statusText }}</span>
                                            <span class="tile-status-text-mobile">{{
                                                tileStatusEntries[index]?.mobileStatusText }}</span>
                                        </span>
                                        <span
                                            v-if="tileStatusEntries[index]?.fpsText"
                                            class="tile-status-fps"
                                        >
                                            {{ tileStatusEntries[index]?.fpsText }}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <Tile
                            v-else
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
        },
        showTileStatuses: {
            type: Boolean,
            default: false,
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

    function parseTileStatusText(text, isError = false) {
        const normalizedText = typeof text === 'string' && text.trim()
            ? text.trim()
            : 'Queued';

        if (isError) {
            return {
                statusText: normalizedText,
                fpsText: null,
            };
        }

        const fpsMatch = normalizedText.match(/^(.*?)(?:\s*\(([^)]+FPS)\))$/i);
        if (fpsMatch) {
            return {
                statusText: fpsMatch[1].trim(),
                fpsText: fpsMatch[2].trim(),
            };
        }

        return {
            statusText: normalizedText,
            fpsText: null,
        };
    }

    function getMobileStatusText(statusText) {
        if (statusText.startsWith('Encoding layer ')) {
            return statusText.replace(/^Encoding layer\s+/, 'Encoding ');
        }

        if (statusText.startsWith('Decoding frame ')) {
            return statusText.replace(/^Decoding frame\s+/, 'Decoding ');
        }

        return statusText;
    }

    const tileStatusEntries = computed(() => {
        return tiles.value.map((tile, index) => {
            const tileNumber = index + 1;
            const errorText = app.status[`Tile ${tileNumber} Error`];
            const statusText = errorText ?? app.status[`Tile ${tileNumber}`] ?? 'Queued';
            const parsedStatus = parseTileStatusText(statusText, Boolean(errorText));

            return {
                text: statusText,
                statusText: parsedStatus.statusText,
                mobileStatusText: getMobileStatusText(parsedStatus.statusText),
                fpsText: parsedStatus.fpsText,
                frameRangeText: `${tile.start}-${tile.end}`,
                overlayState: getTileOverlayState(parsedStatus.statusText, Boolean(errorText)),
                isError: Boolean(errorText),
                progress: app.processingProgress?.tiles?.[index] ?? null,
            };
        });
    });

    function getTileOverlayState(statusText, isError = false) {
        if (isError) {
            return 'none';
        }

        if (statusText === 'Ready for Encoding') {
            return 'ready';
        }

        if (statusText.startsWith('Encoding') || statusText === 'Assembling KTX2 Layers') {
            return 'encoding';
        }

        if (statusText === 'Complete') {
            return 'complete';
        }

        return 'none';
    }

    function getTileStatusIndicatorStyle(index) {
        const entry = tileStatusEntries.value[index];
        if (!entry) {
            return null;
        }

        if (entry.isError) {
            return {
                background: '#dc2626',
            };
        }

        const progress = entry.progress;
        if (progress) {
            const decodePercent = Math.max(0, Math.min(100, (progress.decodeProgress ?? 0) * 100));
            const encodePercent = Math.max(0, Math.min(decodePercent, (progress.encodeProgress ?? 0) * 100));

            if (encodePercent >= 100) {
                return {
                    background: 'var(--processing-encoded)',
                };
            }

            return {
                background: `linear-gradient(90deg, var(--processing-encoding) 0%, var(--processing-encoding) ${encodePercent}%, var(--processing-decoding) ${encodePercent}%, var(--processing-decoding) ${decodePercent}%, var(--processing-empty) ${decodePercent}%, var(--processing-empty) 100%)`,
            };
        }

        if (entry.text === 'Complete') {
            return { background: 'var(--processing-encoded)' };
        }

        if (entry.text.startsWith('Encoding') || entry.text === 'Assembling KTX2 Layers') {
            return { background: 'var(--processing-encoding)' };
        }

        if (entry.text.startsWith('Decoding') || entry.text === 'Ready for Encoding') {
            return { background: 'var(--processing-decoding)' };
        }

        return { background: 'var(--processing-empty)' };
    }

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
        --tile-status-column-width: clamp(18rem, 30vw, 24rem);
        --processing-empty: color-mix(in srgb, var(--bg-secondary) 72%, #111827 28%);
        --processing-decoding: #9ca3af;
        --processing-encoding: #86efac;
        --processing-encoded: #22c55e;
    }

    .tile-preview-row {
        display: flex;
        flex-direction: row;
        align-items: flex-start;
        gap: 1rem;
        position: relative;
    }

    .tile-preview-row-status {
        align-items: stretch;
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

    .tile-status-slot {
        flex: 0 1 var(--tile-status-column-width);
        width: var(--tile-status-column-width);
        min-width: min(100%, 16rem);
    }

    .tile-status-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        width: 100%;
    }

    .tile-status-row {
        display: flex;
        align-items: center;
        gap: 1rem;
        width: calc(100% - 1rem);
        min-width: 0;
        box-sizing: border-box;
        padding-right: 1rem;
        background: #1f2937;
    }

    .tile-status-row :deep(.tile) {
        flex: 0 0 var(--tile-column-width);
        width: var(--tile-column-width);
        min-width: var(--tile-column-width);
    }

    .tile-status-content {
        display: flex;
        flex-direction: column;
        gap: 0.55rem;
        min-width: 0;
        flex: 1 1 0;
    }

    .tile-status-heading-group {
        display: flex;
        flex-direction: row;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.75rem;
        min-width: 0;
    }

    .tile-status-heading {
        font-size: 1.05rem;
        font-weight: 600;
        color: var(--text-primary);
        line-height: 1.3;
        white-space: pre;
    }

    .tile-status-heading-range {
        color: var(--text-secondary);
        font-weight: 500;
        font-size: 0.82rem;
        line-height: 1.2;
        font-variant-numeric: tabular-nums;
        flex: 0 0 auto;
        text-align: right;
    }

    .tile-status-heading-range-prefix-mobile {
        display: none;
    }

    .tile-status-fields {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
        min-width: 0;
    }

    .tile-status-field {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        min-width: 0;
    }

    .tile-status-progress-line {
        width: 100%;
        min-width: 0;
    }

    .tile-status-progress {
        display: block;
        width: 100%;
        height: 0.7rem;
        min-width: 0;
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border-primary) 70%, transparent 30%);
        background: var(--processing-empty);
    }

    .tile-status-progress-error {
        box-shadow: inset 0 0 0 1px rgba(127, 29, 29, 0.45);
    }

    .tile-status-text {
        font-size: 0.95rem;
        color: var(--text-primary);
        line-height: 1.35;
        min-width: 0;
        display: block;
        font-variant-numeric: tabular-nums;
        text-wrap: balance;
    }

    .tile-status-text-mobile {
        display: none;
    }

    .tile-status-fps {
        display: block;
        min-width: 0;
        color: var(--text-secondary);
        font-size: 0.9rem;
        line-height: 1.25;
        font-variant-numeric: tabular-nums;
    }

    .tile-status-text-error {
        color: #ef4444;
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

    @media (max-width: 1023px) {
        .tile-preview-row-status {
            flex-direction: column;
        }

        .tile-status-slot {
            width: 100%;
            max-width: none;
        }

        .tile-status-row {
            align-items: flex-start;
        }
    }

    @media (max-width: 767px) {
        .tile-status-row {
            width: 100%;
            padding-right: 0;
            flex-direction: column;
            align-items: stretch;
        }

        .tile-status-row :deep(.tile) {
            width: 100%;
            min-width: 0;
            max-width: none;
            flex: 0 0 auto;
        }

        .tile-status-content,
        .tile-status-heading-group {
            width: 100%;
        }

        .tile-status-heading-range-prefix-full {
            display: none;
        }

        .tile-status-heading-range-prefix-mobile {
            display: inline;
        }

        .tile-status-text-desktop {
            display: none;
        }

        .tile-status-text-mobile {
            display: inline;
        }
    }
</style>
