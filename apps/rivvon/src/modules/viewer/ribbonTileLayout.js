const MIN_TILE_WORLD_LENGTH = 0.0001;

function normalizePositiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function buildRibbonTileIntervals({ pathLength = 0, tileWorldLength = 1, maxSegmentCount = null } = {}) {
    const safePathLength = Math.max(0, Number(pathLength) || 0);
    const safeTileWorldLength = normalizePositiveNumber(tileWorldLength, 1);
    const tileLength = Math.max(MIN_TILE_WORLD_LENGTH, safeTileWorldLength);
    const visibleIntervalCount = Math.max(1, Math.ceil(safePathLength / tileLength));
    const allocatedIntervalCount = maxSegmentCount == null
        ? visibleIntervalCount
        : Math.max(1, Math.ceil(Number(maxSegmentCount) || 1));
    const intervals = [];

    for (let tileIndex = 0; tileIndex < allocatedIntervalCount; tileIndex += 1) {
        const tileStartDistance = tileIndex * tileLength;
        const tileEndDistance = tileStartDistance + tileLength;
        const visibleStartDistance = clamp(tileStartDistance, 0, safePathLength);
        const visibleEndDistance = clamp(tileEndDistance, 0, safePathLength);
        const visible = tileStartDistance < safePathLength && visibleEndDistance > visibleStartDistance;
        const uStart = clamp((visibleStartDistance - tileStartDistance) / tileLength, 0, 1);
        const uEnd = clamp((visibleEndDistance - tileStartDistance) / tileLength, 0, 1);

        intervals.push({
            tileIndex,
            tileStartDistance,
            tileEndDistance,
            visibleStartDistance,
            visibleEndDistance,
            visible,
            partialStart: visible && visibleStartDistance > tileStartDistance,
            partialEnd: visible && visibleEndDistance < tileEndDistance,
            uStart,
            uEnd,
        });
    }

    return intervals;
}

export function summarizeRibbonTileIntervals(intervals = []) {
    const visibleIntervals = intervals.filter(interval => interval.visible);
    const finalVisibleInterval = visibleIntervals[visibleIntervals.length - 1] || null;

    return {
        visibleTileCount: visibleIntervals.length,
        totalAllocatedSegmentCount: intervals.length,
        partialFinalTileU: finalVisibleInterval ? finalVisibleInterval.uEnd : 0,
    };
}
