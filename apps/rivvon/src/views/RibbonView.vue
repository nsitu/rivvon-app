<script setup>
    import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
    import { useRoute, useRouter } from 'vue-router';
    import { useViewerStore } from '../stores/viewerStore';
    import { useGoogleAuth } from '../composables/shared/useGoogleAuth';
    import { useThreeSetup } from '../composables/viewer/useThreeSetup';
    import { parseSvgContentDynamicResolution, normalizePointsMultiPath } from '../modules/viewer/svgPathToPoints';
    import { fetchTextureSet } from '../services/textureService';
    import { useLocalStorage } from '../services/localStorage.js';
    import * as THREE from 'three';

    // Components
    import AppHeader from '../components/viewer/AppHeader.vue';
    import BottomToolbar from '../components/viewer/BottomToolbar.vue';
    import CountdownNumbers from '../components/viewer/CountdownNumbers.vue';
    import CountdownProgressBar from '../components/viewer/CountdownProgressBar.vue';
    import TextInputPanel from '../components/viewer/TextInputPanel.vue';
    import TextureBrowser from '../components/viewer/TextureBrowser.vue';
    import TextureCreator from '../components/viewer/TextureCreator.vue';
    import BetaModal from '../components/viewer/BetaModal.vue';
    import ThreeCanvas from '../components/viewer/ThreeCanvas.vue';
    import DrawCanvas from '../components/viewer/DrawCanvas.vue';
    import RendererIndicator from '../components/viewer/RendererIndicator.vue';

    const app = useViewerStore();
    const { isAuthenticated } = useGoogleAuth();
    const route = useRoute();
    const router = useRouter();

    // Template refs
    const threeCanvasRef = ref(null);
    const drawCanvasRef = ref(null);
    const fileInputRef = ref(null);

    // Local state
    const isReady = ref(false);

    // Background style based on thumbnail
    const backgroundStyle = computed(() => {
        if (app.thumbnailUrl) {
            return {
                backgroundImage: `url(${app.thumbnailUrl})`
            };
        }
        return {};
    });

    const backgroundClass = computed(() => {
        return app.thumbnailUrl ? 'visible' : '';
    });

    // Watch drawing mode to control renderer visibility
    watch(() => app.isDrawingMode, (isDrawing) => {
        // Hide/show the Three.js canvas when in drawing mode
        if (threeCanvasRef.value?.renderer) {
            threeCanvasRef.value.renderer.domElement.style.opacity = isDrawing ? '0' : '1';
        }

        // Also disable orbit controls when drawing
        if (threeCanvasRef.value?.controls) {
            threeCanvasRef.value.controls.enabled = !isDrawing;
        }
    });

    // Initialize when Three.js canvas is ready
    function handleThreeInitialized(context) {
        console.log('[RibbonView] Three.js initialized with context:', context);
        console.log('[RibbonView] tileManager:', context.tileManager);
        console.log('[RibbonView] scene:', context.scene);
        isReady.value = true;

        // Initialize default ribbon
        initializeDefaultRibbon();

        // Check for texture deep link
        if (route.params.textureId) {
            loadTextureFromRoute(route.params.textureId);
        }
    }

    // Initialize ribbon with default SVG
    async function initializeDefaultRibbon() {
        if (!threeCanvasRef.value) {
            console.warn('[RibbonView] threeCanvasRef not available');
            return;
        }

        console.log('[RibbonView] initializeDefaultRibbon - threeCanvasRef:', threeCanvasRef.value);
        console.log('[RibbonView] isInitialized:', threeCanvasRef.value.isInitialized);

        try {
            // Load default SVG path (spiral.svg exists in public folder)
            console.log('[RibbonView] Fetching /spiral.svg...');
            const response = await fetch('/spiral.svg');
            if (!response.ok) {
                console.warn('[RibbonView] Could not load default SVG:', response.status);
                return;
            }
            const svgContent = await response.text();
            console.log('[RibbonView] SVG loaded, length:', svgContent.length);

            const paths = parseSvgContentDynamicResolution(svgContent, {}, 5, 0);
            console.log('[RibbonView] Parsed paths:', paths.length, paths);

            if (paths.length > 0) {
                const normalizedPaths = normalizePointsMultiPath(paths);
                console.log('[RibbonView] Normalized paths:', normalizedPaths.length);
                console.log('[RibbonView] First path sample:', normalizedPaths[0]?.slice(0, 3));

                await threeCanvasRef.value.createRibbonSeries(normalizedPaths);
                console.log('[RibbonView] Default ribbon created with', paths.length, 'paths');
            } else {
                console.warn('[RibbonView] No paths extracted from SVG');
            }
        } catch (error) {
            console.error('[RibbonView] Failed to load default ribbon:', error);
        }
    }

    // Load texture from route parameter
    async function loadTextureFromRoute(textureId) {
        if (!threeCanvasRef.value) return;

        try {
            console.log('[RibbonView] Loading texture:', textureId);
            await threeCanvasRef.value.loadTextures(textureId);
        } catch (error) {
            console.error('[RibbonView] Failed to load texture:', error);
        }
    }

    // Drawing mode handlers
    function toggleDrawMode() {
        app.setDrawingMode(!app.isDrawingMode);
    }

    function handleDrawingComplete(strokesData) {
        if (!threeCanvasRef.value || !strokesData || strokesData.length === 0) return;

        // Exit drawing mode
        app.setDrawingMode(false);

        // Reset camera before building new ribbon
        if (threeCanvasRef.value.resetCamera) {
            threeCanvasRef.value.resetCamera();
        }

        // strokesData is Array<Array<{x,y}>> from DrawingManager
        const isMultiStroke = Array.isArray(strokesData) && strokesData.length > 0 && Array.isArray(strokesData[0]);

        console.log('[RibbonView] handleDrawingComplete', {
            isMultiStroke,
            strokeCount: isMultiStroke ? strokesData.length : 1
        });

        if (isMultiStroke && strokesData.length > 1) {
            // Multi-stroke: convert to Vector3 and normalize together
            const rawPathsPoints = strokesData.map(stroke =>
                stroke.map(p => new THREE.Vector3(p.x, -p.y, 0))  // Flip Y
            ).filter(points => points.length >= 2);

            if (rawPathsPoints.length > 0) {
                const normalizedPaths = normalizePointsMultiPath(rawPathsPoints);
                threeCanvasRef.value.createRibbonSeries(normalizedPaths);
            }
        } else {
            // Single stroke: use createRibbonFromDrawing which handles conversion internally
            const singleStroke = isMultiStroke ? strokesData[0] : strokesData;
            threeCanvasRef.value.createRibbonFromDrawing(singleStroke);
        }
    }

    function finishDrawing() {
        if (drawCanvasRef.value) {
            const strokes = drawCanvasRef.value.finalizeDrawing();
            handleDrawingComplete(strokes);
        }
    }

    // Flow toggle (cycles through: off -> forward -> backward -> off)
    function toggleFlow() {
        app.cycleFlowState();
    }

    // Text to SVG handler
    function handleTextGenerate(pointsArray) {
        if (!threeCanvasRef.value || pointsArray.length === 0) return;

        if (pointsArray.length === 1) {
            threeCanvasRef.value.createRibbon(pointsArray[0]);
        } else {
            threeCanvasRef.value.createRibbonSeries(pointsArray);
        }
    }

    // File import handler
    function openFileImport() {
        fileInputRef.value?.click();
    }

    async function handleFileImport(event) {
        const file = event.target.files?.[0];
        if (!file) return;

        const fileName = file.name.toLowerCase();

        if (fileName.endsWith('.svg')) {
            // Handle SVG import
            const reader = new FileReader();
            reader.onload = async (e) => {
                const svgContent = e.target.result;
                const paths = parseSvgContentDynamicResolution(svgContent, {}, 5, 0);
                if (paths.length > 0) {
                    const normalizedPaths = normalizePointsMultiPath(paths);
                    if (normalizedPaths.length === 1) {
                        threeCanvasRef.value?.createRibbon(normalizedPaths[0]);
                    } else {
                        threeCanvasRef.value?.createRibbonSeries(normalizedPaths);
                    }
                }
            };
            reader.readAsText(file);
        } else if (fileName.endsWith('.zip')) {
            // Handle ZIP texture pack
            await threeCanvasRef.value?.loadTextures(file);
        }

        // Reset file input
        event.target.value = '';
    }

    // Texture browser handler
    function openTextureBrowser() {
        app.showTextureBrowser();
    }

    // Track the initial tab for the texture browser
    const textureBrowserInitialTab = ref('all');

    // Check for texture browser query param on mount
    watch(() => route.query.textures, (texturesParam) => {
        if (texturesParam === 'mine' || texturesParam === 'all') {
            textureBrowserInitialTab.value = texturesParam;
            app.showTextureBrowser();
            // Clear the query param to prevent reopening on refresh
            router.replace({ path: route.path, query: {} });
        }
    }, { immediate: true });

    // Check for slyce panel query param
    watch(() => route.query.slyce, (slyceParam) => {
        if (slyceParam === 'true') {
            app.showSlyce();
            // Clear the query param to prevent reopening on refresh
            router.replace({ path: route.path, query: {} });
        }
    }, { immediate: true });

    // Check for local texture query param
    const { getTextureSet: getLocalTextureSet, getTiles } = useLocalStorage();

    watch(() => route.query.local, async (localTextureId) => {
        if (localTextureId && threeCanvasRef.value?.isInitialized) {
            await loadLocalTexture(localTextureId);
            // Clear the query param to prevent reloading on refresh
            router.replace({ path: route.path, query: {} });
        }
    }, { immediate: true });

    // Load local texture by ID
    async function loadLocalTexture(textureId) {
        console.log('[RibbonView] Loading local texture:', textureId);
        isLoadingTexture.value = true;
        loadingProgress.value = 'Loading local texture...';

        try {
            const textureSet = await getLocalTextureSet(textureId);

            if (!textureSet) {
                throw new Error('Local texture not found');
            }

            console.log(`[RibbonView] Found local texture set: ${textureSet.name}`);

            // Load textures from local storage via TileManager
            await threeCanvasRef.value?.loadTexturesFromLocal(textureSet, getTiles, (stage, current, total) => {
                if (stage === 'downloading') {
                    const pct = Math.round((current / total) * 100);
                    loadingProgress.value = `Loading ${pct}%`;
                } else if (stage === 'building') {
                    const pct = Math.round((current / total) * 100);
                    loadingProgress.value = `Building ${pct}%`;
                }
            });

            // Set blurred background from thumbnail
            if (textureSet.thumbnail_data_url) {
                app.setThumbnailUrl(textureSet.thumbnail_data_url);
            }

            console.log('[RibbonView] Local texture loaded successfully');
        } catch (error) {
            console.error('[RibbonView] Failed to load local texture:', error);
            alert('Failed to load local texture: ' + error.message);
        } finally {
            isLoadingTexture.value = false;
            loadingProgress.value = '';
        }
    }

    // Handle local texture selection from browser
    async function handleLocalTextureSelect(texture) {
        console.log('[RibbonView] Selected local texture from browser:', texture.name);
        await loadLocalTexture(texture.id);
    }

    // Loading state for remote texture
    const isLoadingTexture = ref(false);
    const loadingProgress = ref('');

    // Handle texture selection from browser
    async function handleTextureSelect(texture) {
        console.log('[RibbonView] Loading remote texture:', texture.name);
        isLoadingTexture.value = true;
        loadingProgress.value = 'Loading...';

        try {
            // Fetch full texture set with tile URLs
            const textureSet = await fetchTextureSet(texture.id);

            if (!textureSet || !textureSet.tiles || textureSet.tiles.length === 0) {
                throw new Error('No tiles found in texture set');
            }

            // Check if this is a Google Drive texture that requires authentication
            const hasDriveTiles = textureSet.tiles.some(tile => tile.driveFileId);
            if (hasDriveTiles && !isAuthenticated.value) {
                // Show beta modal with texture-auth context
                app.showBetaModal('texture-auth');
                return;
            }

            console.log(`[RibbonView] Fetched texture set: ${textureSet.tiles.length} tiles`);

            // Load textures from remote URLs via TileManager
            await threeCanvasRef.value?.loadTexturesFromRemote(textureSet, (stage, current, total) => {
                if (stage === 'downloading') {
                    const pct = Math.round((current / total) * 100);
                    loadingProgress.value = `Downloading ${pct}%`;
                } else if (stage === 'building') {
                    const pct = Math.round((current / total) * 100);
                    loadingProgress.value = `Building ${pct}%`;
                }
            });

            // Set blurred background from thumbnail
            if (texture.thumbnail_url) {
                app.setThumbnailUrl(texture.thumbnail_url);
            }

            console.log('[RibbonView] Remote texture loaded successfully');
        } catch (error) {
            console.error('[RibbonView] Failed to load remote texture:', error);

            if (error.message.includes('Not authenticated') || error.message.includes('Access denied')) {
                // Show beta modal with access-denied context
                app.showBetaModal('access-denied');
            } else {
                alert('Failed to load texture: ' + error.message);
            }
        } finally {
            isLoadingTexture.value = false;
            loadingProgress.value = '';
        }
    }

    // Handle applying a newly created texture 
    async function handleApplyCreatedTexture(texture) {
        console.log('[RibbonView] Applying created texture:', texture);

        // Close the Slyce panel
        app.toggleSlyce();

        // Load the texture using the same mechanism as the texture browser
        await handleTextureSelect(texture);
    }
</script>

<template>
    <!-- Blurred background teleported to body for correct stacking with Three.js canvas -->
    <Teleport to="body">
        <div
            class="blurred-background"
            :class="backgroundClass"
            :style="backgroundStyle"
        ></div>
    </Teleport>

    <div class="ribbon-view">
        <!-- Checkerboard for drawing mode -->
        <div
            class="checkerboard"
            :class="{ visible: app.isDrawingMode }"
        ></div>

        <!-- Renderer indicator (debug mode) -->
        <RendererIndicator />

        <!-- Header with logo and auth -->
        <AppHeader />

        <!-- Three.js canvas -->
        <ThreeCanvas
            ref="threeCanvasRef"
            :renderer-type="app.rendererType"
            @initialized="handleThreeInitialized"
        />

        <!-- Drawing canvas overlay -->
        <DrawCanvas
            ref="drawCanvasRef"
            :active="app.isDrawingMode"
            @drawing-complete="handleDrawingComplete"
        />

        <!-- Countdown display (numbers in center of screen) -->
        <CountdownNumbers />

        <!-- Countdown progress bar -->
        <CountdownProgressBar />

        <!-- Bottom toolbar -->
        <BottomToolbar
            @toggle-draw-mode="toggleDrawMode"
            @toggle-flow="toggleFlow"
            @open-text-panel="app.showTextPanel"
            @open-texture-browser="openTextureBrowser"
            @import-file="openFileImport"
            @finish-drawing="finishDrawing"
        />

        <!-- Hidden file input -->
        <input
            ref="fileInputRef"
            type="file"
            accept=".svg,.zip"
            style="display: none"
            @change="handleFileImport"
        />

        <!-- Modals -->
        <TextInputPanel
            v-model:visible="app.textPanelVisible"
            @generate="handleTextGenerate"
        />
        <TextureBrowser
            v-if="app.textureBrowserVisible"
            :visible="app.textureBrowserVisible"
            :initial-tab="textureBrowserInitialTab"
            @close="app.hideTextureBrowser"
            @select="handleTextureSelect"
            @select-local="handleLocalTextureSelect"
        />

        <!-- Full-page Slyce panel (like drawing mode) -->
        <TextureCreator
            v-if="app.textureCreatorVisible"
            :active="app.textureCreatorVisible"
            @apply-texture="handleApplyCreatedTexture"
        />

        <BetaModal />

        <!-- Loading overlay for texture loading -->
        <Transition name="fade">
            <div
                v-if="isLoadingTexture"
                class="loading-overlay"
            >
                <div class="loading-content">
                    <div class="loading-spinner"></div>
                    <div class="loading-text">{{ loadingProgress }}</div>
                </div>
            </div>
        </Transition>
    </div>
</template>

<!-- Unscoped styles for teleported elements -->
<style>

    /* Blurred background - teleported to body, must be unscoped */
    .blurred-background {
        position: fixed;
        top: -10%;
        left: -10%;
        width: 120%;
        height: 120%;
        z-index: -1;
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        filter: blur(60px) saturate(1.2);
        opacity: 0;
        transition: opacity 0.8s ease-in-out;
        pointer-events: none;
    }

    .blurred-background.visible {
        opacity: 0.7;
    }
</style>

<style scoped>
    .ribbon-view {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        /* Allow pointer events to pass through to Three.js canvas underneath */
        pointer-events: none;
    }

    /* Re-enable pointer events only on specific interactive containers */
    .ribbon-view :deep(.app-header),
    .ribbon-view :deep(.bottom-toolbar),
    .ribbon-view :deep(.text-input-panel),
    .ribbon-view :deep(.beta-modal),
    .ribbon-view :deep(.texture-browser.active),
    .ribbon-view :deep(.slyce-panel.active),
    .ribbon-view :deep(.draw-canvas.active),
    .ribbon-view .loading-overlay {
        pointer-events: auto;
    }

    .checkerboard {
        position: fixed;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        opacity: 0;
        background-color: #1a1a1a;
        background-image:
            linear-gradient(45deg, #222 25%, transparent 25%),
            linear-gradient(-45deg, #222 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #222 75%),
            linear-gradient(-45deg, transparent 75%, #222 75%);
        background-size: 20px 20px;
        background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
        transition: opacity 0.3s ease;
    }

    .checkerboard.visible {
        opacity: 1;
    }

    /* Loading overlay */
    .loading-overlay {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(8px);
    }

    .loading-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
    }

    .loading-spinner {
        width: 48px;
        height: 48px;
        border: 3px solid rgba(255, 255, 255, 0.2);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .loading-text {
        color: #fff;
        font-size: 1rem;
        font-weight: 500;
        letter-spacing: 0.05em;
    }

    /* Fade transition */
    .fade-enter-active,
    .fade-leave-active {
        transition: opacity 0.3s ease;
    }

    .fade-enter-from,
    .fade-leave-to {
        opacity: 0;
    }
</style>
