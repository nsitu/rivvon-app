import { Box3, Vector3 } from 'three';
import { normalizeGridRepeatSettings } from '../../../../../packages/shared-types/src/gridRepeat.js';

// Bound CPU animation work as well as memory. Tube sides and helix sampling
// share the vertex budget, so the same cell count can have different limits.
export const GRID_REPEAT_LIMITS = Object.freeze({ paths: 2048, points: 250000, meshes: 2048, vertices: 300000 });

export class GridRepeatLimitError extends Error {
    constructor() {
        super('This grid is too complex. Reduce rows or columns, simplify the artwork, or use fewer tube sides.');
        this.name = 'GridRepeatLimitError';
    }
}

export function assertGridRepeatPointBudget(pointCount) {
    if (pointCount > GRID_REPEAT_LIMITS.points) throw new GridRepeatLimitError();
}

/** Repeat the whole artwork, keeping spline and closure metadata with each path. */
export function repeatPathGrid(descriptors, settings = {}, baseWidth = 1) {
    const options = normalizeGridRepeatSettings(settings);
    const columns = options.gridRepeatEnabled ? options.gridRepeatColumns : 1;
    const rows = options.gridRepeatEnabled ? options.gridRepeatRows : 1;
    const copies = rows * columns;
    if (copies > 1) {
        if (descriptors.length * copies > GRID_REPEAT_LIMITS.paths) throw new GridRepeatLimitError();
        assertGridRepeatPointBudget(descriptors.reduce((sum, path) => sum + path.points.length + (path.splineNodes?.length || 0), 0) * copies);
    }

    const bounds = new Box3();
    for (const { points } of descriptors) for (const point of points) bounds.expandByPoint(point);
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const gutter = Number.isFinite(baseWidth) && baseWidth > 0 ? baseWidth : 1;
    const paths = [];
    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            const sign = options.gridRepeatEnabled && options.gridRepeatCheckerboard && (row + column) % 2 ? -1 : 1;
            const dx = (column - (columns - 1) / 2) * (size.x + gutter * options.gridRepeatColumnSpacing);
            const dy = ((rows - 1) / 2 - row) * (size.y + gutter * options.gridRepeatRowSpacing);
            const transform = point => new Vector3(
                // Keep 1x1 and disabled paths bit-for-bit identical, including
                // coordinates whose precision would be lost by recentering.
                sign === 1 ? point.x + dx : 2 * center.x - point.x + dx,
                point.y + dy,
                point.z,
            );
            descriptors.forEach((path, sourcePathIndex) => paths.push({
                ...path,
                sourcePathIndex,
                points: path.points.map(transform),
                splineNodes: path.splineNodes?.map(transform),
            }));
        }
    }
    return paths;
}

/** Run before disposing the old meshes, using the same segment sizing as Ribbon. */
export function assertGridRepeatGeometryBudget(paths, width, options) {
    const settings = normalizeGridRepeatSettings(options);
    if (!settings.gridRepeatEnabled || settings.gridRepeatColumns * settings.gridRepeatRows <= 1) return;
    let meshes = 0;
    const strands = options.helixMode ? 2 : 1;
    const samples = options.helixMode ? Math.max(50, Math.ceil(50 * (1 + (options.helixPitch ?? 9) / 4))) : 50;
    const acrossVertices = options.surfaceMode === 'tube' ? (options.tubeRadialSegments ?? 8) + 1 : 2;
    let points = 0;
    for (const path of paths) {
        points += path.length;
        let length = 0;
        for (let i = 1; i < path.length; i++) length += path[i].distanceTo(path[i - 1]);
        meshes += Math.ceil(length / Math.max(0.0001, width)) * strands;
        if (meshes > GRID_REPEAT_LIMITS.meshes || meshes * (samples + 1) * acrossVertices > GRID_REPEAT_LIMITS.vertices) {
            throw new GridRepeatLimitError();
        }
    }
    assertGridRepeatPointBudget(points);
}
