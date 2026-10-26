import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { shallowRef } from 'vue';
import { MeshBasicMaterial, Scene, Vector3 } from 'three';
import { useViewerStore } from '../../stores/viewerStore.js';
import { useRibbonBuilder } from './useRibbonBuilder.js';

let ctx;
let material;
beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: vi.fn() } });
    setActivePinia(createPinia());
    material = new MeshBasicMaterial();
    const manager = { getMaterial: () => material, getOrCreateMaterialForSegment: () => material, clearFlowMaterialCache: vi.fn() };
    ctx = {
        app: useViewerStore(), scene: shallowRef(new Scene()), tileManager: shallowRef(manager), tileManagers: shallowRef([]),
        ribbon: shallowRef(null), ribbonSeries: shallowRef(null),
        cinematicCamera: { clearROIs: vi.fn(), invalidateAutoROIs: vi.fn() },
    };
    ctx.app.undulationEnabled = false;
    ctx.app.normalizeTextureOrientation = false;
});
afterEach(() => { ctx.ribbonSeries.value?.dispose(); material.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const point = (x, y) => new Vector3(x, y, 0);
const paths = () => [[point(-2, -1), point(0, 1), point(2, -1)]];

describe('grid repeat source lifecycle', () => {
    it('preserves counts through texture rebuilds and updates auto latitude from the effective grid', async () => {
        const builder = useRibbonBuilder(ctx);
        ctx.app.$patch({ gridRepeatEnabled: true, gridRepeatRows: 2, gridRepeatColumns: 3, gridRepeatCheckerboard: true, sphericalProjectionEnabled: true });
        const series = await builder.createRibbonSeries(paths(), { width: 0.3 });
        expect(series.ribbons).toHaveLength(6);
        expect(ctx.app.sphericalProjectionArtworkAspectRatio).toBeCloseTo(4.3 / 12.6);
        const geometry = series.lastPathsPoints;
        builder.rebuildRibbonsWithNewTextures();
        expect(series.lastPathsPoints).toEqual(geometry);
        expect(series.sourcePathsPoints).toEqual(paths());
        ctx.app.setGridRepeatCount('gridRepeatRows', 3);
        expect(builder.setHelixMode(ctx.app.helixOptions)).toBe(true);
        expect(series.ribbons).toHaveLength(9);
        expect(ctx.app.sphericalProjectionArtworkAspectRatio).toBeCloseTo(6.6 / 12.6);
        expect(ctx.app.sphericalProjectionUpperLatitudeDegrees).toBeCloseTo(100 * (6.6 / 12.6) / 2);
        expect(ctx.cinematicCamera.invalidateAutoROIs).toHaveBeenCalledOnce();
        ctx.app.setSphericalProjectionLatitudeBounds([10, 40]);
        builder.setHelixMode(ctx.app.helixOptions);
        ctx.app.setGridRepeatCount('gridRepeatColumns', 2);
        builder.setHelixMode(ctx.app.helixOptions);
        expect(ctx.app.sphericalProjectionVerticalWrapAuto).toBe(false);
        expect(ctx.app.sphericalProjectionLowerLatitudeDegrees).toBe(10);
        expect(ctx.app.sphericalProjectionUpperLatitudeDegrees).toBe(40);
    });

    it('keeps stored dormant settings without rebuilding and restores the source when disabled', async () => {
        const builder = useRibbonBuilder(ctx);
        const series = await builder.createRibbonSeries(paths(), { width: 0.3 });
        // First normalize the options to the store's effective disabled recipe.
        builder.setHelixMode(ctx.app.helixOptions);
        const rebuild = vi.spyOn(series, 'rebuildUpdate');
        ctx.app.setGridRepeatCount('gridRepeatRows', 2);
        ctx.app.setGridRepeatCount('gridRepeatColumns', 2);
        builder.setHelixMode(ctx.app.helixOptions);
        expect(rebuild).not.toHaveBeenCalled();
        ctx.app.setGridRepeatEnabled(true);
        builder.setHelixMode(ctx.app.helixOptions);
        expect(series.ribbons).toHaveLength(4);
        ctx.app.setGridRepeatEnabled(false);
        builder.setHelixMode(ctx.app.helixOptions);
        expect(series.lastPathsPoints).toEqual(paths());
        expect(ctx.app.gridRepeatRows).toBe(2);
        expect(ctx.app.gridRepeatColumns).toBe(2);
    });

    it('rolls back rejected geometry settings while retaining meshes and shared materials', async () => {
        const builder = useRibbonBuilder(ctx);
        const series = await builder.createRibbonSeries(paths(), { width: 0.3 });
        builder.setHelixMode(ctx.app.helixOptions);
        const previous = series.ribbons[0];
        const dispose = vi.spyOn(previous, 'dispose');
        const clearCache = ctx.tileManager.value.clearFlowMaterialCache;
        clearCache.mockClear();
        ctx.app.$patch({ gridRepeatEnabled: true, gridRepeatRows: 12, gridRepeatColumns: 12, ribbonWidthScale: 0.1 });
        expect(builder.setHelixMode(ctx.app.helixOptions)).toBe(false);
        expect(series.ribbons[0]).toBe(previous);
        expect(dispose).not.toHaveBeenCalled();
        expect(clearCache).not.toHaveBeenCalled();
        expect(ctx.app.gridRepeatEnabled).toBe(false);
        expect(ctx.app.ribbonWidthScale).toBe(1);
        expect(ctx.app.gridRepeatError).toContain('too complex');
        expect(ctx.app.getArtworkSettingsSnapshot().gridRepeatEnabled).toBe(false);
    });

    it('preflights a replacement artwork before disposing the current scene or clearing its cache', async () => {
        const builder = useRibbonBuilder(ctx);
        const series = await builder.createRibbonSeries(paths(), { width: 0.3 });
        const dispose = vi.spyOn(series, 'dispose');
        ctx.tileManager.value.clearFlowMaterialCache.mockClear();
        const childCount = ctx.scene.value.children.length;
        ctx.app.$patch({ gridRepeatEnabled: true, gridRepeatRows: 12, gridRepeatColumns: 12 });
        await expect(builder.createRibbonSeries(paths(), { width: 0.001 })).rejects.toThrow('too complex');
        expect(ctx.ribbonSeries.value).toBe(series);
        expect(dispose).not.toHaveBeenCalled();
        expect(ctx.tileManager.value.clearFlowMaterialCache).not.toHaveBeenCalled();
        expect(ctx.scene.value.children).toHaveLength(childCount);
    });

    it('uses saved repeat and manual latitude settings during restoration, regardless of the previous procedural mode', async () => {
        ctx.app.$patch({ isRestoringPreset: true, proceduralPathMode: 'clock', gridRepeatEnabled: true, gridRepeatRows: 2, gridRepeatColumns: 3,
            sphericalProjectionEnabled: true, sphericalProjectionVerticalWrapAuto: false,
            sphericalProjectionLowerLatitudeDegrees: 10, sphericalProjectionUpperLatitudeDegrees: 45 });
        const series = await useRibbonBuilder(ctx).createRibbonSeries(paths(), { width: 0.3 });
        expect(series.ribbons).toHaveLength(6);
        expect(ctx.app.proceduralPathMode).toBeNull();
        expect(ctx.app.sphericalProjectionVerticalWrapAuto).toBe(false);
        expect(ctx.app.sphericalProjectionLowerLatitudeDegrees).toBe(10);
        expect(ctx.app.sphericalProjectionUpperLatitudeDegrees).toBe(45);
    });

    it('bypasses repeat for live procedural builds and preserves its recipe for the next static source', async () => {
        ctx.app.$patch({ gridRepeatEnabled: true, gridRepeatRows: 2, gridRepeatColumns: 3 });
        const builder = useRibbonBuilder(ctx);
        const procedural = await builder.createProceduralRibbon({ type: 'sineWave' });
        const count = procedural.ribbons.length;
        expect(count).toBeLessThan(6);
        ctx.app.setGridRepeatCount('gridRepeatRows', 4);
        builder.setHelixMode(ctx.app.helixOptions);
        expect(procedural.ribbons).toHaveLength(count);
        expect(procedural._helixOptions.gridRepeatEnabled).toBe(false);
        const staticSeries = await builder.createRibbonSeries(paths(), { width: 0.3 });
        expect(staticSeries.ribbons).toHaveLength(12);
    });
});
