export const MAX_GRADIENT_MAP_STOPS = 8;
export const GRADIENT_MAP_LUT_SIZE = 256;
export const DEFAULT_GRADIENT_MAP_STOPS = Object.freeze([
    Object.freeze({ id: 'shadow', position: 0, color: '#000000' }),
    Object.freeze({ id: 'midtone', position: 0.5, color: '#ff7a00' }),
    Object.freeze({ id: 'highlight', position: 1, color: '#ffffff' }),
]);

export function normalizeGradientMapColor(value, fallback = '#ff7a00') {
    if (typeof value !== 'string') return fallback;

    const normalized = value.trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(normalized)) {
        return `#${normalized.split('').map((character) => character.repeat(2)).join('')}`;
    }

    return /^[0-9a-f]{6}$/.test(normalized) ? `#${normalized}` : fallback;
}

function cloneDefaultStops() {
    return DEFAULT_GRADIENT_MAP_STOPS.map((stop) => ({ ...stop }));
}

export function createLegacyDuotoneStops(color = '#ff7a00') {
    return [
        { id: 'shadow', position: 0, color: '#000000' },
        {
            id: 'highlight',
            position: 1,
            color: normalizeGradientMapColor(color),
        },
    ];
}

export function normalizeGradientMapStops(value, fallback = DEFAULT_GRADIENT_MAP_STOPS) {
    if (!Array.isArray(value) || value.length < 2) {
        return fallback === DEFAULT_GRADIENT_MAP_STOPS
            ? cloneDefaultStops()
            : normalizeGradientMapStops(fallback, DEFAULT_GRADIENT_MAP_STOPS);
    }

    const ids = new Set();
    const normalized = value
        .slice(0, MAX_GRADIENT_MAP_STOPS)
        .map((stop, index) => {
            const parsedPosition = Number(stop?.position);
            const baseId = typeof stop?.id === 'string' && stop.id.trim()
                ? stop.id.trim()
                : `stop-${index}`;
            let id = baseId;
            let suffix = 1;
            while (ids.has(id)) {
                id = `${baseId}-${suffix++}`;
            }
            ids.add(id);

            return {
                id,
                position: Number.isFinite(parsedPosition)
                    ? Math.min(1, Math.max(0, parsedPosition))
                    : index / Math.max(1, value.length - 1),
                color: normalizeGradientMapColor(stop?.color),
                sourceIndex: index,
            };
        })
        .sort((left, right) => (
            left.position - right.position || left.sourceIndex - right.sourceIndex
        ))
        .map(({ sourceIndex: _sourceIndex, ...stop }) => stop);

    return normalized.length >= 2 ? normalized : cloneDefaultStops();
}

function parseHexColor(color) {
    const normalized = normalizeGradientMapColor(color).slice(1);
    return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
}

export function createGradientMapLut(stops, size = GRADIENT_MAP_LUT_SIZE) {
    const normalizedStops = normalizeGradientMapStops(stops);
    const normalizedSize = Math.max(2, Math.round(Number(size) || GRADIENT_MAP_LUT_SIZE));
    const data = new Uint8Array(normalizedSize * 4);
    let rightIndex = 0;

    for (let index = 0; index < normalizedSize; index++) {
        const position = index / (normalizedSize - 1);
        while (
            rightIndex < normalizedStops.length - 1
            && normalizedStops[rightIndex].position < position
        ) {
            rightIndex += 1;
        }

        const right = normalizedStops[rightIndex];
        const left = normalizedStops[Math.max(0, rightIndex - 1)] || right;
        const span = right.position - left.position;
        const amount = position <= normalizedStops[0].position
            ? 0
            : (span > 0 ? Math.min(1, Math.max(0, (position - left.position) / span)) : 1);
        const leftColor = parseHexColor(left.color);
        const rightColor = parseHexColor(right.color);
        const dataOffset = index * 4;

        for (let channel = 0; channel < 3; channel++) {
            // Interpolate encoded sRGB channel values to match CSS-style gradients.
            data[dataOffset + channel] = Math.round(
                leftColor[channel] + (rightColor[channel] - leftColor[channel]) * amount,
            );
        }
        data[dataOffset + 3] = 255;
    }

    return data;
}

export function serializeGradientMapStops(stops) {
    return normalizeGradientMapStops(stops)
        .map(({ position, color }) => `${position.toFixed(6)}:${color}`)
        .join('|');
}
