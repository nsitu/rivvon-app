import { BLEND_MODES } from '../../../../packages/shared-types/src/blendModes.js';
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

    it.each([
        ['artworkTiltHorizontalDegrees', 'artworkTiltVerticalDegrees', 30],
        ['artworkTiltVerticalDegrees', 'artworkTiltHorizontalDegrees', 22.5],
    ])('persists and tracks independent tilt setting %s through reset and presets', (key, otherKey, fallback) => {
        const store = useViewerStore();
        const setter = `set${key[0].toUpperCase()}${key.slice(1)}`;
        const otherValue = store[otherKey];
        store.captureToolsPanelOriginalState();
        store[setter](0);
        expect(store.hasToolsPanelChanges()).toBe(true);
        expect(store.toolsPanelOriginalState[key]).toBe(fallback);
        expect(store.getViewerSettingsSnapshot()[key]).toBe(0);
        expect(store[otherKey]).toBe(otherValue);
        const saved = store.getArtworkSettingsSnapshot();
        expect(saved[key]).toBe(0);
        setActivePinia(createPinia());
        const restored = useViewerStore();
        expect(restored[key]).toBe(0);
        restored.resetToolbarSettingsToDefaults();
        expect(restored[key]).toBe(fallback);
        setActivePinia(createPinia());
        expect(useViewerStore()[key]).toBe(fallback);
        const before = [...preferences];
        restored.applyArtworkSettingsSnapshot(saved);
        expect(restored[key]).toBe(0);
        expect([...preferences]).toEqual(before);
        restored.applyArtworkSettingsSnapshot({});
        expect(restored[key]).toBe(fallback);
        for (const [value, expected] of [[-1, 0], [91, 90], [12.5, 12.5], [NaN, fallback], [undefined, fallback]]) {
            restored[setter](value);
            expect(restored[key]).toBe(expected);
        }
    });

    it('persists independent artwork blending through preferences, Tools tracking, presets and reset', () => {
        const app = useViewerStore();
        expect(app.artworkBlendMode).toBe('normal'); app.captureToolsPanelOriginalState();
        app.setArtworkBlendMode('softLight');
        expect(app.hasToolsPanelChanges()).toBe(true);
        expect(app.toolsPanelOriginalState.artworkBlendMode).toBe('normal');
        expect(app.backgroundTextureBlendMode).toBe('softLight');
        const saved = app.getArtworkSettingsSnapshot(); expect(saved.artworkBlendMode).toBe('softLight');
        setActivePinia(createPinia()); const restored = useViewerStore();
        expect(restored.artworkBlendMode).toBe('softLight'); restored.resetToolbarSettingsToDefaults();
        expect(restored.artworkBlendMode).toBe('normal');
        const previousPreferences = [...preferences]; restored.applyArtworkSettingsSnapshot(saved);
        expect(restored.artworkBlendMode).toBe('softLight'); expect([...preferences]).toEqual(previousPreferences);
        restored.applyArtworkSettingsSnapshot({}); expect(restored.artworkBlendMode).toBe('normal');
    });

    it.each(BLEND_MODES.filter(mode => mode !== 'normal'))('persists independent %s modes across reloads and presets', mode => {
        const app = useViewerStore();
        app.setArtworkBlendMode(mode); app.setBackgroundTextureBlendMode(mode);
        const saved = app.getArtworkSettingsSnapshot();
        setActivePinia(createPinia());
        const restored = useViewerStore();
        expect(restored.artworkBlendMode).toBe(mode);
        expect(restored.backgroundTextureBlendMode).toBe(mode);
        restored.resetToolbarSettingsToDefaults();
        expect(restored.artworkBlendMode).toBe('normal');
        expect(restored.backgroundTextureBlendMode).toBe('softLight');
        restored.applyArtworkSettingsSnapshot(saved);
        expect(restored.artworkBlendMode).toBe(mode);
        expect(restored.backgroundTextureBlendMode).toBe(mode);
        restored.setArtworkBlendMode('invalid'); restored.setBackgroundTextureBlendMode('invalid');
        expect(restored.artworkBlendMode).toBe('normal');
        expect(restored.backgroundTextureBlendMode).toBe('softLight');
    });

    it('persists clip timing, detects timing-only Tools changes, and restores/reset snapshots', () => {
        const store = useViewerStore(); store.setBackgroundTextureSource({ kind: 'clip', id: 'clip-123' });
        store.captureToolsPanelOriginalState(); store.setBackgroundClipPlaybackMode('alignLoop');
        expect(store.hasToolsPanelChanges()).toBe(true);
        const saved = store.getArtworkSettingsSnapshot();
        expect(saved.backgroundClipPlaybackMode).toBe('alignLoop');
        expect(saved).not.toHaveProperty('backgroundClipDuration');
        setActivePinia(createPinia()); const restored = useViewerStore();
        expect(restored.backgroundClipPlaybackMode).toBe('alignLoop');
        expect(restored.backgroundTextureSource).toEqual({ kind: 'clip', id: 'clip-123' });
        restored.resetToolbarSettingsToDefaults(); expect(restored.backgroundClipPlaybackMode).toBe('native');
        restored.applyArtworkSettingsSnapshot(saved); expect(restored.backgroundClipPlaybackMode).toBe('alignLoop');
    });
    it('persists image selection and blend independently, includes them in Tools snapshots and resets them', () => {
        const store = useViewerStore();
        store.captureToolsPanelOriginalState();
        store.setBackgroundTextureSource({ kind: 'image', id: 'uploaded-image' }, { presetId: 'source-preset' });
        store.setBackgroundTextureBlendMode('normal');
        expect(store.hasToolsPanelChanges()).toBe(true);
        expect(store.toolsPanelOriginalState.backgroundTextureSource).toEqual({ kind: 'builtin', id: 'card' });
        const artwork = store.getArtworkSettingsSnapshot();
        expect(artwork.backgroundTextureSource).toEqual({ kind: 'image', id: 'uploaded-image' });
        expect(artwork.backgroundTextureBlendMode).toBe('normal');
        expect(artwork).not.toHaveProperty('backgroundImagePresetId');
        setActivePinia(createPinia());
        const restored = useViewerStore();
        expect(restored.backgroundImagePresetId).toBe('source-preset');
        expect(restored.backgroundTextureSource).toEqual(artwork.backgroundTextureSource);
        restored.setBackgroundTextureEnabled(false);
        expect(restored.backgroundTextureSource).toEqual(artwork.backgroundTextureSource);
        restored.resetToolbarSettingsToDefaults();
        expect(restored.backgroundTextureBlendMode).toBe('softLight');
        expect(restored.backgroundTextureSource).toEqual({ kind: 'builtin', id: 'card' });
    });

    it.each(['gradientMapMix', 'backgroundTextureGradientMapMix', 'artworkBlendStrength', 'backgroundTextureBlendStrength'])('persists and restores independent %s including zero and legacy defaults', key => {
        const store = useViewerStore();
        const setter = `set${key[0].toUpperCase()}${key.slice(1)}`;
        const otherKey = key === 'gradientMapMix' ? 'backgroundTextureGradientMapMix' : 'gradientMapMix';
        expect(store[key]).toBe(1);
        store.captureToolsPanelOriginalState();
        store[setter](0);
        expect(store.hasToolsPanelChanges()).toBe(true);
        expect(store.toolsPanelOriginalState[key]).toBe(1);
        expect(store.getViewerSettingsSnapshot()[key]).toBe(0);
        const saved = store.getArtworkSettingsSnapshot();
        expect(saved[key]).toBe(0);
        expect(store[otherKey]).toBe(1);
        setActivePinia(createPinia());
        const restored = useViewerStore();
        expect(restored[key]).toBe(0);
        restored.resetToolbarSettingsToDefaults();
        expect(restored[key]).toBe(1);
        setActivePinia(createPinia());
        expect(useViewerStore()[key]).toBe(1);
        const before = [...preferences];
        restored.applyArtworkSettingsSnapshot(saved);
        expect(restored[key]).toBe(0);
        expect([...preferences]).toEqual(before);
        restored.applyArtworkSettingsSnapshot({});
        expect(restored[key]).toBe(1);
        for (const [value, expected] of [[0.5, 0.5], [-1, 0], [2, 1], [NaN, 1], [undefined, 1]]) {
            restored[setter](value);
            expect(restored[key]).toBe(expected);
        }
    });

    it.each([
        ['backgroundTextureGradientMapEnabled', true],
        ['backgroundTextureGradientMapStops', [{ id: 'dark', position: 0, color: '#123456' }, { id: 'light', position: 1, color: '#abcdef' }]],
        ['backgroundTextureContrast', 1.7],
        ['backgroundTextureSaturation', 0.3],
        ['backgroundTextureVerticalAlignment', 0.2],
    ])('persists, tracks, and restores independent static texture setting %s', (key, value) => {
        const store = useViewerStore();
        const original = store.getArtworkSettingsSnapshot();
        store.captureToolsPanelOriginalState();
        store[`set${key[0].toUpperCase()}${key.slice(1)}`](value);
        expect(store.hasToolsPanelChanges()).toBe(true);
        expect(store.getViewerSettingsSnapshot()[key]).toEqual(value);
        expect(store.toolsPanelOriginalState[key]).toEqual(original[key]);
        const saved = store.getArtworkSettingsSnapshot();
        expect(saved[key]).toEqual(value);
        expect(saved.contrast).toBe(1);
        expect(saved.saturation).toBe(1);
        expect(saved.renderFilterMode).toBe('none');
        expect(saved.gradientMapStops).toEqual(original.gradientMapStops);
        setActivePinia(createPinia());
        const restored = useViewerStore();
        expect(restored[key]).toEqual(value);
        restored.resetToolbarSettingsToDefaults();
        expect(restored[key]).toEqual(original[key]);
        setActivePinia(createPinia());
        expect(useViewerStore()[key]).toEqual(original[key]);
        const before = [...preferences];
        restored.applyArtworkSettingsSnapshot(saved);
        expect(restored[key]).toEqual(value);
        expect([...preferences]).toEqual(before);
        restored.applyArtworkSettingsSnapshot({});
        if (key === 'backgroundTextureGradientMapStops') {
            expect(restored[key].map(({ id, ...stop }) => stop)).toEqual(original[key].map(({ id, ...stop }) => stop));
        } else expect(restored[key]).toEqual(original[key]);
    });

    it('clamps static texture adjustments independently and preserves Cenote in presets', () => {
        const store = useViewerStore();
        store.setBackgroundTexture('cenote');
        store.setBackgroundTextureContrast(99);
        store.setBackgroundTextureSaturation(-1);
        expect(store.getArtworkSettingsSnapshot()).toMatchObject({
            backgroundTexture: 'cenote', backgroundTextureContrast: 2, backgroundTextureSaturation: 0,
        });
        store.setBackgroundTextureContrast(NaN);
        store.setBackgroundTextureSaturation(Infinity);
        expect(store.backgroundTextureContrast).toBe(1);
        expect(store.backgroundTextureSaturation).toBe(1);
        store.setBackgroundTextureVerticalAlignment(99);
        expect(store.backgroundTextureVerticalAlignment).toBe(1);
        store.setBackgroundTextureVerticalAlignment(-1);
        expect(store.backgroundTextureVerticalAlignment).toBe(0);
        store.setBackgroundTextureVerticalAlignment(NaN);
        expect(store.backgroundTextureVerticalAlignment).toBe(0.5);
    });

    it.each([256, 512, 'full'])('persists the %s projection preview choice as a device preference', resolution => {
        const store = useViewerStore();
        expect(store.sceneProjectionPreviewResolution).toBe(512);
        store.captureToolsPanelOriginalState();
        store.setSceneProjectionPreviewResolution(resolution);
        expect(store.getViewerSettingsSnapshot().sceneProjectionPreviewResolution).toBe(resolution);
        expect(store.toolsPanelOriginalState.sceneProjectionPreviewResolution).toBe(512);
        expect(store.getArtworkSettingsSnapshot()).not.toHaveProperty('sceneProjectionPreviewResolution');
        setActivePinia(createPinia());
        const restored = useViewerStore();
        expect(restored.sceneProjectionPreviewResolution).toBe(resolution);
        restored.applyArtworkSettingsSnapshot({});
        expect(restored.sceneProjectionPreviewResolution).toBe(resolution);
        restored.resetToolbarSettingsToDefaults();
        setActivePinia(createPinia());
        expect(useViewerStore().sceneProjectionPreviewResolution).toBe(512);
    });

    it('defaults touch projection previews to 256 and normalizes invalid stored choices', () => {
        window.matchMedia = () => ({ matches: true });
        preferences.set('rivvon.viewer.preferences', JSON.stringify({ sceneProjectionPreviewResolution: 1024 }));
        const store = useViewerStore();
        expect(store.sceneProjectionPreviewResolution).toBe(256);
        expect(store.setSceneProjectionPreviewResolution('full')).toBe('full');
        expect(store.setSceneProjectionPreviewResolution('invalid')).toBe(256);
        store.resetToolbarSettingsToDefaults();
        expect(store.sceneProjectionPreviewResolution).toBe(256);
    });

    it('persists gradient controls, round-trips artwork, and restores texture mode for older presets', () => {
        const store = useViewerStore();
        store.captureToolsPanelOriginalState();
        store.setBackgroundMode('gradient');
        store.setBackgroundGradientInfluence(0.75);
        store.setBackgroundGradientFalloff(3);
        expect(store.hasToolsPanelChanges()).toBe(true);
        const saved = store.getArtworkSettingsSnapshot();
        expect(saved).toMatchObject({ backgroundMode: 'gradient', backgroundGradientInfluence: 0.75, backgroundGradientFalloff: 3 });
        setActivePinia(createPinia());
        const restored = useViewerStore();
        expect(restored.getArtworkSettingsSnapshot()).toMatchObject(saved);
        restored.resetToolbarSettingsToDefaults();
        expect(restored.backgroundMode).toBe('texture');
        restored.applyArtworkSettingsSnapshot(saved);
        expect(restored.backgroundMode).toBe('gradient');
        restored.applyArtworkSettingsSnapshot({});
        expect(restored.backgroundMode).toBe('texture');
        restored.setBackgroundGradientInfluence(0);
        restored.setBackgroundGradientFalloff(100);
        expect(restored.backgroundGradientInfluence).toBe(0.15);
        expect(restored.backgroundGradientFalloff).toBe(6);
    });

    it.each(['Horizontal', 'Vertical'])('persists and resets the independent %s background flip', (axis) => {
        const key = `backgroundFlip${axis}`;
        const otherKey = `backgroundFlip${axis === 'Horizontal' ? 'Vertical' : 'Horizontal'}`;
        const store = useViewerStore();
        expect(store[key]).toBe(false);
        store.captureToolsPanelOriginalState();
        store[`setBackgroundFlip${axis}`](true);
        expect(store.hasToolsPanelChanges()).toBe(true);
        expect(store[otherKey]).toBe(false);
        const saved = store.getArtworkSettingsSnapshot();
        expect(saved[key]).toBe(true);
        setActivePinia(createPinia());
        const restored = useViewerStore();
        expect(restored.getViewerSettingsSnapshot()[key]).toBe(true);
        restored.resetToolbarSettingsToDefaults();
        expect(restored[key]).toBe(false);
        setActivePinia(createPinia());
        expect(useViewerStore()[key]).toBe(false);
        restored.applyArtworkSettingsSnapshot(saved);
        expect(restored[key]).toBe(true);
        expect(restored[otherKey]).toBe(false);
        restored.applyArtworkSettingsSnapshot({});
        expect(restored[key]).toBe(false);
    });

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
