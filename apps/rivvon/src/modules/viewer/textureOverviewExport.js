import * as THREE from 'three';
import { createCanvasVideoExport } from './canvasVideoExport.js';
import { applyRendererDisplayConfig } from './rendererConfig.js';
import { TileManager } from './tileManager';
import { calculateTextureOverviewLayout } from './textureOverviewLayout';
import {
    DEFAULT_SEAMLESS_LOOP_COUNT,
    getSeamlessLoopDuration,
    normalizeSeamlessLoopCount,
} from './seamlessLoop.js';
import { createLazyLoader } from '../shared/lazyLoader.js';

const loadTextureService = createLazyLoader(() => import('../../services/textureService.js'));

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
    tileManager.setVerticalFlip?.(viewerSettings.textureFlipVertical ?? false);
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
    applyRendererDisplayConfig(renderer);
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
        flipVertical: viewerSettings?.textureFlipVertical ?? false,
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
    const seamlessLoopDuration = getSeamlessLoopDuration(tileManager, false, 1);
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
        strategy: options.viewerSettings?.textureOverviewLayoutStrategy,
    });
    const geometry = new THREE.PlaneGeometry(layout.tileWidth, layout.tileHeight);
    const vertexCount = geometry.getAttribute('position')?.count ?? 0;
    geometry.setAttribute('capStartStyle', new THREE.Float32BufferAttribute(new Float32Array(vertexCount), 1));
    geometry.setAttribute('capEndStyle', new THREE.Float32BufferAttribute(new Float32Array(vertexCount), 1));
    const cells = layout.positions.map((position) => {
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }));
        mesh.position.set(position.x, position.y, 0);
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
        encodingMethod = 'ffmpeg',
        hardwareAcceleration = 'no-preference',
        duration = null,
        loopCount = DEFAULT_SEAMLESS_LOOP_COUNT,
        quality = 'very-high',
        logoOverlayEnabled = true,
        logoOverlayCorner = 'bottomLeft',
        signal = null,
        onProgress = null,
        onStatus = null,
        onColourMetadata = null,
    } = options;

    if (!texture) {
        throw new Error('Texture-only export requires a texture source.');
    }

    const renderer = createRenderer(width, height);
    let tileManager = null;
    let overviewScene = null;
    let videoExport = null;

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

        overviewScene = createOverviewScene(tileManager, width, height, { viewerSettings });
        tileManager.resetAnimationState?.();
        overviewScene.syncMaterials(true);

        const seamlessLoopDuration = getSeamlessLoopDuration(tileManager, false, 1);
        const normalizedLoopCount = normalizeSeamlessLoopCount(loopCount);
        const exportDuration = duration != null
            ? duration
            : seamlessLoopDuration * normalizedLoopCount;
        const totalFrames = Math.ceil(exportDuration * fps);
        const deltaSec = 1 / fps;

        videoExport = await createCanvasVideoExport(renderer.domElement, {
            width, height, fps, format, encodingMethod, hardwareAcceleration, quality, logoOverlayEnabled, logoOverlayCorner,
            renderContext: renderer.getContext?.(),
            signal, onStatus, onColourMetadata,
        });

        onStatus?.(`Encoding ${totalFrames} overview frames…`);

        for (let frame = 0; frame < totalFrames; frame += 1) {
            if (signal?.aborted) {
                return null;
            }

            const time = frame * deltaSec;
            const animationDelta = frame === 0 ? 0 : deltaSec;

            tileManager.tickDeterministic?.(animationDelta);
            overviewScene.syncMaterials();
            renderer.render(overviewScene.scene, overviewScene.camera);

            await videoExport.add(time, deltaSec);
            onProgress?.(0.95 * (frame + 1) / totalFrames);
        }

        onStatus?.('Finalizing…');
        const blob = await videoExport.finalize();
        onProgress?.(1);
        return blob;
    } catch (error) {
        if (signal?.aborted) return null;
        throw error;
    } finally {
        await videoExport?.dispose();
        overviewScene?.dispose?.();
        tileManager?.dispose?.();
        disposeRenderer(renderer);
    }
}
