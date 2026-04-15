import { read } from 'ktx-parse';
import { KTX2Assembler } from './ktx2-assembler.js';
import { KTX2WorkerPool } from './ktx2-worker-pool.js';
import { getSharedBackgroundEncodeConfig } from './encodingPolicy.js';

const DEFAULT_SAMPLE_SOURCE = '/tiles-ktx2-waves/0.ktx2';

function generateJobId() {
    return `texture_variant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getHeapStats() {
    if (typeof performance === 'undefined' || !performance.memory) {
        return null;
    }

    return {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
    };
}

async function loadSourceBuffer(source) {
    if (typeof source === 'string') {
        const response = await fetch(source);
        if (!response.ok) {
            throw new Error(`Failed to fetch source texture: ${response.status} ${response.statusText}`);
        }

        return {
            buffer: await response.arrayBuffer(),
            label: source
        };
    }

    if (source instanceof Blob) {
        return {
            buffer: await source.arrayBuffer(),
            label: source.name || 'blob'
        };
    }

    if (source instanceof ArrayBuffer) {
        return {
            buffer: source.slice(0),
            label: 'array-buffer'
        };
    }

    if (ArrayBuffer.isView(source)) {
        return {
            buffer: source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
            label: 'typed-array'
        };
    }

    throw new Error('Unsupported source texture. Use a URL, Blob, ArrayBuffer, or typed array.');
}

function deriveTargetDimensions(width, height, targetMaxDimension) {
    if (!Number.isFinite(targetMaxDimension) || targetMaxDimension <= 0) {
        throw new Error(`Invalid target resolution: ${targetMaxDimension}`);
    }

    const sourceMaxDimension = Math.max(width, height);
    if (targetMaxDimension >= sourceMaxDimension) {
        throw new Error(
            `Target resolution ${targetMaxDimension} must be smaller than the source max dimension ${sourceMaxDimension}`
        );
    }

    const scale = targetMaxDimension / sourceMaxDimension;

    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        scale,
        sourceMaxDimension,
        targetMaxDimension
    };
}

function createCanvasSurface(width, height) {
    if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(width, height);
    }

    if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    throw new Error('No canvas implementation is available for local variant downscaling');
}

function createRgbaDownscaler(sourceWidth, sourceHeight, targetWidth, targetHeight) {
    const sourceCanvas = createCanvasSurface(sourceWidth, sourceHeight);
    const targetCanvas = createCanvasSurface(targetWidth, targetHeight);
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true, alpha: true });
    const targetContext = targetCanvas.getContext('2d', { willReadFrequently: true, alpha: true });

    if (!sourceContext || !targetContext) {
        throw new Error('Failed to create 2D canvas contexts for local variant downscaling');
    }

    targetContext.imageSmoothingEnabled = true;
    targetContext.imageSmoothingQuality = 'high';

    return {
        downscale(rgba) {
            const rgbaBytes = rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba);
            const imageData = new ImageData(
                new Uint8ClampedArray(rgbaBytes.buffer, rgbaBytes.byteOffset, rgbaBytes.byteLength),
                sourceWidth,
                sourceHeight
            );

            sourceContext.putImageData(imageData, 0, 0);
            targetContext.clearRect(0, 0, targetWidth, targetHeight);
            targetContext.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);

            const scaled = targetContext.getImageData(0, 0, targetWidth, targetHeight).data;
            return new Uint8Array(scaled.buffer.slice(0));
        }
    };
}

function inspectKtx2Buffer(buffer) {
    const container = read(new Uint8Array(buffer));

    return {
        pixelWidth: container.pixelWidth,
        pixelHeight: container.pixelHeight,
        layerCount: container.layerCount || 1,
        levelCount: container.levelCount || container.levels?.length || 0,
        vkFormat: container.vkFormat,
        supercompressionScheme: container.supercompressionScheme,
        typeSize: container.typeSize,
        byteLength: buffer.byteLength
    };
}

function getTilePayloadSource(tile) {
    return tile?.source ?? tile?.blob ?? tile?.bytes ?? tile?.buffer ?? tile;
}

function getTilePayloadIndex(tile, fallbackIndex = 0) {
    const index = tile?.index ?? tile?.tileIndex ?? tile?.tile_index ?? fallbackIndex;
    return Number.isFinite(index) ? Number(index) : fallbackIndex;
}

function getTilePayloadLabel(tile, fallbackIndex = 0) {
    if (typeof tile?.label === 'string' && tile.label) {
        return tile.label;
    }

    return `tile-${getTilePayloadIndex(tile, fallbackIndex)}`;
}

function normalizeSourceTiles(sourceTiles = []) {
    return sourceTiles
        .map((tile, index) => ({
            index: getTilePayloadIndex(tile, index),
            label: getTilePayloadLabel(tile, index),
            source: getTilePayloadSource(tile)
        }))
        .sort((a, b) => a.index - b.index);
}

function buildSharedEncodeConfig(workerCount, encodeWorkerPool, encodeConfig) {
    if (encodeConfig) {
        return encodeConfig;
    }

    if (encodeWorkerPool) {
        return {
            workerCount: encodeWorkerPool.workerCount,
            reason: 'shared-pool'
        };
    }

    return resolveEncodeWorkerConfig(workerCount);
}

function assertConsistentOutputShape(referenceMeta, nextMeta, tileIndex) {
    if (!referenceMeta) {
        return;
    }

    const keysToCompare = ['pixelWidth', 'pixelHeight', 'layerCount', 'levelCount'];
    for (const key of keysToCompare) {
        if (referenceMeta[key] !== nextMeta[key]) {
            throw new Error(
                `Derived tile ${tileIndex} produced inconsistent ${key}: expected ${referenceMeta[key]}, got ${nextMeta[key]}`
            );
        }
    }
}

function resolveEncodeWorkerConfig(workerCount) {
    if (Number.isFinite(workerCount) && workerCount > 0) {
        return {
            workerCount: Math.max(1, Math.floor(workerCount)),
            reason: 'explicit-override'
        };
    }

    const sharedConfig = getSharedBackgroundEncodeConfig();

    return {
        workerCount: Math.max(1, Math.floor(sharedConfig.layerWorkerCount)),
        reason: sharedConfig.reason
    };
}

class Ktx2TranscodeWorkerClient {
    constructor() {
        this.worker = new Worker(
            new URL('../../workers/ktx2TranscodeWorker.js', import.meta.url),
            { type: 'module' }
        );
        this.pendingRequests = new Map();
        this.nextRequestId = 1;

        this.worker.addEventListener('message', (event) => {
            const { type, requestId, data, error } = event.data;
            const pending = this.pendingRequests.get(requestId);
            if (!pending) return;

            this.pendingRequests.delete(requestId);

            if (type === 'ERROR') {
                const workerError = new Error(error?.message || 'Unknown KTX2 transcode worker error');
                if (error?.stack) workerError.stack = error.stack;
                workerError.name = error?.name || 'Error';
                pending.reject(workerError);
                return;
            }

            pending.resolve(data);
        });
    }

    request(type, data, transfer = []) {
        const requestId = this.nextRequestId++;

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(requestId, { resolve, reject });
            this.worker.postMessage({ type, requestId, data }, transfer);
        });
    }

    openFile(jobId, buffer) {
        return this.request('OPEN_FILE', { jobId, buffer }, [buffer]);
    }

    decodeLayer(jobId, layerIndex, mipLevel = 0) {
        return this.request('DECODE_LAYER', { jobId, layerIndex, mipLevel });
    }

    closeFile(jobId) {
        return this.request('CLOSE_FILE', { jobId });
    }

    terminate() {
        this.worker.terminate();
        this.pendingRequests.clear();
    }
}

async function deriveKtx2Tile({
    source = DEFAULT_SAMPLE_SOURCE,
    targetResolution = 256,
    workerCount = null,
    onProgress = null,
    keepOutputBlobUrl = true,
    decodeWorker = null,
    encodeWorkerPool = null,
    encodeConfig = null
} = {}) {
    const sourceLoad = await loadSourceBuffer(source);
    const sourceByteLength = sourceLoad.buffer.byteLength;
    const sourceHeapBefore = getHeapStats();
    const jobId = generateJobId();
    const resolvedEncodeConfig = buildSharedEncodeConfig(workerCount, encodeWorkerPool, encodeConfig);
    const localDecodeWorker = decodeWorker || new Ktx2TranscodeWorkerClient();
    const localEncodeWorkerPool = encodeWorkerPool || new KTX2WorkerPool(resolvedEncodeConfig.workerCount);
    const ownsDecodeWorker = !decodeWorker;
    const ownsEncodeWorkerPool = !encodeWorkerPool;
    const phaseStart = performance.now();

    let outputBuffer = null;
    let outputBlobUrl = null;

    try {
        onProgress?.({ stage: 'open', label: sourceLoad.label });
        const openStart = performance.now();
        const sourceMeta = await localDecodeWorker.openFile(jobId, sourceLoad.buffer);
        const openDurationMs = performance.now() - openStart;

        const targetMeta = deriveTargetDimensions(sourceMeta.width, sourceMeta.height, targetResolution);
        const downscaler = createRgbaDownscaler(
            sourceMeta.width,
            sourceMeta.height,
            targetMeta.width,
            targetMeta.height
        );

        const frames = [];
        const layerMetrics = [];
        let totalDecodedBytes = 0;
        let totalScaledBytes = 0;
        let peakDecodedBytes = 0;

        for (let layerIndex = 0; layerIndex < sourceMeta.layerCount; layerIndex++) {
            onProgress?.({
                stage: 'decode-layer',
                layerIndex,
                layerCount: sourceMeta.layerCount
            });

            const decodeStart = performance.now();
            const decodedLayer = await localDecodeWorker.decodeLayer(jobId, layerIndex, 0);
            const decodeDurationMs = performance.now() - decodeStart;
            const decodedRgba = new Uint8Array(decodedLayer.buffer);

            const scaleStart = performance.now();
            const scaledRgba = downscaler.downscale(decodedRgba);
            const scaleDurationMs = performance.now() - scaleStart;

            totalDecodedBytes += decodedLayer.rgbaByteLength;
            totalScaledBytes += scaledRgba.byteLength;
            peakDecodedBytes = Math.max(peakDecodedBytes, decodedLayer.rgbaByteLength);

            frames.push({
                rgba: scaledRgba,
                width: targetMeta.width,
                height: targetMeta.height
            });

            layerMetrics.push({
                layerIndex,
                sourceWidth: decodedLayer.width,
                sourceHeight: decodedLayer.height,
                decodedBytes: decodedLayer.rgbaByteLength,
                scaledBytes: scaledRgba.byteLength,
                decodeDurationMs,
                scaleDurationMs,
                totalDurationMs: decodeDurationMs + scaleDurationMs
            });

            onProgress?.({
                stage: 'layer-complete',
                layerIndex,
                layerCount: sourceMeta.layerCount,
                decodeDurationMs,
                scaleDurationMs
            });
        }

        onProgress?.({
            stage: 'encode',
            layerCount: frames.length,
            workerCount: localEncodeWorkerPool.workerCount,
            workerReason: resolvedEncodeConfig.reason
        });

        const encodeStart = performance.now();
        outputBuffer = await KTX2Assembler.encodeParallelWithPool(
            localEncodeWorkerPool,
            frames,
            (completed, total) => {
                onProgress?.({
                    stage: 'encode-progress',
                    completed,
                    total
                });
            }
        );
        const encodeDurationMs = performance.now() - encodeStart;

        const outputMeta = inspectKtx2Buffer(outputBuffer);
        const phaseDurationMs = performance.now() - phaseStart;
        const outputBlob = new Blob([outputBuffer], { type: 'image/ktx2' });
        outputBlobUrl = keepOutputBlobUrl ? URL.createObjectURL(outputBlob) : null;
        const sourceHeapAfter = getHeapStats();

        return {
            source: {
                label: sourceLoad.label,
                ...sourceMeta,
                sourceByteLength
            },
            target: {
                width: targetMeta.width,
                height: targetMeta.height,
                scale: targetMeta.scale,
                targetMaxDimension: targetMeta.targetMaxDimension,
                sourceMaxDimension: targetMeta.sourceMaxDimension
            },
            output: {
                ...outputMeta,
                outputBlob,
                outputBlobUrl,
                outputBuffer
            },
            validation: {
                preservedLayerCount: outputMeta.layerCount === sourceMeta.layerCount,
                regeneratedMipmaps: outputMeta.levelCount > 0,
                resizedBaseLevel: outputMeta.pixelWidth === targetMeta.width && outputMeta.pixelHeight === targetMeta.height,
                viewerCompatibleShape:
                    outputMeta.layerCount === sourceMeta.layerCount
                    && outputMeta.pixelWidth === targetMeta.width
                    && outputMeta.pixelHeight === targetMeta.height
                    && outputMeta.levelCount > 0
            },
            metrics: {
                sourceByteLength,
                outputByteLength: outputMeta.byteLength,
                totalDecodedBytes,
                totalScaledBytes,
                peakDecodedBytes,
                heapBefore: sourceHeapBefore,
                heapAfter: sourceHeapAfter
            },
            encodeConfig: {
                workerCount: localEncodeWorkerPool.workerCount,
                reason: resolvedEncodeConfig.reason
            },
            timings: {
                openDurationMs,
                encodeDurationMs,
                totalDurationMs: phaseDurationMs
            },
            layers: layerMetrics
        };
    } finally {
        try {
            await localDecodeWorker.closeFile(jobId);
        } catch (error) {
            console.warn('[Texture Variant] Failed to close KTX2 decode job cleanly:', error);
        }

        if (ownsDecodeWorker) {
            localDecodeWorker.terminate();
        }

        if (ownsEncodeWorkerPool) {
            localEncodeWorkerPool.terminate();
        }
    }
}

export async function runKtx2RoundtripDerivation({
    source = DEFAULT_SAMPLE_SOURCE,
    targetResolution = 256,
    workerCount = null,
    onProgress = null,
    keepOutputBlobUrl = true
} = {}) {
    return deriveKtx2Tile({
        source,
        targetResolution,
        workerCount,
        onProgress,
        keepOutputBlobUrl
    });
}

export async function deriveKtx2TextureSet({
    sourceTiles = [],
    targetResolution = 256,
    workerCount = null,
    onProgress = null
} = {}) {
    const normalizedTiles = normalizeSourceTiles(sourceTiles);

    if (normalizedTiles.length === 0) {
        throw new Error('No source tiles were provided for local derivation');
    }

    const encodeConfig = resolveEncodeWorkerConfig(workerCount);
    const decodeWorker = new Ktx2TranscodeWorkerClient();
    const encodeWorkerPool = new KTX2WorkerPool(encodeConfig.workerCount);
    const phaseStart = performance.now();

    let totalSourceByteLength = 0;
    let totalOutputByteLength = 0;
    let totalEncodeDurationMs = 0;
    let sharedSourceMeta = null;
    let sharedOutputMeta = null;

    try {
        const derivedTiles = [];

        for (let tileOffset = 0; tileOffset < normalizedTiles.length; tileOffset++) {
            const tile = normalizedTiles[tileOffset];
            const tileNumber = tileOffset + 1;

            onProgress?.({
                stage: 'tile-start',
                tileIndex: tile.index,
                tileNumber,
                tileCount: normalizedTiles.length,
                label: tile.label
            });

            const tileResult = await deriveKtx2Tile({
                source: tile.source,
                targetResolution,
                onProgress: (stage) => {
                    onProgress?.({
                        stage: 'tile-progress',
                        tileIndex: tile.index,
                        tileNumber,
                        tileCount: normalizedTiles.length,
                        label: tile.label,
                        nestedStage: stage.stage,
                        ...stage
                    });
                },
                keepOutputBlobUrl: false,
                decodeWorker,
                encodeWorkerPool,
                encodeConfig
            });

            totalSourceByteLength += tileResult.source.sourceByteLength;
            totalOutputByteLength += tileResult.output.byteLength;
            totalEncodeDurationMs += tileResult.timings.encodeDurationMs;

            if (!sharedSourceMeta) {
                sharedSourceMeta = {
                    width: tileResult.source.width,
                    height: tileResult.source.height,
                    layerCount: tileResult.source.layerCount,
                    levelCount: tileResult.source.levelCount
                };
            }

            const nextOutputMeta = {
                pixelWidth: tileResult.output.pixelWidth,
                pixelHeight: tileResult.output.pixelHeight,
                layerCount: tileResult.output.layerCount,
                levelCount: tileResult.output.levelCount
            };
            assertConsistentOutputShape(sharedOutputMeta, nextOutputMeta, tile.index);
            sharedOutputMeta = sharedOutputMeta || nextOutputMeta;

            derivedTiles.push({
                index: tile.index,
                label: tile.label,
                blob: tileResult.output.outputBlob,
                byteLength: tileResult.output.byteLength,
                timings: tileResult.timings,
                validation: tileResult.validation
            });

            onProgress?.({
                stage: 'tile-complete',
                tileIndex: tile.index,
                tileNumber,
                tileCount: normalizedTiles.length,
                label: tile.label,
                outputByteLength: tileResult.output.byteLength,
                tileDurationMs: tileResult.timings.totalDurationMs
            });
        }

        const totalDurationMs = performance.now() - phaseStart;
        const outputBlobs = Object.fromEntries(
            derivedTiles.map((tile) => [tile.index, tile.blob])
        );
        const viewerCompatibleShape = derivedTiles.every((tile) => tile.validation.viewerCompatibleShape);

        onProgress?.({
            stage: 'complete',
            tileCount: normalizedTiles.length,
            totalDurationMs,
            outputByteLength: totalOutputByteLength
        });

        return {
            source: {
                tileCount: normalizedTiles.length,
                totalByteLength: totalSourceByteLength,
                width: sharedSourceMeta?.width,
                height: sharedSourceMeta?.height,
                layerCount: sharedSourceMeta?.layerCount,
                levelCount: sharedSourceMeta?.levelCount
            },
            output: {
                tileCount: derivedTiles.length,
                pixelWidth: sharedOutputMeta?.pixelWidth,
                pixelHeight: sharedOutputMeta?.pixelHeight,
                layerCount: sharedOutputMeta?.layerCount,
                levelCount: sharedOutputMeta?.levelCount,
                totalByteLength: totalOutputByteLength
            },
            outputBlobs,
            derivedTiles,
            encodeConfig,
            timings: {
                totalDurationMs,
                encodeDurationMs: totalEncodeDurationMs
            },
            validation: {
                preservedLayerCount: sharedOutputMeta?.layerCount === sharedSourceMeta?.layerCount,
                consistentOutputShape: true,
                viewerCompatibleShape
            }
        };
    } finally {
        decodeWorker.terminate();
        encodeWorkerPool.terminate();
    }
}

export async function runSampleKtx2RoundtripDerivation(options = {}) {
    return runKtx2RoundtripDerivation({
        source: DEFAULT_SAMPLE_SOURCE,
        ...options
    });
}

export function revokeRoundtripOutputBlobUrl(resultOrUrl) {
    const url = typeof resultOrUrl === 'string'
        ? resultOrUrl
        : resultOrUrl?.output?.outputBlobUrl;

    if (url) {
        URL.revokeObjectURL(url);
    }
}

export function installKtx2RoundtripDevHelpers(target = window) {
    if (!target) return;

    target.__rivvonTextureVariants = {
        deriveKtx2TextureSet,
        runKtx2RoundtripDerivation,
        runSampleKtx2RoundtripDerivation,
        revokeRoundtripOutputBlobUrl
    };

    console.info(
        '[Texture Variant] Installed dev helpers on window.__rivvonTextureVariants. Try runSampleKtx2RoundtripDerivation({ targetResolution: 256 }).'
    );
}