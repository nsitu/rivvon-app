import { afterEach, describe, expect, it, vi } from 'vitest';
import { shallowRef } from 'vue';
import { MeshBasicMaterial, Scene, Vector3 } from 'three';
import { useRibbonBuilder } from './useRibbonBuilder.js';

afterEach(() => vi.restoreAllMocks());

describe('SVG source lifecycle', () => {
    it('keeps both interpretations through texture rebuilds, then clears SVG controls for other artwork', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const material = new MeshBasicMaterial();
        const manager = { getMaterial: () => material, getOrCreateMaterialForSegment: () => material };
        const app = {
            svgSmoothNodesEnabled: false,
            get helixOptions() { return { svgSmoothNodesEnabled: this.svgSmoothNodesEnabled, undulationEnabled: false }; },
            normalizeTextureOrientation: false,
            setProceduralPathMode: vi.fn(),
        };
        const ctx = { app, scene: shallowRef(new Scene()), tileManager: shallowRef(manager), tileManagers: shallowRef([]),
            ribbon: shallowRef(null), ribbonSeries: shallowRef(null), cinematicCamera: { clearROIs: vi.fn() } };
        const builder = useRibbonBuilder(ctx);
        const nodes = [{ closed: false, points: [{ x: -2, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }, { x: 2, y: 0, z: 0 }] }];
        const original = [[new Vector3(-2, 0), new Vector3(0, 2)], [new Vector3(0, 2), new Vector3(2, 0)]];
        try {
            const series = await builder.createRibbonSeries(original, { source: { svgNodes: nodes, svgSmoothNodesEnabled: true } });
            expect(app.svgNodesAvailable).toBe(true);
            expect(app.svgSmoothNodesEnabled).toBe(true);
            expect(series.ribbons).toHaveLength(1);
            nodes[0].points[0].x = 99;
            builder.rebuildRibbonsWithNewTextures();
            expect(series.svgNodes[0].points[0].x).toBe(-2);
            expect(series.sourcePathsPoints).toEqual(original);
            expect(series.ribbons).toHaveLength(1);
            app.svgSmoothNodesEnabled = false;
            builder.setHelixMode(app.helixOptions);
            expect(series.ribbons).toHaveLength(2);
            expect(series.lastPathsPoints).toEqual(original);
            await builder.createRibbon(original[0]);
            expect(app.svgNodesAvailable).toBe(false);
            expect(app.svgSmoothNodesEnabled).toBe(false);
            expect(ctx.ribbonSeries.value.svgNodes).toBeNull();
        } finally {
            ctx.ribbonSeries.value?.dispose();
            material.dispose();
        }
    });

    it('uses the preset mode instead of resetting it to the drawing default during restoration', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const material = new MeshBasicMaterial();
        const manager = { getMaterial: () => material, getOrCreateMaterialForSegment: () => material };
        const app = { isRestoringPreset: true, svgSmoothNodesEnabled: true,
            helixOptions: { svgSmoothNodesEnabled: true, undulationEnabled: false } };
        const ctx = { app, scene: shallowRef(new Scene()), tileManager: shallowRef(manager), tileManagers: shallowRef([]),
            ribbon: shallowRef(null), ribbonSeries: shallowRef(null), cinematicCamera: { clearROIs: vi.fn() } };
        const points = [new Vector3(-2, 0), new Vector3(0, 2), new Vector3(2, 0)];
        try {
            await useRibbonBuilder(ctx).createRibbonSeries([points], {
                source: { svgNodes: [{ closed: false, points }], svgSmoothNodesEnabled: false },
            });
            expect(app.svgSmoothNodesEnabled).toBe(true);
            expect(app.svgNodesAvailable).toBe(true);
            expect(ctx.ribbonSeries.value.lastPathsPoints[0].length).toBeGreaterThan(3);
        } finally {
            ctx.ribbonSeries.value?.dispose();
            material.dispose();
        }
    });
});
