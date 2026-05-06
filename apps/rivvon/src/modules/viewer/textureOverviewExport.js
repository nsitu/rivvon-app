import * as THREE from 'three';
import { drawExportLogoOverlay, loadExportLogoAsset } from './exportLogoOverlay';
import { TileManager } from './tileManager';
import { calculateTextureOverviewLayout } from './textureOverviewLayout';

let textureServicePromise = null;

function loadTextureService() {
    if (!textureServicePromise) {
        textureServicePromise = import('../../services/textureService.js');
    }

    return textureServicePromise;
}

function getRepeatModeLabel(mode) {
    if (mode === 'mirrorTile') {
        return 'mirror-bounce';
    }

    if (mode === 'bounce') {
        return 'bounce';
    }

    return 'wrap';
}

function getCycleRepeatCount(loopDuration, cycleDuration) {
    if (!Number.isFinite(loopDuration) || !Number.isFinite(cycleDuration) || cycleDuration <= 0) {
        return null;
    }

    const rawRepeatCount = loopDuration / cycleDuration;
    const roundedRepeatCount = Math.round(rawRepeatCount);

    return Math.abs(rawRepeatCount - roundedRepeatCount) < 1e-3
        ? roundedRepeatCount
        : Number(rawRepeatCount.toFixed(2));
}

function buildCycleDetail({ loopDuration, key, label, active, duration, detail, inactiveDetail, statusLabel }) {
    const repeatCount = active ? getCycleRepeatCount(loopDuration, duration) : null;
    const implication = active
        ? (repeatCount === 1
            ? 'This cycle currently defines the seamless texture loop.'
            : `It repeats ${repeatCount} times before the overview loop resets.`)
        : inactiveDetail;

    return {
        key,
        label,
        active,
        duration,
        detail,
        implication,
        repeatCount,
        statusLabel,
    };
}

function applyViewerSettings(tileManager, viewerSettings = {}) {
    tileManager.setRepeatMode?.(viewerSettings.textureRepeatMode ?? 'mirrorTile');
    tileManager.setFlowAlignmentEnabled?.(viewerSettings.flowCycleAlignmentEnabled ?? true);
    tileManager.setLayerAnimationEnabled?.(viewerSettings.textureAnimationEnabled ?? true);
    tileManager.setLayerAnimationReversed?.(viewerSettings.textureAnimationReversed ?? false);

    if (viewerSettings.flowState === 'off') {
        tileManager.setFlowEnabled?.(false);
        return;
    }

    const baseSpeed = Number(viewerSettings.flowSpeed) || 0.25;
    const signedSpeed = viewerSettings.flowState === 'backward' ? -baseSpeed : baseSpeed;
    tileManager.setFlowSpeed?.(signedSpeed);
    tileManager.setFlowEnabled?.(true);
}

function createRenderer(width = 1, height = 1) {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(1);
    renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    renderer.setClearColor(0x000000, 0);
    return renderer;
}

function disposeRenderer(renderer) {
    if (!renderer) {
        return;
    }

    renderer.dispose?.();
    renderer.forceContextLoss?.();
    renderer.domElement?.remove?.();
}

async function loadTemporaryTileManager(options = {}) {
    const {
        texture,
        isLocal = false,
        isCached = false,
        getLocalTiles,
        getCachedLocalId,
        renderer,
        viewerSettings,
    } = options;

    const tileManager = new TileManager({
        renderer,
        rendererType: 'webgl',
        rotate90: true,
        repeatMode: viewerSettings?.textureRepeatMode ?? 'mirrorTile',
        flowAlignmentEnabled: viewerSettings?.flowCycleAlignmentEnabled ?? true,
        layerAnimationEnabled: viewerSettings?.textureAnimationEnabled ?? true,
        layerAnimationReversed: viewerSettings?.textureAnimationReversed ?? false,
        webgpuMaterialMode: 'node',
    });

    let didLoad = false;

    if (isLocal) {
        didLoad = await tileManager.loadFromLocal(texture, getLocalTiles);
    } else if (isCached && typeof getCachedLocalId === 'function') {
        const cachedLocalId = await getCachedLocalId(texture.id);
        if (cachedLocalId) {
            didLoad = await tileManager.loadFromLocal({
                ...texture,
                id: cachedLocalId,
                thumbnail_data_url: texture.thumbnail_data_url || texture.thumbnail_url || null,
            }, getLocalTiles);
        }
    }

    if (!didLoad) {
        const { fetchTextureWithTiles } = await loadTextureService();
        const textureSet = await fetchTextureWithTiles(texture.id);
        didLoad = await tileManager.loadFromRemote(textureSet);
    }

    if (!didLoad) {
        tileManager.dispose?.();
        throw new Error('Texture data is incomplete or unreadable for texture-only export.');
    }

    applyViewerSettings(tileManager, viewerSettings);
    return tileManager;
}

export function buildTextureOverviewModeInfoFromTileManager(tileManager) {
    const seamlessLoopDuration = tileManager.getSeamlessLoopDuration?.(false) ?? 1;
    const layerCount = tileManager.getLayerCount?.() ?? 0;
    const fps = tileManager.getFps?.() ?? 30;
    const textureAnimationEnabled = tileManager.isLayerAnimationEnabled?.() ?? true;
    const textureCyclePeriod = textureAnimationEnabled && layerCount > 1
        ? (tileManager.getLayerCyclePeriod?.() ?? 0)
        : 0;
    const flowEnabled = tileManager.isFlowEnabled?.() ?? false;
    const flowSpeed = tileManager.getFlowSpeed?.() ?? 0;
    const flowAlignmentInfo = tileManager.getFlowAlignmentInfo?.() ?? null;
    const requestedFlowSpeed = Math.abs(flowAlignmentInfo?.requestedSpeed ?? flowSpeed);
    const appliedFlowSpeed = Math.abs(flowAlignmentInfo?.appliedSpeed ?? flowSpeed);
    const effectiveTileCount = tileManager.getEffectiveTileCount?.() ?? 0;
    const flowCyclePeriod = flowEnabled && flowSpeed !== 0 && effectiveTileCount > 0
        ? (flowAlignmentInfo?.flowCyclePeriod ?? (effectiveTileCount / appliedFlowSpeed))
        : 0;

    return {
        seamlessLoopDuration,
        textureCyclePeriod,
        flowCyclePeriod,
        cinematicAutoDuration: seamlessLoopDuration,
        cinematicDuration: 0,
        hasROIs: false,
        textureOnly: true,
        loopLabel: 'Seamless Texture Loop',
        cycleDetails: [
            buildCycleDetail({
                loopDuration: seamlessLoopDuration,
                key: 'texture',
                label: 'Texture Cycle',
                active: textureCyclePeriod > 0,
                duration: textureCyclePeriod,
                detail: textureCyclePeriod > 0
                    ? `${layerCount} layers animate at ${fps} fps across the texture overview.`
                    : (!textureAnimationEnabled && layerCount > 1
                        ? 'Layer Cycling is turned off, so the overview holds a single KTX2 layer.'
                        : 'Current texture set is static, so there is no animated texture cycle.'),
                inactiveDetail: !textureAnimationEnabled && layerCount > 1
                    ? 'Texture animation does not contribute to the overview loop while disabled.'
                    : 'Texture animation is not extending the overview loop right now.',
                statusLabel: !textureAnimationEnabled && layerCount > 1 ? 'Off' : 'Static',
            }),
            buildCycleDetail({
                loopDuration: seamlessLoopDuration,
                key: 'flow',
                label: 'Flow Cycle',
                active: flowCyclePeriod > 0,
                duration: flowCyclePeriod,
                detail: flowCyclePeriod > 0
                    ? (flowAlignmentInfo?.enabled && flowAlignmentInfo.canAlign && flowAlignmentInfo.cycleMultiple
                        ? (flowAlignmentInfo.aligned
                            ? `${effectiveTileCount} overview cells cycle at ${appliedFlowSpeed.toFixed(2)} tiles/s in ${getRepeatModeLabel(tileManager.getRepeatMode?.())} mode. Requested ${requestedFlowSpeed.toFixed(2)} tiles/s is snapped so one flow loop spans ${flowAlignmentInfo.cycleMultiple} texture cycles.`
                            : `${effectiveTileCount} overview cells cycle at ${appliedFlowSpeed.toFixed(2)} tiles/s in ${getRepeatModeLabel(tileManager.getRepeatMode?.())} mode. It already lands on a ${flowAlignmentInfo.cycleMultiple}-texture-cycle flow loop.`)
                        : `${effectiveTileCount} overview cells cycle at ${appliedFlowSpeed.toFixed(2)} tiles/s in ${getRepeatModeLabel(tileManager.getRepeatMode?.())} mode.`)
                    : 'Tile flow is disabled, so the overview does not stream across cells.',
                inactiveDetail: 'Flow does not contribute to the overview loop while disabled.',
                statusLabel: 'Off',
            }),
        ],
    };
}

function createOverviewScene(tileManager, width, height, options = {}) {
    const flipVertical = options.flipVertical === true;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(
        -width / 2,
        width / 2,
        height / 2,
        -height / 2,
        0.1,
        10,
    );
    camera.position.z = 2;

    const tileResolution = Number(
        tileManager.currentTextureSet?.tile_resolution
        ?? tileManager.tileSize
        ?? 512,
    ) || 512;
    const layout = calculateTextureOverviewLayout({
        targetWidth: width,
        targetHeight: height,
        tileWidth: tileResolution,
        tileHeight: tileResolution,
    });
    const geometry = new THREE.PlaneGeometry(layout.tileWidth, layout.tileHeight);
    const cells = layout.positions.map((position) => {
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }));
        mesh.position.set(position.x, position.y, 0);
        mesh.scale.y = flipVertical ? -1 : 1;
        scene.add(mesh);
        return {
            mesh,
            baseIndex: position.index,
        };
    });

    let flowWasActive = null;

    const syncMaterials = (force = false) => {
        const flowActive = tileManager.isFlowEnabled?.() && tileManager.getFlowSpeed?.() !== 0;

        if (force || flowWasActive !== flowActive) {
            tileManager.clearFlowMaterials?.();

            for (const cell of cells) {
                const material = tileManager.getOrCreateMaterialForSegment(cell.baseIndex, flowActive);
                if (material) {
                    cell.mesh.material = material;
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

        for (const cell of cells) {
            const material = tileManager.getOrCreateMaterialForSegment(cell.baseIndex, true);
            if (material) {
                cell.mesh.material = material;
            }
        }
    };

    const dispose = () => {
        for (const cell of cells) {
            scene.remove(cell.mesh);
        }
        geometry.dispose();
    };

    return {
        camera,
        dispose,
        scene,
        syncMaterials,
    };
}

export async function buildTextureOverviewExportInfo(options = {}) {
    const renderer = createRenderer(1, 1);
    let tileManager = null;

    try {
        tileManager = await loadTemporaryTileManager({
            texture: options.texture,
            isLocal: options.isLocal,
            isCached: options.isCached,
            getLocalTiles: options.getLocalTiles,
            getCachedLocalId: options.getCachedLocalId,
            renderer,
            viewerSettings: options.viewerSettings,
        });

        return buildTextureOverviewModeInfoFromTileManager(tileManager);
    } finally {
        tileManager?.dispose?.();
        disposeRenderer(renderer);
    }
}

export async function exportTextureOverviewVideo(options = {}) {
    const {
        texture,
        isLocal = false,
        isCached = false,
        getLocalTiles,
        getCachedLocalId,
        viewerSettings,
        width = 1920,
        height = 1080,
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

    if (!texture) {
        throw new Error('Texture-only export requires a texture source.');
    }

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

    const renderer = createRenderer(width, height);
    let tileManager = null;
    let overviewScene = null;

    try {
        tileManager = await loadTemporaryTileManager({
            texture,
            isLocal,
            isCached,
            getLocalTiles,
            getCachedLocalId,
            renderer,
            viewerSettings,
        });

        overviewScene = createOverviewScene(tileManager, width, height, {
            flipVertical: viewerSettings?.textureOverviewFlipVertical === true,
        });
        tileManager.resetAnimationState?.();
        overviewScene.syncMaterials(true);

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

        const output = new MB.Output({
            format: new OutputFormat(),
            target: new MB.BufferTarget(),
        });

        const renderCanvas = renderer.domElement;
        let exportCanvas = renderCanvas;
        let exportCanvasContext = null;
        let exportLogoAsset = null;

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
            overviewScene.syncMaterials();
            renderer.render(overviewScene.scene, overviewScene.camera);

            if (exportCanvasContext && exportLogoAsset) {
                exportCanvasContext.clearRect(0, 0, width, height);
                exportCanvasContext.drawImage(renderCanvas, 0, 0, width, height);
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
        overviewScene?.dispose?.();
        tileManager?.dispose?.();
        disposeRenderer(renderer);
    }
}