/**
 * Stroke smoothing pipeline for drawn paths
 * 
 * Three-stage pipeline:
 *   1. Ramer-Douglas-Peucker simplification (noise reduction)
 *   2. Chaikin's corner-cutting subdivision (smooth sharp angles)
 *   3. Catmull-Rom spline interpolation (generate smooth curve)
 */


// ─── Stage 1: Ramer-Douglas-Peucker Simplification ────────────────────────────

/**
 * Perpendicular distance from a point to a line defined by two endpoints
 * @param {{x: number, y: number}} point
 * @param {{x: number, y: number}} lineStart
 * @param {{x: number, y: number}} lineEnd
 * @returns {number}
 */
function perpendicularDistance(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const lengthSq = dx * dx + dy * dy;

    if (lengthSq === 0) {
        // lineStart and lineEnd are the same point
        const px = point.x - lineStart.x;
        const py = point.y - lineStart.y;
        return Math.sqrt(px * px + py * py);
    }

    const num = Math.abs(
        dy * point.x - dx * point.y +
        lineEnd.x * lineStart.y - lineEnd.y * lineStart.x
    );
    return num / Math.sqrt(lengthSq);
}

/**
 * Ramer-Douglas-Peucker simplification
 * Removes noisy/redundant points while preserving the intentional shape
 * @param {Array<{x: number, y: number}>} points - Raw input points
 * @param {number} epsilon - Tolerance distance in px (higher = more aggressive)
 * @returns {Array<{x: number, y: number}>} Simplified points
 */
function rdpSimplify(points, epsilon) {
    if (points.length <= 2) return [...points];

    const first = points[0];
    const last = points[points.length - 1];
    let maxDist = 0;
    let maxIndex = 0;

    for (let i = 1; i < points.length - 1; i++) {
        const dist = perpendicularDistance(points[i], first, last);
        if (dist > maxDist) {
            maxDist = dist;
            maxIndex = i;
        }
    }

    if (maxDist > epsilon) {
        const left = rdpSimplify(points.slice(0, maxIndex + 1), epsilon);
        const right = rdpSimplify(points.slice(maxIndex), epsilon);
        // Remove duplicate junction point
        return [...left.slice(0, -1), ...right];
    }

    // All intermediate points are within tolerance — keep only endpoints
    return [first, last];
}


// ─── Stage 2: Chaikin's Corner Cutting ────────────────────────────────────────

/**
 * Chaikin's corner-cutting subdivision
 * Iteratively replaces each segment with two new points at the 25%/75% marks,
 * smoothing sharp direction changes while preserving overall shape
 * @param {Array<{x: number, y: number}>} points - Input points (≥3 recommended)
 * @param {number} iterations - Number of subdivision passes (2-4 recommended)
 * @returns {Array<{x: number, y: number}>} Smoothed points
 */
function chaikinSmooth(points, iterations) {
    if (points.length < 3) return [...points];

    let current = points;

    for (let iter = 0; iter < iterations; iter++) {
        const next = [];
        // Preserve the first endpoint
        next.push({ x: current[0].x, y: current[0].y });

        for (let i = 0; i < current.length - 1; i++) {
            const p0 = current[i];
            const p1 = current[i + 1];

            // Q point at 25% along segment
            next.push({
                x: 0.75 * p0.x + 0.25 * p1.x,
                y: 0.75 * p0.y + 0.25 * p1.y
            });

            // R point at 75% along segment
            next.push({
                x: 0.25 * p0.x + 0.75 * p1.x,
                y: 0.25 * p0.y + 0.75 * p1.y
            });
        }

        // Preserve the last endpoint
        next.push({
            x: current[current.length - 1].x,
            y: current[current.length - 1].y
        });

        current = next;
    }

    return current;
}


// ─── Stage 3: Catmull-Rom Spline Interpolation ────────────────────────────────

/**
 * Evaluate one dimension of a Catmull-Rom spline at parameter t
 * Uses the standard uniform Catmull-Rom basis matrix
 * @param {number} t - Parameter in [0, 1]
 * @param {number} p0 - Control point before span start
 * @param {number} p1 - Span start
 * @param {number} p2 - Span end
 * @param {number} p3 - Control point after span end
 * @returns {number} Interpolated value
 */
function catmullRomPoint(t, p0, p1, p2, p3) {
    const t2 = t * t;
    const t3 = t2 * t;

    return 0.5 * (
        (2 * p1) +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    );
}

/**
 * Catmull-Rom spline interpolation through all control points
 * Generates a dense, smooth curve that passes exactly through every input point
 * @param {Array<{x: number, y: number}>} points - Control points to interpolate through
 * @param {number} segmentsPerSpan - Interpolated points generated per control-point span
 * @returns {Array<{x: number, y: number}>} Dense interpolated curve
 */
function catmullRomInterpolate(points, segmentsPerSpan) {
    if (points.length < 3) return [...points];

    const result = [];

    for (let i = 0; i < points.length - 1; i++) {
        // Clamp boundary control points
        const p0 = points[Math.max(i - 1, 0)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(i + 2, points.length - 1)];

        // Include the starting point of the first span
        if (i === 0) {
            result.push({ x: p1.x, y: p1.y });
        }

        for (let s = 1; s <= segmentsPerSpan; s++) {
            const t = s / segmentsPerSpan;
            result.push({
                x: catmullRomPoint(t, p0.x, p1.x, p2.x, p3.x),
                y: catmullRomPoint(t, p0.y, p1.y, p2.y, p3.y)
            });
        }
    }

    return result;
}


// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Full three-stage smoothing pipeline for a single stroke
 *
 * @param {Array<{x: number, y: number}>} points - Raw stroke points
 * @param {object} [options]
 * @param {number} [options.rdpEpsilon=2]         - RDP tolerance in pixels
 * @param {number} [options.chaikinIterations=2]   - Chaikin subdivision passes
 * @param {number} [options.splineSegments=8]      - Interpolated points per span
 * @returns {Array<{x: number, y: number}>} Smoothed points
 */
export function smoothStroke(points, options = {}) {
    const {
        rdpEpsilon = 2,
        chaikinIterations = 2,
        splineSegments = 8
    } = options;

    if (!points || points.length < 3) {
        return points ? [...points] : [];
    }

    // Stage 1 — Noise reduction
    let result = rdpSimplify(points, rdpEpsilon);

    // Guard: if RDP collapsed the stroke too aggressively, skip smoothing
    if (result.length < 3) {
        return [...points];
    }

    // Stage 2 — Corner cutting
    result = chaikinSmooth(result, chaikinIterations);

    // Stage 3 — Spline interpolation
    result = catmullRomInterpolate(result, splineSegments);

    return result;
}

/**
 * Smooth every stroke in an array
 * @param {Array<Array<{x: number, y: number}>>} strokes
 * @param {object} [options] - Passed through to smoothStroke
 * @returns {Array<Array<{x: number, y: number}>>} Smoothed strokes
 */
export function smoothStrokes(strokes, options = {}) {
    if (!strokes || strokes.length === 0) return [];
    return strokes.map(stroke => smoothStroke(stroke, options));
}
