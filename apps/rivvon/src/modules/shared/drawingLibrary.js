import * as THREE from 'three';

const DRAWING_KIND_VALUES = new Set(['gesture', 'walk', 'text', 'emoji', 'svg']);
const DRAWING_STORAGE_PROVIDER_VALUES = new Set(['local', 'google-drive', 'r2']);

function normalizeFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTimestamp(value, fallback = Date.now()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeText(value, fallback = '') {
    return typeof value === 'string' ? value.trim() : fallback;
}

function cloneSerializable(value) {
    if (!value || typeof value !== 'object') {
        return value ?? null;
    }

    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

function toPlainPoint(point) {
    if (!point || typeof point !== 'object') {
        return null;
    }

    const x = normalizeFiniteNumber(point.x, null);
    const y = normalizeFiniteNumber(point.y, null);
    const z = normalizeFiniteNumber(point.z, 0);

    if (x === null || y === null) {
        return null;
    }

    return { x, y, z };
}

function getKindLabel(kind) {
    switch (normalizeDrawingKind(kind)) {
        case 'gesture':
            return 'Gesture';
        case 'walk':
            return 'Walk';
        case 'text':
            return 'Text';
        case 'emoji':
            return 'Emoji';
        case 'svg':
            return 'SVG';
        default:
            return 'Drawing';
    }
}

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function getBounds(paths) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const path of paths) {
        for (const point of path) {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
        return null;
    }

    return {
        minX,
        maxX,
        minY,
        maxY,
        width: Math.max(maxX - minX, 1),
        height: Math.max(maxY - minY, 1),
    };
}

export function normalizeDrawingKind(kind) {
    return DRAWING_KIND_VALUES.has(kind) ? kind : 'gesture';
}

export function normalizeDrawingStorageProvider(storageProvider) {
    return DRAWING_STORAGE_PROVIDER_VALUES.has(storageProvider) ? storageProvider : 'local';
}

export function serializeDrawingPaths(paths) {
    if (!Array.isArray(paths)) {
        return [];
    }

    return paths
        .map((path) => {
            if (!Array.isArray(path)) {
                return [];
            }

            return path
                .map(toPlainPoint)
                .filter(Boolean);
        })
        .filter((path) => path.length >= 2);
}

export function inflateDrawingPaths(paths) {
    return serializeDrawingPaths(paths).map((path) => path.map((point) => new THREE.Vector3(point.x, point.y, point.z)));
}

export function countDrawingPoints(paths) {
    return serializeDrawingPaths(paths).reduce((total, path) => total + path.length, 0);
}

export function createDefaultDrawingName(kind, createdAt = Date.now()) {
    const timestamp = new Date(normalizeTimestamp(createdAt))
        .toISOString()
        .slice(0, 16)
        .replace('T', ' ');

    return `${getKindLabel(kind)} ${timestamp}`;
}

export function createDrawingThumbnailDataUrl(paths, options = {}) {
    const serializedPaths = serializeDrawingPaths(paths);
    if (!serializedPaths.length) {
        return null;
    }

    const bounds = getBounds(serializedPaths);
    if (!bounds) {
        return null;
    }

    const size = Math.max(64, normalizeFiniteNumber(options.size, 256));
    const padding = Math.max(8, normalizeFiniteNumber(options.padding, 22));
    const stroke = sanitizeText(options.stroke, '#f5f5f5') || '#f5f5f5';
    const background = sanitizeText(options.background, '#050505') || '#050505';
    const availableWidth = Math.max(1, size - padding * 2);
    const availableHeight = Math.max(1, size - padding * 2);
    const scale = Math.min(availableWidth / bounds.width, availableHeight / bounds.height);
    const requestedStrokeWidth = Number(options.strokeWidth);
    const strokeWidth = Number.isFinite(requestedStrokeWidth)
        ? Math.max(0.9, requestedStrokeWidth)
        : Math.max(1.15, Math.min(3.2, scale * 0.1));
    const extraX = (availableWidth - bounds.width * scale) / 2;
    const extraY = (availableHeight - bounds.height * scale) / 2;

    const polylines = serializedPaths.map((path) => {
        const points = path
            .map((point) => {
                const x = padding + extraX + (point.x - bounds.minX) * scale;
                const y = padding + extraY + (bounds.maxY - point.y) * scale;
                return `${x.toFixed(2)},${y.toFixed(2)}`;
            })
            .join(' ');

        return `<polyline points="${points}" fill="none" stroke="${escapeXml(stroke)}" stroke-linecap="round" stroke-linejoin="round" stroke-width="${strokeWidth}" />`;
    });

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="28" fill="${escapeXml(background)}" />${polylines.join('')}</svg>`;

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function createDrawingDocument(input = {}) {
    const serializedPaths = serializeDrawingPaths(input.paths || input.geometry || []);
    if (!serializedPaths.length) {
        throw new Error('Saved drawing requires at least one path with two points');
    }

    const createdAt = normalizeTimestamp(input.createdAt ?? input.created_at);
    const id = sanitizeText(input.id, '') || null;
    const parentDrawingId = sanitizeText(input.parentDrawingId ?? input.parent_drawing_id, '') || null;
    const cachedFrom = sanitizeText(input.cachedFrom ?? input.cached_from, '') || null;
    const rootDrawingId = sanitizeText(input.rootDrawingId ?? input.root_drawing_id, '')
        || cachedFrom
        || parentDrawingId
        || id;
    const kind = normalizeDrawingKind(input.kind);
    const name = sanitizeText(input.name, '') || createDefaultDrawingName(kind, createdAt);
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    const storageProvider = normalizeDrawingStorageProvider(input.storageProvider ?? input.storage_provider);

    return {
        id,
        kind,
        name,
        description,
        storage_provider: storageProvider,
        status: sanitizeText(input.status, '') || 'complete',
        paths: serializedPaths,
        path_count: serializedPaths.length,
        point_count: countDrawingPoints(serializedPaths),
        thumbnail_data_url: input.thumbnailDataUrl || input.thumbnail_data_url || createDrawingThumbnailDataUrl(serializedPaths),
        source: cloneSerializable(input.source),
        cached_from: cachedFrom,
        parent_drawing_id: parentDrawingId,
        root_drawing_id: rootDrawingId,
        created_at: createdAt,
        updated_at: normalizeTimestamp(input.updatedAt ?? input.updated_at, createdAt),
    };
}