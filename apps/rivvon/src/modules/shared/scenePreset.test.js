import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useViewerStore } from '../../stores/viewerStore.js';
import { ARTWORK_DEFAULTS, normalizeScenePreset } from '../../../../../packages/shared-types/src/scenePreset.js';

export function sampleScene() {
    return { schemaVersion: 1, geometry: { paths: [[{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }]], kind: 'gesture', title: 'Ribbon', width: 1.2 },
        artwork: { ...ARTWORK_DEFAULTS }, textures: [{ id: 'texture', name: 'Texture', tileCount: 1, tileResolution: 512, layerCount: 60, variant: 'waves' }],
        camera: { position: [0, 0, 5], target: [0, 0, 0], up: [0, 1, 0], quaternion: [0, 0, 0, 1], fov: 45 } };
}

describe('scene preset contract', () => {
    it('round trips the grid recipe without expanding saved source paths and defaults older presets off', () => {
        const input = sampleScene();
        input.artwork = { gridRepeatEnabled: true, gridRepeatRows: 2, gridRepeatColumns: 3, gridRepeatCheckerboard: true, gridRepeatColumnSpacing: -5, gridRepeatRowSpacing: -2.35 };
        const saved = normalizeScenePreset(input);
        expect(saved.geometry.paths).toHaveLength(1);
        expect(saved.artwork).toMatchObject(input.artwork);
        expect(normalizeScenePreset(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
        const legacy = sampleScene();
        legacy.artwork = {};
        expect(normalizeScenePreset(legacy).artwork).toMatchObject({ gridRepeatEnabled: false, gridRepeatRows: 3, gridRepeatColumns: 3, gridRepeatCheckerboard: false, gridRepeatColumnSpacing: 1, gridRepeatRowSpacing: 1 });
        expect(normalizeScenePreset({ ...input, artwork: { gridRepeatEnabled: true } }).artwork).toMatchObject({ gridRepeatColumnSpacing: 1, gridRepeatRowSpacing: 1 });
    });

    it.each([0, 13, 2.5, NaN, Infinity, '3'])('rejects invalid persisted grid counts: %s', value => {
        for (const key of ['gridRepeatRows', 'gridRepeatColumns']) {
            const input = sampleScene();
            input.artwork[key] = value;
            expect(() => normalizeScenePreset(input)).toThrow(`Invalid ${key}`);
        }
    });

    it.each([-5.05, 5.05, NaN, Infinity, '1'])('rejects invalid persisted grid spacing: %s', value => {
        for (const key of ['gridRepeatRowSpacing', 'gridRepeatColumnSpacing']) {
            const input = sampleScene();
            input.artwork[key] = value;
            expect(() => normalizeScenePreset(input)).toThrow(`Invalid ${key}`);
        }
    });

    it.each(['gridRepeatRowSpacing', 'gridRepeatColumnSpacing'])('tracks %s changes independently and restores the setting', key => {
        const store = useViewerStore();
        store.captureToolsPanelOriginalState();
        store.setGridRepeatSpacing(key, 2.35);
        expect(store.hasToolsPanelChanges()).toBe(true);
        const saved = store.getArtworkSettingsSnapshot();
        expect(store.getViewerSettingsSnapshot()[key]).toBe(2.35);
        store.resetToolbarSettingsToDefaults();
        expect(store[key]).toBe(1);
        store.applyArtworkSettingsSnapshot(saved);
        expect(store[key]).toBe(2.35);
    });

    it('persists zero-height artwork aspect ratios', () => {
        const input = sampleScene();
        input.artwork.sphericalProjectionArtworkAspectRatio = 0;
        expect(normalizeScenePreset(input).artwork.sphericalProjectionArtworkAspectRatio).toBe(0);
    });
    it('retains SVG anchors, closure and interpretation while validating portable node data', () => {
        const scene = sampleScene();
        scene.geometry.kind = 'svg';
        scene.geometry.source = { fileName: 'triangle.svg', svgSmoothNodesEnabled: true,
            svgNodes: [{ closed: true, points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }] }] };
        scene.artwork.svgSmoothNodesEnabled = true;
        const saved = normalizeScenePreset(scene);
        expect(saved.geometry.source.svgNodes[0].closed).toBe(true);
        expect(saved.geometry.source.svgNodes[0].points[0]).toEqual({ x: 0, y: 0, z: 0 });
        expect(saved.artwork.svgSmoothNodesEnabled).toBe(true);
        expect(saved.geometry.source.svgSmoothNodesEnabled).toBe(true);
        expect(normalizeScenePreset(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
        scene.geometry.source.svgNodes[0].points[0].x = Infinity;
        expect(() => normalizeScenePreset(scene)).toThrow('Invalid SVG node coordinate');
        expect(normalizeScenePreset(sampleScene()).artwork.svgSmoothNodesEnabled).toBe(false);
    });
    let preferences;
    beforeEach(() => {
        preferences = new Map();
        vi.stubGlobal('window', { localStorage: { getItem: key => preferences.get(key) || null, setItem: (key, value) => preferences.set(key, value) } });
        setActivePinia(createPinia());
    });
    afterEach(() => vi.unstubAllGlobals());

    it('tracks grid settings in Tools changes, snapshots, default reset, and artwork restoration', () => {
        const store = useViewerStore();
        store.captureToolsPanelOriginalState();
        store.setGridRepeatEnabled(true);
        store.setGridRepeatCount('gridRepeatRows', 2);
        store.setGridRepeatCount('gridRepeatColumns', 4);
        store.setGridRepeatCheckerboard(true);
        expect(store.hasToolsPanelChanges()).toBe(true);
        const saved = store.getArtworkSettingsSnapshot();
        expect(store.getViewerSettingsSnapshot()).toMatchObject({ gridRepeatEnabled: true, gridRepeatRows: 2, gridRepeatColumns: 4, gridRepeatCheckerboard: true });
        const before = [...preferences];
        store.resetToolbarSettingsToDefaults();
        expect(store.gridRepeatEnabled).toBe(false);
        expect(store.gridRepeatRows).toBe(3);
        const resetPreferences = [...preferences];
        store.applyArtworkSettingsSnapshot(saved);
        expect(store.gridRepeatRows).toBe(2);
        expect(store.gridRepeatCheckerboard).toBe(true);
        expect([...preferences]).toEqual(resetPreferences);
        expect(before).toEqual([]);
    });

    it('round trips artwork without capturing or changing device preferences or localStorage', () => {
        const store = useViewerStore();
        store.setContrast(1.8);
        store.setCapStyle('swallowtail');
        store.tubeTextureJoinOffsetDegrees = 120;
        store.sceneColoredShadowsEnabled = true;
        const saved = store.getArtworkSettingsSnapshot();
        expect(saved).not.toHaveProperty('rendererType');
        expect(saved).not.toHaveProperty('preferredTextureMaxResolution');
        expect(saved).not.toHaveProperty('screenWakeLockEnabled');
        expect(saved).not.toHaveProperty('viewerControlMode');
        const before = [...preferences];
        store.$patch({ contrast: 0.4, rendererType: 'webgpu', screenWakeLockEnabled: false, preferredTextureMaxResolution: 256, viewerControlMode: 'mouseTilt' });
        store.applyArtworkSettingsSnapshot({ ...saved, rendererType: 'webgl', screenWakeLockEnabled: true });
        expect(store.contrast).toBe(1.8);
        expect(store.capStyle).toBe('swallowtail');
        expect(store.tubeTextureJoinOffsetDegrees).toBe(120);
        expect(store.sceneColoredShadowsEnabled).toBe(true);
        expect(store.rendererType).toBe('webgpu');
        expect(store.viewerControlMode).toBe('mouseTilt');
        expect(store.screenWakeLockEnabled).toBe(false);
        expect(store.preferredTextureMaxResolution).toBe(256);
        expect([...preferences]).toEqual(before);
    });

    it('clones saved paths, stops and source settings, with fixed defaults for absent artwork values', () => {
        const input = sampleScene();
        input.geometry.source = { text: 'Hello' };
        input.artwork = { contrast: 1.5 };
        const saved = normalizeScenePreset(input);
        input.geometry.paths[0][0].x = 50;
        input.geometry.source.text = 'Changed';
        expect(saved.geometry.paths[0][0].x).toBe(0);
        expect(saved.geometry.source.text).toBe('Hello');
        expect(saved.artwork.filmstripAperture).toBe(0.23);
        expect(saved.artwork.contrast).toBe(1.5);
        expect(normalizeScenePreset(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    });

    it('rejects unknown versions, incomplete assets and malformed camera/geometry before restoration', () => {
        expect(() => normalizeScenePreset({ ...sampleScene(), schemaVersion: 999 })).toThrow('version');
        expect(() => normalizeScenePreset({ ...sampleScene(), textures: [] })).toThrow('textures');
        const input = sampleScene(); input.camera.fov = Infinity;
        expect(() => normalizeScenePreset(input)).toThrow('field of view');
        input.camera.fov = 45; input.geometry.paths[0][0].x = NaN;
        expect(() => normalizeScenePreset(input)).toThrow('point');
    });

    it('retains fractional artwork motion rates and usable gradient stop identifiers', () => {
        const input = sampleScene(); input.artwork.viewerMotionLoopCount = 1 / 3;
        input.artwork.gradientMapStops = [{ id: 'same', position: 0, color: '#000000' }, { id: 'same', position: 1, color: '#ffffff' }];
        const saved = normalizeScenePreset(input);
        expect(saved.artwork.viewerMotionLoopCount).toBe(1 / 3);
        expect(new Set(saved.artwork.gradientMapStops.map(stop => stop.id)).size).toBe(2);
    });

    it('discards credentials and URLs from authoring metadata and rejects excessive render complexity', () => {
        const input = sampleScene(); input.geometry.source = { text: 'Hello', accessToken: 'secret', url: 'https://example.test', settings: { radius: 2, refreshToken: 'secret' } };
        expect(normalizeScenePreset(input).geometry.source).toEqual({ text: 'Hello', settings: { radius: 2 } });
        input.artwork.tubeRadialSegments = 100000;
        expect(() => normalizeScenePreset(input)).toThrow('tubeRadialSegments');
    });
});
