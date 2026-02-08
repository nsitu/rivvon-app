<template>
    <div
        class="scanline-preview"
        :class="{ 'has-tiles': activeTileCount > 0 }"
    >
        <!-- Per-tile canvases are appended here by the module -->
        <div
            ref="containerRef"
            class="scanline-container"
        ></div>

        <!-- Progress overlay -->
        <div
            v-if="totalFrames > 0"
            class="scanline-info"
        >
            {{ framesSeen }} / {{ totalFrames }} frames
            · {{ activeTileCount }} / {{ totalTileCount }} tiles
        </div>

        <!-- Waiting state -->
        <div
            v-if="activeTileCount === 0 && !isInitialized"
            class="scanline-waiting"
        >
            Waiting for frames...
        </div>
    </div>
</template>

<script setup>
    import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
    import { useSlyceStore } from '../../stores/slyceStore';
    import { ScanlinePreview } from '../../modules/slyce/scanlinePreview.js';

    const app = useSlyceStore();

    // Template refs
    const containerRef = ref(null);

    // State
    const isInitialized = ref(false);
    const framesSeen = ref(0);
    const totalFrames = ref(0);
    const totalTileCount = ref(0);
    const activeTileCount = ref(0);

    /** @type {ScanlinePreview|null} */
    let preview = null;

    /**
     * Initialize (or reinitialize) the snapshot preview.
     * Only needs the tile plan — all sampling logic is handled by TileBuilder.
     */
    function initializePreview() {
        // Clean up any existing instance
        disposePreview();

        const tilePlan = app.tilePlan;
        if (!tilePlan?.tiles?.length || !containerRef.value) {
            return;
        }

        totalTileCount.value = tilePlan.tiles.length;

        preview = new ScanlinePreview({ tilePlan });

        // Track new tile canvases reactively
        preview.onTileCreated = () => {
            activeTileCount.value = preview.tileCount;
        };

        preview.init(containerRef.value);

        totalFrames.value = preview.totalFrames;
        isInitialized.value = true;

        // Expose instance on the store so videoProcessor can call snapshot()
        app.set('scanlinePreviewInstance', preview);

        console.log('[ScanlinePreview.vue] Initialized (snapshot mode)');
    }

    function disposePreview() {
        if (preview) {
            preview.dispose();
            preview = null;
        }
        isInitialized.value = false;
        framesSeen.value = 0;
        totalFrames.value = 0;
        totalTileCount.value = 0;
        activeTileCount.value = 0;

        // Clear store reference
        if (app.scanlinePreviewInstance) {
            app.set('scanlinePreviewInstance', null);
        }
    }

    // Keep counters in sync via the store's frameNumber
    watch(() => app.frameNumber, () => {
        if (preview) {
            framesSeen.value = preview.framesSeen;
            activeTileCount.value = preview.tileCount;
        }
    });

    // Watch for tilePlan becoming populated
    watch(() => app.tilePlan?.tiles?.length, async (len) => {
        if (len > 0 && app.previewMode === 'static' && !isInitialized.value) {
            await nextTick();
            initializePreview();
        }
    });

    // Watch previewMode — if user switches to static mid-processing
    watch(() => app.previewMode, async (mode) => {
        if (mode === 'static' && app.tilePlan?.tiles?.length && !isInitialized.value) {
            await nextTick();
            initializePreview();
        } else if (mode !== 'static') {
            disposePreview();
        }
    });

    onMounted(async () => {
        await nextTick();
        if (app.previewMode === 'static' && app.tilePlan?.tiles?.length) {
            initializePreview();
        }
    });

    onBeforeUnmount(() => {
        disposePreview();
    });
</script>

<style scoped>
    .scanline-preview {
        position: relative;
        width: 100%;
        min-height: 80px;
        background: transparent;
        border-radius: 0.375rem;
        display: flex;
        flex-direction: column;
        align-items: center;
    }

    .scanline-preview.has-tiles {
        background: #0f0f0f;
    }

    .scanline-container {
        width: 100%;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 0.75rem;
        padding: 1rem;
        overflow-y: auto;
        max-height: 80vh;
    }

    .scanline-container :deep(canvas) {
        width: 100%;
        height: auto;
    }

    .scanline-info {
        position: sticky;
        bottom: 0;
        align-self: flex-end;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.5);
        background: rgba(0, 0, 0, 0.6);
        padding: 4px 8px;
        border-radius: 4px;
        margin: 0 0.75rem 0.5rem 0;
        pointer-events: none;
    }

    .scanline-waiting {
        color: #666;
        font-size: 14px;
        padding: 2rem;
    }
</style>
