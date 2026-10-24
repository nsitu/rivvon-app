import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scene, MeshBasicMaterial, Vector3 } from 'three';
import { svgPathDataToNodes, sampleSvgNodes } from './svgNodes.js';
import { RibbonSeries } from './ribbonSeries.js';
import { projectPathsToSphere } from './sphericalProjection.js';
import { normalizeSvgNodes } from '../../../../../packages/shared-types/src/svgNodes.js';
import { createDrawingPayload } from '../shared/drawingLibrary.js';
import { parseSvgNodes } from './svgPathToPoints.js';

const resources = [];
afterEach(() => {
    resources.splice(0).forEach(resource => resource.dispose());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
const point = (x, y) => new Vector3(x, y, 0);

function seriesFor(nodes, original, options = {}) {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const material = new MeshBasicMaterial();
    const series = new RibbonSeries(new Scene());
    resources.push(series, material);
    series.svgNodes = nodes;
    series.setTileManager({ getMaterial: () => material, getOrCreateMaterialForSegment: () => material });
    series.setHelixOptions({ undulationEnabled: false, ...options });
    series.buildFromMultiplePaths(original, 0.3);
    return series;
}

describe('SVG node interpretation', () => {
    it('extracts endpoints, ignoring handles and resolving relative, shorthand, horizontal and vertical commands', () => {
        expect(svgPathDataToNodes('m 1 2 h 3 v 4 c 20 30 40 50 6 7 s 30 40 5 6 q 90 90 2 3 t 4 5'))
            .toEqual([{ closed: false, points: [[1, 2], [4, 2], [4, 6], [10, 13], [15, 19], [17, 22], [21, 27]]
                .map(([x, y]) => ({ x, y, z: 0 })) }]);
    });

    it('keeps subpaths separate and represents closure without a repeated anchor', () => {
        const paths = svgPathDataToNodes('M0 0 L2 0 L2 2 L0 0 Z m10 0 l1 1');
        expect(paths).toHaveLength(2);
        expect(paths[0].closed).toBe(true);
        expect(paths[0].points).toHaveLength(3);
        expect(paths[1].points).toEqual([{ x: 10, y: 0, z: 0 }, { x: 11, y: 1, z: 0 }]);
    });

    it('applies nested transforms and the original import normalization to anchors', () => {
        const parent = { parentElement: null, getAttribute: key => key === 'transform' ? 'translate(10 20)' : null };
        const element = { tagName: 'path', parentElement: parent,
            getAttribute: key => ({ d: 'm1 2 l3 4', transform: 'scale(2 3)' })[key] ?? null };
        vi.stubGlobal('DOMParser', class {
            parseFromString() {
                return { querySelectorAll: () => [element],
                    querySelector: key => key === 'svg' ? { getAttribute: () => '0, 0, 100, 100' } : null };
            }
        });
        const reference = [[point(0.6, -1.3), point(0.9, -1.9)]];
        const nodes = parseSvgNodes('<svg/>', reference);
        expect(nodes).toHaveLength(1);
        expect(nodes[0].closed).toBe(false);
        expect(nodes[0].points[0].x).toBeCloseTo(-2);
        expect(nodes[0].points[0].y).toBeCloseTo(4);
        expect(nodes[0].points[1].x).toBeCloseTo(2);
        expect(nodes[0].points[1].y).toBeCloseTo(-4);
    });

    it('retains enough arc endpoints for circles rather than collapsing to a line', () => {
        const paths = svgPathDataToNodes('M-2 0 A2 2 0 1 0 2 0 A2 2 0 1 0 -2 0 Z');
        expect(paths[0].points.length).toBeGreaterThanOrEqual(4);
        const sampled = sampleSvgNodes(paths)[0];
        expect(sampled.closed).toBe(true);
        expect(Math.max(...sampled.points.map(p => p.y))).toBeGreaterThan(1.5);
        expect(Math.min(...sampled.points.map(p => p.y))).toBeLessThan(-1.5);
    });

    it('deduplicates adjacent nodes and safely handles two-node and degenerate paths', () => {
        const input = [{ closed: false, points: [point(0, 0), point(0, 0), point(1, 0)] }];
        expect(sampleSvgNodes(input)[0].points).toEqual([point(0, 0), point(1, 0)]);
        expect(sampleSvgNodes([{ closed: true, points: [point(1, 1), point(1, 1)] }])).toEqual([]);
        expect(() => normalizeSvgNodes([{ points: [{ x: NaN, y: 0 }, { x: 1, y: 1 }] }])).toThrow();
    });

    it('switches between split original paths and an unsplit spline without changing the source', () => {
        const original = [[point(-2, 0), point(0, 2)], [point(0, 2), point(2, 0)]];
        const nodes = [{ closed: false, points: [point(-2, 0), point(0, 2), point(2, 0)] }];
        const series = seriesFor(nodes, original);
        expect(series.ribbons).toHaveLength(2);
        for (let i = 0; i < 3; i++) {
            series.setHelixOptions({ svgSmoothNodesEnabled: true });
            series.rebuildUpdate(0);
            expect(series.ribbons).toHaveLength(1);
            expect(series.lastPathsPoints[0].length).toBeGreaterThan(3);
            series.setHelixOptions({ svgSmoothNodesEnabled: false });
            series.rebuildUpdate(0);
            expect(series.lastPathsPoints).toEqual(original);
            expect(series.sourcePathsPoints).toEqual(original);
        }
    });

    it.each(['ribbon', 'tube'])('closes the spline tangent and surface seam with no end caps for %s', (surfaceMode) => {
        const nodes = svgPathDataToNodes('M-2 -2 L2 -2 L2 2 L-2 2 Z');
        const original = [nodes[0].points.map(p => point(p.x, p.y))];
        const series = seriesFor(nodes, original, { svgSmoothNodesEnabled: true, surfaceMode });
        const ribbon = series.ribbons[0];
        const curve = ribbon.createCurveFromPoints(series.lastPathsPoints[0]);
        expect(curve.getPoint(0).distanceTo(curve.getPoint(1))).toBeLessThan(1e-8);
        expect(curve.getTangent(0).dot(curve.getTangent(1))).toBeGreaterThan(0.99999);
        const frames = ribbon.createFrameSamples(curve, 101);
        expect(frames[0].normal.distanceTo(frames.at(-1).normal)).toBeLessThan(1e-7);
        expect(ribbon._getCapStyleCode()).toBe(0);
        const first = ribbon.meshSegments[0].geometry.attributes.position;
        const last = ribbon.meshSegments.at(-1).geometry.attributes.position;
        const stride = surfaceMode === 'tube' ? ribbon.tubeRadialSegments + 1 : 2;
        for (let i = 0; i < stride; i++) {
            expect(new Vector3().fromBufferAttribute(first, i).distanceTo(
                new Vector3().fromBufferAttribute(last, last.count - stride + i),
            )).toBeLessThan(1e-6);
        }
    });

    it('smooths in the source plane before spherical projection', () => {
        const nodes = svgPathDataToNodes('M-2 -1 L0 2 L2 -1');
        const original = [nodes[0].points.map(p => point(p.x, p.y))];
        const options = { svgSmoothNodesEnabled: true, sphericalProjectionEnabled: true, sphericalProjectionWrapDegrees: 100 };
        const series = seriesFor(nodes, original, options);
        const expected = projectPathsToSphere(sampleSvgNodes(nodes).map(path => path.points), { wrapDegrees: 100 });
        expect(series.lastPathsPoints).toEqual(expected.paths);
        expect(series.sourcePathsPoints).toEqual(original);
    });

    it.each(['ribbon', 'tube'])('keeps closed %s animation continuous with projection, undulation and fractional helix pitch', (surfaceMode) => {
        const nodes = svgPathDataToNodes('M-2 -2 L2 -2 L2 2 L-2 2 Z');
        const original = [nodes[0].points.map(p => point(p.x, p.y))];
        const series = seriesFor(nodes, original, { svgSmoothNodesEnabled: true, surfaceMode,
            undulationEnabled: true, sphericalProjectionEnabled: true, sphericalProjectionWrapDegrees: 100,
            helixMode: true, helixPitch: 2.7 });
        const ribbon = series.ribbons[0];
        const curve = ribbon.createCurveFromPoints(series.lastPathsPoints[0]);
        const frames = ribbon.createFrameSamples(curve, 101);
        const start = ribbon._sampleFrame(curve, frames, 0);
        const end = ribbon._sampleFrame(curve, frames, 1);
        for (const time of [0, 0.7, 3]) {
            for (const strandOffset of [0, Math.PI]) {
                const a = new Vector3(); const b = new Vector3();
                const scratch = ribbon._createAnimationScratch();
                if (surfaceMode === 'tube') {
                    ribbon._setAnimatedTubeVertexPosition(a, start, 0.15, 0.3, time, strandOffset, scratch);
                    ribbon._setAnimatedTubeVertexPosition(b, end, 0.15, 0.3, time, strandOffset, scratch);
                } else {
                    ribbon._setAnimatedVertexPosition(a, start, 0.3, -0.5, 1, time, strandOffset, scratch);
                    ribbon._setAnimatedVertexPosition(b, end, 0.3, -0.5, 1, time, strandOffset, scratch);
                }
                expect(a.distanceTo(b)).toBeLessThan(1e-6);
            }
        }
    });

    it('preserves nodes, closure and mode in portable drawing payloads', () => {
        const nodes = svgPathDataToNodes('M0 0 L2 0 L2 2 Z');
        const source = { fileName: 'triangle.svg', svgNodes: nodes, svgSmoothNodesEnabled: true };
        const payload = createDrawingPayload({ kind: 'svg', paths: [nodes[0].points], source });
        expect(JSON.parse(JSON.stringify(payload)).source).toEqual(source);
        source.svgNodes[0].points[0].x = 99;
        expect(payload.source.svgNodes[0].points[0].x).toBe(0);
    });
});
