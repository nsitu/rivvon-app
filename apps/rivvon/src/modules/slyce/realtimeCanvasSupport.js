function isLikelyIOSOrSafari() {
    if (typeof navigator === 'undefined') return false;

    const ua = navigator.userAgent || '';
    const isIOSDevice = /iPad|iPhone|iPod/.test(ua)
        || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 0);
    const isSafariBrowser = /Safari/.test(ua)
        && !/(Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS)/.test(ua);

    return isIOSDevice || isSafariBrowser;
}

function getRealtimeSamplingOverride() {
    if (typeof window === 'undefined') return null;

    try {
        const params = new URLSearchParams(window.location.search);
        const queryValue = params.get('realtimeSamplingSource');
        if (queryValue === 'staging' || queryValue === 'direct') {
            return queryValue;
        }
    } catch {
        // Ignore malformed URLs and fall back to storage/defaults.
    }

    try {
        const storedValue = window.localStorage?.getItem('rivvon:realtimeSamplingSource');
        if (storedValue === 'staging' || storedValue === 'direct') {
            return storedValue;
        }
    } catch {
        // Ignore storage access errors.
    }

    return null;
}

export function getRealtimeSamplingSourceMode() {
    const override = getRealtimeSamplingOverride();
    if (override) {
        return override === 'staging' ? 'staging-canvas' : 'direct-frame';
    }
    return isLikelyIOSOrSafari() ? 'staging-canvas' : 'direct-frame';
}

export function shouldUseDomCanvasForRealtime() {
    return isLikelyIOSOrSafari();
}

export function shouldUseStagingCanvasForRealtimeSampling() {
    return getRealtimeSamplingSourceMode() === 'staging-canvas';
}

export function createRealtimeCanvas(width, height) {
    const preferDomCanvas = shouldUseDomCanvasForRealtime();

    if (!preferDomCanvas && typeof OffscreenCanvas !== 'undefined') {
        try {
            const canvas = new OffscreenCanvas(width, height);
            const ctx = canvas.getContext('2d');
            if (ctx) {
                return { canvas, ctx };
            }
        } catch (error) {
            console.warn('[RealtimeCanvas] OffscreenCanvas unavailable, falling back to DOM canvas:', error);
        }
    }

    if (typeof document === 'undefined') {
        throw new Error('DOM canvas fallback is unavailable in this environment.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
        throw new Error('Failed to acquire a 2D canvas context for realtime capture.');
    }

    return { canvas, ctx };
}