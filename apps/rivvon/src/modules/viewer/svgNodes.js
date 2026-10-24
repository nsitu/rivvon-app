import { CatmullRomCurve3, Vector3 } from 'three';
import SvgPath from 'svgpath';
import { normalizeSvgNodes } from '../../../../../packages/shared-types/src/svgNodes.js';

// Expand arcs to cubic spans first so circles/ellipses retain quadrant anchors.
// Bézier handles are deliberately excluded: this mode interpolates endpoints.
export function svgPathDataToNodes(pathData) {
    const paths = [];
    let current = null;
    let x = 0;
    let y = 0;
    const finish = () => {
        if (!current) return;
        if (current.closed && current.points.length > 1) {
            const first = current.points[0];
            const last = current.points.at(-1);
            if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-9) current.points.pop();
        }
        if (current.points.length >= 2) paths.push(current);
        current = null;
    };
    new SvgPath(pathData).abs().unshort().unarc().iterate((segment) => {
        const command = segment[0];
        if (command === 'Z' || command === 'z') {
            if (current) {
                current.closed = true;
                x = current.points[0].x;
                y = current.points[0].y;
            }
            finish();
            return;
        }
        if (command === 'M') finish();
        // SVG allows drawing commands directly after closepath; they start at
        // the previous subpath's start position.
        if (!current && command !== 'M') current = { closed: false, points: [{ x, y, z: 0 }] };
        if (command === 'H') x = segment[1];
        else if (command === 'V') y = segment[1];
        else {
            x = segment.at(-2);
            y = segment.at(-1);
        }
        if (!current) current = { closed: false, points: [] };
        const last = current.points.at(-1);
        if (!last || Math.hypot(last.x - x, last.y - y) > 1e-9) {
            current.points.push({ x, y, z: 0 });
        }
    });
    finish();
    return paths;
}

// Densify before non-linear projection. The ribbon renderer then uses the same
// closed spline semantics for positions/tangents at the seam.
export function sampleSvgNodes(input) {
    return (normalizeSvgNodes(input) || []).map(({ points, closed }) => {
        const nodes = [];
        for (const point of points) {
            const vector = new Vector3(point.x, point.y, point.z);
            if (!nodes.length || vector.distanceToSquared(nodes.at(-1)) > 1e-16) nodes.push(vector);
        }
        if (closed && nodes.length > 2 && nodes[0].distanceToSquared(nodes.at(-1)) < 1e-16) nodes.pop();
        if (nodes.length < 2) return null;
        if (nodes.length === 2) return { points: nodes, nodes, closed: false };
        const curve = new CatmullRomCurve3(nodes, closed, 'centripetal');
        const divisions = Math.min(2000, Math.max(50, nodes.length * 16));
        curve.arcLengthDivisions = Math.max(200, divisions * 2);
        return { points: curve.getSpacedPoints(divisions), nodes, closed };
    }).filter(Boolean);
}
