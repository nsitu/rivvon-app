import { smoothStrokes } from './strokeSmoothing.js';

export const DEFAULT_CAPTURE_SMOOTHING = Object.freeze({
    rdpEpsilon: 2,
    cuspAngle: 60,
    chaikinIterations: 2,
    splineSegments: 8
});

function isFinitePoint(point) {
    return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

export function finalizeCapturedPaths(rawPaths, options = {}) {
    if (!Array.isArray(rawPaths) || rawPaths.length === 0) {
        return null;
    }

    const validPaths = rawPaths
        .map(path => Array.isArray(path) ? path.filter(isFinitePoint) : [])
        .filter(path => path.length >= 2);

    if (validPaths.length === 0) {
        return null;
    }

    return smoothStrokes(validPaths, {
        ...DEFAULT_CAPTURE_SMOOTHING,
        ...options
    });
}