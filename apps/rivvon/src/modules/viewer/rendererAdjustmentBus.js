/**
 * Module singleton that exposes live "drag-time" renderer setters so leaf UI
 * controls (e.g. contrast/saturation sliders in `TextureSettingsControls.vue`)
 * can bypass Pinia/Vue reactivity during continuous input and call the Three.js
 * setters directly. The Pinia store remains the source of truth and is updated
 * only on commit (e.g. slider `@change`/mouseup), which also keeps localStorage
 * persistence and "has changes" indicators consistent.
 *
 * `ThreeCanvas.vue` registers the live setters after the renderer is initialized
 * and clears them on unmount.
 */

const handlers = {
    setContrast: null,
    setSaturation: null,
};

export function registerRendererAdjustments(next = {}) {
    if (typeof next.setContrast === 'function') {
        handlers.setContrast = next.setContrast;
    }
    if (typeof next.setSaturation === 'function') {
        handlers.setSaturation = next.setSaturation;
    }
}

export function clearRendererAdjustments() {
    handlers.setContrast = null;
    handlers.setSaturation = null;
}

export function applyLiveContrast(value) {
    handlers.setContrast?.(value);
}

export function applyLiveSaturation(value) {
    handlers.setSaturation?.(value);
}
