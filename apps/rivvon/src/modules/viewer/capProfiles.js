import {
    CanvasTexture,
    ClampToEdgeWrapping,
    LinearFilter,
    Shape,
    ShapeGeometry,
} from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import squareCapSvg from './cap-profiles/square.svg?raw';
import roundedCapSvg from './cap-profiles/rounded.svg?raw';
import pointedCapSvg from './cap-profiles/pointed.svg?raw';
import swallowtailCapSvg from './cap-profiles/swallowtail.svg?raw';

export const CAP_STYLE_SQUARE = 'square';
export const CAP_STYLE_ROUNDED = 'rounded';
export const CAP_STYLE_POINTED = 'pointed';
export const CAP_STYLE_SWALLOWTAIL = 'swallowtail';
export const CAP_STYLE_ORGANIC = 'organic';
export const DEFAULT_CAP_STYLE = CAP_STYLE_SQUARE;

const svgLoader = new SVGLoader();
const INTERSECTION_EPSILON = 1e-6;
const ORGANIC_BASE_SAMPLE_COUNT = 72;
const DEFAULT_CAP_MASK_RESOLUTION = 512;
const DEFAULT_CAP_MASK_TIP_FADE = 0.18;
const DEFAULT_CAP_MASK_SDF_SPREAD = 0.08;
const CAP_MASK_TEXTURE_CACHE = new Map();

// Normalized cap profile format:
// - the full SVG width maps to the existing end segment length
// - the full SVG height maps to the full ribbon width
// - the filled silhouette defines what remains after subtracting the cap cut
// - the join edge is the right edge of the SVG
const CAP_PROFILE_SOURCES = {
    [CAP_STYLE_SQUARE]: {
        svgText: squareCapSvg,
        curveSegments: 1,
    },
    [CAP_STYLE_ROUNDED]: {
        svgText: roundedCapSvg,
        curveSegments: 32,
    },
    [CAP_STYLE_POINTED]: {
        svgText: pointedCapSvg,
        curveSegments: 1,
    },
    [CAP_STYLE_SWALLOWTAIL]: {
        svgText: swallowtailCapSvg,
        curveSegments: 1,
    }
};

function parseSvgSize(svgText) {
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgElement = svgDoc.querySelector('svg');
    const viewBox = svgElement?.getAttribute('viewBox');

    if (viewBox) {
        const [, , width, height] = viewBox.trim().split(/[\s,]+/).map(Number);
        if (width > 0 && height > 0) {
            return { width, height };
        }
    }

    return {
        width: Number(svgElement?.getAttribute('width')) || 100,
        height: Number(svgElement?.getAttribute('height')) || 100,
    };
}

function buildCapProfile(style, source) {
    const { width, height } = parseSvgSize(source.svgText);
    const svgData = svgLoader.parse(source.svgText);
    const shapes = [];

    for (const path of svgData.paths) {
        shapes.push(...SVGLoader.createShapes(path));
    }

    if (shapes.length === 0) {
        throw new Error(`[CapProfiles] No filled shape found for cap style: ${style}`);
    }

    if (shapes.length > 1) {
        console.warn(`[CapProfiles] Cap style ${style} defines multiple filled shapes; only the first will be used.`);
    }

    const geometry = new ShapeGeometry(shapes[0], source.curveSegments);
    const profile = buildProfileFromGeometry(style, geometry, width, height);
    geometry.dispose();
    return profile;
}

function buildProfileFromGeometry(style, geometry, width = 1, height = 1) {
    const positionAttr = geometry.getAttribute('position');
    const indexAttr = geometry.getIndex();
    const vertices = [];

    for (let index = 0; index < positionAttr.count; index++) {
        vertices.push({
            u: positionAttr.getX(index) / width,
            v: positionAttr.getY(index) / height,
        });
    }

    const indices = indexAttr
        ? Array.from(indexAttr.array)
        : Array.from({ length: positionAttr.count }, (_, index) => index);

    return {
        style,
        vertices,
        indices,
    };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(start, end, t) {
    return start + (end - start) * t;
}

function smoothstep(edge0, edge1, value) {
    if (edge1 <= edge0) {
        return value >= edge1 ? 1 : 0;
    }

    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

function xmur3(seedText) {
    let hash = 1779033703 ^ seedText.length;

    for (let index = 0; index < seedText.length; index++) {
        hash = Math.imul(hash ^ seedText.charCodeAt(index), 3432918353);
        hash = (hash << 13) | (hash >>> 19);
    }

    return () => {
        hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
        hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
        return (hash ^= hash >>> 16) >>> 0;
    };
}

function mulberry32(seed) {
    return () => {
        let t = (seed += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function seededRandom(seedText) {
    const seedFn = xmur3(String(seedText));
    return mulberry32(seedFn());
}

function randomBetween(rng, min, max) {
    return min + (max - min) * rng();
}

function createOrganicBrushShape(rng, sampleCount = ORGANIC_BASE_SAMPLE_COUNT) {
    const leftEdgePoints = [];

    const envelopeExponent = randomBetween(rng, 0.85, 1.35);
    const baseInset = randomBetween(rng, 0.05, 0.18);
    const maxPush = randomBetween(rng, 0.45, 0.72);
    const asymmetryUp = randomBetween(rng, 0.03, 0.13);
    const asymmetryDown = randomBetween(rng, 0.03, 0.13);
    const lobeFreqA = randomBetween(rng, 12, 24);
    const lobeFreqB = randomBetween(rng, 28, 56);
    const lobeFreqC = randomBetween(rng, 58, 96);
    const lobeAmpA = randomBetween(rng, 0.02, 0.085);
    const lobeAmpB = randomBetween(rng, 0.01, 0.055);
    const lobeAmpC = randomBetween(rng, 0.004, 0.028);
    const lobePhaseA = randomBetween(rng, 0, Math.PI * 2);
    const lobePhaseB = randomBetween(rng, 0, Math.PI * 2);
    const lobePhaseC = randomBetween(rng, 0, Math.PI * 2);

    for (let index = 0; index <= sampleCount; index++) {
        const v = index / sampleCount;
        const centerWeight = 1 - Math.abs(v * 2 - 1);
        const tipEnvelope = Math.pow(centerWeight, envelopeExponent);
        const asymmetry = asymmetryUp * Math.pow(v, 1.7) - asymmetryDown * Math.pow(1 - v, 2.1);

        const feathering =
            lobeAmpA * Math.sin(v * lobeFreqA + lobePhaseA)
            + lobeAmpB * Math.sin(v * lobeFreqB + lobePhaseB)
            + lobeAmpC * Math.sin(v * lobeFreqC + lobePhaseC);

        const rawU = baseInset + tipEnvelope * maxPush + asymmetry + feathering;
        leftEdgePoints.push({
            u: clamp(rawU, 0.02, 0.94),
            v,
        });
    }

    const shape = new Shape();
    shape.moveTo(1, 0);
    shape.lineTo(leftEdgePoints[0].u, leftEdgePoints[0].v);

    for (let index = 1; index < leftEdgePoints.length; index++) {
        const point = leftEdgePoints[index];
        shape.lineTo(point.u, point.v);
    }

    shape.lineTo(1, 1);
    shape.closePath();
    return shape;
}

function buildOrganicBrushCapProfile() {
    return buildOrganicBrushCapProfileForVariation('organic-default');
}

function buildOrganicBrushCapProfileForVariation(variationKey) {
    const rng = seededRandom(variationKey);
    const sampleCount = Math.round(randomBetween(rng, 56, 88));
    const detail = Math.round(randomBetween(rng, 48, 84));
    const geometry = new ShapeGeometry(createOrganicBrushShape(rng, sampleCount), detail);
    const profile = buildProfileFromGeometry(CAP_STYLE_ORGANIC, geometry, 1, 1);
    geometry.dispose();
    return profile;
}

function getTriangleIntervalAtU(a, b, c, u) {
    const values = [];
    const edges = [[a, b], [b, c], [c, a]];

    for (const [start, end] of edges) {
        const du = end.u - start.u;

        if (Math.abs(du) < INTERSECTION_EPSILON) {
            if (Math.abs(u - start.u) < INTERSECTION_EPSILON) {
                values.push(start.v, end.v);
            }
            continue;
        }

        const t = (u - start.u) / du;
        if (t < -INTERSECTION_EPSILON || t > 1 + INTERSECTION_EPSILON) {
            continue;
        }

        values.push(start.v + (end.v - start.v) * t);
    }

    if (values.length < 2) {
        return null;
    }

    values.sort((left, right) => left - right);
    return [
        Math.max(0, values[0]),
        Math.min(1, values[values.length - 1]),
    ];
}

function mergeIntervals(intervals) {
    if (intervals.length === 0) {
        return [];
    }

    const sorted = intervals
        .map(([start, end]) => [Math.min(start, end), Math.max(start, end)])
        .sort((left, right) => left[0] - right[0]);
    const merged = [sorted[0]];

    for (let index = 1; index < sorted.length; index++) {
        const current = sorted[index];
        const previous = merged[merged.length - 1];

        if (current[0] <= previous[1] + INTERSECTION_EPSILON) {
            previous[1] = Math.max(previous[1], current[1]);
        } else {
            merged.push(current);
        }
    }

    return merged;
}

function getProfileBoundaryEdges(profile) {
    if (profile.boundaryEdges) {
        return profile.boundaryEdges;
    }

    const edgeCounts = new Map();

    for (let index = 0; index < profile.indices.length; index += 3) {
        const triangle = [
            profile.indices[index],
            profile.indices[index + 1],
            profile.indices[index + 2],
        ];

        for (let edgeIndex = 0; edgeIndex < 3; edgeIndex++) {
            const start = triangle[edgeIndex];
            const end = triangle[(edgeIndex + 1) % 3];
            const key = start < end ? `${start}:${end}` : `${end}:${start}`;
            edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
        }
    }

    profile.boundaryEdges = Array.from(edgeCounts.entries())
        .filter(([, count]) => count === 1)
        .map(([key]) => {
            const [startIndex, endIndex] = key.split(':').map(Number);
            return {
                start: profile.vertices[startIndex],
                end: profile.vertices[endIndex],
            };
        });

    return profile.boundaryEdges;
}

function distanceToSegment(pointU, pointV, start, end) {
    const segmentU = end.u - start.u;
    const segmentV = end.v - start.v;
    const lengthSq = segmentU * segmentU + segmentV * segmentV;

    if (lengthSq <= INTERSECTION_EPSILON) {
        const du = pointU - start.u;
        const dv = pointV - start.v;
        return Math.sqrt(du * du + dv * dv);
    }

    const t = clamp(
        ((pointU - start.u) * segmentU + (pointV - start.v) * segmentV) / lengthSq,
        0,
        1
    );
    const closestU = start.u + segmentU * t;
    const closestV = start.v + segmentV * t;
    const deltaU = pointU - closestU;
    const deltaV = pointV - closestV;
    return Math.sqrt(deltaU * deltaU + deltaV * deltaV);
}

function isPointInsideIntervals(intervals, v) {
    return intervals.some(([start, end]) => v >= start && v <= end);
}

function buildCapMaskTexture(profile, options = {}) {
    if (typeof document === 'undefined') {
        return null;
    }

    const resolution = Math.max(32, Math.round(options.resolution || DEFAULT_CAP_MASK_RESOLUTION));
    const spread = Math.max(1e-4, options.spread ?? DEFAULT_CAP_MASK_SDF_SPREAD);
    const canvas = document.createElement('canvas');
    canvas.width = resolution;
    canvas.height = resolution;

    const context = canvas.getContext('2d');
    if (!context) {
        return null;
    }

    const imageData = context.createImageData(resolution, resolution);
    const { data } = imageData;
    const boundaryEdges = getProfileBoundaryEdges(profile);
    const columnSamples = Array.from({ length: resolution }, (_, x) => {
        const u = (x + 0.5) / resolution;
        return {
            u,
            intervals: sampleCapIntervals(profile, u),
        };
    });

    for (let x = 0; x < resolution; x++) {
        const { u, intervals } = columnSamples[x];

        for (let y = 0; y < resolution; y++) {
            const v = 1 - ((y + 0.5) / resolution);
            const inside = isPointInsideIntervals(intervals, v);
            let minDistance = Infinity;

            for (const edge of boundaryEdges) {
                minDistance = Math.min(minDistance, distanceToSegment(u, v, edge.start, edge.end));
            }

            const signedDistance = inside ? minDistance : -minDistance;
            const encodedDistance = clamp(0.5 + signedDistance / (2 * spread), 0, 1);
            const alpha = Math.round(encodedDistance * 255);
            const pixelIndex = (y * resolution + x) * 4;

            data[pixelIndex] = 255;
            data[pixelIndex + 1] = 255;
            data[pixelIndex + 2] = 255;
            data[pixelIndex + 3] = alpha;
        }
    }

    context.putImageData(imageData, 0, 0);

    const texture = new CanvasTexture(canvas);
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.userData.capMaskSdfSpread = spread;
    texture.needsUpdate = true;

    return texture;
}

const CAP_PROFILES = Object.fromEntries(
    Object.entries(CAP_PROFILE_SOURCES).map(([style, source]) => [style, buildCapProfile(style, source)])
);

CAP_PROFILES[CAP_STYLE_ORGANIC] = buildOrganicBrushCapProfile();

const KNOWN_CAP_STYLES = new Set([
    CAP_STYLE_SQUARE,
    CAP_STYLE_ROUNDED,
    CAP_STYLE_POINTED,
    CAP_STYLE_SWALLOWTAIL,
    CAP_STYLE_ORGANIC,
]);

export function normalizeCapStyle(capStyle, roundedCaps = false) {
    if (capStyle && KNOWN_CAP_STYLES.has(capStyle)) {
        return capStyle;
    }

    return roundedCaps ? CAP_STYLE_ROUNDED : DEFAULT_CAP_STYLE;
}

export function getCapProfile(capStyle, roundedCaps = false, variationKey = null) {
    const normalizedStyle = normalizeCapStyle(capStyle, roundedCaps);

    if (normalizedStyle === CAP_STYLE_ORGANIC) {
        const key = variationKey ?? `${Date.now()}-${Math.random()}`;
        return buildOrganicBrushCapProfileForVariation(key);
    }

    return CAP_PROFILES[normalizedStyle] || CAP_PROFILES[DEFAULT_CAP_STYLE];
}

export function getCapMaskTexture(capStyle, roundedCaps = false, variationKey = null, options = {}) {
    const normalizedStyle = normalizeCapStyle(capStyle, roundedCaps);
    const tipFadeWidth = Math.max(0, Math.min(1, options.tipFadeWidth ?? DEFAULT_CAP_MASK_TIP_FADE));
    const spread = Math.max(1e-4, options.spread ?? DEFAULT_CAP_MASK_SDF_SPREAD);
    const shouldCache = normalizedStyle !== CAP_STYLE_ORGANIC;
    const cacheKey = shouldCache
        ? `${normalizedStyle}:${roundedCaps ? 1 : 0}:${options.resolution || DEFAULT_CAP_MASK_RESOLUTION}:${spread}`
        : null;

    if (cacheKey && CAP_MASK_TEXTURE_CACHE.has(cacheKey)) {
        return {
            texture: CAP_MASK_TEXTURE_CACHE.get(cacheKey),
            owned: false,
            spread,
            tipFadeWidth,
        };
    }

    const profileKey = normalizedStyle === CAP_STYLE_ORGANIC ? variationKey : null;
    const profile = getCapProfile(normalizedStyle, roundedCaps, profileKey);
    const texture = buildCapMaskTexture(profile, options);

    if (!texture) {
        return { texture: null, owned: false, spread, tipFadeWidth };
    }

    if (cacheKey) {
        CAP_MASK_TEXTURE_CACHE.set(cacheKey, texture);
        return { texture, owned: false, spread, tipFadeWidth };
    }

    return {
        texture,
        owned: true,
        spread,
        tipFadeWidth,
    };
}

export function sampleCapIntervals(profile, normalizedU) {
    if (!profile?.vertices?.length || !profile?.indices?.length) {
        return [];
    }

    const u = Math.max(0, Math.min(1, normalizedU));
    const intervals = [];

    for (let index = 0; index < profile.indices.length; index += 3) {
        const triangle = getTriangleIntervalAtU(
            profile.vertices[profile.indices[index]],
            profile.vertices[profile.indices[index + 1]],
            profile.vertices[profile.indices[index + 2]],
            u
        );

        if (triangle) {
            intervals.push(triangle);
        }
    }

    return mergeIntervals(intervals);
}