import * as THREE from 'three';

export const DEFAULT_SPHERICAL_WRAP_DEGREES = 100;
export const MIN_SPHERICAL_WRAP_DEGREES = 15;
export const MAX_SPHERICAL_WRAP_DEGREES = 360;
export const MIN_SPHERICAL_LATITUDE_DEGREES = -90;
export const MAX_SPHERICAL_LATITUDE_DEGREES = 90;
export const MAX_AUTO_SPHERICAL_VERTICAL_WRAP_DEGREES = 170;
const MIN_MAPPABLE_LATITUDE_DEGREES = -89.999;
const MAX_MAPPABLE_LATITUDE_DEGREES = 89.999;
const MIN_SPHERICAL_RADIUS = 1;
const ORIGIN = new THREE.Vector3(0, 0, 0);

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function degreesToRadians(value) {
    return value * (Math.PI / 180);
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

function normalizeSphericalProjectionLatitudeDegrees(value, fallback) {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return clamp(
        parsed,
        MIN_SPHERICAL_LATITUDE_DEGREES,
        MAX_SPHERICAL_LATITUDE_DEGREES
    );
}

export function deriveSphericalProjectionLatitudeBounds(
    horizontalWrapDegrees,
    artworkAspectRatio = 1
) {
    const horizontal = normalizeSphericalProjectionWrapDegrees(horizontalWrapDegrees);
    const ratio = Number(artworkAspectRatio);
    const safeRatio = Number.isFinite(ratio) && ratio >= 0 ? ratio : 1;

    const verticalSpanDegrees = clamp(
        horizontal * safeRatio,
        0,
        MAX_AUTO_SPHERICAL_VERTICAL_WRAP_DEGREES
    );

    return {
        lower: -verticalSpanDegrees / 2,
        upper: verticalSpanDegrees / 2,
    };
}

export function normalizeSphericalProjectionLatitudeBounds(
    lowerValue,
    upperValue,
    fallbackBounds = deriveSphericalProjectionLatitudeBounds(DEFAULT_SPHERICAL_WRAP_DEGREES)
) {
    let lower = normalizeSphericalProjectionLatitudeDegrees(
        lowerValue,
        fallbackBounds.lower
    );
    let upper = normalizeSphericalProjectionLatitudeDegrees(
        upperValue,
        fallbackBounds.upper
    );

    if (upper < lower) {
        [lower, upper] = [upper, lower];
    }

    return { lower, upper };
}

export function getSphericalProjectionArtworkAspectRatio(pathsPoints) {
    const allPoints = Array.isArray(pathsPoints) ? pathsPoints.flat() : [];

    if (allPoints.length < 2) {
        return 1;
    }

    const box = new THREE.Box3().setFromPoints(allPoints);
    const size = box.getSize(new THREE.Vector3());

    if (!Number.isFinite(size.x) || !Number.isFinite(size.y)) {
        return 1;
    }

    if (size.x <= 1e-6) {
        return size.y <= 1e-6 ? 1 : MAX_AUTO_SPHERICAL_VERTICAL_WRAP_DEGREES;
    }

    return Math.max(0, size.y / size.x);
}

export function resolveSphericalProjectionRadius(
    pathsPoints,
    wrapDegrees = DEFAULT_SPHERICAL_WRAP_DEGREES,
    lowerLatitudeDegrees = null,
    upperLatitudeDegrees = null
) {
    const allPoints = Array.isArray(pathsPoints) ? pathsPoints.flat() : [];
    const normalizedHorizontalWrapDegrees = normalizeSphericalProjectionWrapDegrees(wrapDegrees);
    const aspectRatio = getSphericalProjectionArtworkAspectRatio(pathsPoints);
    const automaticLatitudeBounds = deriveSphericalProjectionLatitudeBounds(
        normalizedHorizontalWrapDegrees,
        aspectRatio
    );
    const latitudeBounds = normalizeSphericalProjectionLatitudeBounds(
        lowerLatitudeDegrees,
        upperLatitudeDegrees,
        automaticLatitudeBounds
    );

    if (allPoints.length < 2) {
        return {
            radius: MIN_SPHERICAL_RADIUS,
            horizontalWrapDegrees: normalizedHorizontalWrapDegrees,
            lowerLatitudeDegrees: latitudeBounds.lower,
            upperLatitudeDegrees: latitudeBounds.upper,
            center: new THREE.Vector3(),
            width: 0,
            height: 0,
        };
    }

    const box = new THREE.Box3().setFromPoints(allPoints);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const width = Math.max(size.x, 1e-6);
    const height = Math.max(size.y, 0);
    const horizontalSpan = degreesToRadians(normalizedHorizontalWrapDegrees);
    const radius = Math.max(MIN_SPHERICAL_RADIUS, width / horizontalSpan);

    if (!Number.isFinite(width) || !Number.isFinite(height)) {
        return {
            radius: MIN_SPHERICAL_RADIUS,
            horizontalWrapDegrees: normalizedHorizontalWrapDegrees,
            lowerLatitudeDegrees: latitudeBounds.lower,
            upperLatitudeDegrees: latitudeBounds.upper,
            center: new THREE.Vector3(),
            width: 0,
            height: 0,
        };
    }

    return {
        radius,
        horizontalWrapDegrees: normalizedHorizontalWrapDegrees,
        lowerLatitudeDegrees: latitudeBounds.lower,
        upperLatitudeDegrees: latitudeBounds.upper,
        center,
        width,
        height,
    };
}

export function projectPlanarPointToSphere(point, radius, target = new THREE.Vector3(), mapping = null) {
    const safeRadius = getSafeSphericalRadius(radius);
    const longitude = mapping
        ? ((point.x - mapping.center.x) / Math.max(mapping.width, 1e-6))
            * degreesToRadians(mapping.horizontalWrapDegrees)
        : point.x / safeRadius;
    const normalizedArtworkY = mapping
        ? clamp(
            ((point.y - mapping.center.y) / Math.max(mapping.height, 1e-6)) + 0.5,
            0,
            1
        )
        : null;
    const mappedLatitudeDegrees = mapping
        ? mapping.lowerLatitudeDegrees
            + normalizedArtworkY
                * (mapping.upperLatitudeDegrees - mapping.lowerLatitudeDegrees)
        : null;
    const latitude = mapping
        ? degreesToRadians(clamp(
            mappedLatitudeDegrees,
            MIN_MAPPABLE_LATITUDE_DEGREES,
            MAX_MAPPABLE_LATITUDE_DEGREES
        ))
        : point.y / safeRadius;
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
    const resolution = resolveSphericalProjectionRadius(
        pathsPoints,
        options.wrapDegrees,
        options.lowerLatitudeDegrees,
        options.upperLatitudeDegrees
    );

    const radius = getSafeSphericalRadius(
        Number.isFinite(options.radius) ? options.radius : resolution.radius
    );

    return {
        ...resolution,
        radius,
        paths: (Array.isArray(pathsPoints) ? pathsPoints : []).map((points) => (
            points.map((point) => projectPlanarPointToSphere(point, radius, new THREE.Vector3(), resolution))
        )),
    };
}
