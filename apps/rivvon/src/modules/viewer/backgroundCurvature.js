import * as THREE from "three";

export const DEFAULT_BACKGROUND_CURVATURE = 0.6;
export const MAX_BACKGROUND_CURVE_ANGLE = THREE.MathUtils.degToRad(65);

export function normalizeBackgroundCurvature(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? THREE.MathUtils.clamp(parsed, 0, 1)
    : DEFAULT_BACKGROUND_CURVATURE;
}

export function createBackgroundSurfaceGeometry(coarse = false) {
  return new THREE.PlaneGeometry(
    1,
    1,
    coarse ? 20 : 32,
    coarse ? 14 : 24,
  );
}

export function deformBackgroundSurface(
  geometry,
  width,
  height,
  curvature = 0,
) {
  const position = geometry?.attributes?.position;
  const uv = geometry?.attributes?.uv;
  if (!position || !uv) return;

  const normalizedCurvature = normalizeBackgroundCurvature(curvature);
  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;
  const radialExtent = Math.hypot(halfWidth, halfHeight);
  const capAngle = normalizedCurvature * MAX_BACKGROUND_CURVE_ANGLE;
  const sphereRadius =
    capAngle > 0.0001 ? radialExtent / Math.sin(capAngle) : Infinity;

  for (let index = 0; index < position.count; index += 1) {
    const x = (uv.getX(index) - 0.5) * width;
    const y = (uv.getY(index) - 0.5) * height;
    const radialDistanceSquared = x * x + y * y;
    const z = Number.isFinite(sphereRadius)
      ? sphereRadius -
        Math.sqrt(
          Math.max(0, sphereRadius * sphereRadius - radialDistanceSquared),
        )
      : 0;
    position.setXYZ(index, x, y, z);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
}
