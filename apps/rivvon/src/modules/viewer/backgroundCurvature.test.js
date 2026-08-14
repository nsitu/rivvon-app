import { describe, expect, it } from "vitest";
import {
  createBackgroundSurfaceGeometry,
  deformBackgroundSurface,
  normalizeBackgroundCurvature,
} from "./backgroundCurvature.js";

describe("background curvature", () => {
  it("normalizes curvature into the supported range", () => {
    expect(normalizeBackgroundCurvature(-1)).toBe(0);
    expect(normalizeBackgroundCurvature(0.4)).toBe(0.4);
    expect(normalizeBackgroundCurvature(2)).toBe(1);
  });

  it("keeps a zero-curvature surface flat", () => {
    const geometry = createBackgroundSurfaceGeometry();
    deformBackgroundSurface(geometry, 16, 9, 0);

    const position = geometry.attributes.position;
    for (let index = 0; index < position.count; index += 1) {
      expect(position.getZ(index)).toBeCloseTo(0);
    }
    geometry.dispose();
  });

  it("curves the edges toward the camera while retaining a distant center", () => {
    const geometry = createBackgroundSurfaceGeometry();
    deformBackgroundSurface(geometry, 16, 9, 1);

    const position = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    let centerZ = Infinity;
    let edgeZ = -Infinity;
    for (let index = 0; index < position.count; index += 1) {
      const distanceFromCenter = Math.hypot(
        uv.getX(index) - 0.5,
        uv.getY(index) - 0.5,
      );
      if (distanceFromCenter < 0.001) centerZ = position.getZ(index);
      if (distanceFromCenter > 0.7) edgeZ = Math.max(edgeZ, position.getZ(index));
    }

    expect(centerZ).toBeCloseTo(0);
    expect(edgeZ).toBeGreaterThan(0);
    geometry.dispose();
  });
});
