import { ShapeGeometry } from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import squareCapSvg from './cap-profiles/square.svg?raw';
import roundedCapSvg from './cap-profiles/rounded.svg?raw';
import pointedCapSvg from './cap-profiles/pointed.svg?raw';
import swallowtailCapSvg from './cap-profiles/swallowtail.svg?raw';

export const CAP_STYLE_SQUARE = 'square';
export const CAP_STYLE_ROUNDED = 'rounded';
export const CAP_STYLE_POINTED = 'pointed';
export const CAP_STYLE_SWALLOWTAIL = 'swallowtail';
export const DEFAULT_CAP_STYLE = CAP_STYLE_SQUARE;

const svgLoader = new SVGLoader();
const INTERSECTION_EPSILON = 1e-6;

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

    geometry.dispose();

    return {
        style,
        vertices,
        indices,
    };
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

const CAP_PROFILES = Object.fromEntries(
    Object.entries(CAP_PROFILE_SOURCES).map(([style, source]) => [style, buildCapProfile(style, source)])
);

export function normalizeCapStyle(capStyle, roundedCaps = false) {
    if (capStyle && CAP_PROFILES[capStyle]) {
        return capStyle;
    }

    return roundedCaps ? CAP_STYLE_ROUNDED : DEFAULT_CAP_STYLE;
}

export function getCapProfile(capStyle, roundedCaps = false) {
    return CAP_PROFILES[normalizeCapStyle(capStyle, roundedCaps)] || CAP_PROFILES[DEFAULT_CAP_STYLE];
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