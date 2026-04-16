import { estimateAvailableMemory } from '../../utils/memory-utils.js';

// 64px, 32px, and 16px can be re-enabled by lowering this floor if a future flow
// really needs them, but right now they have diminishing returns for the extra
// derive/upload work they add.
export const MIN_VARIANT_RESOLUTION = 128;
export const BYTES_PER_PIXEL_RGBA = 4;
const MEMORY_GUARD_FRACTION = 0.75;

export function isPowerOfTwo(value) {
    return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

export function normalizeTextureVariantTargetResolutions(sourceResolution = null, targetResolutions = []) {
    const normalizedSourceResolution = Number(sourceResolution);
    const uniqueTargets = new Set();

    for (const candidate of targetResolutions || []) {
        const parsed = Number(candidate);
        if (!Number.isInteger(parsed) || parsed < MIN_VARIANT_RESOLUTION || !isPowerOfTwo(parsed)) {
            continue;
        }
        if (Number.isInteger(normalizedSourceResolution) && normalizedSourceResolution > 0 && parsed >= normalizedSourceResolution) {
            continue;
        }

        uniqueTargets.add(parsed);
    }

    return Array.from(uniqueTargets).sort((left, right) => right - left);
}

export function getTextureVariantTargetResolutionOptions(sourceResolution = null) {
    const normalizedSourceResolution = Number(sourceResolution);

    if (!Number.isInteger(normalizedSourceResolution) || normalizedSourceResolution <= MIN_VARIANT_RESOLUTION) {
        return [];
    }

    const availableTargets = [];

    for (
        let resolution = Math.floor(normalizedSourceResolution / 2);
        resolution >= MIN_VARIANT_RESOLUTION;
        resolution = Math.floor(resolution / 2)
    ) {
        if (!isPowerOfTwo(resolution)) {
            continue;
        }

        availableTargets.push(resolution);
    }

    return normalizeTextureVariantTargetResolutions(normalizedSourceResolution, availableTargets);
}

export function assessTextureVariantDerivationWorkload({
    tileCount = 0,
    tileResolution = 0,
    layerCount = 0,
    targetResolutions = [],
} = {}) {
    const normalizedTileCount = Math.max(0, Number(tileCount) || 0);
    const normalizedTileResolution = Math.max(0, Number(tileResolution) || 0);
    const normalizedLayerCount = Math.max(0, Number(layerCount) || 0);
    const normalizedTargets = normalizeTextureVariantTargetResolutions(normalizedTileResolution, targetResolutions);
    const estimatedAvailableMemoryMb = estimateAvailableMemory();
    const bytesPerTileRgba = normalizedTileResolution > 0 && normalizedLayerCount > 0
        ? normalizedTileResolution * normalizedTileResolution * BYTES_PER_PIXEL_RGBA * normalizedLayerCount
        : 0;
    const estimatedPeakWorkingSetMb = Math.round((bytesPerTileRgba * 1.35) / (1024 * 1024));
    const estimatedFamilyOutputMb = Math.round(normalizedTargets.reduce((total, resolution) => {
        const scaledBytes = resolution * resolution * BYTES_PER_PIXEL_RGBA * normalizedLayerCount;
        return total + ((scaledBytes * normalizedTileCount) / (1024 * 1024));
    }, 0));
    const deviceMemory = typeof navigator !== 'undefined' ? Number(navigator.deviceMemory) || null : null;

    let severity = 'ok';
    let message = 'Variant generation should fit within the current browser memory budget.';

    if (estimatedPeakWorkingSetMb > 0 && estimatedPeakWorkingSetMb > estimatedAvailableMemoryMb * MEMORY_GUARD_FRACTION) {
        severity = 'danger';
        message = 'This job is likely to exceed the available browser memory. Reduce the base resolution or derive fewer variants.';
    } else if (
        normalizedTargets.length > 1
        || (deviceMemory !== null && deviceMemory <= 4)
        || estimatedPeakWorkingSetMb > estimatedAvailableMemoryMb * 0.45
    ) {
        severity = 'warning';
        message = 'This derivation may take a while on lower-memory devices. Keep the tab open and consider generating fewer variants at a time.';
    }

    return {
        severity,
        message,
        targetResolutions: normalizedTargets,
        estimatedAvailableMemoryMb,
        estimatedPeakWorkingSetMb,
        estimatedFamilyOutputMb,
        deviceMemory,
        tileCount: normalizedTileCount,
        tileResolution: normalizedTileResolution,
        layerCount: normalizedLayerCount,
    };
}