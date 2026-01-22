<template>
    <!-- KTX2 Tile Grid Renderer - Three.js-based texture array viewer -->
    <div
        ref="containerRef"
        class="tile-grid-renderer"
        :class="{ 'is-fullscreen': isFullscreen }"
    >
        <div
            v-if="!isInitialized"
            class="loading-message"
        >Initializing renderer...</div>

        <!-- Fullscreen toggle button -->
        <button
            v-if="isInitialized"
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
    </div>
</template>

<script setup>
    import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick } from 'vue';
    import { useAppStore } from '../stores/appStore';

    // Import both renderer implementations
    import { TileGridRendererWebGL } from '../modules/tileGridRenderer-webgl.js';
    import { TileGridRendererWebGPU } from '../modules/tileGridRenderer-webgpu.js';

    // Import grid calculator utility
    import { calculateGridPositions } from '../utils/grid-calculator.js';

    // Access the Pinia store
    const app = useAppStore();

    // Choose renderer based on store setting (determined in main.js)
    const TileGridRenderer = computed(() => {
        return app.rendererType === 'webgpu' ? TileGridRendererWebGPU : TileGridRendererWebGL;
    });

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

    // Template refs
    const containerRef = ref(null);

    // Renderer instance
    let renderer = null;
    const isInitialized = ref(false);
    let initializationAttempted = ref(false);

    // Fullscreen state
    const isFullscreen = ref(false);

    /**
     * Initialize renderer - called lazily when tiles are available and container is visible
     */
    async function initializeRenderer() {
        if (initializationAttempted.value || !containerRef.value) {
            return;
        }

        initializationAttempted.value = true;
        const container = containerRef.value;

        // Check if container has valid dimensions (is visible)
        const width = container.clientWidth;
        const height = container.clientHeight;

        if (width === 0 || height === 0) {
            console.log('[TileGridRenderer.vue] Container not visible yet, dimensions:', { width, height });
            initializationAttempted.value = false; // Allow retry
            return;
        }

        console.log('[TileGridRenderer.vue] Initializing with dimensions:', { width, height });

        try {
            // Create renderer (type determined by store.rendererType)
            renderer = new TileGridRenderer.value();
            await renderer.init(container, {
                backgroundColor: 0x1a1a1a
            });

            // Start animation loop
            renderer.startAnimation();

            // Load tiles
            loadTiles();

            // Start playback with current settings
            startPlayback();

            isInitialized.value = true;
            console.log('[TileGridRenderer.vue] Initialized successfully');
        } catch (error) {
            console.error('[TileGridRenderer.vue] Initialization failed:', error);
            app.setStatus('Renderer Error', `Failed to initialize KTX2 renderer: ${error.message}`);
            initializationAttempted.value = false; // Allow retry
        }
    }


    // Store observer reference for cleanup
    let intersectionObserver = null;

    /**
     * Toggle fullscreen mode for the renderer container
     */
    function toggleFullscreen() {
        if (!containerRef.value) return;

        if (!document.fullscreenElement) {
            containerRef.value.requestFullscreen().catch(err => {
                console.error('[TileGridRenderer.vue] Fullscreen request failed:', err);
                app.setStatus('Fullscreen Error', err.message);
            });
        } else {
            document.exitFullscreen();
        }
    }

    /**
     * Handle fullscreen change events
     */
    function handleFullscreenChange() {
        isFullscreen.value = !!document.fullscreenElement;

        // Resize renderer when entering/exiting fullscreen
        if (renderer) {
            // Give the browser a moment to update dimensions
            setTimeout(() => {
                renderer.resize();
            }, 100);
        }
    }

    // Mount: Just set up the container ref, don't initialize yet
    onMounted(async () => {
        await nextTick();
        console.log('[TileGridRenderer.vue] Component mounted, waiting for tiles...');

        // Listen for fullscreen changes
        document.addEventListener('fullscreenchange', handleFullscreenChange);

        // Also watch for when container becomes visible (e.g., tab switch)
        if (containerRef.value) {
            intersectionObserver = new IntersectionObserver((entries) => {
                const entry = entries[0];
                if (entry.isIntersecting && !isInitialized.value) {
                    console.log('[TileGridRenderer.vue] Container became visible, checking if we can initialize...');
                    // If we have tiles and container is now visible, try to initialize
                    const tileCount = Object.keys(props.ktx2BlobURLs).length;
                    if (tileCount > 0) {
                        initializeRenderer();
                    }
                }
            });

            intersectionObserver.observe(containerRef.value);
        }
    });

    // Cleanup on unmount - must be registered synchronously before any async operations
    onBeforeUnmount(() => {
        // Clean up fullscreen listener
        document.removeEventListener('fullscreenchange', handleFullscreenChange);

        // Exit fullscreen if active
        if (document.fullscreenElement) {
            document.exitFullscreen();
        }

        // Clean up intersection observer
        if (intersectionObserver) {
            intersectionObserver.disconnect();
            intersectionObserver = null;
        }

        // Clean up renderer
        if (renderer) {
            renderer.dispose();
            renderer = null;
        }
    });

    // Watch for changes in blob URLs - this triggers initialization if not done yet
    watch(() => props.ktx2BlobURLs, async () => {
        const tileCount = Object.keys(props.ktx2BlobURLs).length;

        console.log('[TileGridRenderer.vue] Blob URLs changed, tile count:', tileCount);

        if (tileCount > 0) {
            // We have tiles! Initialize if not done yet
            if (!isInitialized.value) {
                await nextTick(); // Ensure tab is visible
                await initializeRenderer();
            } else {
                // Already initialized, just reload tiles
                loadTiles();
            }
        } else if (isInitialized.value && renderer) {
            // No tiles - clear the renderer (e.g., after reset)
            renderer.clearAllTiles();
        }
    }, { deep: true, immediate: true });

    // Watch for changes in crossSectionType (cycling mode)
    watch(() => app.crossSectionType, (newMode) => {
        if (renderer && renderer.isPlaying) {
            renderer.stopPlayback();
            renderer.startPlayback({
                fps: renderer.fps,
                mode: newMode
            });
        }
    });

    /**
     * Load all tiles into the renderer
     * Efficiently handles grid layout changes by:
     * - Updating positions for existing tiles (without reloading textures)
     * - Loading only new tiles that don't exist yet
     */
    function loadTiles() {
        if (!renderer) return;

        const tileNumbers = Object.keys(props.ktx2BlobURLs).sort((a, b) => Number(a) - Number(b));
        const tileCount = tileNumbers.length;

        if (tileCount === 0) return;

        // Calculate grid layout based on outputMode
        const { positions, tileSize } = calculateGridLayout(tileCount);

        // Process all tiles - update positions for existing ones, load new ones
        tileNumbers.forEach((tileNumber, index) => {
            const blobURL = props.ktx2BlobURLs[tileNumber];
            const position = positions[index];

            // Update position if tile already exists (performance optimization)
            if (renderer.tiles.has(tileNumber)) {
                renderer.updateTilePosition(tileNumber, position, tileSize);
                return;
            }

            // Load new tile
            renderer.upsertTile(tileNumber, blobURL, position, tileSize)
                .then(() => {
                    console.log(`[TileGridRenderer.vue] Tile ${tileNumber} loaded`);
                })
                .catch(error => {
                    console.error(`[TileGridRenderer.vue] Failed to load tile ${tileNumber}:`, error);
                });
        });
    }

    /**
     * Calculate grid layout positions for tiles
     */
    function calculateGridLayout(tileCount) {
        // Make tiles square (1:1 aspect ratio) to match the 256x256 texture
        const tileSize = { width: 1, height: 1 };

        // Add small spacing between tiles to prevent overlap and improve visibility
        // Note: With spacing=0, tiles touch edge-to-edge with no gap
        const spacing = 0; // Small gap between tiles

        // Determine flow direction based on output mode
        // 'columns' mode: pixels assembled column-by-column → tiles flow left-to-right
        // 'rows' mode: pixels assembled row-by-row → tiles flow top-to-bottom
        const flowDirection = props.outputMode === 'columns' ? 'horizontal' : 'vertical';

        // Calculate optimal grid with positions
        const { positions, cols, rows } = calculateGridPositions(
            tileCount,
            flowDirection,
            tileSize,
            spacing
        );

        console.log(`[TileGridRenderer.vue] Grid layout: ${cols}×${rows} for ${tileCount} tiles (${props.outputMode} mode)`);

        return { positions, tileSize };
    }

    /**
     * Start playback with current settings
     */
    function startPlayback() {
        if (!renderer) return;

        renderer.startPlayback({
            fps: app.ktx2Playback.fps,
            mode: app.crossSectionType // 'waves' or 'planes'
        });
    }
</script>

<style scoped>
    .tile-grid-renderer {
        position: relative;
        width: 100%;
        min-width: 800px;
        /* Ensure minimum width even if parent isn't sized */
        height: 600px;
        background: #1a1a1a;
        border-radius: 0.375rem;
        overflow: hidden;
    }

    .tile-grid-renderer.is-fullscreen {
        min-width: unset;
        height: 100vh;
        width: 100vw;
        border-radius: 0;
    }

    .loading-message {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: #888;
        font-size: 14px;
        z-index: 10;
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

    .tile-grid-renderer :deep(canvas) {
        display: block;
        width: 100% !important;
        height: 100% !important;
    }
</style>
