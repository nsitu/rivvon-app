<script setup>
    import * as THREE from 'three';
    import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
    import LoadingIndicator from '../shared/LoadingIndicator.vue';
    import { useViewerStore } from '../../stores/viewerStore';
    import { TileManager } from '../../modules/viewer/tileManager';
    import { drawExportLogoOverlay, loadExportLogoAsset } from '../../modules/viewer/exportLogoOverlay';
    import { buildTextureOverviewModeInfoFromTileManager } from '../../modules/viewer/textureOverviewExport';
    import { calculateTextureOverviewLayout } from '../../modules/viewer/textureOverviewLayout';

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
    });

    const app = useViewerStore();
    const wrapperRef = ref(null);
    const isLoading = ref(false);
    const error = ref('');
    const isReady = ref(false);
    const displayScale = ref(1);
    const tileCount = ref(0);
    const loadingStatusText = ref('');

    const wrapperStyle = computed(() => ({
        '--overview-aspect-ratio': `${Math.max(1, Number(props.targetWidth) || 1920)} / ${Math.max(1, Number(props.targetHeight) || 1080)}`,
    }));

    let renderer = null;
    let scene = null;
    let camera = null;
    let tileManager = null;
    let resizeObserver = null;
    let animationFrameId = 0;
    let cellGeometry = null;
    let cellEntries = [];
    let currentLayout = null;
    let flowWasActive = null;
    let reloadToken = 0;
    let textureServicePromise = null;

    function loadTextureService() {
        if (!textureServicePromise) {
            textureServicePromise = import('../../services/textureService.js');
        }

        return textureServicePromise;
    }

    function updateLoadingStatus(stage, current, total) {
        const numericTotal = Math.max(0, Number(total) || 0);
        const numericCurrent = Math.max(0, Number(current) || 0);

        if (numericTotal <= 0) {
            loadingStatusText.value = '';
            return;
        }

        const normalized = Math.min(1, numericCurrent / numericTotal);
        let overallProgress = normalized;

        if (stage === 'downloading') {
            overallProgress = normalized * 0.5;
        } else if (stage === 'building') {
            overallProgress = 0.5 + normalized * 0.5;
        }

        loadingStatusText.value = `${Math.round(overallProgress * 100)}%`;
    }

    function applyViewerSettings() {
        if (!tileManager) {
            return;
        }

        tileManager.setRepeatMode?.(app.textureRepeatMode);
        tileManager.setFlowAlignmentEnabled?.(app.flowCycleAlignmentEnabled);
        tileManager.setLayerAnimationEnabled?.(app.textureAnimationEnabled);
        tileManager.setLayerAnimationReversed?.(app.textureAnimationReversed);

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

    function applyCellOrientation() {
        const scaleY = app.textureOverviewFlipVertical ? -1 : 1;

        for (const entry of cellEntries) {
            entry.mesh.scale.y = scaleY;
        }
    }

    function syncCellMaterials(force = false) {
        if (!tileManager || cellEntries.length === 0) {
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

        renderer.render(scene, camera);
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

        camera.left = -currentLayout.frameWidth / 2;
        camera.right = camera.left + visibleWidth;
        camera.top = currentLayout.frameHeight / 2;
        camera.bottom = camera.top - visibleHeight;
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
        });

        cellGeometry = new THREE.PlaneGeometry(currentLayout.tileWidth, currentLayout.tileHeight);
        cellEntries = currentLayout.positions.map((position) => {
            const mesh = new THREE.Mesh(cellGeometry, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }));
            mesh.position.set(position.x, position.y, 0);
            scene.add(mesh);
            return {
                mesh,
                baseIndex: position.index,
            };
        });

        applyCellOrientation();
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
            rendererType: 'webgl',
            rotate90: true,
            repeatMode: app.textureRepeatMode,
            flowAlignmentEnabled: app.flowCycleAlignmentEnabled,
            layerAnimationEnabled: app.textureAnimationEnabled,
            layerAnimationReversed: app.textureAnimationReversed,
            webgpuMaterialMode: 'node',
        });

        try {
            let didLoad = false;

            if (props.isLocal) {
                didLoad = await nextTileManager.loadFromLocal(props.texture, props.getLocalTiles, handleLoadProgress);
            } else if (props.isCached && props.getCachedLocalId) {
                const cachedLocalId = await props.getCachedLocalId(props.texture.id);
                if (cachedLocalId) {
                    didLoad = await nextTileManager.loadFromLocal({
                        ...props.texture,
                        id: cachedLocalId,
                        thumbnail_data_url: props.texture.thumbnail_data_url || props.texture.thumbnail_url || null,
                    }, props.getLocalTiles, handleLoadProgress);
                }
            }

            if (!didLoad) {
                const { fetchTextureWithTiles } = await loadTextureService();
                const textureSet = await fetchTextureWithTiles(props.texture.id);
                didLoad = await nextTileManager.loadFromRemote(textureSet, handleLoadProgress);
            }

            if (!didLoad) {
                throw new Error('Unable to load overview preview tiles.');
            }

            if (token !== reloadToken) {
                nextTileManager.dispose?.();
                return;
            }

            tileManager = nextTileManager;
            tileCount.value = tileManager.getTileCount?.() || props.texture.tile_count || 0;
            loadingStatusText.value = '100%';
            applyViewerSettings();
            rebuildLayout();
            isReady.value = true;
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
                    loadingStatusText.value = '';
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

        renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
        });
        renderer.setClearColor(0x000000, 0);
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

            if (logoOverlayEnabled) {
                exportLogoAsset = await loadExportLogoAsset();
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

                if (exportCanvasContext && exportLogoAsset) {
                    exportCanvasContext.clearRect(0, 0, width, height);
                    exportCanvasContext.drawImage(renderer.domElement, 0, 0, width, height);
                    drawExportLogoOverlay(
                        exportCanvasContext,
                        exportLogoAsset.image,
                        width,
                        height,
                        exportLogoAsset.aspectRatio,
                    );
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
        () => [app.flowState, app.flowSpeed, app.flowCycleAlignmentEnabled, app.textureAnimationEnabled, app.textureAnimationReversed, app.textureRepeatMode],
        () => {
            handleSettingChange();
        }
    );

    watch(
        () => app.textureOverviewFlipVertical,
        () => {
            applyCellOrientation();
            renderer?.render?.(scene, camera);
        }
    );

    onBeforeUnmount(() => {
        reloadToken += 1;

        stopAnimationLoop();

        resizeObserver?.disconnect?.();
        resizeObserver = null;
        teardownTileManager();

        if (renderer) {
            renderer.dispose?.();
            renderer.domElement?.remove?.();
            renderer = null;
        }

        scene = null;
        camera = null;
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
        <div
            v-if="error"
            class="texture-overview-preview-message is-error"
        >
            Failed to load overview: {{ error }}
        </div>
        <LoadingIndicator
            v-else-if="isLoading || !isReady"
            class="texture-overview-preview-message"
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

    .texture-overview-preview-message {
        position: absolute;
        inset: 0;
        padding: 1rem;
        background: rgba(0, 0, 0, 0.24);
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