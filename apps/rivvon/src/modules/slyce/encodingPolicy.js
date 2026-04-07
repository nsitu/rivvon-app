const DEFAULT_LAYER_WORKER_COUNT = 4;
const MAX_CONCURRENT_TILE_ENCODES = 2;

function getLogicalCoreCount() {
    if (typeof navigator === 'undefined') {
        return DEFAULT_LAYER_WORKER_COUNT;
    }

    const cores = Number(navigator.hardwareConcurrency);
    if (!Number.isFinite(cores) || cores <= 0) {
        return DEFAULT_LAYER_WORKER_COUNT;
    }

    return Math.max(1, Math.floor(cores));
}

export function getRealtimeSamplingEncodeConfig() {
    return {
        maxConcurrentTileEncodes: 1,
        layerWorkerCount: 1,
    };
}

export function getSharedBackgroundEncodeConfig() {
    return {
        maxConcurrentTileEncodes: MAX_CONCURRENT_TILE_ENCODES,
        layerWorkerCount: getLogicalCoreCount(),
    };
}