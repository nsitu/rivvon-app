<template>
    <div
        ref="wrapperRef"
        class="tile-linear-viewer"
        :class="{
            'has-tiles': hasTiles,
            'is-loading': showLoadingIndicator,
        }"
    >
        <div
            ref="containerRef"
            class="viewer-container"
        ></div>

        <LoadingIndicator
            v-if="showLoadingIndicator"
            class="loading-message"
            :message="loadingMessage"
            :statusText="loadingStatusText"
        />

        <div
            v-if="hasTiles && !showLoadingIndicator"
            class="tile-info"
        >
            <template v-if="expectedTileCountComputed > tileCount">
                {{ tileCount }} / {{ expectedTileCountComputed }} tiles
            </template>
            <template v-else>
                {{ tileCount }} tile{{ tileCount > 1 ? 's' : '' }}
            </template>
            <span v-if="displayScale < 1">({{ Math.round(displayScale * 100) }}% scale)</span>
        </div>
    </div>
</template>

<script setup>
    import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
    import LoadingIndicator from '../shared/LoadingIndicator.vue';
    import { useSlyceStore } from '../../stores/slyceStore';
    import { useViewerStore } from '../../stores/viewerStore';
    import { createAndInitTileLinearRenderer } from '../../modules/slyce/tileLinearRenderer.js';
    import { readRendererDisplayConfig } from '../../modules/viewer/rendererConfig.js';

    const props = defineProps({
        ktx2BlobURLs: {
            type: Object,
            required: true,
        },
        maxViewportHeight: {
            type: Number,
            default: 800,
        },
        expectedTileCount: {
            type: Number,
            default: 0,
        },
        textureId: {
            type: [String, Number],
            default: null,
        },
        sourceLoading: {
            type: Boolean,
            default: false,
        },
    });

    const slyceApp = useSlyceStore();
    const viewerApp = useViewerStore();

    const wrapperRef = ref(null);
    const containerRef = ref(null);

    let renderer = null;
    const isInitialized = ref(false);
    const initializationAttempted = ref(false);
    const displayScale = ref(1);
    const loadedTileCount = ref(0);
    const isTileLoadPending = ref(false);
    const failedTileCount = ref(0);

    const sourceTileCount = computed(() => Object.keys(props.ktx2BlobURLs || {}).length);
    const expectedTileCountComputed = computed(() => Math.max(Number(props.expectedTileCount) || 0, sourceTileCount.value));
    const tileCount = computed(() => loadedTileCount.value);
    const hasTiles = computed(() => tileCount.value > 0);
    const isBusy = computed(() => {
        if (sourceTileCount.value === 0) {
            return props.sourceLoading;
        }

        if (isTileLoadPending.value) {
            return true;
        }

        const targetCount = expectedTileCountComputed.value || sourceTileCount.value;
        return tileCount.value < targetCount && (tileCount.value + failedTileCount.value) < targetCount;
    });
    const showLoadingIndicator = computed(() => isBusy.value);
    const loadingMessage = computed(() => {
        if (sourceTileCount.value > 0) {
            return 'Building...';
        }

        if (props.sourceLoading) {
            return 'Loading...';
        }

        return 'Loading...';
    });
    const loadingStatusText = computed(() => {
        const targetCount = expectedTileCountComputed.value || sourceTileCount.value;
        if (targetCount > 0) {
            return `${tileCount.value} / ${targetCount} tiles`;
        }

        if (props.sourceLoading) {
            return 'Preparing tiles';
        }

        return '';
    });

    const loadingTiles = new Set();

    function syncLoadedTileCount() {
        if (!renderer?.tiles) {
            loadedTileCount.value = 0;
            return;
        }

        let count = 0;
        renderer.tiles.forEach((tile) => {
            if (tile && !tile.isPlaceholder) {
                count += 1;
            }
        });
        loadedTileCount.value = count;
    }

    async function initializeRenderer() {
        if (initializationAttempted.value || !containerRef.value) {
            return;
        }

        initializationAttempted.value = true;
        const container = containerRef.value;
        const width = container.clientWidth;
        if (width === 0) {
            console.log('[TileLinearViewer] Container not visible yet, will retry...');
            initializationAttempted.value = false;
            return;
        }

        console.log('[TileLinearViewer] Initializing with container width:', width);

        try {
            const rendererType = viewerApp.rendererType || slyceApp.rendererType || 'webgl';
            const displayConfig = readRendererDisplayConfig(viewerApp.threeContext?.renderer ?? null, rendererType);
            renderer = await createAndInitTileLinearRenderer(container, rendererType, {
                tileSize: slyceApp.potResolution || 512,
                maxViewportWidth: 2560,
                maxViewportHeight: props.maxViewportHeight,
                flowDirection: 'vertical',
                displayConfig,
                textureSetId: props.textureId,
            });

            renderer.startAnimation();
            renderer.startPlayback({
                fps: slyceApp.ktx2Playback.fps,
                mode: slyceApp.crossSectionType,
            });

            isInitialized.value = true;
            console.log('[TileLinearViewer] Initialized successfully');

            const expected = expectedTileCountComputed.value || sourceTileCount.value;
            if (expected > 0) {
                renderer.preallocatePlaceholders(expected);
            }

            await loadTiles();
        } catch (error) {
            console.error('[TileLinearViewer] Initialization failed:', error);
            slyceApp.setStatus('Renderer Error', `Failed to initialize linear renderer: ${error.message}`);
            initializationAttempted.value = false;
        }
    }

    async function loadTiles() {
        if (!renderer) {
            return;
        }

        const tileNumbers = Object.keys(props.ktx2BlobURLs || {}).sort((a, b) => Number(a) - Number(b));
        if (tileNumbers.length === 0) {
            syncLoadedTileCount();
            return;
        }

        const loadTasks = [];
        tileNumbers.forEach((tileNumber) => {
            const existing = renderer.tiles.get(tileNumber);
            const needsLoad = !existing || existing.isPlaceholder;
            if (!needsLoad || loadingTiles.has(tileNumber)) {
                return;
            }

            loadTasks.push((async () => {
                loadingTiles.add(tileNumber);
                const blobURL = props.ktx2BlobURLs[tileNumber];
                try {
                    await renderer.upsertTile(tileNumber, blobURL);
                    displayScale.value = renderer.displayScale;
                    syncLoadedTileCount();
                } catch (error) {
                    failedTileCount.value += 1;
                    console.error(`[TileLinearViewer] Failed to load tile ${tileNumber}:`, error);
                } finally {
                    loadingTiles.delete(tileNumber);
                }
            })());
        });

        if (loadTasks.length === 0) {
            syncLoadedTileCount();
            return;
        }

        isTileLoadPending.value = true;
        await Promise.allSettled(loadTasks);
        isTileLoadPending.value = false;
        syncLoadedTileCount();
        displayScale.value = renderer.displayScale;
    }

    onMounted(async () => {
        await nextTick();
        console.log('[TileLinearViewer] Component mounted');

        if (sourceTileCount.value > 0) {
            await initializeRenderer();
        }
    });

    onBeforeUnmount(() => {
        if (renderer) {
            renderer.dispose();
            renderer = null;
        }
        syncLoadedTileCount();
    });

    watch(() => props.ktx2BlobURLs, async () => {
        const count = Object.keys(props.ktx2BlobURLs || {}).length;
        console.log('[TileLinearViewer] Blob URLs changed, count:', count);
        failedTileCount.value = 0;

        if (count > 0) {
            if (!isInitialized.value) {
                await nextTick();
                await initializeRenderer();
            } else {
                await loadTiles();
            }
        } else if (isInitialized.value && renderer) {
            renderer.clearAllTiles();
            syncLoadedTileCount();
        }
    }, { deep: true, immediate: true });

    watch(() => props.textureId, (nextTextureId) => {
        if (renderer) {
            renderer.textureSetId = nextTextureId;
        }
    });

    watch(() => slyceApp.crossSectionType, (newMode) => {
        if (renderer && renderer.isPlaying) {
            renderer.stopPlayback();
            renderer.startPlayback({
                fps: renderer.fps,
                mode: newMode,
            });
        }
    });

    defineExpose({
        tileCount,
        displayScale,
        isBusy,
        expectedTileCount: expectedTileCountComputed,
    });
</script>

<style scoped>
    .tile-linear-viewer {
        position: relative;
        width: 100%;
        min-height: 100px;
        background: transparent;
        border-radius: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        align-items: start;
        justify-items: stretch;
        overflow: visible;
    }

    .tile-linear-viewer.is-loading .viewer-container :deep(canvas) {
        opacity: 0.4;
    }

    .viewer-container {
        grid-area: 1 / 1;
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
        grid-area: 1 / 1;
        position: sticky;
        top: 0.75rem;
        justify-self: center;
        align-self: start;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: center;
        width: max-content;
        max-width: calc(100% - 2rem);
        padding: 0.75rem 1rem 0;
        background: transparent;
        pointer-events: none;
    }

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
