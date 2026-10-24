// Portable, bounded SVG anchor data used by drawings and scene presets.
export function normalizeSvgNodes(input) {
    if (input == null) return null;
    if (!Array.isArray(input) || input.length > 2048) throw new Error('Invalid SVG node paths');
    let count = 0;
    return input.map((path) => {
        if (!Array.isArray(path?.points) || path.points.length < 2) throw new Error('Invalid SVG nodes');
        count += path.points.length;
        if (count > 100000) throw new Error('Too many SVG nodes');
        return {
            closed: path.closed === true,
            points: path.points.map((point) => {
                const result = { x: point?.x, y: point?.y, z: point?.z ?? 0 };
                if (Object.values(result).some(value => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e6)) {
                    throw new Error('Invalid SVG node coordinate');
                }
                return result;
            }),
        };
    });
}
