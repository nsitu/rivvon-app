<script setup>
    import { ref, computed, onMounted, onUnmounted, watch, shallowRef, defineAsyncComponent } from 'vue';
    import { useRoute, useRouter } from 'vue-router';
    import { useViewerStore } from '../stores/viewerStore';
    import { useGoogleAuth } from '../composables/shared/useGoogleAuth';
    import { useScreenWakeLock } from '../composables/viewer/useScreenWakeLock';
    import { useThreeSetup } from '../composables/viewer/useThreeSetup';
    import { createDefaultDrawingName, createDrawingDocument, inflateDrawingPaths } from '../modules/shared/drawingLibrary.js';
    import { parseSvgContentDynamicResolution, normalizePointsMultiPath } from '../modules/viewer/svgPathToPoints';
    import { splitAllPathsAtCusps3D } from '../modules/viewer/cuspSplitter.js';
    import { useRivvonAPI } from '../services/api.js';
    import { useDrawingStorage } from '../services/drawingStorage.js';
    import { useLocalStorage } from '../services/localStorage.js';
    import * as THREE from 'three';

    // Components
    import AppHeader from '../components/viewer/AppHeader.vue';
    import BottomToolbar from '../components/viewer/BottomToolbar.vue';
    import CountdownNumbers from '../components/viewer/CountdownNumbers.vue';
    import CountdownProgressBar from '../components/viewer/CountdownProgressBar.vue';
    const TextInputPanel = defineAsyncComponent(() => import('../components/viewer/TextInputPanel.vue'));
    const EmojiPickerPanel = defineAsyncComponent(() => import('../components/viewer/EmojiPickerPanel.vue'));
    const DrawingBrowser = defineAsyncComponent(() => import('../components/viewer/DrawingBrowser.vue'));
    const TextureBrowser = defineAsyncComponent(() => import('../components/viewer/TextureBrowser.vue'));
    const TextureCreator = defineAsyncComponent(() => import('../components/viewer/TextureCreator.vue'));
    import BetaModal from '../components/viewer/BetaModal.vue';
    const ExportVideoDialog = defineAsyncComponent(() => import('../components/viewer/ExportVideoDialog.vue'));
    import ThreeCanvas from '../components/viewer/ThreeCanvas.vue';
    const DrawCanvas = defineAsyncComponent(() => import('../components/viewer/DrawCanvas.vue'));
    const WalkCanvas = defineAsyncComponent(() => import('../components/viewer/WalkCanvas.vue'));
    import RendererIndicator from '../components/viewer/RendererIndicator.vue';
    import ViewerTechnicalOverlay from '../components/viewer/ViewerTechnicalOverlay.vue';
    import DeviceLostOverlay from '../components/viewer/DeviceLostOverlay.vue';
    import TextureMetadataOverlay from '../components/viewer/TextureMetadataOverlay.vue';
    const RealtimeSampler = defineAsyncComponent(() => import('../components/slyce/RealtimeSampler.vue'));

    const app = useViewerStore();
    const { isAuthenticated, isAdmin } = useGoogleAuth();
    const route = useRoute();
    const router = useRouter();
    const { saveDrawing: saveLocalDrawing } = useDrawingStorage();
    const { uploadDrawing, uploadDrawingToR2, getDrawing } = useRivvonAPI();

    useScreenWakeLock();

    // Realtime webcam mode
    const realtimeInstance = shallowRef(null);
    let realtimeLoaderPromise = null;

    async function ensureRealtime() {
        if (realtimeInstance.value) {
            return realtimeInstance.value;
        }

        if (!realtimeLoaderPromise) {
            realtimeLoaderPromise = import('../composables/slyce/useRealtimeSlyce.js')
                .then(({ useRealtimeSlyce }) => {
                    const instance = useRealtimeSlyce();
                    realtimeInstance.value = instance;
                    return instance;
                })
                .finally(() => {
                    realtimeLoaderPromise = null;
                });
        }

        return realtimeLoaderPromise;
    }

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

    let textureServicePromise = null;

    async function fetchTextureSetById(textureId) {
        if (!textureServicePromise) {
            textureServicePromise = import('../services/textureService.js');
        }

        const { fetchTextureSet } = await textureServicePromise;
        return fetchTextureSet(textureId);
    }

    const returnToCreateTextureOnRealtimeClose = ref(false);
    const textureCreatorLaunchSource = ref(null);

    function openCreateTextureMode() {
        returnToCreateTextureOnRealtimeClose.value = false;
        textureCreatorLaunchSource.value = null;
        app.showSlyce();
    }

    function openCreateTextureFileMode() {
        returnToCreateTextureOnRealtimeClose.value = false;
        textureCreatorLaunchSource.value = 'file';
        app.showSlyce();
    }

    async function openCreateTextureCameraMode() {
        textureCreatorLaunchSource.value = null;
        await enterRealtimeMode();
    }

    function closeCreateTextureMode() {
        textureCreatorLaunchSource.value = null;
        app.hideSlyce();
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

        if (mode === 'mouseTilt') {
            // Mouse tilt needs no camera access — switch directly
            app.clearHeadTrackingFeedback();
            app.setViewerControlMode('mouseTilt');
            return;
        }

        if (realtime.isCameraActive.value || realtime.isCapturing.value || app.realtimeSamplerVisible) {
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
    const fileInputRef = ref(null);

    // Local state
    const isReady = ref(false);
    const showTechnicalOverlay = ref(false);
    const showTextureMetadataOverlay = computed(() => (
        app.showTextureMetadataOverlay
        && !app.multiTextureActive
        && Boolean(app.currentTextureName || app.currentTextureDescription)
    ));

    function setCurrentTextureMetadata(metadata = null) {
        if (!metadata) {
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

    // Watch drawing mode to control renderer visibility
    watch(() => [app.isDrawingMode, app.isWalkMode], ([isDrawing, isWalking]) => {
        const hasPathCaptureOverlay = isDrawing || isWalking;

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

        // Show loading indicator during initial setup
        isLoadingTexture.value = true;
        loadingProgress.value = 'Initializing...';

        try {
            // Initialize default ribbon
            await initializeDefaultRibbon();

            // Check for texture deep link
            if (route.params.textureId) {
                await loadTextureFromRoute(route.params.textureId);
            }

            isReady.value = true;
        } finally {
            isLoadingTexture.value = false;
            loadingProgress.value = '';
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
            loadingProgress.value = 'Loading...';
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
                setCurrentTextureMetadata(null);
                app.setThumbnailUrl(null);
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
            loadingProgress.value = 'Loading texture...';
            console.log('[RibbonView] Loading texture:', textureId);
            await threeCanvasRef.value.loadTextures(textureId);

            try {
                const textureSet = await fetchTextureSetById(textureId);
                if (textureSet?.thumbnail_url) {
                    app.setThumbnailUrl(textureSet.thumbnail_url);
                }
                setCurrentTextureMetadata({
                    id: textureId,
                    name: textureSet?.name || '',
                    description: textureSet?.description || '',
                });
            } catch (metadataError) {
                console.warn('[RibbonView] Loaded texture but failed to resolve metadata:', metadataError);
            }
        } catch (error) {
            console.error('[RibbonView] Failed to load texture:', error);
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

    function getDrawingAutosaveTarget() {
        if (!isAuthenticated.value) {
            return 'local';
        }

        if (!isAdmin.value) {
            return 'google-drive';
        }

        return app.drawingAutosaveTarget === 'local' || app.drawingAutosaveTarget === 'r2'
            ? app.drawingAutosaveTarget
            : 'google-drive';
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

    async function dataUrlToBlob(dataUrl) {
        if (!dataUrl) {
            return null;
        }

        const response = await fetch(dataUrl);
        return response.blob();
    }

    async function uploadDrawingToCloud(drawingDraft) {
        const autosaveTarget = getDrawingAutosaveTarget();
        if (!drawingDraft || autosaveTarget === 'local') {
            return null;
        }

        const thumbnailBlob = await dataUrlToBlob(drawingDraft.thumbnail_data_url);
        const uploadOptions = {
            name: drawingDraft.name,
            description: drawingDraft.description,
            kind: drawingDraft.kind,
            paths: drawingDraft.paths,
            source: drawingDraft.source,
            thumbnailBlob,
        };

        if (autosaveTarget === 'r2') {
            return uploadDrawingToR2(uploadOptions);
        }

        return uploadDrawing(uploadOptions);
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
        let cloudResult = null;

        try {
            cloudResult = await uploadDrawingToCloud(drawingDraft);
            if (cloudResult?.drawingId) {
                console.log('[RibbonView] Saved drawing to cloud:', cloudResult.drawingId, cloudResult.storageProvider);
            }
        } catch (error) {
            console.error('[RibbonView] Failed to autosave drawing to cloud:', error);
        }

        return autosaveDrawingLocally(drawingDraft, {
            cachedFrom: cloudResult?.drawingId || null,
        });
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
            setCurrentTextureMetadata(null);
        }

        // Reset file input
        event.target.value = '';
    }

    // Image export handler
    function handleExportImage() {
        ensureOrbitControlsForInteraction(
            'scene-export',
            'Head tracking switched back to OrbitControls for export.',
        );
        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `rivvon-${timestamp}.png`;
        threeCanvasRef.value?.exportImage(filename);
    }

    // Video export dialog state
    const showExportDialog = ref(false);
    const exportInfo = ref({});
    const exportAbortController = ref(null);

    // Video export handler — opens dialog instead of recording immediately
    function handleExportVideo() {
        ensureOrbitControlsForInteraction(
            'scene-export',
            'Head tracking switched back to OrbitControls for export.',
        );
        // Gather current scene info for the dialog
        exportInfo.value = threeCanvasRef.value?.getExportInfo?.() ?? {};
        showExportDialog.value = true;
    }

    // Called when user confirms export settings in the dialog
    async function handleExportConfirm(settings) {
        ensureOrbitControlsForInteraction(
            'scene-export',
            'Head tracking switched back to OrbitControls for export.',
        );
        showExportDialog.value = false;

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const ext = settings.format === 'webm' ? 'webm' : 'mp4';
        const filename = `rivvon-${timestamp}.${ext}`;

        isLoadingTexture.value = true;
        loadingProgress.value = 'Preparing export…';

        exportAbortController.value = new AbortController();

        try {
            await threeCanvasRef.value?.exportVideo({
                width: settings.width,
                height: settings.height,
                fps: settings.fps,
                format: settings.format,
                duration: settings.duration,
                cameraMovement: settings.cameraMovement,
                quality: settings.quality,
                logoOverlayEnabled: settings.logoOverlayEnabled,
                filename,
                signal: exportAbortController.value.signal,
                onProgress: (progress) => {
                    loadingProgress.value = `Encoding… ${Math.round(progress * 100)}%`;
                },
                onStatus: (status) => {
                    loadingProgress.value = status;
                }
            });
            loadingProgress.value = 'Video saved!';
        } catch (error) {
            console.error('Video export failed:', error);
            loadingProgress.value = 'Export failed: ' + error.message;
        } finally {
            exportAbortController.value = null;
            setTimeout(() => { isLoadingTexture.value = false; }, 800);
        }
    }

    // Texture browser handler
    function openTextureBrowser() {
        app.showTextureBrowser();
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
    const { getTextureSet: getLocalTextureSet, getTiles, cacheCloudTexture, getCachedLocalId } = useLocalStorage();

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
            const success = await threeCanvasRef.value?.loadTexturesFromLocal(textureSet, getTiles, (stage, current, total) => {
                if (stage === 'downloading') {
                    const pct = Math.round((current / total) * 100);
                    loadingProgress.value = `Loading ${pct}%`;
                } else if (stage === 'building') {
                    const pct = Math.round((current / total) * 100);
                    loadingProgress.value = `Building ${pct}%`;
                }
            });

            if (!success) {
                throw new Error('Local texture data is incomplete or unreadable on this device.');
            }

            // Set blurred background from thumbnail
            if (textureSet.thumbnail_data_url) {
                app.setThumbnailUrl(textureSet.thumbnail_data_url);
            }

            setCurrentTextureMetadata({
                id: textureSet.id,
                name: textureSet.name || '',
                description: textureSet.description || '',
            });

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

    /**
     * Handle multi-texture selection from TextureBrowser
     * @param {Array<{id: string, source: string, name: string}>} selections
     *   Each entry has id, source ('cloud'|'local'), and name
     */
    async function handleMultiTextureSelect(selections) {
        console.log('[RibbonView] Multi-texture selection:', selections.length, 'textures');
        isLoadingTexture.value = true;
        loadingProgress.value = 'Loading multiple textures...';

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
                // Update store with active texture IDs
                app.setActiveTextures(selections.map(s => s.id));
                app.clearCurrentTextureMetadata();

                // Use first texture's thumbnail for background
                const firstSel = selections[0];
                if (firstSel.source === 'local') {
                    const ts = await getLocalTextureSet(firstSel.id);
                    if (ts?.thumbnail_data_url) {
                        app.setThumbnailUrl(ts.thumbnail_data_url);
                    }
                }

                console.log('[RibbonView] Multi-texture load complete');
            }
        } catch (error) {
            console.error('[RibbonView] Failed to load multiple textures:', error);
            alert('Failed to load textures: ' + error.message);
        } finally {
            isLoadingTexture.value = false;
            loadingProgress.value = '';
        }
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
            // Check if this texture is cached locally
            const cachedLocalId = await getCachedLocalId(texture.id);
            if (cachedLocalId) {
                console.log(`[RibbonView] Using cached version: ${cachedLocalId}`);
                const cachedTextureSet = await getLocalTextureSet(cachedLocalId);
                if (cachedTextureSet) {
                    const success = await threeCanvasRef.value?.loadTexturesFromLocal(cachedTextureSet, getTiles, (stage, current, total) => {
                        if (stage === 'downloading') {
                            const pct = Math.round((current / total) * 100);
                            loadingProgress.value = `Loading ${pct}%`;
                        } else if (stage === 'building') {
                            const pct = Math.round((current / total) * 100);
                            loadingProgress.value = `Building ${pct}%`;
                        }
                    });
                    if (success) {
                        if (texture.thumbnail_url) {
                            app.setThumbnailUrl(texture.thumbnail_url);
                        }
                        setCurrentTextureMetadata({
                            id: texture.id,
                            name: cachedTextureSet.name || texture.name || '',
                            description: cachedTextureSet.description || texture.description || '',
                        });
                        console.log('[RibbonView] Loaded from cache successfully');
                        return;
                    }
                    // If cache load failed, fall through to remote
                    console.warn('[RibbonView] Cache load failed, falling back to remote');
                }
            }

            // Fetch full texture set with tile URLs
            const textureSet = await fetchTextureSetById(texture.id);

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
            const success = await threeCanvasRef.value?.loadTexturesFromRemote(textureSet, (stage, current, total) => {
                if (stage === 'downloading') {
                    const pct = Math.round((current / total) * 100);
                    loadingProgress.value = `Downloading ${pct}%`;
                } else if (stage === 'building') {
                    const pct = Math.round((current / total) * 100);
                    loadingProgress.value = `Building ${pct}%`;
                }
            });

            if (!success) {
                throw new Error('Texture data is incomplete or unreadable.');
            }

            // Set blurred background from thumbnail
            if (texture.thumbnail_url) {
                app.setThumbnailUrl(texture.thumbnail_url);
            }

            setCurrentTextureMetadata({
                id: texture.id,
                name: textureSet.name || texture.name || '',
                description: textureSet.description || texture.description || '',
            });

            // Cache the downloaded tiles in background
            cacheRemoteTextureInBackground(texture, textureSet);

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

    /**
     * Cache a remotely-loaded texture to IndexedDB in background.
     * Reads already-downloaded tile data from the TileManager's zipFiles cache.
     */
    function cacheRemoteTextureInBackground(texture, textureSet) {
        const doCache = async () => {
            // Get the tile data that TileManager already downloaded (stored in zipFiles)
            const tileManagerRef = threeCanvasRef.value?.tileManager;
            const tm = tileManagerRef?.value ?? tileManagerRef;
            if (!tm?.zipFiles) return;

            const ktx2Blobs = {};
            for (const [filename, data] of Object.entries(tm.zipFiles)) {
                const index = parseInt(filename.replace('.ktx2', ''), 10);
                if (!isNaN(index)) {
                    ktx2Blobs[index] = data;
                }
            }

            if (Object.keys(ktx2Blobs).length === 0) return;

            // Convert thumbnail URL to data URL
            let thumbnailDataUrl = null;
            if (texture.thumbnail_url) {
                try {
                    const resp = await fetch(texture.thumbnail_url);
                    const blob = await resp.blob();
                    thumbnailDataUrl = await new Promise(resolve => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.readAsDataURL(blob);
                    });
                } catch (e) { /* non-critical */ }
            }

            await cacheCloudTexture({
                cloudTextureId: texture.id,
                name: texture.name,
                description: textureSet.description ?? texture.description ?? '',
                tileCount: textureSet.tile_count ?? Object.keys(ktx2Blobs).length,
                tileResolution: textureSet.tile_resolution ?? texture.tile_resolution,
                layerCount: textureSet.layer_count ?? texture.layer_count,
                crossSectionType: textureSet.cross_section_type ?? texture.cross_section_type ?? 'waves',
                sourceMetadata: textureSet.source_metadata ?? texture.source_metadata,
                thumbnailDataUrl,
                ktx2Blobs,
                rootTextureSetId: textureSet.root_texture_id || texture.root_texture_id || texture.id,
                parentTextureSetId: textureSet.parent_texture_set_id || texture.parent_texture_set_id || null,
                variantInfo: textureSet.variant_info || texture.variant_info || null,
                variantSummaries: textureSet.variant_summaries || texture.variant_summaries || null,
                availableResolutions: textureSet.available_resolutions || texture.available_resolutions || null,
            });

            console.log(`[RibbonView] Cached texture ${texture.id} locally`);
        };

        doCache().catch(err => {
            console.warn('[RibbonView] Background texture cache failed:', err);
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
            @close-realtime-mode="handleRealtimeClose"
            @turn-off-camera="handleTurnOffCamera"
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
            :texture-metadata-overlay="app.showTextureMetadataOverlay"
            @enter-draw-mode="enterDrawMode"
            @enter-walk-mode="enterWalkMode"
            @open-drawing-browser="openDrawingBrowser"
            @open-texture-file="openCreateTextureFileMode"
            @open-texture-camera="openCreateTextureCameraMode"
            @close-realtime-mode="handleRealtimeClose"
            @viewer-control-mode-change="handleViewerControlModeChange"
            @recenter-head-tracking="handleHeadTrackingRecenter"
            @toggle-flow="toggleFlow"
            @open-text-panel="app.showTextPanel"
            @open-emoji-picker="app.showEmojiPicker"
            @open-texture-browser="openTextureBrowser"
            @import-file="openFileImport"
            @export-image="handleExportImage"
            @export-video="handleExportVideo"
            @finish-drawing="finishDrawing"
            @finish-walk="finishWalk"
            @cinematic-capture="handleCinematicCapture"
            @cinematic-toggle="handleCinematicToggle"
            @cinematic-clear="handleCinematicClear"
            @technical-overlay-toggle="showTechnicalOverlay = !showTechnicalOverlay"
            @texture-metadata-overlay-toggle="app.setShowTextureMetadataOverlay(!app.showTextureMetadataOverlay)"
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

        <!-- Modals -->
        <TextInputPanel
            v-model:visible="app.textPanelVisible"
            @generate="handleTextGenerate"
        />
        <EmojiPickerPanel
            v-model:visible="app.emojiPickerVisible"
            @generate="handleEmojiGenerate"
        />
        <DrawingBrowser
            v-if="app.drawingBrowserVisible"
            :visible="app.drawingBrowserVisible"
            @close="app.hideDrawingBrowser"
            @select="handleSavedDrawingSelect"
        />
        <TextureBrowser
            v-if="app.textureBrowserVisible"
            :visible="app.textureBrowserVisible"
            :initial-tab="textureBrowserInitialTab"
            @close="app.hideTextureBrowser"
            @select="handleTextureSelect"
            @select-local="handleLocalTextureSelect"
            @select-multi="handleMultiTextureSelect"
        />

        <!-- Full-page Slyce panel (like drawing mode) -->
        <TextureCreator
            v-if="app.textureCreatorVisible"
            :active="app.textureCreatorVisible"
            :launch-source="textureCreatorLaunchSource"
            @close="closeCreateTextureMode"
            @apply-realtime-texture="handleRealtimeApplyFromTextureCreator"
            @apply-texture="handleApplyCreatedTexture"
        />

        <!-- Full-page Realtime Sampler (like Slyce panel) -->
        <RealtimeSampler
            v-if="app.realtimeSamplerVisible"
            :active="app.realtimeSamplerVisible"
            @apply="handleRealtimeApply"
            @close="handleRealtimeClose"
        />

        <BetaModal />

        <!-- GPU device lost recovery overlay -->
        <DeviceLostOverlay
            :visible="isDeviceLost"
            @restart="handleDeviceLostRestart"
        />

        <!-- Export Video Dialog -->
        <ExportVideoDialog
            v-model:visible="showExportDialog"
            :export-info="exportInfo"
            @export="handleExportConfirm"
        />

        <!-- Contextual technical overlay (press D to toggle) -->
        <ViewerTechnicalOverlay
            :cinematic-camera="threeCanvasRef?.cinematicCamera"
            :head-tracking="threeCanvasRef?.headTracking"
            :viewer-control-mode="app.viewerControlMode"
            :visible="showTechnicalOverlay"
            :fps="threeCanvasRef?.fps ?? 0"
        />

        <!-- Loading overlay for texture loading or viewer reinitialization -->
        <Transition name="fade">
            <div
                v-if="isLoadingTexture || app.isReinitializing"
                class="loading-overlay"
            >
                <div class="loading-content">
                    <div class="loading-spinner"></div>
                    <div class="loading-text">{{ loadingProgress || 'Loading...' }}</div>
                </div>
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
