<template>
    <!-- Linear Tile Viewer - Document-like KTX2 texture display -->
    <div
        ref="wrapperRef"
        class="tile-linear-viewer"
        :class="{
            'has-tiles': hasTiles
        }"
    >
        <!-- Canvas container (handles scrolling) -->
        <div
            ref="containerRef"
            class="viewer-container"
        ></div>

        <!-- Tile info overlay -->
        <div
            v-if="hasTiles"
            class="tile-info"
        >
            {{ tileCount }} tile{{ tileCount > 1 ? 's' : '' }}
            <span v-if="displayScale < 1">({{ Math.round(displayScale * 100) }}% scale)</span>
        </div>

        <!-- Loading placeholder -->
        <div
            v-if="!hasTiles && !isInitialized"
            class="loading-message"
        >
            Waiting for tiles...
        </div>
    </div>
</template>

<script setup>
    import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
    import { useSlyceStore } from '../../stores/slyceStore';
    import { createAndInitTileLinearRenderer } from '../../modules/slyce/tileLinearRenderer.js';
    import { chooseRenderer } from '../../utils/renderer-utils.js';

    // Props
    const props = defineProps({
        ktx2BlobURLs: {
            type: Object,
            required: true
        },
        outputMode: {
            type: String,
            required: true,
            validator: (value) => ['columns', 'rows'].includes(value)
        },
        maxViewportHeight: {
            type: Number,
            default: 800
        },
        expectedTileCount: {
            type: Number,
            default: 0
        }
    });

    // Access store
    const app = useSlyceStore();

    // Template refs
    const wrapperRef = ref(null);
    const containerRef = ref(null);

    // Renderer instance
    let renderer = null;
    const isInitialized = ref(false);
    let initializationAttempted = ref(false);

    // State
    const displayScale = ref(1);

    // Computed
    const tileCount = computed(() => Object.keys(props.ktx2BlobURLs).length);
    const hasTiles = computed(() => tileCount.value > 0);

    /**
     * Initialize renderer
     */
    async function initializeRenderer() {
        if (initializationAttempted.value || !containerRef.value) {
            return;
        }

        initializationAttempted.value = true;
        const container = containerRef.value;

        // Check container visibility
        const width = container.clientWidth;
        if (width === 0) {
            console.log('[TileLinearViewer] Container not visible yet, will retry...');
            initializationAttempted.value = false;
            return;
        }

        console.log('[TileLinearViewer] Initializing with container width:', width);

        try {
            const rendererType = await chooseRenderer();
            renderer = await createAndInitTileLinearRenderer(container, rendererType, {
                tileSize: app.potResolution || 512,
                maxViewportWidth: 2560,
                maxViewportHeight: props.maxViewportHeight,
                flowDirection: props.outputMode === 'columns' ? 'horizontal' : 'vertical'
            });

            // Start animation loop
            renderer.startAnimation();

            // Start playback with current settings
            renderer.startPlayback({
                fps: app.ktx2Playback.fps,
                mode: app.crossSectionType
            });

            isInitialized.value = true;
            console.log('[TileLinearViewer] Initialized successfully');

            // Pre-allocate placeholder slots if we know the expected count
            const expected = props.expectedTileCount || tileCount.value;
            if (expected > 0) {
                renderer.preallocatePlaceholders(expected);
            }

            // Load any existing tiles
            loadTiles();
        } catch (error) {
            console.error('[TileLinearViewer] Initialization failed:', error);
            app.setStatus('Renderer Error', `Failed to initialize linear renderer: ${error.message}`);
            initializationAttempted.value = false;
        }
    }

    // Track tiles currently being loaded to avoid duplicate concurrent loads
    const loadingTiles = new Set();

    /**
     * Load tiles into renderer
     */
    function loadTiles() {
        if (!renderer) return;

        const tileNumbers = Object.keys(props.ktx2BlobURLs).sort((a, b) => Number(a) - Number(b));

        if (tileNumbers.length === 0) return;

        // Load only new tiles (placeholders count as needing load)
        tileNumbers.forEach(async (tileNumber) => {
            const existing = renderer.tiles.get(tileNumber);
            const needsLoad = !existing || existing.isPlaceholder;
            if (needsLoad && !loadingTiles.has(tileNumber)) {
                loadingTiles.add(tileNumber);
                const blobURL = props.ktx2BlobURLs[tileNumber];
                try {
                    await renderer.upsertTile(tileNumber, blobURL);
                    displayScale.value = renderer.displayScale;
                } catch (error) {
                    console.error(`[TileLinearViewer] Failed to load tile ${tileNumber}:`, error);
                } finally {
                    loadingTiles.delete(tileNumber);
                }
            }
        });
    }

    // Mount
    onMounted(async () => {
        await nextTick();
        console.log('[TileLinearViewer] Component mounted');

        // If we already have tiles, initialize immediately
        if (tileCount.value > 0) {
            await initializeRenderer();
        }
    });

    // Cleanup
    onBeforeUnmount(() => {
        if (renderer) {
            renderer.dispose();
            renderer = null;
        }
    });

    // Watch for blob URL changes
    watch(() => props.ktx2BlobURLs, async () => {
        const count = Object.keys(props.ktx2BlobURLs).length;
        console.log('[TileLinearViewer] Blob URLs changed, count:', count);

        if (count > 0) {
            if (!isInitialized.value) {
                await nextTick();
                await initializeRenderer();
            } else {
                loadTiles();
            }
        } else if (isInitialized.value && renderer) {
            renderer.clearAllTiles();
        }
    }, { deep: true, immediate: true });

    // Watch for crossSectionType changes (cycling mode)
    watch(() => app.crossSectionType, (newMode) => {
        if (renderer && renderer.isPlaying) {
            renderer.stopPlayback();
            renderer.startPlayback({
                fps: renderer.fps,
                mode: newMode
            });
        }
    });

    // Watch for outputMode changes (flow direction)
    watch(() => props.outputMode, (newMode) => {
        if (renderer) {
            renderer.flowDirection = newMode === 'columns' ? 'horizontal' : 'vertical';
            renderer.updateLayout();
        }
    });

    defineExpose({ tileCount, displayScale });
</script>

<style scoped>
    .tile-linear-viewer {
        position: relative;
        width: 100%;
        min-height: 100px;
        background: transparent;
        border-radius: 0;
        display: flex;
        align-items: center;
        justify-content: center;
    }


    .viewer-container {
        width: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 1rem;
    }

    .viewer-container :deep(canvas) {
        display: block;
        border-radius: 0.25rem;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }

    .tile-info {
        position: absolute;
        bottom: 8px;
        right: 12px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.5);
        background: rgba(0, 0, 0, 0.5);
        padding: 4px 8px;
        border-radius: 4px;
        pointer-events: none;
    }

    .loading-message {
        color: #666;
        font-size: 14px;
        padding: 2rem;
    }

    /* Scrollbar styling for overflow */
    .viewer-container::-webkit-scrollbar {
        height: 8px;
        width: 8px;
    }

    .viewer-container::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 4px;
    }

    .viewer-container::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 4px;
    }

    .viewer-container::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.3);
    }
</style>
