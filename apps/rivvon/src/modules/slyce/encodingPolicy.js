const DEFAULT_LAYER_WORKER_COUNT = 4;
const MAX_CONCURRENT_TILE_ENCODES = 2;
const MEMORY_SAFE_LAYER_WORKER_CAP = 2;

function getDeviceMemory() {
    if (typeof navigator === 'undefined') {
        return null;
    }

    const memory = Number(navigator.deviceMemory);
    if (!Number.isFinite(memory) || memory <= 0) {
        return null;
    }

    return memory;
}

function isLikelyIOSOrSafari() {
    if (typeof navigator === 'undefined') return false;

    const ua = navigator.userAgent || '';
    const isIOSDevice = /iPad|iPhone|iPod/.test(ua)
        || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 0);
    const isSafariBrowser = /Safari/.test(ua)
        && !/(Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS)/.test(ua);

    return isIOSDevice || isSafariBrowser;
}

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
        reason: 'realtime-sampling-throttled',
    };
}

export function getSharedBackgroundEncodeConfig() {
    const cores = getLogicalCoreCount();
    const memory = getDeviceMemory();

    if (isLikelyIOSOrSafari()) {
        return {
            maxConcurrentTileEncodes: MAX_CONCURRENT_TILE_ENCODES,
            layerWorkerCount: Math.min(MEMORY_SAFE_LAYER_WORKER_CAP, cores),
            reason: 'apple-webkit-memory-cap',
        };
    }

    if (memory !== null && memory <= 4) {
        return {
            maxConcurrentTileEncodes: MAX_CONCURRENT_TILE_ENCODES,
            layerWorkerCount: Math.min(MEMORY_SAFE_LAYER_WORKER_CAP, cores),
            reason: 'device-memory-cap',
        };
    }

    return {
        maxConcurrentTileEncodes: MAX_CONCURRENT_TILE_ENCODES,
        layerWorkerCount: cores,
        reason: 'hardware-concurrency',
    };
}