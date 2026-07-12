import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  Ribbon,
  getMirroredTubeTextureV,
  normalizeTubeRadialSegments,
} from "./ribbon.js";

describe("tube ribbon geometry", () => {
  it("normalizes radial resolution to a bounded even count", () => {
    expect(normalizeTubeRadialSegments(3)).toBe(4);
    expect(normalizeTubeRadialSegments(7)).toBe(8);
    expect(normalizeTubeRadialSegments(30)).toBe(24);
  });

  it("maps one texture forward and one mirrored around the tube", () => {
    const values = Array.from({ length: 9 }, (_, index) =>
      getMirroredTubeTextureV(index, 8),
    );

    expect(values).toEqual([0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25, 0]);
  });

  it("builds closed tube side walls while keeping planar masks away from the seams", () => {
    const ribbon = new Ribbon(new THREE.Scene());
    ribbon.setHelixOptions({
      surfaceMode: "tube",
      tubeRadiusScale: 0.5,
      tubeRadialSegments: 8,
      undulationEnabled: false,
    });
    ribbon.pathLength = 2;

    const curve = ribbon.createCurveFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(2, 0, 0),
    ]);
    const frameSamples = ribbon.createFrameSamples(curve, 3);
    const geometry = ribbon.createTubeRibbonSegmentGeometryWithCache(
      curve,
      0,
      1,
      1,
      0,
      0,
      frameSamples,
      2,
      0,
      null,
      { pathLength: 2, tileWorldLength: 1, capWorldLength: 1 },
    );

    expect(geometry.attributes.position.count).toBe(27);
    expect(geometry.index.count).toBe(96);
    expect(
      Array.from(geometry.attributes.maskV.array).every(
        (value) => value === 0.5,
      ),
    ).toBe(true);

    const positions = geometry.attributes.position;
    const first = new THREE.Vector3().fromBufferAttribute(positions, 0);
    const seamDuplicate = new THREE.Vector3().fromBufferAttribute(positions, 8);
    expect(first.distanceTo(seamDuplicate)).toBeLessThan(1e-6);
    expect(Math.hypot(first.y, first.z)).toBeCloseTo(0.5, 6);

    geometry.dispose();
    ribbon.dispose();
  });

  it("rotates the tube seam so the mirrored join can start at 90 degrees", () => {
    const baseRibbon = new Ribbon(new THREE.Scene());
    baseRibbon.setHelixOptions({
      surfaceMode: "tube",
      tubeRadiusScale: 0.5,
      tubeRadialSegments: 8,
      undulationEnabled: false,
    });
    baseRibbon.pathLength = 2;

    const offsetRibbon = new Ribbon(new THREE.Scene());
    offsetRibbon.setHelixOptions({
      surfaceMode: "tube",
      tubeRadiusScale: 0.5,
      tubeRadialSegments: 8,
      tubeTextureJoinOffsetDegrees: 90,
      undulationEnabled: false,
    });
    offsetRibbon.pathLength = 2;

    const curve = baseRibbon.createCurveFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(2, 0, 0),
    ]);
    const frameSamples = baseRibbon.createFrameSamples(curve, 3);

    const baseGeometry = baseRibbon.createTubeRibbonSegmentGeometryWithCache(
      curve,
      0,
      1,
      1,
      0,
      0,
      frameSamples,
      2,
      0,
      null,
      { pathLength: 2, tileWorldLength: 1, capWorldLength: 1 },
    );
    const offsetGeometry =
      offsetRibbon.createTubeRibbonSegmentGeometryWithCache(
        curve,
        0,
        1,
        1,
        0,
        0,
        frameSamples,
        2,
        0,
        null,
        { pathLength: 2, tileWorldLength: 1, capWorldLength: 1 },
      );

    const baseVertexAtQuarterTurn = new THREE.Vector3().fromBufferAttribute(
      baseGeometry.attributes.position,
      2,
    );
    const offsetFirstVertex = new THREE.Vector3().fromBufferAttribute(
      offsetGeometry.attributes.position,
      0,
    );
    expect(offsetFirstVertex.distanceTo(baseVertexAtQuarterTurn)).toBeLessThan(
      1e-6,
    );

    baseGeometry.dispose();
    offsetGeometry.dispose();
    baseRibbon.dispose();
    offsetRibbon.dispose();
  });

  it("selects tube geometry through the normal build path and disables planar cap masks", () => {
    const scene = new THREE.Scene();
    const ribbon = new Ribbon(scene);
    const material = new THREE.MeshBasicMaterial();
    ribbon.setTileManager({
      getMaterial: () => material,
      getOptimalUndulationPeriod: () => 3,
    });
    ribbon.setHelixOptions({
      surfaceMode: "tube",
      tubeRadiusScale: 0.5,
      tubeRadialSegments: 8,
      capStyle: "swallowtail",
      undulationEnabled: false,
    });

    ribbon.buildFromPoints(
      [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)],
      1,
      0,
    );

    expect(ribbon.meshSegments).toHaveLength(1);
    const geometry = ribbon.meshSegments[0].geometry;
    expect(geometry.attributes.position.count).toBe(51 * 9);
    expect(
      Array.from(geometry.attributes.capStartStyle.array).every(
        (value) => value === 0,
      ),
    ).toBe(true);
    expect(
      Array.from(geometry.attributes.capEndStyle.array).every(
        (value) => value === 0,
      ),
    ).toBe(true);

    ribbon.dispose();
    material.dispose();
  });
});
