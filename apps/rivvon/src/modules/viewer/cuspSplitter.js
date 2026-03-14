/**
 * Cusp detection and path splitting
 *
 * Detects sharp corners (cusps) in a point sequence and splits the path
 * at each cusp into separate subpaths. The cusp point is duplicated as
 * the endpoint of one subpath and the start of the next, so each subpath
 * gets its own rounded ribbon cap at the split.
 *
 * Two variants are exported:
 *   - splitAtCusps2D  — works on {x, y} objects (drawing strokes)
 *   - splitAtCusps3D  — works on THREE.Vector3     (text / emoji / SVG)
 */

// ─── 2D variant (drawing strokes) ─────────────────────────────────────────────

/**
 * Compute the turning angle (in radians) at point `i` in a 2D polyline.
 * Returns 0 for collinear points, π for a full reversal.
 */
function turningAngle2D(prev, curr, next) {
    const d1x = curr.x - prev.x;
    const d1y = curr.y - prev.y;
    const d2x = next.x - curr.x;
    const d2y = next.y - curr.y;

    const len1 = Math.sqrt(d1x * d1x + d1y * d1y);
    const len2 = Math.sqrt(d2x * d2x + d2y * d2y);
    if (len1 === 0 || len2 === 0) return 0;

    const dot = (d1x * d2x + d1y * d2y) / (len1 * len2);
    return Math.acos(Math.max(-1, Math.min(1, dot)));
}

/**
 * Split a 2D point array at cusps (sharp corners).
 *
 * @param {Array<{x: number, y: number}>} points
 * @param {number} [angleThresholdDeg=60] - Minimum turning angle (degrees) to
 *   consider a cusp.  60° catches aggressive corners; raise to 90° for only
 *   near-right-angle or sharper bends.
 * @returns {Array<Array<{x: number, y: number}>>} One or more subpaths.
 *   Each subpath shares its boundary point with the adjacent subpath.
 */
export function splitAtCusps2D(points, angleThresholdDeg = 60) {
    if (!points || points.length < 3) return [points];

    const threshold = (180 - angleThresholdDeg) * Math.PI / 180;
    const subpaths = [];
    let current = [points[0]];

    for (let i = 1; i < points.length - 1; i++) {
        current.push(points[i]);

        const angle = turningAngle2D(points[i - 1], points[i], points[i + 1]);

        if (angle >= threshold) {
            // Cusp detected — finish this subpath and start a new one
            subpaths.push(current);
            current = [{ x: points[i].x, y: points[i].y }]; // duplicate cusp point
        }
    }

    // Push final point and last subpath
    current.push(points[points.length - 1]);
    subpaths.push(current);

    // Only return split result if we actually split
    return subpaths;
}


// ─── 3D variant (THREE.Vector3 paths) ─────────────────────────────────────────

/**
 * Compute the turning angle at point `i` in a 3D polyline.
 */
function turningAngle3D(prev, curr, next) {
    const d1x = curr.x - prev.x;
    const d1y = curr.y - prev.y;
    const d1z = curr.z - prev.z;
    const d2x = next.x - curr.x;
    const d2y = next.y - curr.y;
    const d2z = next.z - curr.z;

    const len1 = Math.sqrt(d1x * d1x + d1y * d1y + d1z * d1z);
    const len2 = Math.sqrt(d2x * d2x + d2y * d2y + d2z * d2z);
    if (len1 === 0 || len2 === 0) return 0;

    const dot = (d1x * d2x + d1y * d2y + d1z * d2z) / (len1 * len2);
    return Math.acos(Math.max(-1, Math.min(1, dot)));
}

/**
 * Split a 3D point array at cusps.
 *
 * @param {Array<THREE.Vector3>} points
 * @param {number} [angleThresholdDeg=60] - Minimum turning angle (degrees)
 * @returns {Array<Array<THREE.Vector3>>} One or more subpaths.
 */
export function splitAtCusps3D(points, angleThresholdDeg = 60) {
    if (!points || points.length < 3) return [points];

    const threshold = (180 - angleThresholdDeg) * Math.PI / 180;
    const subpaths = [];
    let current = [points[0]];

    for (let i = 1; i < points.length - 1; i++) {
        current.push(points[i]);

        const angle = turningAngle3D(points[i - 1], points[i], points[i + 1]);

        if (angle >= threshold) {
            subpaths.push(current);
            current = [points[i].clone()]; // duplicate cusp point
        }
    }

    current.push(points[points.length - 1]);
    subpaths.push(current);

    return subpaths;
}

/**
 * Split every path in an array of 3D point arrays at cusps.
 * Paths that contain no cusps pass through unchanged.
 *
 * @param {Array<Array<THREE.Vector3>>} pathsPoints
 * @param {number} [angleThresholdDeg=60]
 * @returns {Array<Array<THREE.Vector3>>}
 */
export function splitAllPathsAtCusps3D(pathsPoints, angleThresholdDeg = 60) {
    if (!pathsPoints || pathsPoints.length === 0) return pathsPoints;
    return pathsPoints.flatMap(path => splitAtCusps3D(path, angleThresholdDeg));
}
