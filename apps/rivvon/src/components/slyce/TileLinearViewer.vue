<template>
    <!-- Linear Tile Viewer - Document-like KTX2 texture display -->
    <div
        ref="wrapperRef"
        class="tile-linear-viewer"
        :class="{
            'has-tiles': hasTiles,
            'is-fullscreen': isFullscreen
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
            <span v-if="displayScale < 1">({{ Math.round(displayScale * 100) }}%)</span>
        </div>

        <!-- Fullscreen toggle button -->
        <button
            v-if="hasTiles"
            class="fullscreen-button"
            @click="toggleFullscreen"
            :title="isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'"
        >
            <svg
                v-if="!isFullscreen"
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <path
                    d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
            <svg
                v-else
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <path
                    d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
            </svg>
        </button>

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
    import { TileLinearRenderer } from '../../modules/slyce/tileLinearRenderer.js';

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
    const isFullscreen = ref(false);

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
            renderer = new TileLinearRenderer();
            await renderer.init(container, {
                tileSize: app.potResolution || 512,
                maxViewportWidth: 2560,
                maxViewportHeight: 800,
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

            // Load any existing tiles
            loadTiles();
        } catch (error) {
            console.error('[TileLinearViewer] Initialization failed:', error);
            app.setStatus('Renderer Error', `Failed to initialize linear renderer: ${error.message}`);
            initializationAttempted.value = false;
        }
    }

    /**
     * Load tiles into renderer
     */
    function loadTiles() {
        if (!renderer) return;

        const tileNumbers = Object.keys(props.ktx2BlobURLs).sort((a, b) => Number(a) - Number(b));

        if (tileNumbers.length === 0) return;

        // Load only new tiles
        tileNumbers.forEach(async (tileNumber) => {
            if (!renderer.tiles.has(tileNumber)) {
                const blobURL = props.ktx2BlobURLs[tileNumber];
                try {
                    await renderer.upsertTile(tileNumber, blobURL);
                    displayScale.value = renderer.displayScale;
                } catch (error) {
                    console.error(`[TileLinearViewer] Failed to load tile ${tileNumber}:`, error);
                }
            }
        });
    }

    /**
     * Toggle fullscreen mode
     */
    function toggleFullscreen() {
        if (!wrapperRef.value) return;

        if (!document.fullscreenElement) {
            wrapperRef.value.requestFullscreen().catch(err => {
                console.error('[TileLinearViewer] Fullscreen request failed:', err);
            });
        } else {
            document.exitFullscreen();
        }
    }

    /**
     * Handle fullscreen change
     */
    function handleFullscreenChange() {
        isFullscreen.value = !!document.fullscreenElement;

        if (renderer) {
            setTimeout(() => renderer.resize(), 100);
        }
    }

    // Mount
    onMounted(async () => {
        await nextTick();
        console.log('[TileLinearViewer] Component mounted');

        document.addEventListener('fullscreenchange', handleFullscreenChange);

        // If we already have tiles, initialize immediately
        if (tileCount.value > 0) {
            await initializeRenderer();
        }
    });

    // Cleanup
    onBeforeUnmount(() => {
        document.removeEventListener('fullscreenchange', handleFullscreenChange);

        if (document.fullscreenElement) {
            document.exitFullscreen();
        }

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
</script>

<style scoped>
    .tile-linear-viewer {
        position: relative;
        width: 100%;
        min-height: 100px;
        background: transparent;
        border-radius: 0.375rem;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .tile-linear-viewer.has-tiles {
        background: #0f0f0f;
        min-height: 200px;
    }

    .tile-linear-viewer.is-fullscreen {
        border-radius: 0;
        background: #000;
    }

    .viewer-container {
        width: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 1rem;
    }

    .tile-linear-viewer.is-fullscreen .viewer-container {
        height: 100vh;
        padding: 2rem;
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

    .fullscreen-button {
        position: absolute;
        top: 12px;
        right: 12px;
        z-index: 20;
        background: rgba(0, 0, 0, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        padding: 8px;
        cursor: pointer;
        color: rgba(255, 255, 255, 0.8);
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .fullscreen-button:hover {
        background: rgba(0, 0, 0, 0.8);
        border-color: rgba(255, 255, 255, 0.4);
        color: #fff;
    }

    .fullscreen-button:active {
        transform: scale(0.95);
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
