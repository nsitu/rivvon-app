import * as THREE from 'three';

export const DEFAULT_SPHERICAL_WRAP_DEGREES = 100;
export const MIN_SPHERICAL_WRAP_DEGREES = 15;
export const MAX_SPHERICAL_WRAP_DEGREES = 360;
const MAX_SPHERICAL_VERTICAL_WRAP_DEGREES = 170;
const MIN_SPHERICAL_RADIUS = 1;
const ORIGIN = new THREE.Vector3(0, 0, 0);

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function degreesToRadians(value) {
    return value * (Math.PI / 180);
}

function radiansToDegrees(value) {
    return value * (180 / Math.PI);
}

function getSafeSphericalRadius(value) {
    return Number.isFinite(value) && value > 0
        ? value
        : MIN_SPHERICAL_RADIUS;
}

export function normalizeSphericalProjectionWrapDegrees(value) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return DEFAULT_SPHERICAL_WRAP_DEGREES;
    }

    return clamp(parsed, MIN_SPHERICAL_WRAP_DEGREES, MAX_SPHERICAL_WRAP_DEGREES);
}

export function resolveSphericalProjectionRadius(pathsPoints, wrapDegrees = DEFAULT_SPHERICAL_WRAP_DEGREES) {
    const allPoints = Array.isArray(pathsPoints) ? pathsPoints.flat() : [];

    if (allPoints.length < 2) {
        return {
            radius: MIN_SPHERICAL_RADIUS,
            horizontalWrapDegrees: DEFAULT_SPHERICAL_WRAP_DEGREES,
            verticalWrapDegrees: DEFAULT_SPHERICAL_WRAP_DEGREES,
        };
    }

    const box = new THREE.Box3().setFromPoints(allPoints);
    const size = box.getSize(new THREE.Vector3());
    const width = Math.max(size.x, 1e-6);
    const height = Math.max(size.y, 1e-6);
    const normalizedWrapDegrees = normalizeSphericalProjectionWrapDegrees(wrapDegrees);
    const requestedHorizontalSpan = degreesToRadians(normalizedWrapDegrees);
    const maxVerticalSpan = degreesToRadians(MAX_SPHERICAL_VERTICAL_WRAP_DEGREES);
    const aspectLimitedHorizontalSpan = height > 0
        ? Math.min(requestedHorizontalSpan, maxVerticalSpan * (width / height))
        : requestedHorizontalSpan;
    const effectiveHorizontalSpan = Math.max(
        degreesToRadians(MIN_SPHERICAL_WRAP_DEGREES),
        aspectLimitedHorizontalSpan
    );
    const radius = Math.max(MIN_SPHERICAL_RADIUS, width / effectiveHorizontalSpan);
    const effectiveVerticalSpan = height / radius;

    if (!Number.isFinite(width) || !Number.isFinite(height)) {
        return {
            radius: MIN_SPHERICAL_RADIUS,
            horizontalWrapDegrees: DEFAULT_SPHERICAL_WRAP_DEGREES,
            verticalWrapDegrees: DEFAULT_SPHERICAL_WRAP_DEGREES,
        };
    }

    return {
        radius,
        horizontalWrapDegrees: radiansToDegrees(effectiveHorizontalSpan),
        verticalWrapDegrees: radiansToDegrees(effectiveVerticalSpan),
    };
}

export function projectPlanarPointToSphere(point, radius, target = new THREE.Vector3()) {
    const safeRadius = getSafeSphericalRadius(radius);
    const longitude = point.x / safeRadius;
    const latitude = point.y / safeRadius;
    const cosLatitude = Math.cos(latitude);

    return target.set(
        Math.sin(longitude) * cosLatitude * safeRadius,
        Math.sin(latitude) * safeRadius,
        Math.cos(longitude) * cosLatitude * safeRadius
    );
}

export function reprojectPointToSphere(point, radius, target = new THREE.Vector3(), center = ORIGIN) {
    const safeRadius = getSafeSphericalRadius(radius);

    target.copy(point).sub(center);

    if (target.lengthSq() < 1e-10) {
        return target.copy(center).addScaledVector(new THREE.Vector3(0, 0, 1), safeRadius);
    }

    return target.normalize().multiplyScalar(safeRadius).add(center);
}

export function projectPathsToSphere(pathsPoints, options = {}) {
    const resolution = Number.isFinite(options.radius)
        ? {
            radius: getSafeSphericalRadius(options.radius),
            horizontalWrapDegrees: normalizeSphericalProjectionWrapDegrees(options.wrapDegrees),
            verticalWrapDegrees: normalizeSphericalProjectionWrapDegrees(options.wrapDegrees),
        }
        : resolveSphericalProjectionRadius(pathsPoints, options.wrapDegrees);

    const radius = getSafeSphericalRadius(
        Number.isFinite(resolution.radius)
            ? resolution.radius
            : MIN_SPHERICAL_RADIUS
    );

    return {
        ...resolution,
        radius,
        paths: (Array.isArray(pathsPoints) ? pathsPoints : []).map((points) => (
            points.map((point) => projectPlanarPointToSphere(point, radius))
        )),
    };
}