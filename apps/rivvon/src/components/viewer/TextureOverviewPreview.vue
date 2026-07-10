<script setup>
    import * as THREE from 'three';
    import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
    import LoadingIndicator from '../shared/LoadingIndicator.vue';
    import { useViewerStore } from '../../stores/viewerStore';
    import { TileManager } from '../../modules/viewer/tileManager';
    import { applyRendererDisplayConfig, readRendererDisplayConfig } from '../../modules/viewer/rendererConfig.js';
    import { useLocalStorage } from '../../services/localStorage.js';
    import { drawExportLogoOverlay, loadExportLogoAsset } from '../../modules/viewer/exportLogoOverlay';
    import { buildTextureOverviewModeInfoFromTileManager } from '../../modules/viewer/textureOverviewExport';
    import { calculateTextureOverviewLayout } from '../../modules/viewer/textureOverviewLayout';
    import { createLazyLoader } from '../../modules/shared/lazyLoader';
    import { useRenderFilter } from '../../composables/viewer/useRenderFilter.js';

    const props = defineProps({
        texture: {
            type: Object,
            required: true,
        },
        isLocal: {
            type: Boolean,
            default: false,
        },
        getLocalTiles: {
            type: Function,
            required: true,
        },
        getCachedLocalId: {
            type: Function,
            default: null,
        },
        isCached: {
            type: Boolean,
            default: false,
        },
        targetWidth: {
            type: Number,
            default: 1920,
        },
        targetHeight: {
            type: Number,
            default: 1080,
        },
        backgroundUrl: { type: String, default: null },
        showBlurredBackground: { type: Boolean, default: false },
    });

    const app = useViewerStore();
    const { cacheCloudTexture, getTextureSet: getLocalTextureSet, evictCachedTexture } = useLocalStorage();
    const wrapperRef = ref(null);
    const backgroundCanvasRef = ref(null);
    const isLoading = ref(false);
    const error = ref('');
    const isReady = ref(false);
    const displayScale = ref(1);
    const tileCount = ref(0);
    const loadingMessage = ref('Loading...');
    const loadingStatusText = ref('');
    const OVERVIEW_DEV_HELPER_KEY = '__rivvonTextureOverview';

    const wrapperStyle = computed(() => ({
        '--overview-aspect-ratio': `${Math.max(1, Number(props.targetWidth) || 1920)} / ${Math.max(1, Number(props.targetHeight) || 1080)}`,
        '--overview-background-image': props.backgroundUrl ? `url("${String(props.backgroundUrl).replace(/"/g, '\\"')}")` : 'none',
    }));

    let renderer = null;
    let scene = null;
    let camera = null;
    let tileManager = null;
    let resizeObserver = null;
    const rendererRef = shallowRef(null);
    const sceneRef = shallowRef(null);
    const cameraRef = shallowRef(null);
    const renderFilter = useRenderFilter({ app, renderer: rendererRef, scene: sceneRef, camera: cameraRef });
    let animationFrameId = 0;
    let cellGeometry = null;
    let cellEntries = [];
    let currentLayout = null;
    let flowWasActive = null;
    let reloadToken = 0;
    let debugOverrideMaterials = [];
    let overviewDevHelper = null;
    let activeRendererType = 'webgl';
    let autoDiagnosticRunSequence = 0;
    let lastAutoDiagnosticKey = null;
    let hasPaintedStaticBackground = false;
    const loadTextureService = createLazyLoader(() => import('../../services/textureService.js'));
    const loadThreeWebGPUModule = createLazyLoader(() => import('three/webgpu'));
    const loadWebGPUCapability = createLazyLoader(() => import('three/addons/capabilities/WebGPU.js').then((module) => module.default));


    function waitForAnimationFrame() {
        return new Promise((resolve) => {
            requestAnimationFrame(() => resolve());
        });
    }

    function shouldAutoRunDiagnostics() {
        if (typeof window === 'undefined') {
            return false;
        }

        if (app.debugMode || window.location.hash === '#debug' || Boolean(window.eruda)) {
            return true;
        }

        const params = new URLSearchParams(window.location.search);
        const raw = (params.get('overviewDiagnostics') || '').trim().toLowerCase();
        return raw === '1' || raw === 'true' || raw === 'auto';
    }

    function buildAutoDiagnosticKey() {
        return [
            props.texture?.id || 'unknown',
            props.targetWidth || 0,
            props.targetHeight || 0,
            currentLayout?.strategy || 'none',
            currentLayout?.cellCount || 0,
            tileCount.value || 0,
            Math.round((displayScale.value || 0) * 1000),
        ].join('|');
    }

    function classifyAutoDiagnosticSummary(result) {
        const baselineRenderAvailable = result?.baseline?.probes?.render?.available !== false;
        const debugRenderAvailable = result?.debugOverride?.probes?.render?.available !== false;
        const baselineRender = result?.baseline?.probes?.render?.nonEmptySampleCount ?? 0;
        const baselineComposite = result?.baseline?.probes?.composite?.nonEmptySampleCount ?? 0;
        const debugRender = result?.debugOverride?.probes?.render?.nonEmptySampleCount ?? 0;
        const debugComposite = result?.debugOverride?.probes?.composite?.nonEmptySampleCount ?? 0;

        let suspectedFailureStage = 'unknown';

        if (baselineComposite > 0) {
            suspectedFailureStage = 'no-black-frame-detected';
        } else if ((baselineRenderAvailable ? baselineRender : baselineComposite) === 0
            && (debugRenderAvailable ? debugRender : debugComposite) > 0) {
            suspectedFailureStage = 'texture-or-material-path';
        } else if ((debugRenderAvailable ? debugRender : debugComposite) === 0) {
            suspectedFailureStage = 'webgl-draw-or-geometry-path';
        } else if (baselineRenderAvailable && baselineRender > 0 && baselineComposite === 0) {
            suspectedFailureStage = 'canvas-composite-or-export-path';
        }

        return {
            suspectedFailureStage,
            rendererType: result?.baseline?.renderer?.type ?? null,
            baselineRenderNonEmpty: baselineRender,
            baselineCompositeNonEmpty: baselineComposite,
            debugRenderNonEmpty: debugRender,
            debugCompositeNonEmpty: debugComposite,
        };
    }

    function disposeDebugOverrideMaterials() {
        if (debugOverrideMaterials.length === 0) {
            return;
        }

        for (const material of debugOverrideMaterials) {
            material?.dispose?.();
        }

        debugOverrideMaterials = [];
    }

    function safeGetContextParameter(context, parameter) {
        if (!context || typeof parameter === 'undefined') {
            return null;
        }

        try {
            return context.getParameter(parameter);
        } catch {
            return null;
        }
    }

    function describeMaterial(material) {
        if (!material) {
            return null;
        }

        const uniforms = material.uniforms && typeof material.uniforms === 'object'
            ? Object.keys(material.uniforms)
            : [];

        return {
            type: material.type || material.constructor?.name || 'UnknownMaterial',
            transparent: Boolean(material.transparent),
            opacity: Number.isFinite(material.opacity) ? material.opacity : null,
            visible: material.visible !== false,
            side: material.side ?? null,
            hasMap: Boolean(material.map),
            uniformKeys: uniforms.slice(0, 16),
            hasTextureArray: Boolean(material.uniforms?.uTexArray?.value),
            hasFlowTextures: Boolean(material.uniforms?.uTexA?.value || material.uniforms?.uTexB?.value),
        };
    }

    function buildGlContextSummary() {
        const context = renderer?.getContext?.();
        if (!context) {
            return null;
        }

        if (typeof context.getParameter !== 'function') {
            return {
                api: activeRendererType,
                readPixelsSupported: false,
            };
        }

        const debugInfo = context.getExtension?.('WEBGL_debug_renderer_info') || null;
        const isWebGl2 = typeof WebGL2RenderingContext !== 'undefined' && context instanceof WebGL2RenderingContext;

        return {
            api: activeRendererType,
            isWebGl2,
            version: safeGetContextParameter(context, context.VERSION),
            shadingLanguageVersion: safeGetContextParameter(context, context.SHADING_LANGUAGE_VERSION),
            vendor: debugInfo
                ? safeGetContextParameter(context, debugInfo.UNMASKED_VENDOR_WEBGL)
                : safeGetContextParameter(context, context.VENDOR),
            renderer: debugInfo
                ? safeGetContextParameter(context, debugInfo.UNMASKED_RENDERER_WEBGL)
                : safeGetContextParameter(context, context.RENDERER),
            maxTextureSize: safeGetContextParameter(context, context.MAX_TEXTURE_SIZE),
            maxTextureImageUnits: safeGetContextParameter(context, context.MAX_TEXTURE_IMAGE_UNITS),
            maxArrayTextureLayers: isWebGl2
                ? safeGetContextParameter(context, context.MAX_ARRAY_TEXTURE_LAYERS)
                : null,
            contextAttributes: context.getContextAttributes?.() || null,
            extensions: {
                astc: Boolean(context.getExtension?.('WEBGL_compressed_texture_astc')),
                etc: Boolean(context.getExtension?.('WEBGL_compressed_texture_etc')),
                etc1: Boolean(context.getExtension?.('WEBGL_compressed_texture_etc1')),
                s3tc: Boolean(context.getExtension?.('WEBGL_compressed_texture_s3tc')),
                pvrtc: Boolean(context.getExtension?.('WEBGL_compressed_texture_pvrtc')),
            },
        };
    }

    function collectMaterialSample() {
        return cellEntries.slice(0, 4).map((entry, index) => ({
            index,
            baseIndex: entry.baseIndex,
            position: {
                x: Number(entry.mesh.position.x.toFixed(2)),
                y: Number(entry.mesh.position.y.toFixed(2)),
                z: Number(entry.mesh.position.z.toFixed(2)),
            },
            material: describeMaterial(entry.mesh.material),
        }));
    }

    function buildOverviewDebugState(options = {}) {
        const includeProbes = Boolean(options.includeProbes);
        const canvas = renderer?.domElement || null;
        const wrapper = wrapperRef.value;
        const rendererSize = renderer ? renderer.getSize(new THREE.Vector2()) : null;

        const state = {
            ready: isReady.value,
            loading: isLoading.value,
            error: error.value || null,
            loadingStatusText: loadingStatusText.value || null,
            texture: {
                id: props.texture?.id || null,
                name: props.texture?.name || null,
                tileCount: props.texture?.tile_count || null,
                tileResolution: props.texture?.tile_resolution || null,
                source: props.isLocal ? 'local' : (props.isCached ? 'cached' : 'cloud'),
            },
            targetFrame: {
                width: props.targetWidth,
                height: props.targetHeight,
            },
            viewport: {
                wrapperWidth: wrapper?.clientWidth || 0,
                wrapperHeight: wrapper?.clientHeight || 0,
                devicePixelRatio: window.devicePixelRatio || 1,
                displayScale: displayScale.value,
            },
            canvas: canvas
                ? {
                    clientWidth: canvas.clientWidth,
                    clientHeight: canvas.clientHeight,
                    width: canvas.width,
                    height: canvas.height,
                }
                : null,
            renderer: renderer
                ? {
                    type: activeRendererType,
                    pixelRatio: renderer.getPixelRatio(),
                    size: rendererSize ? { width: rendererSize.x, height: rendererSize.y } : null,
                    info: {
                        memory: renderer.info?.memory || null,
                        render: renderer.info?.render || null,
                    },
                    context: buildGlContextSummary(),
                }
                : null,
            camera: camera
                ? {
                    left: camera.left,
                    right: camera.right,
                    top: camera.top,
                    bottom: camera.bottom,
                    near: camera.near,
                    far: camera.far,
                    z: camera.position.z,
                }
                : null,
            layout: currentLayout
                ? {
                    strategy: currentLayout.strategy,
                    frameWidth: currentLayout.frameWidth,
                    frameHeight: currentLayout.frameHeight,
                    tileWidth: currentLayout.tileWidth,
                    tileHeight: currentLayout.tileHeight,
                    cols: currentLayout.cols,
                    rows: currentLayout.rows,
                    cellCount: currentLayout.cellCount,
                }
                : null,
            tileManager: tileManager
                ? {
                    rendererType: tileManager.rendererType,
                    variant: tileManager.variant,
                    isKtx2: Boolean(tileManager.isKTX2),
                    tileCount: tileManager.getTileCount?.() ?? tileManager.tileCount ?? null,
                    effectiveTileCount: tileManager.getEffectiveTileCount?.() ?? null,
                    loadedMaterials: tileManager.materials?.length ?? 0,
                    mirroredMaterials: tileManager.mirroredMaterials?.size ?? 0,
                    arrayTextures: tileManager.arrayTextures?.length ?? 0,
                    flowMaterials: tileManager.flowMaterials?.length ?? 0,
                    layerCount: tileManager.getLayerCount?.() ?? tileManager.layerCount ?? null,
                    currentLayer: tileManager.currentLayer ?? null,
                    flowEnabled: tileManager.isFlowEnabled?.() ?? null,
                    flowSpeed: tileManager.getFlowSpeed?.() ?? null,
                    requestedFlowSpeed: tileManager.getRequestedFlowSpeed?.() ?? null,
                    flowOffset: tileManager.getFlowOffset?.() ?? tileManager.flowOffset ?? null,
                    tileFlowOffset: tileManager.getTileFlowOffset?.() ?? tileManager.tileFlowOffset ?? null,
                    repeatMode: tileManager.getRepeatMode?.() ?? tileManager.repeatMode ?? null,
                    flowAlignment: tileManager.getFlowAlignmentInfo?.() ?? tileManager.flowAlignmentInfo ?? null,
                    textureSetId: tileManager.currentTextureSet?.id || null,
                }
                : null,
            cells: {
                count: cellEntries.length,
                debugOverrideActive: debugOverrideMaterials.length > 0,
                sample: collectMaterialSample(),
            },
        };

        if (includeProbes) {
            state.probes = {
                render: captureRenderProbe({ gridSize: 3 }),
                composite: captureCompositeProbe({ gridSize: 3 }),
            };
        }

        return state;
    }

    function captureRenderProbe(options = {}) {
        if (!renderer) {
            return { available: false, reason: 'renderer-unavailable' };
        }

        const context = renderer.getContext?.();
        const canvas = renderer.domElement;
        if (!context || !canvas) {
            return { available: false, reason: 'context-unavailable' };
        }

        if (typeof context.readPixels !== 'function') {
            return {
                available: false,
                reason: 'readPixels-unavailable',
                rendererType: activeRendererType,
            };
        }

        renderCurrentScene();
        context.finish?.();

        const gridSize = Math.max(1, Math.min(6, Math.floor(Number(options.gridSize) || 3)));
        const samples = [];
        let nonEmptySampleCount = 0;

        for (let row = 1; row <= gridSize; row += 1) {
            for (let col = 1; col <= gridSize; col += 1) {
                const x = Math.min(canvas.width - 1, Math.floor((col / (gridSize + 1)) * canvas.width));
                const y = Math.min(canvas.height - 1, Math.floor((row / (gridSize + 1)) * canvas.height));
                const pixel = new Uint8Array(4);
                context.readPixels(x, y, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
                const values = Array.from(pixel);

                if (values.some((value) => value > 0)) {
                    nonEmptySampleCount += 1;
                }

                samples.push({ x, y, values });
            }
        }

        return {
            available: true,
            gridSize,
            nonEmptySampleCount,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            samples,
        };
    }

    function captureCompositeProbe(options = {}) {
        const canvas = renderer?.domElement;
        if (!canvas) {
            return { available: false, reason: 'canvas-unavailable' };
        }

        renderCurrentScene();
        renderer?.getContext?.()?.finish?.();

        const probeCanvas = document.createElement('canvas');
        probeCanvas.width = Math.max(1, canvas.width);
        probeCanvas.height = Math.max(1, canvas.height);

        const context2d = probeCanvas.getContext('2d', { alpha: true });
        if (!context2d) {
            return { available: false, reason: '2d-context-unavailable' };
        }

        context2d.clearRect(0, 0, probeCanvas.width, probeCanvas.height);
        context2d.drawImage(canvas, 0, 0, probeCanvas.width, probeCanvas.height);

        const gridSize = Math.max(1, Math.min(6, Math.floor(Number(options.gridSize) || 3)));
        const samples = [];
        let nonEmptySampleCount = 0;

        for (let row = 1; row <= gridSize; row += 1) {
            for (let col = 1; col <= gridSize; col += 1) {
                const x = Math.min(probeCanvas.width - 1, Math.floor((col / (gridSize + 1)) * probeCanvas.width));
                const y = Math.min(probeCanvas.height - 1, Math.floor((row / (gridSize + 1)) * probeCanvas.height));
                const values = Array.from(context2d.getImageData(x, y, 1, 1).data);

                if (values.some((value) => value > 0)) {
                    nonEmptySampleCount += 1;
                }

                samples.push({ x, y, values });
            }
        }

        const result = {
            available: true,
            gridSize,
            nonEmptySampleCount,
            width: probeCanvas.width,
            height: probeCanvas.height,
            samples,
        };

        if (options.includeDataUrl) {
            try {
                result.dataUrl = probeCanvas.toDataURL('image/png');
            } catch (error) {
                result.dataUrlError = error?.message || String(error);
            }
        }

        return result;
    }

    async function runAutoDiagnostics(options = {}) {
        const {
            reason = 'manual',
            force = false,
            includeDebugOverride = true,
            logToConsole = true,
        } = options;

        if (!renderer || !tileManager || !cellEntries.length || !isReady.value || isLoading.value || error.value) {
            return {
                ok: false,
                reason: 'not-ready',
            };
        }

        const diagnosticKey = buildAutoDiagnosticKey();
        if (!force && lastAutoDiagnosticKey === diagnosticKey && overviewDevHelper?.lastAutoDiagnostics) {
            return overviewDevHelper.lastAutoDiagnostics;
        }

        const sequence = ++autoDiagnosticRunSequence;

        await nextTick();
        await waitForAnimationFrame();

        if (sequence !== autoDiagnosticRunSequence) {
            return overviewDevHelper?.lastAutoDiagnostics ?? {
                ok: false,
                reason: 'superseded',
            };
        }

        if (debugOverrideMaterials.length > 0) {
            restoreMaterials();
        }

        const baseline = buildOverviewDebugState({ includeProbes: true });
        const debugOverride = includeDebugOverride
            ? paintDebugTiles()
            : null;
        const restored = includeDebugOverride
            ? restoreMaterials()
            : buildOverviewDebugState({ includeProbes: true });

        const result = {
            ok: true,
            reason,
            timestamp: new Date().toISOString(),
            diagnosticKey,
            baseline,
            debugOverride,
            restored,
        };

        result.summary = classifyAutoDiagnosticSummary(result);
        lastAutoDiagnosticKey = diagnosticKey;

        if (overviewDevHelper) {
            overviewDevHelper.lastAutoDiagnostics = result;
            overviewDevHelper.autoDiagnosticsHistory = [
                ...(overviewDevHelper.autoDiagnosticsHistory || []),
                result,
            ].slice(-5);
        }

        if (typeof window !== 'undefined' && window[OVERVIEW_DEV_HELPER_KEY]) {
            window[OVERVIEW_DEV_HELPER_KEY].lastAutoDiagnostics = result;
            window[OVERVIEW_DEV_HELPER_KEY].autoDiagnosticsHistory = overviewDevHelper?.autoDiagnosticsHistory || [result];
        }

        if (logToConsole) {
            console.info('[TextureOverviewPreview] Auto diagnostics complete', result.summary, result);
        }

        return result;
    }

    async function createOverviewRenderer() {
        const preferredRendererType = app.rendererType === 'webgpu' ? 'webgpu' : 'webgl';
        const displayConfig = readRendererDisplayConfig(app.threeContext?.renderer ?? null, preferredRendererType);

        if (preferredRendererType === 'webgpu') {
            try {
                const [THREEWebGPU, WebGPU] = await Promise.all([
                    loadThreeWebGPUModule(),
                    loadWebGPUCapability(),
                ]);

                if (WebGPU?.isAvailable?.()) {
                    const webgpuRenderer = new THREEWebGPU.WebGPURenderer({
                        antialias: true,
                        alpha: true,
                    });
                    webgpuRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
                    applyRendererDisplayConfig(webgpuRenderer, displayConfig, 'webgpu');
                    await webgpuRenderer.init();

                    return {
                        renderer: webgpuRenderer,
                        rendererType: 'webgpu',
                    };
                }
            } catch (error) {
                console.warn('[TextureOverviewPreview] Falling back to WebGL for overview renderer:', error);
            }
        }

        const webglRenderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
        });
        applyRendererDisplayConfig(webglRenderer, displayConfig, 'webgl');

        return {
            renderer: webglRenderer,
            rendererType: 'webgl',
        };
    }

    function paintDebugTiles() {
        if (!cellEntries.length) {
            return { ok: false, reason: 'no-cells' };
        }

        disposeDebugOverrideMaterials();

        debugOverrideMaterials = cellEntries.map((entry, index) => {
            const material = new THREE.MeshBasicMaterial();
            material.color.setHSL((index % Math.max(1, cellEntries.length)) / Math.max(1, cellEntries.length), 0.85, 0.55);
            material.transparent = false;
            material.opacity = 1;
            entry.mesh.material = material;
            return material;
        });

        renderCurrentScene();
        return buildOverviewDebugState({ includeProbes: true });
    }

    function restoreMaterials() {
        disposeDebugOverrideMaterials();
        syncCellMaterials(true);
        renderCurrentScene();
        return buildOverviewDebugState({ includeProbes: true });
    }

    function installOverviewDevHelpers() {
        if (typeof window === 'undefined') {
            return;
        }

        overviewDevHelper = {
            help() {
                return [
                    `window.${OVERVIEW_DEV_HELPER_KEY}.lastAutoDiagnostics`,
                    `window.${OVERVIEW_DEV_HELPER_KEY}.runAutoDiagnostics({ force: true })`,
                    `window.${OVERVIEW_DEV_HELPER_KEY}.logState({ includeProbes: true })`,
                    `window.${OVERVIEW_DEV_HELPER_KEY}.paintDebugTiles()`,
                    `window.${OVERVIEW_DEV_HELPER_KEY}.restoreMaterials()`,
                    `window.${OVERVIEW_DEV_HELPER_KEY}.captureCompositeProbe({ includeDataUrl: true })`,
                ];
            },
            lastAutoDiagnostics: null,
            autoDiagnosticsHistory: [],
            getState: (options = {}) => buildOverviewDebugState(options),
            logState(options = {}) {
                const state = buildOverviewDebugState(options);
                console.info('[TextureOverviewPreview] Debug state', state);
                return state;
            },
            runAutoDiagnostics,
            captureRenderProbe,
            captureCompositeProbe,
            paintDebugTiles,
            restoreMaterials,
            renderFrame() {
                renderCurrentScene();
                return true;
            },
        };

        window[OVERVIEW_DEV_HELPER_KEY] = overviewDevHelper;
        console.info(
            `[TextureOverviewPreview] Installed dev helpers on window.${OVERVIEW_DEV_HELPER_KEY}.`,
            overviewDevHelper.help(),
        );
    }

    function removeOverviewDevHelpers() {
        if (typeof window === 'undefined') {
            return;
        }

        if (window[OVERVIEW_DEV_HELPER_KEY] === overviewDevHelper) {
            delete window[OVERVIEW_DEV_HELPER_KEY];
        }

        overviewDevHelper = null;
        lastAutoDiagnosticKey = null;
    }

    function formatTextureLoadPercent(stage, current, total) {
        const numericTotal = Math.max(0, Number(total) || 0);
        const numericCurrent = Math.max(0, Number(current) || 0);
        const stageProgress = numericTotal > 0
            ? Math.min(1, Math.max(0, numericCurrent / numericTotal))
            : 0;
        const stageWeights = {
            downloading: [0, 55],
            loading: [0, 55],
            building: [55, 92],
            applying: [92, 99],
        };
        const [start, end] = stageWeights[stage] || [0, 99];
        const percent = Math.round(start + ((end - start) * stageProgress));

        return `${Math.min(99, Math.max(0, percent))}%`;
    }

    function updateLoadingStatus(stage, current, total) {
        const numericTotal = Math.max(0, Number(total) || 0);
        const percent = formatTextureLoadPercent(stage, current, total);

        if (stage === 'building') {
            loadingMessage.value = 'Building...';
            loadingStatusText.value = percent;
            return;
        }

        if (stage === 'applying') {
            loadingMessage.value = 'Preparing viewer...';
            loadingStatusText.value = percent;
            return;
        }

        if (stage === 'downloading' || stage === 'loading') {
            loadingMessage.value = 'Loading...';
            loadingStatusText.value = percent;
            return;
        }

        if (numericTotal <= 0) {
            loadingStatusText.value = '';
            return;
        }

        loadingStatusText.value = percent;
    }

    function applyViewerSettings() {
        if (!tileManager) {
            return;
        }

        tileManager.setRepeatMode?.(app.textureRepeatMode);
        tileManager.setVerticalFlip?.(app.textureFlipVertical);
        tileManager.setFlowAlignmentEnabled?.(app.flowCycleAlignmentEnabled);
        tileManager.setLayerAnimationEnabled?.(app.textureAnimationEnabled);
        tileManager.setLayerAnimationReversed?.(app.textureAnimationReversed);
        tileManager.setContrast?.(app.renderFilterMode === 'duotone' ? 1 : app.contrast);
        tileManager.setSaturation?.(app.renderFilterMode === 'duotone' ? 1 : app.saturation);

        if (app.flowState === 'off') {
            tileManager.setFlowEnabled?.(false);
        } else {
            const baseSpeed = Number(app.flowSpeed) || 0.25;
            const signedSpeed = app.flowState === 'backward' ? -baseSpeed : baseSpeed;
            tileManager.setFlowSpeed?.(signedSpeed);
            tileManager.setFlowEnabled?.(true);
        }
    }

    function clearCellMeshes() {
        disposeDebugOverrideMaterials();

        if (cellEntries.length > 0 && scene) {
            for (const entry of cellEntries) {
                scene.remove(entry.mesh);
            }
        }

        cellEntries = [];

        if (cellGeometry) {
            cellGeometry.dispose();
            cellGeometry = null;
        }
    }

    function teardownTileManager() {
        clearCellMeshes();
        flowWasActive = null;

        if (tileManager) {
            tileManager.dispose?.();
            tileManager = null;
        }
    }

    function syncCellMaterials(force = false) {
        if (!tileManager || cellEntries.length === 0) {
            return;
        }

        if (debugOverrideMaterials.length > 0) {
            return;
        }

        const flowActive = tileManager.isFlowEnabled?.() && tileManager.getFlowSpeed?.() !== 0;

        if (force || flowWasActive !== flowActive) {
            tileManager.clearFlowMaterials?.();

            for (const entry of cellEntries) {
                const material = tileManager.getOrCreateMaterialForSegment(entry.baseIndex, flowActive);
                if (material) {
                    entry.mesh.material = material;
                }
            }

            flowWasActive = flowActive;
        }

        if (!flowActive) {
            return;
        }

        const wholeTiles = tileManager.getPendingFlowWrapTiles?.() || 0;
        if (wholeTiles === 0) {
            return;
        }

        tileManager.wrapFlowOffset?.(wholeTiles);
        tileManager.clearFlowMaterials?.();

        for (const entry of cellEntries) {
            const material = tileManager.getOrCreateMaterialForSegment(entry.baseIndex, true);
            if (material) {
                entry.mesh.material = material;
            }
        }
    }

    function renderCurrentScene() {
        if (!renderer || !scene || !camera) {
            return;
        }

        renderFilter.renderScene();
        renderLiveBackground();
    }

    function renderLiveBackground() {
        if (!props.showBlurredBackground || !backgroundCanvasRef.value || !renderer?.domElement) return;
        if (!app.animatedBackgroundEnabled && hasPaintedStaticBackground) return;
        const canvas = backgroundCanvasRef.value;
        const source = renderer.domElement;
        if (canvas.width !== source.width || canvas.height !== source.height) {
            canvas.width = source.width;
            canvas.height = source.height;
        }
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.filter = `blur(${Math.max(24, Math.round(Math.min(canvas.width, canvas.height) * 0.04))}px) saturate(1.08)`;
        context.drawImage(source, -canvas.width * 0.06, -canvas.height * 0.06, canvas.width * 1.12, canvas.height * 1.12);
        context.filter = 'none';
        hasPaintedStaticBackground = true;
    }

    function updateViewport(viewportWidthOverride = null, viewportHeightOverride = null, pixelRatioOverride = null) {
        if (!wrapperRef.value || !renderer || !camera || !currentLayout) {
            return;
        }

        const viewportWidth = Math.max(1, Number(viewportWidthOverride) || wrapperRef.value.clientWidth || props.targetWidth || 1920);
        const viewportHeight = Math.max(1, Number(viewportHeightOverride) || wrapperRef.value.clientHeight || props.targetHeight || 1080);
        let visibleWidth = currentLayout.frameWidth;
        let visibleHeight = currentLayout.frameHeight;
        const viewportAspect = viewportWidth / viewportHeight;
        const frameAspect = currentLayout.frameWidth / currentLayout.frameHeight;

        if (viewportAspect > frameAspect) {
            visibleWidth = currentLayout.frameHeight * viewportAspect;
        } else {
            visibleHeight = currentLayout.frameWidth / viewportAspect;
        }

        camera.left = -visibleWidth / 2;
        camera.right = visibleWidth / 2;
        camera.top = visibleHeight / 2;
        camera.bottom = -visibleHeight / 2;
        camera.updateProjectionMatrix();

        const nextPixelRatio = pixelRatioOverride == null
            ? Math.min(window.devicePixelRatio || 1, 2)
            : Math.max(1, Number(pixelRatioOverride) || 1);
        renderer.setPixelRatio(nextPixelRatio);
        renderer.setSize(viewportWidth, viewportHeight, false);

        displayScale.value = Math.min(
            viewportWidth / Math.max(1, currentLayout.frameWidth),
            viewportHeight / Math.max(1, currentLayout.frameHeight),
        );
    }

    function rebuildLayout(targetWidth = props.targetWidth, targetHeight = props.targetHeight) {
        if (!scene || !tileManager) {
            return;
        }

        clearCellMeshes();

        const tileResolution = Number(
            props.texture?.tile_resolution
            ?? tileManager.tileSize
            ?? 512,
        ) || 512;

        currentLayout = calculateTextureOverviewLayout({
            targetWidth,
            targetHeight,
            tileWidth: tileResolution,
            tileHeight: tileResolution,
            strategy: app.textureOverviewLayoutStrategy,
        });

        cellGeometry = new THREE.PlaneGeometry(currentLayout.tileWidth, currentLayout.tileHeight);
        const vertexCount = cellGeometry.getAttribute('position')?.count ?? 0;
        cellGeometry.setAttribute('capStartStyle', new THREE.Float32BufferAttribute(new Float32Array(vertexCount), 1));
        cellGeometry.setAttribute('capEndStyle', new THREE.Float32BufferAttribute(new Float32Array(vertexCount), 1));
        cellEntries = currentLayout.positions.map((position) => {
            const mesh = new THREE.Mesh(cellGeometry, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }));
            mesh.position.set(position.x, position.y, 0);
            scene.add(mesh);
            return {
                mesh,
                baseIndex: position.index,
            };
        });

        syncCellMaterials(true);
        updateViewport();
    }

    function stopAnimationLoop() {
        if (!animationFrameId) {
            return false;
        }

        cancelAnimationFrame(animationFrameId);
        animationFrameId = 0;
        return true;
    }

    function startAnimationLoop() {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }

        const tick = (now) => {
            animationFrameId = requestAnimationFrame(tick);

            if (!renderer || !scene || !camera || !tileManager) {
                return;
            }

            tileManager.tick(now);
            syncCellMaterials();
            renderCurrentScene();
        };

        animationFrameId = requestAnimationFrame(tick);
    }

    async function loadTexture() {
        if (!props.texture || !renderer) {
            return;
        }

        const token = reloadToken + 1;
        reloadToken = token;
        isLoading.value = true;
        isReady.value = false;
        error.value = '';
        loadingMessage.value = 'Loading...';
        loadingStatusText.value = '0%';
        teardownTileManager();

        const handleLoadProgress = (stage, current, total) => {
            if (token !== reloadToken) {
                return;
            }

            updateLoadingStatus(stage, current, total);
        };

        const nextTileManager = new TileManager({
            renderer,
            rendererType: activeRendererType,
            rotate90: true,
            repeatMode: app.textureRepeatMode,
            flipVertical: app.textureFlipVertical,
            flowAlignmentEnabled: app.flowCycleAlignmentEnabled,
            layerAnimationEnabled: app.textureAnimationEnabled,
            layerAnimationReversed: app.textureAnimationReversed,
            webgpuMaterialMode: 'node',
        });

        try {
            const { cacheCloudTextureInBackground, getCachedTextureTiles, resolveTextureLoadTarget } = await import('../../services/textureCacheCoordinator.js');
            const resolvedTexture = await resolveTextureLoadTarget({
                texture: props.texture,
                isLocal: props.isLocal,
                getLocalTextureSet,
                getLocalTiles: props.getLocalTiles,
                getCachedLocalId: props.getCachedLocalId,
                onInvalidCachedLocal: async ({ cloudTextureId }) => {
                    await evictCachedTexture(cloudTextureId);
                },
                fetchRemoteTextureSet: async (textureId) => {
                    const { fetchTextureWithTiles } = await loadTextureService();
                    return fetchTextureWithTiles(textureId);
                },
                includeLocalTiles: true,
                preferSessionCache: true,
            });

            const didLoad = resolvedTexture.kind === 'session'
                ? await nextTileManager.loadFromSession(resolvedTexture.textureSet, resolvedTexture.sessionTileEntry || null, handleLoadProgress)
                : resolvedTexture.kind === 'remote'
                    ? await nextTileManager.loadFromRemote(resolvedTexture.textureSet, handleLoadProgress)
                    : await nextTileManager.loadFromTileRecords(resolvedTexture.textureSet, resolvedTexture.localTiles, handleLoadProgress);

            if (!didLoad) {
                throw new Error('Unable to load overview preview tiles.');
            }

            if (token !== reloadToken) {
                nextTileManager.dispose?.();
                return;
            }

            tileManager = nextTileManager;
            tileCount.value = tileManager.getTileCount?.() || props.texture.tile_count || 0;
            loadingMessage.value = 'Building...';
            loadingStatusText.value = '100%';
            applyViewerSettings();
            rebuildLayout();
            isReady.value = true;

            if (resolvedTexture.kind === 'remote') {
                const tileEntry = getCachedTextureTiles(resolvedTexture.textureSet);
                cacheCloudTextureInBackground({
                    texture: props.texture,
                    textureSet: resolvedTexture.textureSet,
                    cacheCloudTexture,
                    tileEntry,
                    tileManager: nextTileManager,
                    logPrefix: '[TextureOverviewPreview]',
                });
            }
        } catch (loadError) {
            nextTileManager.dispose?.();
            if (token !== reloadToken) {
                return;
            }

            console.error('[TextureOverviewPreview] Failed to load overview preview:', loadError);
            error.value = loadError?.message || 'Failed to load overview preview.';
        } finally {
            if (token === reloadToken) {
                isLoading.value = false;
                if (!error.value) {
                    loadingMessage.value = 'Loading...';
                    loadingStatusText.value = '';

                    if (shouldAutoRunDiagnostics()) {
                        void runAutoDiagnostics({ reason: 'load-complete' });
                    }
                }
            }
        }
    }

    async function initializeRenderer() {
        if (!wrapperRef.value || renderer) {
            return;
        }

        scene = new THREE.Scene();
        camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
        camera.position.z = 2;

        const rendererInfo = await createOverviewRenderer();
        renderer = rendererInfo.renderer;
        activeRendererType = rendererInfo.rendererType;
        rendererRef.value = renderer;
        sceneRef.value = scene;
        cameraRef.value = camera;
        await renderFilter.initRenderFilter(activeRendererType);
        wrapperRef.value.appendChild(renderer.domElement);

        resizeObserver = new ResizeObserver(() => {
            updateViewport();
            renderer?.render?.(scene, camera);
        });
        resizeObserver.observe(wrapperRef.value);

        updateViewport();
        startAnimationLoop();
        await loadTexture();
    }

    function handleSettingChange() {
        if (!tileManager) {
            return;
        }

        applyViewerSettings();
        tileManager.resetAnimationState?.();
        syncCellMaterials(true);
        renderer?.render?.(scene, camera);
    }

    function getTextureOnlyExportInfo() {
        if (!tileManager || isLoading.value || !isReady.value) {
            return null;
        }

        return buildTextureOverviewModeInfoFromTileManager(tileManager);
    }

    async function exportVideoWithLiveScene(options = {}) {
        if (!renderer || !scene || !camera || !tileManager || isLoading.value || !isReady.value) {
            throw new Error('Overview preview is not ready for export.');
        }

        const {
            width = props.targetWidth,
            height = props.targetHeight,
            fps = 30,
            format = 'mp4',
            duration = null,
            loopCount = 1,
            quality = 'high',
            logoOverlayEnabled = true,
            logoOverlayCorner = 'bottomLeft',
            signal = null,
            onProgress = null,
            onStatus = null,
        } = options;

        const MB = await import('mediabunny');

        if (typeof VideoEncoder === 'undefined') {
            throw new Error('WebCodecs API is not available in this browser. Use Chrome 94+, Edge 94+, or Firefox 130+.');
        }

        let OutputFormat;
        let codec;
        if (format === 'webm') {
            OutputFormat = MB.WebMOutputFormat;
            codec = 'vp9';
        } else {
            OutputFormat = MB.Mp4OutputFormat;
            codec = 'avc';
        }

        const shouldResumeLoop = stopAnimationLoop();
        let exportCanvas = renderer.domElement;
        let exportCanvasContext = null;
        let exportLogoAsset = null;
        let exportBackgroundSnapshot = null;

        try {
            rebuildLayout(width, height);
            updateViewport(width, height, 1);
            tileManager.resetAnimationState?.();
            syncCellMaterials(true);
            renderCurrentScene();

            const seamlessLoopDuration = tileManager.getSeamlessLoopDuration?.(false) ?? 1;
            const normalizedLoopCount = Math.max(1, Math.floor(Number(loopCount) || 1));
            const exportDuration = duration != null
                ? duration
                : seamlessLoopDuration * normalizedLoopCount;
            const totalFrames = Math.ceil(exportDuration * fps);
            const deltaSec = 1 / fps;

            const qualityMap = {
                'very-low': MB.QUALITY_VERY_LOW,
                'low': MB.QUALITY_LOW,
                'medium': MB.QUALITY_MEDIUM,
                'high': MB.QUALITY_HIGH,
                'very-high': MB.QUALITY_VERY_HIGH,
            };
            const bitrate = qualityMap[quality] ?? MB.QUALITY_HIGH;

            const includeBackground = props.showBlurredBackground;
            if (includeBackground && !app.animatedBackgroundEnabled) {
                exportBackgroundSnapshot = document.createElement('canvas');
                exportBackgroundSnapshot.width = width;
                exportBackgroundSnapshot.height = height;
                exportBackgroundSnapshot.getContext('2d')?.drawImage(renderer.domElement, 0, 0, width, height);
            }
            if (includeBackground || logoOverlayEnabled) {
                if (logoOverlayEnabled) exportLogoAsset = await loadExportLogoAsset();
                exportCanvas = document.createElement('canvas');
                exportCanvas.width = width;
                exportCanvas.height = height;
                exportCanvasContext = exportCanvas.getContext('2d', { alpha: true });

                if (!exportCanvasContext) {
                    throw new Error('Failed to create export overlay compositor.');
                }
            }

            const output = new MB.Output({
                format: new OutputFormat(),
                target: new MB.BufferTarget(),
            });

            const videoSource = new MB.CanvasSource(exportCanvas, {
                codec,
                bitrate,
            });
            output.addVideoTrack(videoSource);
            await output.start();

            onStatus?.(`Encoding ${totalFrames} overview frames…`);

            for (let frame = 0; frame < totalFrames; frame += 1) {
                if (signal?.aborted) {
                    await output.finalize();
                    return null;
                }

                const time = frame * deltaSec;
                const animationDelta = frame === 0 ? 0 : deltaSec;

                tileManager.tickDeterministic?.(animationDelta);
                syncCellMaterials();
                renderCurrentScene();

                if (exportCanvasContext) {
                    exportCanvasContext.clearRect(0, 0, width, height);
                    if (includeBackground) {
                        exportCanvasContext.save();
                        exportCanvasContext.filter = `blur(${Math.max(24, Math.round(Math.min(width, height) * 0.04))}px) saturate(1.08)`;
                        exportCanvasContext.drawImage(
                            exportBackgroundSnapshot || renderer.domElement,
                            -width * 0.06,
                            -height * 0.06,
                            width * 1.12,
                            height * 1.12,
                        );
                        exportCanvasContext.restore();
                    }
                    exportCanvasContext.drawImage(renderer.domElement, 0, 0, width, height);
                    if (exportLogoAsset) {
                        drawExportLogoOverlay(exportCanvasContext, exportLogoAsset.image, width, height, exportLogoAsset.aspectRatio, logoOverlayCorner);
                    }
                }

                await videoSource.add(time, deltaSec);
                onProgress?.((frame + 1) / totalFrames);
            }

            onStatus?.('Finalizing…');
            await output.finalize();

            const mimeType = format === 'webm' ? 'video/webm' : 'video/mp4';
            return new Blob([output.target.buffer], { type: mimeType });
        } finally {
            if (renderer && tileManager) {
                tileManager.resetAnimationState?.();
                rebuildLayout();
                updateViewport();
                syncCellMaterials(true);
                renderCurrentScene();
            }

            if (shouldResumeLoop && renderer && tileManager) {
                startAnimationLoop();
            }
        }
    }

    onMounted(async () => {
        await nextTick();
        await initializeRenderer();
        installOverviewDevHelpers();
    });

    watch(
        () => [props.texture?.id, props.isLocal, props.isCached],
        async () => {
            if (!renderer) {
                return;
            }

            await loadTexture();
        }
    );

    watch(
        () => [props.targetWidth, props.targetHeight],
        async () => {
            if (!renderer || !tileManager) {
                return;
            }

            await nextTick();
            rebuildLayout();
            renderer?.render?.(scene, camera);
        }
    );

    watch(
        () => app.textureOverviewLayoutStrategy,
        () => {
            if (!renderer || !tileManager) {
                return;
            }

            rebuildLayout();
            renderer?.render?.(scene, camera);
        }
    );

    watch(
        () => [app.flowState, app.flowSpeed, app.flowCycleAlignmentEnabled, app.textureAnimationEnabled, app.textureAnimationReversed, app.textureRepeatMode],
        () => {
            handleSettingChange();
        }
    );

    watch(
        () => app.textureFlipVertical,
        () => {
            tileManager?.setVerticalFlip?.(app.textureFlipVertical);
            renderer?.render?.(scene, camera);
        }
    );

    watch(() => app.animatedBackgroundEnabled, () => {
        hasPaintedStaticBackground = false;
        renderCurrentScene();
    });

    watch(
        () => [
            app.transparentShadowsEnabled,
            app.transparencyMode,
            app.transparentShadowsThresholdMin,
            app.transparentShadowsThresholdMax,
            app.renderFilterMode,
            app.duotoneColor,
            app.contrast,
            app.saturation,
        ],
        () => {
            if (!renderer || !tileManager) return;
            tileManager.setContrast?.(app.renderFilterMode === 'duotone' ? 1 : app.contrast);
            tileManager.setSaturation?.(app.renderFilterMode === 'duotone' ? 1 : app.saturation);
            syncCellMaterials(true);
            renderCurrentScene();
        }
    );

    onBeforeUnmount(() => {
        reloadToken += 1;

        stopAnimationLoop();
        removeOverviewDevHelpers();
        disposeDebugOverrideMaterials();

        resizeObserver?.disconnect?.();
        resizeObserver = null;
        teardownTileManager();
        renderFilter.disposeRenderFilter();

        if (renderer) {
            renderer.dispose?.();
            renderer.domElement?.remove?.();
            renderer = null;
            rendererRef.value = null;
        }

        scene = null;
        camera = null;
        sceneRef.value = null;
        cameraRef.value = null;
    });

    defineExpose({
        displayScale,
        tileCount,
        isReady,
        getTextureOnlyExportInfo,
        exportVideoWithLiveScene,
    });
</script>

<template>
    <div
        ref="wrapperRef"
        class="texture-overview-preview"
        :class="{ 'is-ready': isReady && !isLoading && !error }"
        :style="wrapperStyle"
    >
        <canvas
            v-if="showBlurredBackground"
            ref="backgroundCanvasRef"
            class="texture-overview-preview-background"
            aria-hidden="true"
        ></canvas>
        <div
            v-if="error"
            class="texture-overview-preview-message is-error"
        >
            Failed to load overview: {{ error }}
        </div>
        <LoadingIndicator
            v-else-if="isLoading || !isReady"
            class="texture-overview-preview-message"
            :message="loadingMessage"
            :status-text="loadingStatusText"
        />
    </div>
</template>

<style scoped>
    .texture-overview-preview {
        position: relative;
        width: 100%;
        min-height: clamp(10rem, 26vh, 15rem);
        overflow: hidden;
    }

    .texture-overview-preview.is-ready {
        aspect-ratio: var(--overview-aspect-ratio, 16 / 9);
        min-height: 0;
    }

    .texture-overview-preview :deep(canvas) {
        position: absolute;
        inset: 0;
        display: block;
        width: 100%;
        height: 100%;
    }

    .texture-overview-preview-background {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
    }

    .texture-overview-preview-message {
        position: absolute;
        inset: 0;
        padding: 1rem;
    }

    .texture-overview-preview-message.is-error {
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        color: #f87171;
        font-size: 0.9rem;
    }
</style>
