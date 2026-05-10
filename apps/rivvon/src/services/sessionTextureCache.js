import { fetchDriveFile } from '../modules/viewer/auth.js';

const MAX_SESSION_TEXTURE_CACHE_ENTRIES = 4;
const MAX_SESSION_TEXTURE_CACHE_BYTES = 256 * 1024 * 1024;

const sessionTextureTileCache = new Map();
const sessionTextureTileInflight = new Map();

function getTextureTileCacheKey(textureSet) {
    const directId = textureSet?.id || textureSet?.textureSetId;
    if (directId) {
        return String(directId);
    }

    const tiles = Array.isArray(textureSet?.tiles) ? textureSet.tiles : [];
    return JSON.stringify(
        tiles.map((tile) => `${getTileIndex(tile)}:${tile?.driveFileId || tile?.url || ''}`)
    );
}

function getTileIndex(tile) {
    return tile?.index ?? tile?.tileIndex ?? tile?.tile_index ?? 0;
}

function getProgressTotal(tiles) {
    const totalBytes = tiles.reduce((sum, tile) => {
        return sum + (Number(tile?.fileSize ?? tile?.file_size ?? 0) || 0);
    }, 0);

    if (totalBytes > 0) {
        return totalBytes;
    }

    return tiles.length;
}

function getCurrentCachedByteSize() {
    let total = 0;
    for (const entry of sessionTextureTileCache.values()) {
        total += entry.byteSize || 0;
    }
    return total;
}

function touchTextureEntry(cacheKey) {
    const entry = sessionTextureTileCache.get(cacheKey);
    if (!entry) {
        return null;
    }

    entry.lastAccessedAt = Date.now();
    return entry;
}

function evictTextureCacheIfNeeded(preserveKey = null) {
    let totalBytes = getCurrentCachedByteSize();

    while (
        sessionTextureTileCache.size > MAX_SESSION_TEXTURE_CACHE_ENTRIES
        || totalBytes > MAX_SESSION_TEXTURE_CACHE_BYTES
    ) {
        let oldestKey = null;
        let oldestEntry = null;

        for (const [cacheKey, entry] of sessionTextureTileCache.entries()) {
            if (cacheKey === preserveKey) {
                continue;
            }

            if (!oldestEntry || entry.lastAccessedAt < oldestEntry.lastAccessedAt) {
                oldestKey = cacheKey;
                oldestEntry = entry;
            }
        }

        if (!oldestKey || !oldestEntry) {
            break;
        }

        sessionTextureTileCache.delete(oldestKey);
        totalBytes -= oldestEntry.byteSize || 0;
        console.log('[SessionTextureCache] Evicted cached texture tiles:', oldestKey);
    }
}

function cloneTileBytes(bytes) {
    if (bytes instanceof ArrayBuffer) {
        return new Uint8Array(bytes.slice(0));
    }

    if (ArrayBuffer.isView(bytes)) {
        const start = bytes.byteOffset;
        const end = bytes.byteOffset + bytes.byteLength;
        return new Uint8Array(bytes.buffer.slice(start, end));
    }

    return null;
}

function normalizeTextureTileEntry(tileEntry, cacheKey) {
    const zipFiles = {};
    let byteSize = 0;

    for (const [filename, bytes] of Object.entries(tileEntry?.zipFiles || {})) {
        const clonedBytes = cloneTileBytes(bytes);
        if (!clonedBytes) {
            continue;
        }

        zipFiles[filename] = clonedBytes;
        byteSize += clonedBytes.byteLength;
    }

    const inferredTileCount = Object.keys(zipFiles).length;
    const tileCount = Number(tileEntry?.tileCount ?? tileEntry?.tile_count) || inferredTileCount;
    const progressTotal = Number(tileEntry?.progressTotal) || byteSize || tileCount;
    const isComplete = typeof tileEntry?.isComplete === 'boolean'
        ? tileEntry.isComplete
        : tileCount > 0 && inferredTileCount >= tileCount;

    return {
        cacheKey,
        zipFiles,
        tileCount,
        layerCount: Number(tileEntry?.layerCount ?? tileEntry?.layer_count) || 0,
        variant: tileEntry?.variant || tileEntry?.cross_section_type || 'waves',
        byteSize: Number(tileEntry?.byteSize) || byteSize,
        progressTotal,
        isComplete,
        source: tileEntry?.source || 'session',
        lastAccessedAt: Date.now(),
    };
}

export function getCachedTextureTiles(textureSetOrId) {
    const cacheKey = typeof textureSetOrId === 'string'
        ? textureSetOrId
        : getTextureTileCacheKey(textureSetOrId);

    return touchTextureEntry(cacheKey);
}

export function cacheTextureTiles(textureSetOrId, tileEntry, { logPrefix = '[SessionTextureCache]' } = {}) {
    const cacheKey = typeof textureSetOrId === 'string'
        ? textureSetOrId
        : getTextureTileCacheKey(textureSetOrId || tileEntry);
    const normalizedEntry = normalizeTextureTileEntry(tileEntry, cacheKey);

    if (!normalizedEntry.isComplete) {
        return null;
    }

    sessionTextureTileCache.set(cacheKey, normalizedEntry);
    evictTextureCacheIfNeeded(cacheKey);
    console.log(`${logPrefix} Cached texture tiles:`, cacheKey, {
        source: normalizedEntry.source,
        tileCount: normalizedEntry.tileCount,
        byteSizeMB: (normalizedEntry.byteSize / 1024 / 1024).toFixed(2),
    });
    return normalizedEntry;
}

async function fetchArrayBufferWithProgress(url, onBytesReceived = null) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    }

    if (!response.body || typeof response.body.getReader !== 'function') {
        const data = await response.arrayBuffer();
        if (onBytesReceived) {
            onBytesReceived(data.byteLength);
        }
        return data;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let receivedLength = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }

        chunks.push(value);
        receivedLength += value.length;

        if (onBytesReceived) {
            onBytesReceived(value.length);
        }
    }

    const buffer = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
        buffer.set(chunk, position);
        position += chunk.length;
    }

    return buffer.buffer;
}

async function fetchRemoteTileArrayBuffer(tile, onBytesReceived = null) {
    if (tile?.driveFileId) {
        return fetchDriveFile(tile.driveFileId, onBytesReceived);
    }

    if (tile?.url && tile.url.includes('drive.google.com')) {
        const fileIdMatch = tile.url.match(/[?&]id=([^&]+)/);
        if (!fileIdMatch) {
            throw new Error('Invalid Drive URL format');
        }

        return fetchDriveFile(fileIdMatch[1], onBytesReceived);
    }

    if (!tile?.url) {
        throw new Error('Missing remote tile URL');
    }

    return fetchArrayBufferWithProgress(tile.url, onBytesReceived);
}

async function downloadRemoteTextureTiles(textureSet, { onProgress = null } = {}) {
    const tiles = Array.isArray(textureSet?.tiles) ? textureSet.tiles : [];

    if (tiles.length === 0) {
        return {
            cacheKey: getTextureTileCacheKey(textureSet),
            zipFiles: {},
            tileCount: Number(textureSet?.tile_count) || 0,
            layerCount: Number(textureSet?.layer_count) || 0,
            variant: textureSet?.cross_section_type || 'waves',
            byteSize: 0,
            progressTotal: 0,
            isComplete: false,
            source: 'remote',
        };
    }

    const progressTotal = getProgressTotal(tiles);
    const hasFileSizes = progressTotal > tiles.length;
    let downloadedProgress = 0;

    if (onProgress) {
        onProgress('downloading', 0, progressTotal);
    }

    const results = await Promise.all(
        tiles.map(async (tile) => {
            try {
                const tileIndex = getTileIndex(tile);
                const arrayBuffer = await fetchRemoteTileArrayBuffer(tile, (bytesReceived) => {
                    if (hasFileSizes) {
                        downloadedProgress += bytesReceived;
                        onProgress?.('downloading', downloadedProgress, progressTotal);
                    }
                });

                if (!hasFileSizes) {
                    downloadedProgress += 1;
                    onProgress?.('downloading', downloadedProgress, progressTotal);
                }

                return {
                    index: tileIndex,
                    bytes: new Uint8Array(arrayBuffer),
                };
            } catch (error) {
                if (!hasFileSizes) {
                    downloadedProgress += 1;
                    onProgress?.('downloading', downloadedProgress, progressTotal);
                }

                console.error(`[SessionTextureCache] Failed to download tile ${getTileIndex(tile)}:`, error);
                return {
                    index: getTileIndex(tile),
                    bytes: null,
                };
            }
        })
    );

    const zipFiles = {};
    let byteSize = 0;
    for (const result of results) {
        if (!result.bytes) {
            continue;
        }

        zipFiles[`${result.index}.ktx2`] = result.bytes;
        byteSize += result.bytes.byteLength;
    }

    return {
        cacheKey: getTextureTileCacheKey(textureSet),
        zipFiles,
        tileCount: Number(textureSet?.tile_count) || tiles.length,
        layerCount: Number(textureSet?.layer_count) || 0,
        variant: textureSet?.cross_section_type || 'waves',
        byteSize,
        progressTotal,
        isComplete: Object.keys(zipFiles).length === (Number(textureSet?.tile_count) || tiles.length),
        source: 'remote',
    };
}

export async function getOrFetchTextureTiles(textureSet, { onProgress = null } = {}) {
    const cacheKey = getTextureTileCacheKey(textureSet);
    const cached = touchTextureEntry(cacheKey);

    if (cached) {
        console.log('[SessionTextureCache] Reusing cached texture tiles:', cacheKey, { source: cached.source || 'unknown' });
        onProgress?.('downloading', cached.progressTotal, cached.progressTotal);
        return cached;
    }

    if (sessionTextureTileInflight.has(cacheKey)) {
        console.log('[SessionTextureCache] Awaiting in-flight texture tiles:', cacheKey);
        const inflightEntry = await sessionTextureTileInflight.get(cacheKey);
        onProgress?.('downloading', inflightEntry.progressTotal, inflightEntry.progressTotal);
        return inflightEntry;
    }

    const inflightPromise = downloadRemoteTextureTiles(textureSet, { onProgress })
        .then((entry) => {
            if (entry.isComplete) {
                return cacheTextureTiles(cacheKey, entry);
            }

            return entry;
        })
        .finally(() => {
            sessionTextureTileInflight.delete(cacheKey);
        });

    sessionTextureTileInflight.set(cacheKey, inflightPromise);
    return inflightPromise;
}

export function createObjectUrlsFromTextureTiles(tileEntry) {
    const urls = {};

    if (!tileEntry?.zipFiles) {
        return urls;
    }

    for (const [filename, bytes] of Object.entries(tileEntry.zipFiles)) {
        const tileIndex = Number(filename.replace(/\.ktx2$/i, ''));
        urls[tileIndex] = URL.createObjectURL(new Blob([bytes], { type: 'image/ktx2' }));
    }

    return urls;
}

export function createBlobMapFromTextureTiles(tileEntry) {
    const blobs = {};

    if (!tileEntry?.zipFiles) {
        return blobs;
    }

    for (const [filename, bytes] of Object.entries(tileEntry.zipFiles)) {
        const tileIndex = Number(filename.replace(/\.ktx2$/i, ''));
        blobs[tileIndex] = new Blob([bytes], { type: 'image/ktx2' });
    }

    return blobs;
}