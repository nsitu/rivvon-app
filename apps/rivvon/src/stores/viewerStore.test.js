import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useViewerStore } from './viewerStore.js';

describe('viewer preferences', () => {
    let preferences;

    beforeEach(() => {
        preferences = new Map();
        vi.stubGlobal('window', {
            localStorage: {
                getItem: (key) => preferences.get(key) ?? null,
                setItem: (key, value) => preferences.set(key, value),
            },
        });
        setActivePinia(createPinia());
    });

    afterEach(() => vi.unstubAllGlobals());

    it('persists background timing, tracks changes, and resets to synchronized playback', () => {
        const store = useViewerStore();
        expect(store.backgroundAnimationSyncEnabled).toBe(true);
        store.captureToolsPanelOriginalState();
        store.setBackgroundAnimationSyncEnabled(false);
        store.setBackgroundCycleDuration(36);
        expect(store.hasToolsPanelChanges()).toBe(true);
        expect(store.getArtworkSettingsSnapshot()).toMatchObject({
            backgroundAnimationSyncEnabled: false, backgroundCycleDuration: 36,
        });
        setActivePinia(createPinia());
        const restored = useViewerStore();
        expect(restored.getViewerSettingsSnapshot()).toMatchObject({
            backgroundAnimationSyncEnabled: false, backgroundCycleDuration: 36,
        });
        expect(restored.setBackgroundCycleDuration(Infinity)).toBe(12);
        expect(restored.setBackgroundCycleDuration(500)).toBe(120);
        expect(restored.setBackgroundCycleDuration(0)).toBe(0.25);
        restored.applyArtworkSettingsSnapshot({ backgroundAnimationSyncEnabled: false, backgroundCycleDuration: 24 });
        expect(restored.backgroundCycleDuration).toBe(24);
        restored.applyArtworkSettingsSnapshot({});
        expect(restored.backgroundAnimationSyncEnabled).toBe(true);
        expect(restored.backgroundCycleDuration).toBe(12);
    });

    it('restores saturation transparency, range, and reverse after reload', () => {
        const store = useViewerStore();
        store.setTransparencyMethod('saturation');
        store.setTransparencyMode('highlights');
        store.setTransparentShadowsThresholdRange([0.2, 0.6]);

        setActivePinia(createPinia());
        const restored = useViewerStore();
        expect(restored.transparencyMethod).toBe('saturation');
        expect(restored.transparencyMode).toBe('highlights');
        expect(restored.transparentShadowsThresholdMin).toBe(0.2);
        expect(restored.transparentShadowsThresholdMax).toBe(0.6);
        expect(restored.captureToolsPanelOriginalState({ store: false })).toMatchObject({
            transparencyMethod: 'saturation',
            transparencyMode: 'highlights',
            transparentShadowsThresholdMin: 0.2,
            transparentShadowsThresholdMax: 0.6,
        });
    });

    it('retains the brightness default for missing or unsupported methods', () => {
        expect(useViewerStore().transparencyMethod).toBe('brightness');
        useViewerStore().setTransparencyMethod('unknown');
        setActivePinia(createPinia());
        expect(useViewerStore().transparencyMethod).toBe('brightness');
    });

    it('persists filmstrip motion and captures it in viewer settings', () => {
        const store = useViewerStore();
        expect(store.filmstripMotionEnabled).toBe(false);
        expect(store.filmstripMotionSpeed).toBe(1);
        store.captureToolsPanelOriginalState();
        store.setFilmstripMotionEnabled(true);
        store.setFilmstripMotionSpeed(1.7);
        expect(store.hasToolsPanelChanges()).toBe(true);
        setActivePinia(createPinia());
        expect(useViewerStore().captureToolsPanelOriginalState({ store: false })).toMatchObject({
            filmstripMotionEnabled: true,
            filmstripMotionSpeed: 1.7,
        });
    });

    it('resets filmstrip motion and normalizes unsupported speeds', () => {
        const store = useViewerStore();
        expect(store.setFilmstripMotionSpeed(Infinity)).toBe(1);
        expect(store.setFilmstripMotionSpeed(-1)).toBe(0.1);
        expect(store.setFilmstripMotionSpeed(20)).toBe(3);
        store.setFilmstripMotionEnabled(true);
        store.resetToolbarSettingsToDefaults();
        setActivePinia(createPinia());
        expect(useViewerStore().filmstripMotionEnabled).toBe(false);
        expect(useViewerStore().filmstripMotionSpeed).toBe(1);
    });
});
