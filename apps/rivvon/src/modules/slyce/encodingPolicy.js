const DEFAULT_LAYER_WORKER_COUNT = 4;
const MAX_CONCURRENT_TILE_ENCODES = 1;
const MEMORY_SAFE_LAYER_WORKER_CAP = 2;

export const TILE_BUILDER_BACKEND_CANVAS = 'canvas';
export const TILE_BUILDER_BACKEND_WEBGL = 'webgl';
export const TILE_BUILDER_BACKEND_WEBGPU = 'webgpu';
export const TILE_BUILDER_BACKEND_WEBGPU_ARRAY = 'webgpu-array';

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

export function isLikelyIOSDevice() {
    if (typeof navigator === 'undefined') return false;

    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua)
        || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 0);
}

export function isLikelyIOSOrSafari() {
    if (typeof navigator === 'undefined') return false;

    const ua = navigator.userAgent || '';
    const isIOSDevice = isLikelyIOSDevice();
    const isSafariBrowser = /Safari/.test(ua)
        && !/(Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS)/.test(ua);

    return isIOSDevice || isSafariBrowser;
}

export function shouldUseWebGL2BuilderByDefault() {
    return !isLikelyIOSOrSafari();
}

export function hasWebGPUSupport() {
    return typeof navigator !== 'undefined'
        && 'gpu' in navigator
        && typeof navigator.gpu?.requestAdapter === 'function';
}

export function getDefaultTileBuilderBackend() {
    if (hasWebGPUSupport()) {
        return TILE_BUILDER_BACKEND_WEBGPU_ARRAY;
    }

    return shouldUseWebGL2BuilderByDefault()
        ? TILE_BUILDER_BACKEND_WEBGL
        : TILE_BUILDER_BACKEND_CANVAS;
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