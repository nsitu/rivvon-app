<script setup>
    import { ref, computed, onMounted, onUnmounted, watch, shallowRef, defineAsyncComponent, nextTick } from 'vue';
    import { useRoute, useRouter } from 'vue-router';
    import { useSlyceStore } from '../stores/slyceStore';
    import { useViewerStore } from '../stores/viewerStore';
    import { useGoogleAuth } from '../composables/shared/useGoogleAuth';
    import { useScreenWakeLock } from '../composables/viewer/useScreenWakeLock';
    import { useThreeSetup } from '../composables/viewer/useThreeSetup';
    import { createDefaultDrawingName, createDrawingDocument, inflateDrawingPaths } from '../modules/shared/drawingLibrary.js';
    import { createLazyLoader } from '../modules/shared/lazyLoader.js';
    import { resolveOrderedContext } from '../modules/viewer/viewerHeaderContext.js';
    import { isViewerPanelVisible, VIEWER_PANEL_KEYS } from '../modules/viewer/viewerPanels.js';
    import { parseSvgContentDynamicResolution, normalizePointsMultiPath } from '../modules/viewer/svgPathToPoints';
    import { splitAllPathsAtCusps3D } from '../modules/viewer/cuspSplitter.js';
    import { buildTextureOverviewExportInfo, exportTextureOverviewVideo } from '../modules/viewer/textureOverviewExport.js';
    import { useRivvonAPI } from '../services/api.js';
    import { useDrawingStorage } from '../services/drawingStorage.js';
    import { useLocalStorage } from '../services/localStorage.js';
    import Toast from 'primevue/toast';
    import { useToast } from 'primevue/usetoast';
    import * as THREE from 'three';

    // Components
    import AppHeader from '../components/viewer/AppHeader.vue';
    import BottomToolbar from '../components/viewer/BottomToolbar.vue';
    import CountdownNumbers from '../components/viewer/CountdownNumbers.vue';
    import CountdownProgressBar from '../components/viewer/CountdownProgressBar.vue';
    import LoadingIndicator from '../components/shared/LoadingIndicator.vue';
    const TextInputPanel = defineAsyncComponent(() => import('../components/viewer/TextInputPanel.vue'));
    const EmojiPickerPanel = defineAsyncComponent(() => import('../components/viewer/EmojiPickerPanel.vue'));
    const ContourPanel = defineAsyncComponent(() => import('../components/viewer/ContourPanel.vue'));
    const DrawingBrowser = defineAsyncComponent(() => import('../components/viewer/DrawingBrowser.vue'));
    const TextureBrowser = defineAsyncComponent(() => import('../components/viewer/TextureBrowser.vue'));
    const TextureOverviewPanel = defineAsyncComponent(() => import('../components/viewer/TextureOverviewPanel.vue'));
    const TextureCreator = defineAsyncComponent(() => import('../components/viewer/TextureCreator.vue'));
    const BetaModal = defineAsyncComponent(() => import('../components/viewer/BetaModal.vue'));
    const ExportImageDialog = defineAsyncComponent(() => import('../components/viewer/ExportImageDialog.vue'));
    const ExportVideoDialog = defineAsyncComponent(() => import('../components/viewer/ExportVideoDialog.vue'));
    import ThreeCanvas from '../components/viewer/ThreeCanvas.vue';
    const DrawCanvas = defineAsyncComponent(() => import('../components/viewer/DrawCanvas.vue'));
    const WalkCanvas = defineAsyncComponent(() => import('../components/viewer/WalkCanvas.vue'));
    const RendererIndicator = defineAsyncComponent(() => import('../components/viewer/RendererIndicator.vue'));
    const ViewerTechnicalOverlay = defineAsyncComponent(() => import('../components/viewer/ViewerTechnicalOverlay.vue'));
    const DeviceLostOverlay = defineAsyncComponent(() => import('../components/viewer/DeviceLostOverlay.vue'));
    const TextureMetadataOverlay = defineAsyncComponent(() => import('../components/viewer/TextureMetadataOverlay.vue'));
    const RealtimeSampler = defineAsyncComponent(() => import('../components/slyce/RealtimeSampler.vue'));

    const app = useViewerStore();
    const slyce = useSlyceStore();
    const toast = useToast();
    const { isAuthenticated, isAdmin } = useGoogleAuth();
    const route = useRoute();
    const router = useRouter();
    const { saveDrawing: saveLocalDrawing } = useDrawingStorage();
    const { getDrawing } = useRivvonAPI();

    function createViewerPanelModel(panelId) {
        const stateKey = VIEWER_PANEL_KEYS[panelId];

        return computed({
            get: () => Boolean(app[stateKey]),
            set: (value) => {
                app[stateKey] = Boolean(value);
            },
        });
    }

    function createViewerPanelVisibility(panelId) {
        return computed(() => isViewerPanelVisible(app, panelId));
    }

    const textPanelVisible = createViewerPanelModel('text');
    const emojiPickerVisible = createViewerPanelModel('emoji');
    const contourPanelVisible = createViewerPanelVisibility('contour');
    const drawingBrowserVisible = createViewerPanelVisibility('drawings');
    const textureBrowserVisible = createViewerPanelVisibility('textureBrowser');
    const texturePreviewVisible = createViewerPanelVisibility('texturePreview');
    const textureCreatorVisible = createViewerPanelVisibility('textureCreator');
    const realtimeSamplerVisible = createViewerPanelVisibility('realtimeSampler');
    const isNarrowViewport = ref(false);

    let narrowViewportMediaQuery = null;

    function handleNarrowViewportChange(event) {
        isNarrowViewport.value = Boolean(event.matches);
    }

    onMounted(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return;
        }

        narrowViewportMediaQuery = window.matchMedia('(max-width: 767px)');
        isNarrowViewport.value = narrowViewportMediaQuery.matches;

        if (typeof narrowViewportMediaQuery.addEventListener === 'function') {
            narrowViewportMediaQuery.addEventListener('change', handleNarrowViewportChange);
            return;
        }

        narrowViewportMediaQuery.addListener(handleNarrowViewportChange);
    });

    onUnmounted(() => {
        if (!narrowViewportMediaQuery) {
            return;
        }

        if (typeof narrowViewportMediaQuery.removeEventListener === 'function') {
            narrowViewportMediaQuery.removeEventListener('change', handleNarrowViewportChange);
        } else {
            narrowViewportMediaQuery.removeListener(handleNarrowViewportChange);
        }

        narrowViewportMediaQuery = null;
    });

    useScreenWakeLock();

    // Realtime webcam mode
    const realtimeInstance = shallowRef(null);
    const ensureRealtime = createLazyLoader(async () => {
        const { useRealtimeSlyce } = await import('../composables/slyce/useRealtimeSlyce.js');
        const instance = useRealtimeSlyce();
        realtimeInstance.value = instance;
        return instance;
    });

    const realtime = {
        isCameraActive: computed(() => realtimeInstance.value?.isCameraActive?.value ?? false),
        isCapturing: computed(() => realtimeInstance.value?.isCapturing?.value ?? false),
        startCamera: async (...args) => (await ensureRealtime()).startCamera(...args),
        applyToViewer: async (...args) => (await ensureRealtime()).applyToViewer(...args),
        stopCamera: (...args) => realtimeInstance.value?.stopCamera?.(...args),
        stopRealtime: (...args) => realtimeInstance.value?.stopRealtime?.(...args),
    };

    const headTrackingCameraActive = computed(() => threeCanvasRef.value?.headTracking?.hasActiveCamera?.() ?? false);
    const cameraIndicatorMode = computed(() => {
        if (realtime.isCapturing.value || realtime.isCameraActive.value) {
            return 'realtime';
        }

        if (headTrackingCameraActive.value) {
            return 'headTracking';
        }

        return null;
    });
    const isCameraIndicatorVisible = computed(() => cameraIndicatorMode.value !== null);
    const cameraDismissLabel = computed(() => {
        if (cameraIndicatorMode.value === 'realtime') {
            return 'Turn off the realtime camera';
        }

        if (cameraIndicatorMode.value === 'headTracking') {
            return 'Turn off head tracking';
        }

        return 'Turn off camera';
    });

    const activeToolbarOverlay = ref(null);
    const activeToolbarOverlayTitle = computed(() => {
        if (activeToolbarOverlay.value === 'draw') return 'Draw';
        if (activeToolbarOverlay.value === 'texture') return 'Texture';
        if (activeToolbarOverlay.value === 'share') return 'Share';
        return null;
    });

    function handleToolbarOverlayChange(nextOverlay) {
        activeToolbarOverlay.value = nextOverlay === 'draw' || nextOverlay === 'texture' || nextOverlay === 'share'
            ? nextOverlay
            : null;
    }

    function handleToolbarOverlayClose() {
        activeToolbarOverlay.value = null;
    }

    let textToSvgInstance = null;

    const ensureTextureService = createLazyLoader(() => import('../services/textureService.js'));

    async function fetchTextureSetById(textureId) {
        const { fetchTextureSet } = await ensureTextureService();
        return fetchTextureSet(textureId);
    }

    const ensureTextToSvg = createLazyLoader(async () => {
        const { useTextToSvg } = await import('../composables/viewer/useTextToSvg.js');
        const instance = useTextToSvg();
        await instance.init();
        textToSvgInstance = instance;
        return instance;
    });

    function getQueryStringValue(value) {
        if (Array.isArray(value)) {
            return typeof value[0] === 'string' ? value[0] : '';
        }

        return typeof value === 'string' ? value : '';
    }

    const returnToCreateTextureOnRealtimeClose = ref(false);
    const textureCreatorLaunchSource = ref(null);
    const textureCreatorReturnOverlay = ref(null);

    function openCreateTextureMode() {
        returnToCreateTextureOnRealtimeClose.value = false;
        textureCreatorLaunchSource.value = null;
        textureCreatorReturnOverlay.value = null;
        app.showSlyce();
    }

    function openTextureVideoPicker() {
        textureVideoInputRef.value?.click();
    }

    function openCreateTextureFileMode(options = {}) {
        const {
            directBrowse = false,
            file = null,
        } = options;

        if (directBrowse && !file) {
            openTextureVideoPicker();
            return;
        }

        returnToCreateTextureOnRealtimeClose.value = false;
        textureCreatorLaunchSource.value = 'file';
        textureCreatorReturnOverlay.value = 'texture';

        if (file) {
            slyce.beginFileWorkflowWithFile(file);
        }

        app.showSlyce();
    }

    async function openCreateTextureCameraMode() {
        textureCreatorLaunchSource.value = null;
        textureCreatorReturnOverlay.value = null;
        await enterRealtimeMode();
    }

    function closeCreateTextureMode(options = {}) {
        const { reopenToolbarOverlay = null } = options;
        textureCreatorLaunchSource.value = null;
        textureCreatorReturnOverlay.value = null;
        textureCreatorNavigationState.value = null;
        app.hideSlyce();

        if (reopenToolbarOverlay) {
            activeToolbarOverlay.value = reopenToolbarOverlay;
        }
    }

    function forceOrbitControls(options = {}) {
        const controller = threeCanvasRef.value?.headTracking;
        if (controller?.exitToOrbit) {
            controller.exitToOrbit(options);
            return;
        }

        app.setViewerControlMode('orbit');

        if (options.clearFeedback) {
            app.clearHeadTrackingFeedback();
            return;
        }

        app.setHeadTrackingRuntimeState({
            supported: options.supported ?? app.headTrackingSupported,
            active: false,
            calibrating: false,
            statusMessage: options.statusMessage ?? '',
            errorMessage: options.errorMessage ?? '',
            suspendedReason: options.reason ?? null,
        });
    }

    function ensureOrbitControlsForInteraction(reason, statusMessage) {
        if (app.viewerControlMode !== 'headTracking') {
            return false;
        }

        forceOrbitControls({ reason, statusMessage });
        return true;
    }

    function handleViewerControlModeChange(mode) {
        if (mode === app.viewerControlMode) {
            return;
        }

        if (mode === 'orbit') {
            forceOrbitControls({ clearFeedback: true });
            return;
        }

        if (mode === 'mouseTilt' || mode === 'scrollTilt') {
            // Gesture-driven tilt modes need no camera access — switch directly
            app.clearHeadTrackingFeedback();
            app.setViewerControlMode(mode);
            return;
        }

        if (realtime.isCameraActive.value || realtime.isCapturing.value || realtimeSamplerVisible.value) {
            forceOrbitControls({
                reason: 'realtime-capture',
                statusMessage: 'Head tracking is unavailable while realtime webcam capture is using the camera.',
            });
            return;
        }

        if (threeCanvasRef.value?.cinematicCamera?.isPlaying?.value) {
            forceOrbitControls({
                reason: 'cinematic-playback',
                statusMessage: 'Stop cinematic playback before enabling head tracking.',
            });
            return;
        }

        app.clearHeadTrackingFeedback();
        app.setViewerControlMode('headTracking');
    }

    function handleHeadTrackingRecenter() {
        app.requestHeadTrackingRecenter();
    }

    function handleViewerReset() {
        const canvas = threeCanvasRef.value;
        if (!canvas?.resetCamera) {
            return;
        }

        const activeMode = app.viewerControlMode;
        const headTrackingController = canvas.headTracking?.cameraController?.value
            ?? canvas.headTracking?.cameraController
            ?? null;

        if (activeMode === 'mouseTilt') {
            canvas.mouseTilt?.deactivate?.();
            canvas.resetCamera();
            canvas.mouseTilt?.activate?.();
            return;
        }

        if (activeMode === 'scrollTilt') {
            canvas.scrollTilt?.deactivate?.();
            canvas.resetCamera();
            canvas.scrollTilt?.activate?.();
            return;
        }

        if (activeMode === 'headTracking') {
            headTrackingController?.restoreBaseline?.();
            canvas.resetCamera();
            canvas.headTracking?.recenter?.();
            return;
        }

        canvas.resetCamera();
    }

    async function enterRealtimeMode(options = {}) {
        ensureOrbitControlsForInteraction(
            'realtime-capture',
            'Head tracking switched back to OrbitControls because realtime webcam capture owns the camera.',
        );
        returnToCreateTextureOnRealtimeClose.value = !!options.returnToCreateTexture;
        await realtime.startCamera();
        app.showRealtimeSampler();
    }

    async function applyRealtimeResultsToViewer(metadata = null) {
        if (!threeCanvasRef.value) return false;

        // Once realtime output is being applied, the capture device is no longer
        // needed for the current flow.
        realtime.stopCamera();

        threeCanvasRef.value.clearMultiTextureState?.();

        const appliedMetadata = await realtime.applyToViewer(
            threeCanvasRef.value.tileManager,
            threeCanvasRef.value.ribbonSeries,
            {
                setBackgroundFromTileManager: threeCanvasRef.value.setBackgroundFromTileManager,
            }
        );

        app.setThumbnailUrl(null);

        const nextMetadata = metadata || appliedMetadata || null;
        setCurrentTextureMetadata(nextMetadata);

        return true;
    }

    async function handleRealtimeApply(metadata = null) {
        const applied = await applyRealtimeResultsToViewer(metadata);
        if (!applied) return;

        returnToCreateTextureOnRealtimeClose.value = false;
        app.hideRealtimeSampler();
    }

    async function handleRealtimeApplyFromTextureCreator(metadata = null) {
        const applied = await applyRealtimeResultsToViewer(metadata);
        if (!applied) return;

        closeCreateTextureMode();
    }

    function handleRealtimeClose(options = {}) {
        if (realtime.isCapturing.value) {
            realtime.stopRealtime();
        }
        realtime.stopCamera();
        app.hideRealtimeSampler();

        const shouldReturnToCreateTexture = returnToCreateTextureOnRealtimeClose.value
            && !options?.suppressCreateTextureReturn;
        returnToCreateTextureOnRealtimeClose.value = false;

        if (shouldReturnToCreateTexture) {
            app.showSlyce();
        }
    }

    function handleTurnOffCamera() {
        if (realtime.isCapturing.value) {
            realtime.stopRealtime();
        }

        if (realtime.isCameraActive.value) {
            realtime.stopCamera();
            return;
        }

        if (headTrackingCameraActive.value || app.viewerControlMode === 'headTracking') {
            forceOrbitControls({ clearFeedback: true });
        }
    }

    // Template refs
    const threeCanvasRef = ref(null);
    const drawCanvasRef = ref(null);
    const walkCanvasRef = ref(null);
    const textureCreatorRef = ref(null);
    const fileInputRef = ref(null);
    const textureVideoInputRef = ref(null);

    // Local state
    const isReady = ref(false);
    const showTechnicalOverlay = ref(false);
    const currentTextureSelection = ref(null);
    const textureOverviewSelection = ref(null);
    const textureCreatorNavigationState = ref(null);
    const isTextureOverviewActive = computed(() => Boolean(textureOverviewSelection.value?.texture));
    const showTextureMetadataOverlay = computed(() => (
        app.showTextureMetadataOverlay
        && !app.multiTextureActive
        && Boolean(app.currentTextureName || app.currentTextureDescription)
    ));

    function setCurrentTextureSelection(selection = null) {
        currentTextureSelection.value = selection;
    }

    function setCurrentTextureMetadata(metadata = null) {
        if (!metadata) {
            setCurrentTextureSelection(null);
            app.clearActiveTextures();
            app.clearCurrentTextureMetadata();
            return;
        }

        const textureId = metadata.id ?? null;
        if (textureId) {
            app.setActiveTextures([textureId]);
        } else {
            app.clearActiveTextures();
        }

        app.setCurrentTextureMetadata({
            id: textureId,
            name: metadata.name ?? '',
            description: metadata.description ?? '',
        });
    }

    function handleTextureCreatorNavigationStateChange(state) {
        textureCreatorNavigationState.value = state;
    }

    function applyTextureResetState({ activeTextureIds = null, clearThumbnail = false } = {}) {
        if (Array.isArray(activeTextureIds) && activeTextureIds.length > 0) {
            setCurrentTextureSelection(null);
            app.setActiveTextures(activeTextureIds);
            app.clearCurrentTextureMetadata();
        } else {
            setCurrentTextureMetadata(null);
        }

        if (clearThumbnail) {
            app.setThumbnailUrl(null);
        }
    }

    // ─── Cinematic camera keyboard bindings ────────────────────────
    function handleCinematicKeydown(e) {
        // Ignore if focus is in a text input
        const tag = e.target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;

        // Ignore during drawing mode
        if (app.isDrawingMode || app.isWalkMode) return;

        const cinematic = threeCanvasRef.value?.cinematicCamera;
        if (!cinematic) return;

        switch (e.key.toLowerCase()) {
            case 'c': {
                handleCinematicCapture();
                break;
            }
            case 'p': {
                handleCinematicToggle();
                break;
            }
            case 'x': {
                handleCinematicClear();
                break;
            }
            case 'd': {
                // Toggle the active contextual debug overlay
                showTechnicalOverlay.value = !showTechnicalOverlay.value;
                break;
            }
            case 'm': {
                app.setShowTextureMetadataOverlay(!app.showTextureMetadataOverlay);
                break;
            }
        }
    }

    // ─── Cinematic camera toolbar handlers ──────────────────────
    function handleCinematicCapture() {
        ensureOrbitControlsForInteraction(
            'cinematic-authoring',
            'Head tracking switched back to OrbitControls for cinematic camera authoring.',
        );
        const cinematic = threeCanvasRef.value?.cinematicCamera;
        if (!cinematic || cinematic.isPlaying.value) return;
        cinematic.captureROI();
    }

    function handleCinematicToggle() {
        ensureOrbitControlsForInteraction(
            'cinematic-playback',
            'Head tracking switched back to OrbitControls for cinematic playback.',
        );
        const cinematic = threeCanvasRef.value?.cinematicCamera;
        if (!cinematic) return;
        const ribbonSeries = threeCanvasRef.value?.ribbonSeries;
        cinematic.togglePlayback(ribbonSeries);
    }

    function handleCinematicClear() {
        ensureOrbitControlsForInteraction(
            'cinematic-authoring',
            'Head tracking switched back to OrbitControls for cinematic camera authoring.',
        );
        const cinematic = threeCanvasRef.value?.cinematicCamera;
        if (!cinematic || cinematic.isPlaying.value) return;
        cinematic.clearROIs();
    }

    onMounted(() => {
        window.addEventListener('keydown', handleCinematicKeydown);
    });

    onUnmounted(() => {
        window.removeEventListener('keydown', handleCinematicKeydown);
    });

    // Watch overlay modes to control renderer visibility
    watch(() => [app.isDrawingMode, app.isWalkMode, isTextureOverviewActive.value], ([isDrawing, isWalking, isOverviewActive]) => {
        const hasPathCaptureOverlay = isDrawing || isWalking || isOverviewActive;

        // Hide/show the Three.js canvas when in drawing mode
        if (threeCanvasRef.value?.renderer) {
            threeCanvasRef.value.renderer.domElement.style.opacity = hasPathCaptureOverlay ? '0' : '1';
        }

        // Also disable orbit controls when drawing
        if (threeCanvasRef.value?.controls) {
            if (hasPathCaptureOverlay) {
                threeCanvasRef.value.controls.enabled = false;
            } else if (app.viewerControlMode === 'orbit' && !threeCanvasRef.value?.cinematicCamera?.isPlaying?.value) {
                threeCanvasRef.value.controls.enabled = true;
            }
        }
    });

    watch(isTextureOverviewActive, (active) => {
        if (!threeCanvasRef.value) {
            return;
        }

        if (active) {
            threeCanvasRef.value.pauseRenderLoop?.();
            return;
        }

        threeCanvasRef.value.resumeRenderLoop?.();
    });

    watch(
        () => [realtime.isCameraActive.value, realtime.isCapturing.value],
        ([isCameraActive, isCapturing]) => {
            if ((isCameraActive || isCapturing) && app.viewerControlMode === 'headTracking') {
                ensureOrbitControlsForInteraction(
                    'realtime-capture',
                    'Head tracking switched back to OrbitControls because realtime webcam capture owns the camera.',
                );
            }
        }
    );

    watch(
        () => threeCanvasRef.value?.cinematicCamera?.isPlaying?.value ?? false,
        (isPlaying) => {
            if (isPlaying && app.viewerControlMode === 'headTracking') {
                ensureOrbitControlsForInteraction(
                    'cinematic-playback',
                    'Head tracking switched back to OrbitControls for cinematic playback.',
                );
            }
        }
    );

    // Watch thumbnail URL changes (used by texture browser UI, not for scene background)
    // Scene background is set directly by useThreeSetup after each texture load

    // Initialize when Three.js canvas is ready
    async function handleThreeInitialized(context) {
        console.log('[RibbonView] Three.js initialized with context:', context);
        console.log('[RibbonView] tileManager:', context.tileManager);
        console.log('[RibbonView] scene:', context.scene);

        await withTextureLoading('Loading...', async () => {
            // Initialize default ribbon
            const initializedFromQueryText = await initializeTextRibbonFromQuery();
            if (!initializedFromQueryText) {
                await initializeDefaultRibbon();
            }

            // Check for texture deep link
            if (route.params.textureId) {
                await loadTextureFromRoute(route.params.textureId);
            }

            isReady.value = true;
        });
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
            setTextureLoadingDisplay('Loading...', '');
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
                applyTextureResetState({ clearThumbnail: true });
                console.log('[RibbonView] Default ribbon created with', paths.length, 'paths');
            } else {
                console.warn('[RibbonView] No paths extracted from SVG');
            }
        } catch (error) {
            logRibbonViewFailure('[RibbonView] Failed to load default ribbon:', error);
        }
    }

    async function initializeTextRibbonFromQuery() {
        if (!threeCanvasRef.value) {
            return false;
        }

        const sourceText = getQueryStringValue(route.query.text);
        if (!sourceText.trim()) {
            return false;
        }

        setTextureLoadingDisplay('Rendering text...', '');

        try {
            const textRenderer = await ensureTextToSvg();
            const multiline = sourceText.includes('\n');
            const lineHeight = 1.1;
            const selectedFontId = textRenderer.selectedFont.value;
            const paths = await textRenderer.textToPoints(sourceText, {
                font: selectedFontId,
                multiline,
                lineHeight,
            });

            if (!paths.length) {
                return false;
            }

            await applyDrawingPathsToViewer(paths);
            applyTextureResetState({ clearThumbnail: true });
            console.log('[RibbonView] Text ribbon created from query parameter');
            return true;
        } catch (error) {
            logRibbonViewFailure('[RibbonView] Failed to render text from query parameter:', error);
            return false;
        }
    }

    // Load texture from route parameter
    async function loadTextureFromRoute(textureId) {
        if (!threeCanvasRef.value) return;

        try {
            setTextureLoadingDisplay('Loading texture...', '');
            console.log('[RibbonView] Loading texture:', textureId);
            await threeCanvasRef.value.loadTextures(textureId);

            try {
                const textureSet = await fetchTextureSetById(textureId);
                applyLoadedTextureState({
                    source: 'cloud',
                    texture: {
                        ...(textureSet || {}),
                        id: textureId,
                    },
                    isCached: false,
                    thumbnailUrl: textureSet?.thumbnail_url || null,
                    metadata: {
                        id: textureId,
                        name: textureSet?.name || '',
                        description: textureSet?.description || '',
                    },
                });
            } catch (metadataError) {
                console.warn('[RibbonView] Loaded texture but failed to resolve metadata:', metadataError);
            }
        } catch (error) {
            logRibbonViewFailure('[RibbonView] Failed to load texture:', error);
        }
    }

    // Drawing mode handlers
    function enterDrawMode() {
        ensureOrbitControlsForInteraction(
            'draw-capture',
            'Head tracking switched back to OrbitControls for draw capture.',
        );
        app.setDrawingMode(true);
    }

    function enterWalkMode() {
        ensureOrbitControlsForInteraction(
            'walk-capture',
            'Head tracking switched back to OrbitControls for walk capture.',
        );
        app.setWalkMode(true);
    }

    function enterContourMode() {
        ensureOrbitControlsForInteraction(
            'contour-capture',
            'Head tracking switched back to OrbitControls for contour capture.',
        );
        app.showContourPanel();
    }

    function getSavedDrawingName(kind, source = null) {
        const fallbackName = createDefaultDrawingName(kind);

        if (!source || typeof source !== 'object') {
            return fallbackName;
        }

        if (kind === 'text') {
            const text = typeof source.text === 'string'
                ? source.text.trim().replace(/\s+/g, ' ')
                : '';

            if (text) {
                return text.slice(0, 48);
            }
        }

        if (kind === 'emoji') {
            const label = typeof source.label === 'string' ? source.label.trim() : '';
            if (label) {
                return `Emoji: ${label}`;
            }

            const hexcode = typeof source.hexcode === 'string' ? source.hexcode.trim() : '';
            if (hexcode) {
                return `Emoji ${hexcode}`;
            }
        }

        if (kind === 'svg') {
            const fileName = typeof source.fileName === 'string'
                ? source.fileName.trim().replace(/\.svg$/i, '')
                : '';

            if (fileName) {
                return fileName;
            }
        }

        if (kind === 'walk') {
            const pointCount = Number(source.pointCount);
            if (Number.isFinite(pointCount) && pointCount > 0) {
                return `Walk ${pointCount} pts`;
            }
        }

        if (kind === 'gesture') {
            const strokeCount = Number(source.strokeCount);
            if (Number.isFinite(strokeCount) && strokeCount > 1) {
                return `Gesture ${strokeCount} strokes`;
            }
        }

        if (kind === 'contour') {
            const pathCount = Number(source.pathCount);
            if (Number.isFinite(pathCount) && pathCount > 0) {
                return `Contour ${pathCount} path${pathCount === 1 ? '' : 's'}`;
            }
        }

        return fallbackName;
    }

    async function applyDrawingPathsToViewer(paths) {
        if (!threeCanvasRef.value || !Array.isArray(paths) || paths.length === 0) {
            return false;
        }

        if (paths.length === 1) {
            await threeCanvasRef.value.createRibbon(paths[0]);
            return true;
        }

        await threeCanvasRef.value.createRibbonSeries(paths);
        return true;
    }

    function buildDrawingDraft({ kind, paths, source = null, description = '' } = {}) {
        return createDrawingDocument({
            kind,
            name: getSavedDrawingName(kind, source),
            description,
            paths,
            source,
            storageProvider: 'local',
        });
    }

    async function autosaveDrawingLocally(drawingDraft, { cachedFrom = null } = {}) {
        if (!drawingDraft?.paths?.length) {
            return null;
        }

        try {
            const savedDrawing = await saveLocalDrawing({
                ...drawingDraft,
                storageProvider: 'local',
                cachedFrom,
            });

            console.log('[RibbonView] Saved drawing locally:', savedDrawing.id, savedDrawing.name);
            return savedDrawing;
        } catch (error) {
            console.error('[RibbonView] Failed to autosave drawing locally:', error);
            return null;
        }
    }

    async function createDrawingAndAutosave({ kind, paths, source = null, description = '' } = {}) {
        const applied = await applyDrawingPathsToViewer(paths);
        if (!applied) {
            return null;
        }

        const drawingDraft = buildDrawingDraft({ kind, paths, source, description });
        return autosaveDrawingLocally(drawingDraft);
    }

    function unpackGeneratedDrawingPayload(payload) {
        if (Array.isArray(payload)) {
            return {
                paths: payload,
                source: null,
            };
        }

        if (Array.isArray(payload?.points)) {
            return {
                paths: payload.points,
                source: payload.source ?? null,
            };
        }

        return {
            paths: [],
            source: null,
        };
    }

    async function handleCapturedPathComplete(strokesData, { flipY = true, mode = 'draw' } = {}) {
        if (!threeCanvasRef.value || !strokesData || strokesData.length === 0) return;

        if (mode === 'walk') {
            app.setWalkMode(false);
        } else {
            app.setDrawingMode(false);
        }

        if (threeCanvasRef.value.resetCamera) {
            threeCanvasRef.value.resetCamera();
        }

        const isMultiStroke = Array.isArray(strokesData) && strokesData.length > 0 && Array.isArray(strokesData[0]);

        console.log('[RibbonView] handleCapturedPathComplete', {
            mode,
            isMultiStroke,
            strokeCount: isMultiStroke ? strokesData.length : 1
        });

        const strokes = isMultiStroke ? strokesData : [strokesData];
        const rawPathsPoints = strokes.map(stroke =>
            stroke.map(p => new THREE.Vector3(p.x, flipY ? -p.y : p.y, 0))
        ).filter(points => points.length >= 2);

        if (rawPathsPoints.length > 0) {
            const normalizedPaths = normalizePointsMultiPath(rawPathsPoints);
            await createDrawingAndAutosave({
                kind: mode === 'walk' ? 'walk' : 'gesture',
                paths: normalizedPaths,
                source: {
                    mode,
                    strokeCount: strokes.length,
                    pointCount: normalizedPaths.reduce((total, path) => total + path.length, 0),
                },
            });
        }
    }

    async function handleDrawingComplete(strokesData) {
        await handleCapturedPathComplete(strokesData, {
            flipY: true,
            mode: 'draw'
        });
    }

    async function handleWalkComplete(strokesData) {
        await handleCapturedPathComplete(strokesData, {
            flipY: false,
            mode: 'walk'
        });
    }

    async function finishDrawing() {
        if (drawCanvasRef.value) {
            const strokes = drawCanvasRef.value.finalizeDrawing();
            await handleDrawingComplete(strokes);
        }
    }

    async function finishWalk() {
        if (walkCanvasRef.value) {
            const strokes = walkCanvasRef.value.finalizeWalk();
            await handleWalkComplete(strokes);
        }
    }

    // Flow toggle (cycles through: off -> forward -> backward -> off)
    function toggleFlow() {
        app.cycleFlowState();
    }

    // Text to SVG handler
    async function handleTextGenerate(payload) {
        const { paths, source } = unpackGeneratedDrawingPayload(payload);
        if (!threeCanvasRef.value || paths.length === 0) return;

        await createDrawingAndAutosave({
            kind: 'text',
            paths,
            source,
        });
    }

    // Emoji picker handler
    async function handleEmojiGenerate(payload) {
        const { paths, source } = unpackGeneratedDrawingPayload(payload);
        if (!threeCanvasRef.value || paths.length === 0) return;

        await createDrawingAndAutosave({
            kind: 'emoji',
            paths,
            source,
        });
    }

    // Contour handler
    async function handleContourGenerate(payload) {
        const { paths, source } = unpackGeneratedDrawingPayload(payload);
        if (!threeCanvasRef.value || paths.length === 0) return;

        app.hideContourPanel();

        // inferContours returns plain {x, y} objects; convert to THREE.Vector3
        // so buildFromMultiplePaths can call p.clone() on each point.
        const vector3Paths = paths
            .map(path => path.map(p => new THREE.Vector3(p.x, p.y, 0)))
            .filter(path => path.length >= 2);

        if (vector3Paths.length === 0) return;

        // Match other drawing modalities by fitting the extracted contour bounds
        // to a consistent drawing size, so subjects do not appear tiny when the
        // source image contains large empty margins.
        const normalizedPaths = normalizePointsMultiPath(vector3Paths);

        await createDrawingAndAutosave({
            kind: 'contour',
            paths: normalizedPaths,
            source,
        });
    }

    // File import handler
    function openFileImport() {
        fileInputRef.value?.click();
    }

    function handleTextureVideoImport(event) {
        const file = event.target.files?.[0];
        event.target.value = '';

        if (!file || !file.type.startsWith('video/')) {
            return;
        }

        openCreateTextureFileMode({ file });
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
                    const splitPaths = splitAllPathsAtCusps3D(paths);
                    const normalizedPaths = normalizePointsMultiPath(splitPaths);
                    await createDrawingAndAutosave({
                        kind: 'svg',
                        paths: normalizedPaths,
                        source: {
                            fileName: file.name,
                        },
                    });
                }
            };
            reader.readAsText(file);
        } else if (fileName.endsWith('.zip')) {
            // Handle ZIP texture pack
            await threeCanvasRef.value?.loadTextures(file);
            applyTextureResetState();
        }

        // Reset file input
        event.target.value = '';
    }

    function resolveImageExportLogoSettings(settings = {}) {
        return {
            logoOverlayEnabled: settings.logoOverlayEnabled ?? app.exportLogoOverlayEnabled,
            logoOverlayCorner: settings.logoOverlayCorner ?? app.exportLogoOverlayCorner,
        };
    }

    // Image export handler
    async function handleExportImage() {
        ensureOrbitControlsForInteraction(
            'scene-export',
            'Head tracking switched back to OrbitControls for export.',
        );

        showExportDialog.value = false;

        const filename = createTimestampedExportFilename('png');
        const logoSettings = resolveImageExportLogoSettings();

        const preview = await threeCanvasRef.value?.captureImagePreviewWithSettings?.({
            format: 'png',
            ...logoSettings,
        });
        if (!preview?.dataURL) {
            await threeCanvasRef.value?.exportImageWithSettings?.({
                format: 'png',
                filename,
                ...logoSettings,
            });
            return;
        }

        exportImagePreview.value = {
            filename,
            dataURL: preview.dataURL,
            width: preview.width,
            height: preview.height,
        };
        showExportImageDialog.value = true;
    }

    async function handleDownloadExportImage(settings = {}) {
        const { format, filename } = buildExportImageFilename(settings);
        const logoSettings = resolveImageExportLogoSettings(settings);

        if (threeCanvasRef.value?.exportImageWithSettings) {
            const didStartDownload = await threeCanvasRef.value.exportImageWithSettings({
                width: settings.width,
                height: settings.height,
                format,
                quality: settings.quality,
                ...logoSettings,
                filename,
            });

            if (!didStartDownload) {
                toast.add({
                    severity: 'error',
                    summary: 'Download Failed',
                    detail: 'Unable to generate image for download.',
                    life: 3600,
                });
                return;
            }

            toast.add({
                severity: 'success',
                summary: 'Download Started',
                detail: 'Image has been saved to your device Downloads folder.',
                life: 3200,
            });
            return;
        }

        if (!exportImagePreview.value?.dataURL) {
            return;
        }

        const link = document.createElement('a');
        link.download = filename;
        link.href = exportImagePreview.value.dataURL;
        link.click();

        toast.add({
            severity: 'success',
            summary: 'Download Started',
            detail: 'Image has been saved to your device Downloads folder.',
            life: 3200,
        });
    }

    const isMobileDevice = computed(() => {
        if (typeof navigator === 'undefined') return false;
        if (typeof navigator.userAgentData?.mobile === 'boolean') {
            return navigator.userAgentData.mobile;
        }

        return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
    });

    const canImageShare = computed(() => {
        if (!isMobileDevice.value || typeof navigator === 'undefined') {
            return false;
        }

        return typeof navigator.share === 'function';
    });

    function getVideoMimeType(format) {
        return format === 'webm' ? 'video/webm' : 'video/mp4';
    }

    function createTimestampedExportFilename(extension) {
        const normalizedExtension = extension === 'jpeg' ? 'jpg' : extension;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        return `rivvon-${timestamp}.${normalizedExtension}`;
    }

    function getNormalizedImageExportFormat(settings = {}) {
        const format = settings.format === 'jpeg' || settings.format === 'webp' ? settings.format : 'png';
        const extension = format === 'jpeg' ? 'jpg' : format;

        return {
            format,
            extension,
        };
    }

    function buildExportImageFilename(settings = {}) {
        const { format, extension } = getNormalizedImageExportFormat(settings);
        const baseName = (exportImagePreview.value.filename || 'rivvon-export.png').replace(/\.[^.]+$/, '');

        return {
            format,
            filename: `${baseName}.${extension}`,
        };
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = filename;
        link.href = url;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    function getImageMimeType(format) {
        if (format === 'jpeg') return 'image/jpeg';
        if (format === 'webp') return 'image/webp';
        return 'image/png';
    }

    async function dataUrlToBlob(dataUrl) {
        const response = await fetch(dataUrl);
        return response.blob();
    }

    async function handleShareExportImage(settings = {}) {
        if (!canImageShare.value) {
            toast.add({
                severity: 'warn',
                summary: 'Share Not Available',
                detail: 'Native sharing is only available on supported mobile browsers.',
                life: 3200,
            });
            return;
        }

        const { format, filename } = buildExportImageFilename(settings);
        const logoSettings = resolveImageExportLogoSettings(settings);

        try {
            let blob = null;

            if (threeCanvasRef.value?.captureImageBlobWithSettings) {
                const capture = await threeCanvasRef.value.captureImageBlobWithSettings({
                    width: settings.width,
                    height: settings.height,
                    format,
                    quality: settings.quality,
                    ...logoSettings,
                });

                blob = capture?.blob ?? null;
            }

            if (!blob && exportImagePreview.value?.dataURL) {
                blob = await dataUrlToBlob(exportImagePreview.value.dataURL);
            }

            if (!blob) {
                toast.add({
                    severity: 'error',
                    summary: 'Share Failed',
                    detail: 'Unable to prepare image for sharing.',
                    life: 3600,
                });
                return;
            }

            const mimeType = blob.type || getImageMimeType(format);
            const file = new File([blob], filename, { type: mimeType });
            const shareData = { files: [file], title: filename };

            if (typeof navigator.canShare === 'function' && !navigator.canShare(shareData)) {
                toast.add({
                    severity: 'warn',
                    summary: 'Share Not Supported',
                    detail: 'This browser cannot share image files directly. Use Download instead.',
                    life: 3600,
                });
                return;
            }

            await navigator.share(shareData);
            toast.add({
                severity: 'success',
                summary: 'Shared',
                detail: 'Image shared successfully.',
                life: 2400,
            });
        } catch (error) {
            if (error?.name === 'AbortError') {
                return;
            }

            console.error('Image share failed:', error);
            toast.add({
                severity: 'error',
                summary: 'Share Failed',
                detail: 'Could not open the native share sheet on this device.',
                life: 3600,
            });
        }
    }

    function resetEncodedVideoExport() {
        encodedVideoExport.value = {
            blob: null,
            filename: '',
            format: '',
            mimeType: '',
            size: 0,
        };
        videoExportStatus.value = '';
    }

    function clearVideoExportDialogState({
        clearInitialSettings = false,
        clearSourceContext = false,
    } = {}) {
        resetEncodedVideoExport();

        if (clearInitialSettings) {
            exportDialogInitialSettings.value = null;
        }

        if (clearSourceContext) {
            exportSourceContext.value = null;
        }
    }

    async function handleVideoExportSettingsChange() {
        await refreshVideoExportInfo();

        if (exportAbortController.value || !encodedVideoExport.value?.blob) {
            return;
        }

        clearVideoExportDialogState();
    }

    function handleDownloadEncodedVideo() {
        const exportRecord = encodedVideoExport.value;
        if (!exportRecord?.blob) {
            toast.add({
                severity: 'warn',
                summary: 'Video Not Ready',
                detail: 'Encode the video before downloading it.',
                life: 3200,
            });
            return;
        }

        downloadBlob(exportRecord.blob, exportRecord.filename || 'rivvon-export.mp4');
        toast.add({
            severity: 'success',
            summary: 'Download Started',
            detail: 'Video has been saved to your device Downloads folder.',
            life: 3200,
        });
    }

    async function handleShareEncodedVideo() {
        if (!canImageShare.value) {
            toast.add({
                severity: 'warn',
                summary: 'Share Not Available',
                detail: 'Native sharing is only available on supported mobile browsers.',
                life: 3200,
            });
            return;
        }

        const exportRecord = encodedVideoExport.value;
        if (!exportRecord?.blob) {
            toast.add({
                severity: 'warn',
                summary: 'Video Not Ready',
                detail: 'Encode the video before sharing it.',
                life: 3200,
            });
            return;
        }

        try {
            const mimeType = exportRecord.mimeType || getVideoMimeType(exportRecord.format);
            const file = new File([exportRecord.blob], exportRecord.filename || 'rivvon-export.mp4', { type: mimeType });
            const shareData = { files: [file], title: exportRecord.filename || 'rivvon-export.mp4' };

            if (typeof navigator.canShare === 'function' && !navigator.canShare(shareData)) {
                toast.add({
                    severity: 'warn',
                    summary: 'Share Not Supported',
                    detail: 'This browser cannot share video files directly. Use Download instead.',
                    life: 3600,
                });
                return;
            }

            await navigator.share(shareData);
            toast.add({
                severity: 'success',
                summary: 'Shared',
                detail: 'Video shared successfully.',
                life: 2400,
            });
        } catch (error) {
            if (error?.name === 'AbortError') {
                return;
            }

            console.error('Video share failed:', error);
            toast.add({
                severity: 'error',
                summary: 'Share Failed',
                detail: 'Could not open the native share sheet on this device.',
                life: 3600,
            });
        }
    }

    function handleCancelVideoExport() {
        if (!exportAbortController.value) {
            handleExportVideoDialogVisibleChange(false);
            return;
        }

        videoExportStatus.value = 'Cancelling export…';
        exportAbortController.value.abort();
    }

    async function handleRecaptureExportImagePreview(settings = {}) {
        const width = Math.max(1, Math.round(Number(settings.width) || exportImagePreview.value.width || 1920));
        const height = Math.max(1, Math.round(Number(settings.height) || exportImagePreview.value.height || 1080));
        const logoSettings = resolveImageExportLogoSettings(settings);

        const preview = await threeCanvasRef.value?.captureImagePreviewWithSettings?.({
            width,
            height,
            format: 'png',
            ...logoSettings,
        });

        if (!preview?.dataURL) {
            return;
        }

        exportImagePreview.value = {
            ...exportImagePreview.value,
            dataURL: preview.dataURL,
            width: preview.width,
            height: preview.height,
        };
    }

    function resetExportImagePreview() {
        exportImagePreview.value = {
            filename: '',
            dataURL: '',
            width: 0,
            height: 0,
        };
    }

    function clearExportImageDialogState() {
        resetExportImagePreview();
    }

    const showExportImageDialog = ref(false);
    const exportImagePreview = ref({
        filename: '',
        dataURL: '',
        width: 0,
        height: 0,
    });

    // Video export dialog state
    const showExportDialog = ref(false);
    const exportInfo = ref({});
    const exportDialogInitialSettings = ref(null);
    const exportSourceContext = ref(null);
    const exportAbortController = ref(null);
    const encodedVideoExport = ref({
        blob: null,
        filename: '',
        format: '',
        mimeType: '',
        size: 0,
    });
    const videoExportStatus = ref('');
    let exportInfoRequestId = 0;

    function getViewerAnimationSettings() {
        return {
            flowState: app.flowState,
            flowSpeed: app.flowSpeed,
            flowCycleAlignmentEnabled: app.flowCycleAlignmentEnabled,
            textureAnimationEnabled: app.textureAnimationEnabled,
            textureAnimationReversed: app.textureAnimationReversed,
            textureRepeatMode: app.textureRepeatMode,
            textureFlipVertical: app.textureFlipVertical,
            textureOverviewLayoutStrategy: app.textureOverviewLayoutStrategy,
        };
    }

    function getSingleTextureExportContext() {
        if (app.multiTextureActive || !currentTextureSelection.value?.texture) {
            return null;
        }

        return {
            kind: 'viewer',
            source: currentTextureSelection.value.source,
            texture: currentTextureSelection.value.texture,
            isCached: Boolean(currentTextureSelection.value.isCached),
        };
    }

    async function buildVideoExportInfo(sourceContext = null, preferredMode = 'ribbons') {
        const requestId = ++exportInfoRequestId;
        const modes = {};

        if (!sourceContext || sourceContext.kind !== 'preview') {
            modes.ribbons = threeCanvasRef.value?.getExportInfo?.() ?? {};
        }

        const textureOnlyContext = sourceContext?.kind === 'preview'
            ? sourceContext
            : getSingleTextureExportContext();

        if (textureOnlyContext?.texture) {
            const previewTextureOnlyInfo = sourceContext?.kind === 'preview'
                ? await Promise.resolve(sourceContext.getTextureOnlyExportInfo?.())
                : null;

            modes.textureOnly = previewTextureOnlyInfo || await buildTextureOverviewExportInfo({
                texture: textureOnlyContext.texture,
                isLocal: textureOnlyContext.source === 'local',
                isCached: textureOnlyContext.isCached,
                getLocalTiles: getTiles,
                getCachedLocalId,
                viewerSettings: getViewerAnimationSettings(),
            });
        }

        if (requestId !== exportInfoRequestId) {
            return null;
        }

        const supportsRibbonExport = sourceContext?.kind !== 'preview';
        const defaultExportMode = preferredMode === 'textureOnly' && modes.textureOnly
            ? 'textureOnly'
            : (supportsRibbonExport ? 'ribbons' : 'textureOnly');

        return {
            hasWebCodecs: typeof VideoEncoder !== 'undefined',
            supportsRibbonExport,
            defaultExportMode,
            modes,
        };
    }

    async function refreshVideoExportInfo() {
        try {
            const nextInfo = await buildVideoExportInfo(
                exportSourceContext.value,
                exportInfo.value?.defaultExportMode || (exportSourceContext.value?.kind === 'preview' ? 'textureOnly' : 'ribbons'),
            );
            if (nextInfo) {
                exportInfo.value = nextInfo;
            }
        } catch (error) {
            console.error('Failed to refresh export info:', error);
        }
    }

    function prepareVideoExportDialog({
        sourceContext = null,
        exportSettings = null,
    } = {}) {
        ensureOrbitControlsForInteraction(
            'scene-export',
            'Head tracking switched back to OrbitControls for export.',
        );

        showExportImageDialog.value = false;
        clearExportImageDialogState();
        clearVideoExportDialogState();
        exportDialogInitialSettings.value = exportSettings;
        exportSourceContext.value = sourceContext;
    }

    // Video export handler — opens dialog instead of recording immediately
    async function handleExportVideo() {
        prepareVideoExportDialog();

        try {
            exportInfo.value = await buildVideoExportInfo(null, 'ribbons') ?? {};
        } catch (error) {
            console.error('Failed to prepare video export info:', error);
            exportInfo.value = {
                hasWebCodecs: typeof VideoEncoder !== 'undefined',
                supportsRibbonExport: true,
                defaultExportMode: 'ribbons',
                modes: {
                    ribbons: threeCanvasRef.value?.getExportInfo?.() ?? {},
                },
            };
        }

        showExportDialog.value = true;
    }

    async function handleTexturePreviewExport(payload) {
        const sourceContext = {
            kind: 'preview',
            source: payload.source,
            texture: payload.texture,
            isCached: Boolean(payload.isCached),
            getTextureOnlyExportInfo: payload.getTextureOnlyExportInfo,
            exportTextureOnlyVideo: payload.exportTextureOnlyVideo,
        };

        prepareVideoExportDialog({
            sourceContext,
            exportSettings: payload.exportSettings || null,
        });

        try {
            exportInfo.value = await buildVideoExportInfo(exportSourceContext.value, 'textureOnly') ?? {};
            showExportDialog.value = true;
        } catch (error) {
            const errorMessage = logRibbonViewFailure('Failed to prepare texture-only export info:', error, 'Could not prepare the texture-only export.');
            toast.add({
                severity: 'error',
                summary: 'Export Unavailable',
                detail: errorMessage,
                life: 4200,
            });
            exportSourceContext.value = null;
        }
    }

    const primaryWorkflowNavigation = computed(() => {
        if (textureCreatorVisible.value) {
            return {
                id: 'textureCreator',
                group: 'texture',
                breadcrumbs: textureCreatorNavigationState.value?.breadcrumbs ?? ['Create Texture'],
                statusLabel: textureCreatorNavigationState.value?.statusLabel ?? null,
                canGoBack: textureCreatorNavigationState.value?.canGoBack === true,
                back: () => {
                    if (
                        textureCreatorReturnOverlay.value
                        && textureCreatorLaunchSource.value === 'file'
                        && textureCreatorNavigationState.value?.canGoBack === true
                    ) {
                        closeCreateTextureMode({ reopenToolbarOverlay: textureCreatorReturnOverlay.value });
                        return true;
                    }

                    return textureCreatorRef.value?.handleNavigationBack?.() ?? false;
                },
                canExit: textureCreatorNavigationState.value?.canExit !== false,
                exit: () => textureCreatorRef.value?.handleNavigationExit?.() ?? closeCreateTextureMode(),
            };
        }

        if (realtimeSamplerVisible.value) {
            return {
                id: 'realtimeSampler',
                group: 'texture',
                breadcrumbs: ['Create Texture', 'Camera'],
                statusLabel: 'Capture',
                canGoBack: false,
                back: () => false,
                canExit: true,
                exit: () => {
                    handleRealtimeClose({ suppressCreateTextureReturn: true });
                    return true;
                },
            };
        }

        const mobileTexturePreviewActive = texturePreviewVisible.value && isNarrowViewport.value;

        if (isTextureOverviewActive.value || mobileTexturePreviewActive || textureBrowserVisible.value) {
            return {
                id: 'textures',
                group: 'texture',
                breadcrumbs: isTextureOverviewActive.value
                    ? ['Textures', 'Overview']
                    : (mobileTexturePreviewActive ? ['Textures', 'Preview'] : ['Textures']),
                statusLabel: null,
                canGoBack: isTextureOverviewActive.value || mobileTexturePreviewActive,
                back: () => {
                    if (isTextureOverviewActive.value) {
                        closeTextureOverview({ reopenTextureBrowser: true });
                        return true;
                    }

                    if (mobileTexturePreviewActive) {
                        app.hideTexturePreview();
                        return true;
                    }

                    return false;
                },
                canExit: true,
                exit: () => {
                    if (isTextureOverviewActive.value) {
                        closeTextureOverview({ reopenTextureBrowser: false });
                        return true;
                    }

                    app.hideTextureBrowser();
                    return true;
                },
            };
        }

        if (drawingBrowserVisible.value) {
            return {
                id: 'drawings',
                group: 'drawings',
                breadcrumbs: ['Drawings'],
                statusLabel: null,
                canGoBack: false,
                back: () => false,
                canExit: true,
                exit: () => {
                    app.hideDrawingBrowser();
                    return true;
                },
            };
        }

        return null;
    });
    const activeNavigationModal = computed(() => {
        if (showExportDialog.value) {
            return {
                id: 'exportVideo',
                label: 'Export Video',
                close: () => {
                    handleExportPanelClose();
                    return true;
                },
            };
        }

        if (showExportImageDialog.value) {
            return {
                id: 'exportImage',
                label: 'Export Image',
                close: () => {
                    handleExportPanelClose();
                    return true;
                },
            };
        }

        return null;
    });
    const activeNavigationOverlay = computed(() => {
        if (activeToolbarOverlay.value) {
            return {
                id: 'toolbarOverlay',
                label: activeToolbarOverlayTitle.value,
                close: () => {
                    handleToolbarOverlayClose();
                    return true;
                },
            };
        }

        if (app.toolsPanelVisible) {
            return {
                id: 'tools',
                label: 'Tools',
                close: () => {
                    app.hideToolsPanel();
                    return true;
                },
            };
        }

        return null;
    });
    const navigationBreadcrumbs = computed(() => {
        const breadcrumbs = primaryWorkflowNavigation.value
            ? [...primaryWorkflowNavigation.value.breadcrumbs]
            : [];

        if (activeNavigationOverlay.value?.label) {
            breadcrumbs.push(activeNavigationOverlay.value.label);
        }

        if (activeNavigationModal.value?.label) {
            breadcrumbs.push(activeNavigationModal.value.label);
        }

        return breadcrumbs;
    });
    const navigationCanGoBack = computed(() => {
        if (activeNavigationModal.value) {
            return true;
        }

        if (activeNavigationOverlay.value) {
            return true;
        }

        return primaryWorkflowNavigation.value?.canGoBack === true;
    });
    const navigationCanExitWorkflow = computed(() => Boolean(primaryWorkflowNavigation.value?.canExit));
    const navigationHasActiveWorkflow = computed(() => Boolean(primaryWorkflowNavigation.value));
    const navigationWorkflowGroup = computed(() => primaryWorkflowNavigation.value?.group ?? null);
    const headerNavigationModel = computed(() => {
        if (!navigationHasActiveWorkflow.value && !activeNavigationOverlay.value && !activeNavigationModal.value) {
            return null;
        }

        return {
            breadcrumbs: navigationBreadcrumbs.value,
            statusLabel: primaryWorkflowNavigation.value?.statusLabel ?? null,
            canGoBack: navigationCanGoBack.value,
            canExit: navigationCanExitWorkflow.value,
        };
    });

    async function handleNavigationBack() {
        if (activeNavigationModal.value) {
            activeNavigationModal.value.close();
            return;
        }

        if (activeNavigationOverlay.value) {
            activeNavigationOverlay.value.close();
            return;
        }

        if (primaryWorkflowNavigation.value?.canGoBack) {
            await primaryWorkflowNavigation.value.back?.();
        }
    }

    async function handleNavigationExit() {
        if (!primaryWorkflowNavigation.value?.canExit) {
            return;
        }

        await primaryWorkflowNavigation.value.exit?.();
    }

    const activePanelContext = computed(() => resolveOrderedContext([
        {
            title: 'Export Video',
            isActive: () => showExportDialog.value,
            close: () => handleExportPanelClose(),
        },
        {
            title: 'Export Image',
            isActive: () => showExportImageDialog.value,
            close: () => handleExportPanelClose(),
        },
        {
            title: 'Texture Overview',
            isActive: () => isTextureOverviewActive.value,
            close: () => closeTextureOverview(),
        },
    ]));
    const activePanelTitle = computed(() => activePanelContext.value?.title ?? null);

    function handleExportPanelClose() {
        showExportDialog.value = false;
        showExportImageDialog.value = false;
        clearExportImageDialogState();
        clearVideoExportDialogState({
            clearInitialSettings: true,
            clearSourceContext: true,
        });
    }

    function handleHeaderPanelClose() {
        activePanelContext.value?.close?.();
    }

    function handleExportVideoDialogVisibleChange(visible) {
        showExportDialog.value = visible;

        if (!visible && !exportAbortController.value) {
            clearVideoExportDialogState({
                clearInitialSettings: true,
                clearSourceContext: true,
            });
        }
    }

    function handleExportImageDialogVisibleChange(visible) {
        showExportImageDialog.value = visible;
        if (!visible) {
            clearExportImageDialogState();
        }
    }

    // Called when user confirms export settings in the dialog
    async function handleExportConfirm(settings) {
        ensureOrbitControlsForInteraction(
            'scene-export',
            'Head tracking switched back to OrbitControls for export.',
        );

        const filename = createTimestampedExportFilename(settings.format === 'webm' ? 'webm' : 'mp4');

        clearVideoExportDialogState();
        videoExportStatus.value = 'Preparing export…';

        exportAbortController.value = new AbortController();

        try {
            const progressHandlers = {
                signal: exportAbortController.value.signal,
                onProgress: (progress) => {
                    videoExportStatus.value = `Encoding… ${Math.round(progress * 100)}%`;
                },
                onStatus: (status) => {
                    videoExportStatus.value = status;
                },
            };

            let blob = null;

            if (settings.exportMode === 'textureOnly') {
                const sourceContext = exportSourceContext.value?.kind === 'preview'
                    ? exportSourceContext.value
                    : getSingleTextureExportContext();

                if (!sourceContext?.texture) {
                    throw new Error('Texture-only export requires a single active texture.');
                }

                if (sourceContext.kind === 'preview' && sourceContext.exportTextureOnlyVideo) {
                    blob = await sourceContext.exportTextureOnlyVideo({
                        width: settings.width,
                        height: settings.height,
                        fps: settings.fps,
                        format: settings.format,
                        duration: settings.duration,
                        loopCount: settings.loopCount,
                        quality: settings.quality,
                        logoOverlayEnabled: settings.logoOverlayEnabled,
                        logoOverlayCorner: settings.logoOverlayCorner,
                        ...progressHandlers,
                    });
                } else {
                    blob = await exportTextureOverviewVideo({
                        texture: sourceContext.texture,
                        isLocal: sourceContext.source === 'local',
                        isCached: sourceContext.isCached,
                        getLocalTiles: getTiles,
                        getCachedLocalId,
                        viewerSettings: getViewerAnimationSettings(),
                        width: settings.width,
                        height: settings.height,
                        fps: settings.fps,
                        format: settings.format,
                        duration: settings.duration,
                        loopCount: settings.loopCount,
                        quality: settings.quality,
                        logoOverlayEnabled: settings.logoOverlayEnabled,
                        logoOverlayCorner: settings.logoOverlayCorner,
                        ...progressHandlers,
                    });
                }
            } else {
                blob = await threeCanvasRef.value?.exportVideo({
                    width: settings.width,
                    height: settings.height,
                    fps: settings.fps,
                    format: settings.format,
                    duration: settings.duration,
                    loopCount: settings.loopCount,
                    cameraMovement: settings.cameraMovement,
                    quality: settings.quality,
                    logoOverlayEnabled: settings.logoOverlayEnabled,
                    logoOverlayCorner: settings.logoOverlayCorner,
                    ...progressHandlers,
                });
            }

            if (!blob) {
                videoExportStatus.value = 'Export cancelled.';
                return;
            }

            encodedVideoExport.value = {
                blob,
                filename,
                format: settings.format,
                mimeType: blob.type || getVideoMimeType(settings.format),
                size: blob.size,
            };
            videoExportStatus.value = '';
            toast.add({
                severity: 'success',
                summary: 'Encoding complete',
                detail: `${filename} · ${(blob.size / 1024 / 1024).toFixed(1)} MB`,
                life: 5000,
            });
        } catch (error) {
            const errorMessage = logRibbonViewFailure('Video export failed:', error);
            videoExportStatus.value = 'Export failed: ' + errorMessage;
        } finally {
            exportAbortController.value = null;
        }
    }

    // Texture browser handler
    function openTextureBrowser() {
        textureOverviewSelection.value = null;
        app.showTextureBrowser();
    }

    function openTextureOverview(payload) {
        if (!payload?.texture) {
            return;
        }

        textureOverviewSelection.value = {
            texture: payload.texture,
            source: payload.source === 'local' ? 'local' : 'cloud',
            isCached: Boolean(payload.isCached),
        };

        app.hideTextureBrowser();
    }

    function closeTextureOverview({ reopenTextureBrowser = true } = {}) {
        textureOverviewSelection.value = null;

        if (reopenTextureBrowser) {
            app.showTextureBrowser();
            return;
        }

        app.hideTextureBrowser();
    }

    async function handleTextureOverviewApply(payload) {
        if (!payload?.texture) {
            return;
        }

        let applied = false;

        if (payload.source === 'local') {
            applied = await handleLocalTextureSelect(payload.texture);
        } else {
            applied = await handleTextureSelect(payload.texture);
        }

        if (applied) {
            closeTextureOverview({ reopenTextureBrowser: false });
        }
    }

    function openDrawingBrowser() {
        app.showDrawingBrowser();
    }

    async function resolveSavedDrawingPaths(drawing) {
        const localPaths = inflateDrawingPaths(drawing?.paths);
        if (localPaths.length) {
            return localPaths;
        }

        const cloudDrawingId = drawing?.cloud_id
            || (drawing?.is_cloud ? drawing?.id : null)
            || null;

        if (!cloudDrawingId) {
            return [];
        }

        try {
            const cloudDrawing = await getDrawing(cloudDrawingId);
            return inflateDrawingPaths(cloudDrawing?.payload?.paths);
        } catch (error) {
            console.error('[RibbonView] Failed to fetch drawing payload from cloud:', error);
            return [];
        }
    }

    async function handleSavedDrawingSelect(drawing) {
        const paths = await resolveSavedDrawingPaths(drawing);
        if (!paths.length) {
            return;
        }

        if (threeCanvasRef.value?.resetCamera) {
            threeCanvasRef.value.resetCamera();
        }

        await applyDrawingPathsToViewer(paths);
    }

    // Track the initial tab for the texture browser
    const textureBrowserInitialTab = ref('all');

    // Check for texture browser query param on mount
    watch(() => route.query.textures, (texturesParam) => {
        if (texturesParam === 'mine' || texturesParam === 'all' || texturesParam === 'local' || texturesParam === 'my-cloud' || texturesParam === 'public') {
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

    // Check for realtime webcam query param
    watch(() => route.query.realtime, async (realtimeParam) => {
        if (realtimeParam === 'true') {
            try {
                await enterRealtimeMode();
            } finally {
                router.replace({ path: route.path, query: {} });
            }
        }
    }, { immediate: true });

    // Check for local texture query param
    const { getTextureSet: getLocalTextureSet, getTiles, cacheCloudTexture, getCachedLocalId, evictCachedTexture } = useLocalStorage();

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
        return await withTextureLoading('Loading local texture...', async () => {
            try {
                const textureSet = await getLocalTextureSet(textureId);

                if (!textureSet) {
                    throw new Error('Local texture not found');
                }

                console.log(`[RibbonView] Found local texture set: ${textureSet.name}`);

                // Load textures from local storage via TileManager
                const success = await threeCanvasRef.value?.loadTexturesFromLocal(textureSet, getTiles, handleTextureLoadProgress);

                if (!success) {
                    throw new Error('Local texture data is incomplete or unreadable on this device.');
                }

                applyLoadedTextureState({
                    source: 'local',
                    texture: textureSet,
                    isCached: false,
                    thumbnailUrl: textureSet.thumbnail_data_url || null,
                    metadata: {
                        id: textureSet.id,
                        name: textureSet.name || '',
                        description: textureSet.description || '',
                    },
                });

                console.log('[RibbonView] Local texture loaded successfully');
                return true;
            } catch (error) {
                handleTextureLoadFailure({
                    error,
                    consoleMessage: '[RibbonView] Failed to load local texture:',
                    alertPrefix: 'Failed to load local texture: ',
                });
                return false;
            }
        });
    }

    // Handle local texture selection from browser
    async function handleLocalTextureSelect(texture) {
        console.log('[RibbonView] Selected local texture from browser:', texture.name);
        return await loadLocalTexture(texture.id);
    }

    /**
     * Handle multi-texture selection from TextureBrowser
     * @param {Array<{id: string, source: string, name: string}>} selections
     *   Each entry has id, source ('cloud'|'local'), and name
     */
    async function handleMultiTextureSelect(selections) {
        console.log('[RibbonView] Multi-texture selection:', selections.length, 'textures');
        await withTextureLoading('Loading multiple textures...', async () => {
            try {
                // Build texture set entries in parallel
                const textureSetsWithMeta = await Promise.all(
                    selections.map(async (sel) => {
                        if (sel.source === 'local') {
                            const textureSet = await getLocalTextureSet(sel.id);
                            if (!textureSet) throw new Error(`Local texture not found: ${sel.name}`);
                            return { textureSet, source: 'local', getTiles };
                        } else {
                            const textureSet = await fetchTextureSetById(sel.id);
                            if (!textureSet || !textureSet.tiles || textureSet.tiles.length === 0) {
                                throw new Error(`No tiles found for: ${sel.name}`);
                            }
                            return { textureSet, source: 'remote' };
                        }
                    })
                );

                // Load all TileManagers and rebuild ribbons
                const success = await threeCanvasRef.value?.loadMultipleTextures(textureSetsWithMeta);

                if (success) {
                    applyTextureResetState({
                        activeTextureIds: selections.map(s => s.id),
                    });

                    // Use first texture's thumbnail for background
                    const firstTextureSetWithMeta = textureSetsWithMeta[0];
                    if (firstTextureSetWithMeta?.source === 'local' && firstTextureSetWithMeta.textureSet?.thumbnail_data_url) {
                        app.setThumbnailUrl(firstTextureSetWithMeta.textureSet.thumbnail_data_url);
                    }

                    console.log('[RibbonView] Multi-texture load complete');
                }
            } catch (error) {
                handleTextureLoadFailure({
                    error,
                    consoleMessage: '[RibbonView] Failed to load multiple textures:',
                    alertPrefix: 'Failed to load textures: ',
                });
            }
        });
    }

    // Loading state for remote texture
    const isLoadingTexture = ref(true);
    const loadingMessage = ref('Loading...');
    const loadingStatusText = ref('');

    function setTextureLoadingDisplay(message = 'Loading...', statusText = '') {
        loadingMessage.value = message;
        loadingStatusText.value = statusText;
    }

    function setTextureLoadingProgress(stage, current, total) {
        const numericTotal = Math.max(0, Number(total) || 0);
        const numericCurrent = Math.max(0, Number(current) || 0);
        const percent = numericTotal > 0
            ? `${Math.round((numericCurrent / numericTotal) * 100)}%`
            : '';

        if (stage === 'downloading') {
            setTextureLoadingDisplay('Downloading...', percent);
            return;
        }

        if (stage === 'building') {
            setTextureLoadingDisplay('Building...', percent);
            return;
        }

        if (stage === 'loading') {
            setTextureLoadingDisplay('Loading...', percent);
            return;
        }

        setTextureLoadingDisplay(loadingMessage.value || 'Loading...', percent);
    }

    const handleTextureLoadProgress = (stage, current, total) => {
        setTextureLoadingProgress(stage, current, total);
    };

    function applyLoadedTextureState({
        source,
        texture,
        isCached = false,
        thumbnailUrl = null,
        metadata = null,
    } = {}) {
        if (thumbnailUrl) {
            app.setThumbnailUrl(thumbnailUrl);
        }

        setCurrentTextureSelection({
            source,
            texture,
            isCached,
        });
        setCurrentTextureMetadata(metadata);
    }

    async function startTextureLoading(message = 'Loading...') {
        setTextureLoadingDisplay(message, '');

        if (!isLoadingTexture.value) {
            isLoadingTexture.value = true;
            await nextTick();
        }
    }

    function finishTextureLoading() {
        isLoadingTexture.value = false;
        setTextureLoadingDisplay('', '');
    }

    function resolveErrorMessage(error, fallbackMessage = 'Unknown error') {
        if (error instanceof Error && error.message) {
            return error.message;
        }

        if (typeof error === 'string' && error.trim()) {
            return error;
        }

        return fallbackMessage;
    }

    function logRibbonViewFailure(consoleMessage, error, fallbackMessage) {
        const errorMessage = resolveErrorMessage(error, fallbackMessage);
        console.error(consoleMessage, error);
        return errorMessage;
    }

    function handleTextureLoadFailure({
        error,
        consoleMessage,
        alertPrefix = null,
        showAccessDeniedModal = false,
    } = {}) {
        const errorMessage = logRibbonViewFailure(consoleMessage, error);

        if (showAccessDeniedModal && (errorMessage.includes('Not authenticated') || errorMessage.includes('Access denied'))) {
            app.showBetaModal('access-denied');
            return;
        }

        if (alertPrefix) {
            alert(`${alertPrefix}${errorMessage}`);
        }
    }

    async function withTextureLoading(message, task) {
        await startTextureLoading(message);

        try {
            return await task();
        } finally {
            finishTextureLoading();
        }
    }

    // Handle texture selection from browser
    async function handleTextureSelect(texture) {
        console.log('[RibbonView] Loading remote texture:', texture.name);
        return await withTextureLoading('Loading...', async () => {
            try {
                const { cacheCloudTextureInBackground, getCachedTextureTiles, resolveTextureLoadTarget } = await import('../services/textureCacheCoordinator.js');
                const resolvedTexture = await resolveTextureLoadTarget({
                    texture,
                    getLocalTextureSet,
                    getLocalTiles: getTiles,
                    getCachedLocalId,
                    onInvalidCachedLocal: async ({ cloudTextureId }) => {
                        await evictCachedTexture(cloudTextureId);
                    },
                    fetchRemoteTextureSet: fetchTextureSetById,
                    includeLocalTiles: true,
                    preferSessionCache: true,
                });

                if (resolvedTexture.kind === 'remote' && (!resolvedTexture.textureSet || !resolvedTexture.textureSet.tiles || resolvedTexture.textureSet.tiles.length === 0)) {
                    throw new Error('No tiles found in texture set');
                }

                // Check if this is a Google Drive texture that requires authentication
                if (resolvedTexture.hasDriveTiles && !isAuthenticated.value) {
                    // Show beta modal with texture-auth context
                    app.showBetaModal('texture-auth');
                    return false;
                }

                const success = resolvedTexture.kind === 'session'
                    ? await threeCanvasRef.value?.loadTexturesFromSession(resolvedTexture.textureSet, resolvedTexture.sessionTileEntry || null, handleTextureLoadProgress)
                    : resolvedTexture.kind === 'remote'
                        ? await threeCanvasRef.value?.loadTexturesFromRemote(resolvedTexture.textureSet, handleTextureLoadProgress)
                        : await threeCanvasRef.value?.loadTexturesFromTileRecords(resolvedTexture.textureSet, resolvedTexture.localTiles, handleTextureLoadProgress);

                if (!success) {
                    throw new Error('Texture data is incomplete or unreadable.');
                }

                applyLoadedTextureState({
                    source: 'cloud',
                    texture,
                    isCached: resolvedTexture.kind === 'cached-local',
                    thumbnailUrl: texture.thumbnail_url || null,
                    metadata: {
                        id: texture.id,
                        name: resolvedTexture.textureSet?.name || texture.name || '',
                        description: resolvedTexture.textureSet?.description || texture.description || '',
                    },
                });

                // Cache the downloaded tiles in background
                if (resolvedTexture.kind === 'remote') {
                    const tileEntry = getCachedTextureTiles(resolvedTexture.textureSet);
                    const tileManagerRef = threeCanvasRef.value?.tileManager;
                    const tm = tileManagerRef?.value ?? tileManagerRef;
                    cacheCloudTextureInBackground({
                        texture,
                        textureSet: resolvedTexture.textureSet,
                        cacheCloudTexture,
                        tileEntry,
                        tileManager: tm,
                        logPrefix: '[RibbonView]',
                    });
                }

                console.log('[RibbonView] Remote texture loaded successfully');
                return true;
            } catch (error) {
                handleTextureLoadFailure({
                    error,
                    consoleMessage: '[RibbonView] Failed to load remote texture:',
                    alertPrefix: 'Failed to load texture: ',
                    showAccessDeniedModal: true,
                });
                return false;
            }
        });
    }

    // GPU device-loss recovery
    const isDeviceLost = computed(() => threeCanvasRef.value?.isDeviceLost?.value ?? false);

    async function handleDeviceLostRestart() {
        threeCanvasRef.value?.teardownViewer();
        await threeCanvasRef.value?.reinitialize();
        // reinitialize emits 'initialized' which triggers handleThreeInitialized
    }

    // Handle applying a newly created texture 
    async function handleApplyCreatedTexture(texture) {
        console.log('[RibbonView] Applying created texture:', texture);

        // Close the Slyce panel
        closeCreateTextureMode();

        if (texture?.source === 'local' || texture?.isLocal) {
            await handleLocalTextureSelect(texture);
            return;
        }

        // Load the texture using the same mechanism as the texture browser
        await handleTextureSelect(texture);
    }
</script>

<template>
    <div class="ribbon-view">
        <!-- Checkerboard for drawing mode -->
        <div
            class="checkerboard"
            :class="{ visible: app.isDrawingMode }"
        ></div>

        <!-- Renderer indicator (debug mode) -->
        <RendererIndicator />

        <!-- Header with logo and auth -->
        <AppHeader
            :camera-active="isCameraIndicatorVisible"
            :camera-dismiss-label="cameraDismissLabel"
            :navigation-model="headerNavigationModel"
            :panel-title="activePanelTitle"
            :viewer-title="app.currentTextureName"
            :toolbar-overlay-title="activeToolbarOverlayTitle"
            @request-navigation-back="handleNavigationBack"
            @request-navigation-exit="handleNavigationExit"
            @request-close-realtime-mode="handleRealtimeClose"
            @request-close-panel="handleHeaderPanelClose"
            @request-close-toolbar-overlay="handleToolbarOverlayClose"
            @request-turn-off-camera="handleTurnOffCamera"
        />

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

        <WalkCanvas
            ref="walkCanvasRef"
            :active="app.isWalkMode"
        />

        <!-- Countdown display (numbers in center of screen) -->
        <CountdownNumbers />

        <!-- Countdown progress bar -->
        <CountdownProgressBar />

        <!-- Bottom toolbar -->
        <BottomToolbar
            :cinematic-playing="threeCanvasRef?.cinematicCamera?.isPlaying?.value ?? false"
            :cinematic-roi-count="threeCanvasRef?.cinematicCamera?.roiCount?.value ?? 0"
            :technical-overlay="showTechnicalOverlay"
            :active-toolbar-overlay="activeToolbarOverlay"
            :export-image-visible="showExportImageDialog"
            :export-video-visible="showExportDialog"
            :navigation-can-go-back="navigationCanGoBack"
            :navigation-can-exit-workflow="navigationCanExitWorkflow"
            :navigation-has-active-workflow="navigationHasActiveWorkflow"
            :navigation-workflow-group="navigationWorkflowGroup"
            @request-enter-draw-mode="enterDrawMode"
            @request-enter-walk-mode="enterWalkMode"
            @request-enter-contour-mode="enterContourMode"
            @request-open-drawing-browser="openDrawingBrowser"
            @request-open-texture-file="openCreateTextureFileMode"
            @request-open-texture-camera="openCreateTextureCameraMode"
            @request-close-realtime-mode="handleRealtimeClose"
            @request-viewer-control-mode-change="handleViewerControlModeChange"
            @request-reset-viewer="handleViewerReset"
            @request-toggle-flow="toggleFlow"
            @request-open-text-panel="app.showTextPanel"
            @request-open-emoji-picker="app.showEmojiPicker"
            @request-open-texture-browser="openTextureBrowser"
            @request-import-file="openFileImport"
            @request-close-export-image="handleExportPanelClose"
            @request-close-export-video="handleExportPanelClose"
            @request-navigation-back="handleNavigationBack"
            @request-navigation-exit="handleNavigationExit"
            @request-toolbar-overlay-change="handleToolbarOverlayChange"
            @request-export-image="handleExportImage"
            @request-export-video="handleExportVideo"
            @request-finish-drawing="finishDrawing"
            @request-finish-walk="finishWalk"
            @request-cinematic-capture="handleCinematicCapture"
            @request-cinematic-toggle="handleCinematicToggle"
            @request-cinematic-clear="handleCinematicClear"
            @request-technical-overlay-toggle="showTechnicalOverlay = !showTechnicalOverlay"
        />

        <TextureMetadataOverlay
            :visible="showTextureMetadataOverlay"
            :title="app.currentTextureName"
            :description="app.currentTextureDescription"
        />

        <!-- Hidden file input -->
        <input
            ref="fileInputRef"
            type="file"
            accept=".svg,.zip"
            style="display: none"
            @change="handleFileImport"
        />

        <input
            ref="textureVideoInputRef"
            type="file"
            accept="video/*"
            style="display: none"
            @change="handleTextureVideoImport"
        />

        <!-- Modals -->
        <TextInputPanel
            v-model:visible="textPanelVisible"
            @request-generate="handleTextGenerate"
        />
        <EmojiPickerPanel
            v-model:visible="emojiPickerVisible"
            @request-generate="handleEmojiGenerate"
        />
        <ContourPanel
            v-if="contourPanelVisible"
            :active="contourPanelVisible"
            @contour-complete="handleContourGenerate"
        />
        <DrawingBrowser
            v-if="drawingBrowserVisible"
            :visible="drawingBrowserVisible"
            @request-close="app.hideDrawingBrowser"
            @request-select="handleSavedDrawingSelect"
        />
        <TextureOverviewPanel
            v-if="textureOverviewSelection?.texture"
            :texture="textureOverviewSelection.texture"
            :source="textureOverviewSelection.source"
            :is-cached="textureOverviewSelection.isCached"
            @request-apply="handleTextureOverviewApply"
            @request-close="closeTextureOverview"
            @request-export-preview="handleTexturePreviewExport"
        />
        <TextureBrowser
            v-if="textureBrowserVisible"
            :visible="textureBrowserVisible"
            :initial-tab="textureBrowserInitialTab"
            @request-close="app.hideTextureBrowser"
            @request-open-overview="openTextureOverview"
            @request-select="handleTextureSelect"
            @request-select-local="handleLocalTextureSelect"
            @request-select-multi="handleMultiTextureSelect"
        />

        <!-- Full-page Slyce panel (like drawing mode) -->
        <TextureCreator
            ref="textureCreatorRef"
            v-if="textureCreatorVisible"
            :active="textureCreatorVisible"
            :launch-source="textureCreatorLaunchSource"
            @navigation-state-change="handleTextureCreatorNavigationStateChange"
            @request-close="closeCreateTextureMode"
            @request-apply-realtime-texture="handleRealtimeApplyFromTextureCreator"
            @request-apply-texture="handleApplyCreatedTexture"
        />

        <!-- Full-page Realtime Sampler (like Slyce panel) -->
        <RealtimeSampler
            v-if="realtimeSamplerVisible"
            :active="realtimeSamplerVisible"
            @request-apply="handleRealtimeApply"
            @request-close="handleRealtimeClose"
        />

        <BetaModal />

        <!-- GPU device lost recovery overlay -->
        <DeviceLostOverlay
            :visible="isDeviceLost"
            @request-restart="handleDeviceLostRestart"
        />

        <!-- Export Video Dialog -->
        <ExportVideoDialog
            :visible="showExportDialog"
            :export-info="exportInfo"
            :initial-settings="exportDialogInitialSettings"
            :is-encoding="!!exportAbortController"
            :export-status="videoExportStatus"
            :encoded-filename="encodedVideoExport.filename"
            :encoded-size="encodedVideoExport.size"
            :can-share="canImageShare"
            @update:visible="handleExportVideoDialogVisibleChange"
            @request-export="handleExportConfirm"
            @request-download="handleDownloadEncodedVideo"
            @request-share="handleShareEncodedVideo"
            @request-cancel="handleCancelVideoExport"
            @settings-change="handleVideoExportSettingsChange"
        />

        <ExportImageDialog
            :visible="showExportImageDialog"
            :image-data-url="exportImagePreview.dataURL"
            :filename="exportImagePreview.filename"
            :image-width="exportImagePreview.width"
            :image-height="exportImagePreview.height"
            :can-share="canImageShare"
            @update:visible="handleExportImageDialogVisibleChange"
            @request-recapture-preview="handleRecaptureExportImagePreview"
            @request-download="handleDownloadExportImage"
            @request-share="handleShareExportImage"
        />

        <Toast position="top-center" />

        <!-- Contextual technical overlay (press D to toggle) -->
        <ViewerTechnicalOverlay
            :cinematic-camera="threeCanvasRef?.cinematicCamera"
            :head-tracking="threeCanvasRef?.headTracking"
            :viewer-control-mode="app.viewerControlMode"
            :visible="showTechnicalOverlay"
            :fps="threeCanvasRef?.fps ?? 0"
            :perf-telemetry="threeCanvasRef?.perfTelemetry ?? null"
        />

        <!-- Loading overlay for texture loading or viewer reinitialization -->
        <Transition name="fade">
            <div
                v-if="isLoadingTexture || app.isReinitializing"
                class="loading-overlay"
            >
                <LoadingIndicator
                    class="loading-content"
                    :message="loadingMessage || 'Loading...'"
                    :status-text="loadingStatusText"
                />
            </div>
        </Transition>
    </div>
</template>

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
    .ribbon-view :deep(.export-image-panel.active),
    .ribbon-view :deep(.export-video-panel.active),
    .ribbon-view :deep(.launcher-panel.active),
    .ribbon-view :deep(.tools-panel.active),
    .ribbon-view :deep(.about-panel.active),
    .ribbon-view :deep(.text-input-panel.active),
    .ribbon-view :deep(.beta-modal),
    .ribbon-view :deep(.texture-browser.active),
    .ribbon-view :deep(.slyce-panel.active),
    .ribbon-view :deep(.realtime-panel.active),
    .ribbon-view :deep(.draw-canvas.active),
    .ribbon-view :deep(.walk-canvas.active),
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
        z-index: 5;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(8px);
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
