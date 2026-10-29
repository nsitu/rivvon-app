export const DEFAULT_ARTWORK_TILT_HORIZONTAL_DEGREES = 30;
export const DEFAULT_ARTWORK_TILT_VERTICAL_DEGREES = 22.5;
export const MIN_ARTWORK_TILT_DEGREES = 0;
export const MAX_ARTWORK_TILT_DEGREES = 90;

export function normalizeArtworkTiltDegrees(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(MIN_ARTWORK_TILT_DEGREES, Math.min(MAX_ARTWORK_TILT_DEGREES, value))
        : fallback;
}
