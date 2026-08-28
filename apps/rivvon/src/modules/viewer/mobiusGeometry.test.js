import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { RibbonSeries } from './ribbonSeries.js';
import { DEFAULT_MOBIUS_SETTINGS, getProceduralSourceFrame, normalizeMobiusSettings } from './proceduralPaths.js';
import { createDrawingDocument } from '../shared/drawingLibrary.js';

const disposables = [];
afterEach(() => {
    disposables.splice(0).forEach((item) => item.dispose());
    vi.restoreAllMocks();
});

function createSeries(settings = {}, options = {}) {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const tileManager = {
        getMaterial: () => material,
        getOrCreateMaterialForSegment: vi.fn(() => material),
        isFlowEnabled: () => true,
        getFlowSpeed: () => 0.25,
        getPendingFlowWrapTiles: () => 1,
        wrapFlowOffset: vi.fn(),
    };
    const series = new RibbonSeries(new THREE.Scene());
    disposables.push(series, material);
    series.setTileManager(tileManager);
    series.setHelixOptions(options);
    series.buildFromProceduralSource({ type: 'mobius', settings });
    return { series, tileManager };
}

function position(mesh, index) {
    const attr = mesh.geometry.getAttribute('position');
    return new THREE.Vector3().fromBufferAttribute(attr, index < 0 ? attr.count + index : index);
}

function expectClosedBand(series) {
    const meshes = series.ribbons[0].meshSegments;
    for (let i = 1; i < meshes.length; i++) {
        expect(position(meshes[i - 1], -2).distanceTo(position(meshes[i], 0))).toBeLessThan(1e-6);
        expect(position(meshes[i - 1], -1).distanceTo(position(meshes[i], 1))).toBeLessThan(1e-6);
    }
    // A Möbius join reverses the width coordinate.
    expect(position(meshes[0], 0).distanceTo(position(meshes.at(-1), -1))).toBeLessThan(1e-6);
    expect(position(meshes[0], 1).distanceTo(position(meshes.at(-1), -2))).toBeLessThan(1e-6);
}

describe('Möbius procedural ribbons', () => {
    it('normalizes invalid settings and keeps width below the loop diameter', () => {
        expect(normalizeMobiusSettings()).toEqual(DEFAULT_MOBIUS_SETTINGS);
        expect(normalizeMobiusSettings({ radius: NaN, width: Infinity, twistPhase: NaN })).toEqual(DEFAULT_MOBIUS_SETTINGS);
        expect(normalizeMobiusSettings({ radius: 0.5 }).width).toBe(0.8);
        expect(normalizeMobiusSettings({ radius: -10, width: 90, handedness: -1, twistPhase: 999 }))
            .toEqual({ radius: 0.5, width: 0.8, handedness: -1, twistPhase: 360 });
    });

    it.each([[-1, 0], [1, 0], [-1, 73], [1, 235]])('closes every tile and the reversed join for handedness %s, phase %s', (handedness, twistPhase) => {
        const settings = { radius: 2.1, width: 0.85, handedness, twistPhase };
        const { series } = createSeries(settings);
        expectClosedBand(series);
        const ribbon = series.ribbons[0];
        const curve = ribbon.createCurveFromPoints(ribbon.lastPoints);
        expect(curve.getTangent(0).distanceTo(curve.getTangent(1))).toBeLessThan(1e-12);
        expect(ribbon.pathLength).toBeCloseTo(2 * Math.PI * settings.radius, 10);
        for (const mesh of ribbon.meshSegments) {
            const attr = mesh.geometry.getAttribute('position');
            for (let i = 0; i < attr.count; i++) {
                const localT = Math.floor(i / 2) / (attr.count / 2 - 1);
                const distance = THREE.MathUtils.lerp(mesh.userData.visibleStartDistance, mesh.userData.visibleEndDistance, localT);
                const theta = distance / settings.radius;
                const alpha = handedness * theta / 2 + THREE.MathUtils.degToRad(twistPhase);
                const v = (i % 2 - 0.5) * settings.width;
                const expected = new THREE.Vector3(
                    (settings.radius + v * Math.cos(alpha)) * Math.cos(theta),
                    (settings.radius + v * Math.cos(alpha)) * Math.sin(theta),
                    v * Math.sin(alpha),
                );
                expect(position(mesh, i).distanceTo(expected)).toBeLessThan(1e-6);
            }
        }
    });

    it('protects closure from incompatible viewer settings and retains geometry during animation', () => {
        const options = { surfaceMode: 'tube', helixMode: true, capStyle: 'swallowtail', sphericalProjectionEnabled: true, undulationEnabled: true, ribbonPathAlignmentMode: 'inside', ribbonWidthScale: 2.5 };
        const { series, tileManager } = createSeries({}, options);
        const ribbon = series.ribbons[0];
        series.setHelixOptions(options);
        series.setNormalizeTextureOrientation(true);
        expect(ribbon.textureOrientationMirrorY).toBe(false);
        expect(ribbon.surfaceMode).toBe('ribbon');
        expect(ribbon.helixMeshSegmentsB).toHaveLength(0);
        expect(ribbon.lastWidth).toBe(DEFAULT_MOBIUS_SETTINGS.width);
        const firstGeometry = ribbon.meshSegments[0].geometry;
        const before = Array.from(firstGeometry.attributes.position.array);
        series.updateProcedural(42);
        series.update(42);
        series.setUndulationTime(12);
        series.updateFlowMaterials();
        expect(tileManager.wrapFlowOffset).toHaveBeenCalledWith(1);
        expect(ribbon.meshSegments[0].geometry).toBe(firstGeometry);
        expect(Array.from(firstGeometry.attributes.position.array)).toEqual(before);
        for (const mesh of ribbon.meshSegments) {
            expect(Array.from(mesh.geometry.attributes.capStyles.array).every((value) => value === 0)).toBe(true);
        }
        expectClosedBand(series);
    });

    it('retains parameters through serialization and rebuilding, and clears them for other sources', () => {
        const source = { type: 'mobius', settings: { radius: 3, width: 1.4, handedness: -1, twistPhase: 120 } };
        const frame = getProceduralSourceFrame(source);
        const saved = JSON.parse(JSON.stringify(createDrawingDocument({ kind: 'mobius', paths: frame.paths, source })));
        expect(saved.kind).toBe('mobius');
        const { series } = createSeries();
        series.buildFromProceduralSource(saved.source);
        series.rebuildUpdate(3);
        expect(series.proceduralSource.settings).toEqual(source.settings);
        expectClosedBand(series);
        const replacementMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
        disposables.push(replacementMaterial);
        series.setTileManager({
            getMaterial: () => replacementMaterial,
            getOrCreateMaterialForSegment: () => replacementMaterial,
        });
        series.buildFromProceduralSource(series.proceduralSource);
        expect(series.ribbons[0].meshSegments[0].material).toBe(replacementMaterial);
        expect(series.proceduralSource.settings).toEqual(source.settings);
        expectClosedBand(series);
        series.buildFromProceduralSource({ type: 'sineWave' });
        expect(series.ribbons[0].pathGeometry).toBeNull();
        expect(series.ribbons[0].undulationEnabled).toBe(true);
        series.buildFromMultiplePaths([[new THREE.Vector3(), new THREE.Vector3(2, 0, 0)]]);
        expect(series.proceduralSource).toBeNull();
    });
});
