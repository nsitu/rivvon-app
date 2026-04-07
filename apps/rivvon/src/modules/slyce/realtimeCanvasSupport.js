function isLikelyIOSOrSafari() {
    if (typeof navigator === 'undefined') return false;

    const ua = navigator.userAgent || '';
    const isIOSDevice = /iPad|iPhone|iPod/.test(ua)
        || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 0);
    const isSafariBrowser = /Safari/.test(ua)
        && !/(Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS)/.test(ua);

    return isIOSDevice || isSafariBrowser;
}

export function shouldUseDomCanvasForRealtime() {
    return isLikelyIOSOrSafari();
}

export function shouldUseStagingCanvasForRealtimeSampling() {
    return isLikelyIOSOrSafari();
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