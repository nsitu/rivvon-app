import { afterEach, describe, expect, it, vi } from 'vitest';
import { Box3, MeshBasicMaterial, Scene, Vector3 } from 'three';
import { RibbonSeries } from './ribbonSeries.js';
import { repeatPathGrid, assertGridRepeatGeometryBudget, GRID_REPEAT_LIMITS, GridRepeatLimitError } from './gridRepeat.js';
import { GRID_REPEAT_DEFAULTS, normalizeGridRepeatSettings } from '../../../../../packages/shared-types/src/gridRepeat.js';
import { sampleSvgNodes } from './svgNodes.js';
import { deriveSphericalProjectionLatitudeBounds, projectPathsToSphere, samplePathsForSphericalProjection } from './sphericalProjection.js';

const point = (x, y, z = 0) => new Vector3(x, y, z);
const grid = (rows, columns, checkerboard = false) => ({ gridRepeatEnabled: true, gridRepeatRows: rows, gridRepeatColumns: columns, gridRepeatCheckerboard: checkerboard });
const resources = [];
afterEach(() => { resources.splice(0).forEach(resource => resource.dispose()); vi.restoreAllMocks(); });

function seriesFor(paths, options = {}, svgNodes = null) {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const material = new MeshBasicMaterial();
    const series = new RibbonSeries(new Scene());
    resources.push(series, material);
    series.svgNodes = svgNodes;
    series.setTileManager({ getMaterial: () => material, getOrCreateMaterialForSegment: () => material });
    series.setNormalizeTextureOrientation(false);
    series.setHelixOptions({ undulationEnabled: false, ...options });
    series.buildFromMultiplePaths(paths, 0.3);
    return series;
}

describe('grid path transformation', () => {
    it('normalizes bounded integer controls and preserves defaults', () => {
        expect(normalizeGridRepeatSettings()).toEqual(GRID_REPEAT_DEFAULTS);
        expect(normalizeGridRepeatSettings({ gridRepeatRows: Infinity, gridRepeatColumns: 50 })).toMatchObject({ gridRepeatRows: 3, gridRepeatColumns: 12 });
        expect(normalizeGridRepeatSettings({ gridRepeatRows: 0, gridRepeatColumns: 3.7 })).toMatchObject({ gridRepeatRows: 1, gridRepeatColumns: 4 });
        expect(normalizeGridRepeatSettings({ gridRepeatRowSpacing: -10, gridRepeatColumnSpacing: 10 })).toMatchObject({ gridRepeatRowSpacing: -5, gridRepeatColumnSpacing: 5 });
        expect(normalizeGridRepeatSettings({ gridRepeatRowSpacing: -2.35 })).toMatchObject({ gridRepeatRowSpacing: -2.35 });
        expect(normalizeGridRepeatSettings({ gridRepeatRowSpacing: Infinity, gridRepeatColumnSpacing: 0.35 })).toMatchObject({ gridRepeatRowSpacing: 1, gridRepeatColumnSpacing: 0.35 });
    });

    it('keeps disabled and 1x1 geometry exactly unchanged without aliasing input', () => {
        const points = [point(1e6, 2, 3), point(1e-15, 4, 5)];
        for (const settings of [{ ...grid(12, 12, true), gridRepeatEnabled: false }, grid(1, 1, true)]) {
            const result = repeatPathGrid([{ points }], { ...settings, gridRepeatColumnSpacing: 5, gridRepeatRowSpacing: 0 });
            expect(result).toHaveLength(1);
            expect(result[0].points).toEqual(points);
            expect(result[0].points[0]).not.toBe(points[0]);
        }
    });

    it('repeats the whole multi-path motif in centered row-major cells and reflects alternating parity', () => {
        const source = [{ points: [point(-2, -1, 2), point(1, 2, 4)] }, { points: [point(3, 0), point(4, 1)] }];
        const original = source.map(path => path.points.map(p => p.clone()));
        const result = repeatPathGrid(source, grid(2, 3, true), 1);
        expect(result).toHaveLength(12);
        expect(result.map(path => path.sourcePathIndex)).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
        expect(result[0].points[0]).toEqual(point(-9, 1, 2));
        expect(result[2].points[0]).toEqual(point(4, 1, 2));
        expect(result[6].points[0]).toEqual(point(-3, -3, 2));
        expect(result[3].points[0].x - result[2].points[0].x).toBe(-5);
        const bounds = new Box3().setFromPoints(result.flatMap(path => path.points));
        expect(bounds.getCenter(new Vector3())).toEqual(point(1, 0.5, 2));
        expect(source.map(path => path.points)).toEqual(original);
    });

    it('copies spline nodes and closure with the same affine transform', () => {
        const points = [point(-1, -1), point(2, -1), point(2, 1)];
        const result = repeatPathGrid([{ points, splineNodes: points, closed: true }], grid(2, 2, true), 0.3);
        expect(result.every(path => path.closed)).toBe(true);
        for (const path of result) {
            expect(path.splineNodes).toEqual(path.points);
            expect(path.splineNodes).not.toBe(path.points);
        }
        result[1].splineNodes[0].x = 99;
        expect(points[0].x).toBe(-1);
        expect(result[1].points[0].x).not.toBe(99);
    });

    it('separates horizontal, vertical, and zero-extent motifs using base width', () => {
        for (const points of [[point(0, 0), point(0, 2)], [point(0, 0), point(2, 0)], [point(0, 0), point(0, 0)]]) {
            const result = repeatPathGrid([{ points }], grid(2, 2), 0.5);
            expect(result[0].points[0].distanceTo(result[1].points[0])).toBeGreaterThanOrEqual(0.5);
            expect(result[0].points[0].distanceTo(result[2].points[0])).toBeGreaterThanOrEqual(0.5);
        }
        expect(repeatPathGrid([], grid(2, 2))).toEqual([]);
    });

    it.each([false, true])('spaces columns and rows independently while preserving motif size and centre (checkerboard: %s)', checkerboard => {
        const points = [point(-2, -1, 3), point(2, 1, 3)];
        const source = [{ points, splineNodes: points, closed: true }];
        const result = repeatPathGrid(source, { ...grid(2, 3, checkerboard), gridRepeatColumnSpacing: 2.5, gridRepeatRowSpacing: 0 }, 0.4);
        const cells = result.map(path => new Box3().setFromPoints(path.points));
        expect(cells[1].min.x - cells[0].max.x).toBeCloseTo(1);
        expect(cells[0].min.y - cells[3].max.y).toBeCloseTo(0);
        expect(cells[0].getSize(new Vector3())).toEqual(point(4, 2));
        expect(new Box3().setFromPoints(result.flatMap(path => path.points)).getCenter(new Vector3())).toEqual(point(0, 0, 3));
        expect(result.every(path => path.closed && path.splineNodes.every((p, i) => p.equals(path.points[i])))).toBe(true);
        expect(points).toEqual([point(-2, -1, 3), point(2, 1, 3)]);
    });

    it.each([false, true])('overlaps rows and columns with negative gaps without resizing the motif (checkerboard: %s)', checkerboard => {
        const points = [point(-2, -1), point(2, 1)];
        const result = repeatPathGrid([{ points }], { ...grid(2, 3, checkerboard), gridRepeatColumnSpacing: -2, gridRepeatRowSpacing: -3 }, 0.4);
        const cells = result.map(path => new Box3().setFromPoints(path.points));
        expect(cells[1].min.x - cells[0].max.x).toBeCloseTo(-0.8);
        expect(cells[0].min.y - cells[3].max.y).toBeCloseTo(-1.2);
        expect(cells[0].getSize(new Vector3())).toEqual(point(4, 2));
        expect(new Box3().setFromPoints(result.flatMap(path => path.points)).getCenter(new Vector3())).toEqual(point(0, 0));
        expect(points).toEqual([point(-2, -1), point(2, 1)]);
    });

    it('rejects derived path and point counts before allocating copies', () => {
        const descriptor = { points: [point(0, 0), point(1, 1)] };
        expect(() => repeatPathGrid(Array(20).fill(descriptor), grid(12, 12))).toThrow(GridRepeatLimitError);
        const dense = { points: Array(Math.ceil(GRID_REPEAT_LIMITS.points / 2)).fill(point(0, 0)) };
        expect(() => repeatPathGrid([dense], grid(1, 3))).toThrow(GridRepeatLimitError);
    });

    it('budgets meshes, tube sides, and helix sample density', () => {
        const paths = [[point(0, 0), point(100, 0)]];
        expect(() => assertGridRepeatGeometryBudget(paths, 1, grid(2, 2))).not.toThrow();
        expect(() => assertGridRepeatGeometryBudget(paths, 0.01, grid(2, 2))).toThrow(GridRepeatLimitError);
        expect(() => assertGridRepeatGeometryBudget(paths, 0.2, { ...grid(2, 2), surfaceMode: 'tube', tubeRadialSegments: 24 })).toThrow(GridRepeatLimitError);
        expect(() => assertGridRepeatGeometryBudget(paths, 0.2, { ...grid(2, 2), helixMode: true, helixPitch: 100 })).toThrow(GridRepeatLimitError);
    });
});

describe('grid geometry pipeline', () => {
    it('rebuilds from source without accumulating repeats and restores the original on disable', () => {
        const paths = [[point(-1, 0), point(0, 1), point(1, 0)]];
        const series = seriesFor(paths, grid(2, 3, true));
        expect(series.ribbons).toHaveLength(6);
        const repeated = series.lastPathsPoints.map(path => path.map(p => p.clone()));
        for (let i = 0; i < 3; i++) {
            series.rebuildUpdate(0);
            expect(series.lastPathsPoints).toEqual(repeated);
            expect(series.sourcePathsPoints).toEqual(paths);
        }
        series.setHelixOptions({ gridRepeatEnabled: false });
        series.rebuildUpdate(0);
        expect(series.lastPathsPoints).toEqual(paths);
        expect(series.ribbons).toHaveLength(1);
    });

    it.each(['ribbon', 'tube'])('keeps repeated smooth SVG nodes and closed seams in %s mode', surfaceMode => {
        const nodes = [{ closed: true, points: [point(-1, -1), point(1, -1), point(1, 1), point(-1, 1)] }];
        const series = seriesFor([nodes[0].points], { ...grid(2, 2, true), svgSmoothNodesEnabled: true, surfaceMode }, nodes);
        const expected = repeatPathGrid(sampleSvgNodes(nodes).map(path => ({ points: path.points, splineNodes: path.nodes, closed: path.closed })), grid(2, 2, true), 0.3);
        expect(series.ribbons).toHaveLength(4);
        series.ribbons.forEach((ribbon, i) => {
            expect(ribbon.closedSpline).toBe(true);
            expect(ribbon.splineNodes).toEqual(expected[i].splineNodes);
            const curve = ribbon.createCurveFromPoints(series.lastPathsPoints[i]);
            expect(curve.getPoint(0).distanceTo(curve.getPoint(1))).toBeLessThan(1e-8);
        });
        expect(series.svgNodes).toEqual(nodes);
    });

    it('projects the repeated grid onto one sphere, deriving auto latitude from grid aspect', () => {
        const paths = [[point(-2, -1), point(0, 1), point(2, -1)]];
        const options = { ...grid(2, 3, true), sphericalProjectionEnabled: true, sphericalProjectionVerticalWrapAuto: true, sphericalProjectionWrapDegrees: 120 };
        const series = seriesFor(paths, options);
        const repeated = repeatPathGrid(paths.map(points => ({ points })), options, 0.3);
        const bounds = deriveSphericalProjectionLatitudeBounds(120, series.projectionArtworkAspectRatio);
        const projectionOptions = { wrapDegrees: 120, lowerLatitudeDegrees: bounds.lower, upperLatitudeDegrees: bounds.upper };
        const sampled = samplePathsForSphericalProjection(repeated, projectionOptions);
        const expected = projectPathsToSphere(sampled.map(path => path.points), projectionOptions);
        expect(series.lastPathsPoints).toEqual(expected.paths);
        expect(series.lastPathsPoints).toHaveLength(6);
        for (const p of series.lastPathsPoints.flat()) expect(p.length()).toBeCloseTo(expected.radius, 10);
        expect(series.sourcePathsPoints).toEqual(paths);
        expect(series.projectionArtworkAspectRatio).toBeCloseTo(4.3 / 12.6);
    });

    it('keeps manual latitude bounds through row/column changes and finite pole mapping', () => {
        const series = seriesFor([[point(-2, -1), point(0, 1), point(2, -1)]], {
            ...grid(2, 3), sphericalProjectionEnabled: true, sphericalProjectionVerticalWrapAuto: false,
            sphericalProjectionWrapDegrees: 120, sphericalProjectionLowerLatitudeDegrees: 10, sphericalProjectionUpperLatitudeDegrees: 90,
        });
        series.setHelixOptions(grid(3, 2));
        series.rebuildUpdate(0);
        for (const p of series.lastPathsPoints.flat()) {
            expect(p.toArray().every(Number.isFinite)).toBe(true);
            expect(p.y).toBeGreaterThan(0);
        }
        expect(series._helixOptions.sphericalProjectionLowerLatitudeDegrees).toBe(10);
        expect(series._helixOptions.sphericalProjectionUpperLatitudeDegrees).toBe(90);
    });

    it('samples a sparse full-turn path before projecting, so its endpoints do not collapse the curve', () => {
        const series = seriesFor([[point(-2, 0), point(2, 0)]], {
            ...grid(1, 1), sphericalProjectionEnabled: true, sphericalProjectionWrapDegrees: 360,
        });
        expect(series.lastPathsPoints[0].length).toBeGreaterThan(50);
        expect(Math.max(...series.lastPathsPoints[0].map(p => p.z))).toBeGreaterThan(0.9);
        expect(Math.min(...series.lastPathsPoints[0].map(p => p.z))).toBeLessThan(-0.9);
        expect(series.ribbons[0].meshSegments.length).toBeGreaterThan(10);
    });

    it('rejects an oversized rebuild before disposing existing meshes', () => {
        const series = seriesFor([[point(-1, 0), point(1, 0)]]);
        const original = series.ribbons[0];
        const dispose = vi.spyOn(original, 'dispose');
        expect(() => series._resolveGeometryPaths(series.sourcePathsPoints, 0.0001, { ...series._helixOptions, ...grid(12, 12) })).toThrow(GridRepeatLimitError);
        expect(dispose).not.toHaveBeenCalled();
        expect(series.ribbons[0]).toBe(original);
    });
});
