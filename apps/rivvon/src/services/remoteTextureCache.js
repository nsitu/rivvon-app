import { fetchDriveFile } from '../modules/viewer/auth.js';

const MAX_REMOTE_TEXTURE_CACHE_ENTRIES = 4;
const MAX_REMOTE_TEXTURE_CACHE_BYTES = 256 * 1024 * 1024;

const remoteTextureTileCache = new Map();
const remoteTextureTileInflight = new Map();

function getRemoteTextureCacheKey(textureSet) {
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
    for (const entry of remoteTextureTileCache.values()) {
        total += entry.byteSize || 0;
    }
    return total;
}

function touchRemoteTextureEntry(cacheKey) {
    const entry = remoteTextureTileCache.get(cacheKey);
    if (!entry) {
        return null;
    }

    entry.lastAccessedAt = Date.now();
    return entry;
}

function evictRemoteTextureCacheIfNeeded(preserveKey = null) {
    let totalBytes = getCurrentCachedByteSize();

    while (
        remoteTextureTileCache.size > MAX_REMOTE_TEXTURE_CACHE_ENTRIES
        || totalBytes > MAX_REMOTE_TEXTURE_CACHE_BYTES
    ) {
        let oldestKey = null;
        let oldestEntry = null;

        for (const [cacheKey, entry] of remoteTextureTileCache.entries()) {
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

        remoteTextureTileCache.delete(oldestKey);
        totalBytes -= oldestEntry.byteSize || 0;
        console.log('[RemoteTextureCache] Evicted cached texture tiles:', oldestKey);
    }
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
            cacheKey: getRemoteTextureCacheKey(textureSet),
            zipFiles: {},
            tileCount: Number(textureSet?.tile_count) || 0,
            layerCount: Number(textureSet?.layer_count) || 0,
            variant: textureSet?.cross_section_type || 'waves',
            byteSize: 0,
            progressTotal: 0,
            isComplete: false,
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

                console.error(`[RemoteTextureCache] Failed to download tile ${getTileIndex(tile)}:`, error);
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
        cacheKey: getRemoteTextureCacheKey(textureSet),
        zipFiles,
        tileCount: Number(textureSet?.tile_count) || tiles.length,
        layerCount: Number(textureSet?.layer_count) || 0,
        variant: textureSet?.cross_section_type || 'waves',
        byteSize,
        progressTotal,
        isComplete: Object.keys(zipFiles).length === (Number(textureSet?.tile_count) || tiles.length),
    };
}

export function getCachedRemoteTextureTiles(textureSetOrId) {
    const cacheKey = typeof textureSetOrId === 'string'
        ? textureSetOrId
        : getRemoteTextureCacheKey(textureSetOrId);

    return touchRemoteTextureEntry(cacheKey);
}

export async function getOrFetchRemoteTextureTiles(textureSet, { onProgress = null } = {}) {
    const cacheKey = getRemoteTextureCacheKey(textureSet);
    const cached = touchRemoteTextureEntry(cacheKey);

    if (cached) {
        console.log('[RemoteTextureCache] Reusing cached remote texture tiles:', cacheKey);
        onProgress?.('downloading', cached.progressTotal, cached.progressTotal);
        return cached;
    }

    if (remoteTextureTileInflight.has(cacheKey)) {
        console.log('[RemoteTextureCache] Awaiting in-flight remote texture tiles:', cacheKey);
        const inflightEntry = await remoteTextureTileInflight.get(cacheKey);
        onProgress?.('downloading', inflightEntry.progressTotal, inflightEntry.progressTotal);
        return inflightEntry;
    }

    const inflightPromise = downloadRemoteTextureTiles(textureSet, { onProgress })
        .then((entry) => {
            if (entry.isComplete) {
                entry.lastAccessedAt = Date.now();
                remoteTextureTileCache.set(cacheKey, entry);
                evictRemoteTextureCacheIfNeeded(cacheKey);
                console.log('[RemoteTextureCache] Cached remote texture tiles:', cacheKey, {
                    tileCount: entry.tileCount,
                    byteSizeMB: (entry.byteSize / 1024 / 1024).toFixed(2),
                });
            }

            return entry;
        })
        .finally(() => {
            remoteTextureTileInflight.delete(cacheKey);
        });

    remoteTextureTileInflight.set(cacheKey, inflightPromise);
    return inflightPromise;
}

export function createObjectUrlsFromRemoteTextureTiles(tileEntry) {
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

export function createBlobMapFromRemoteTextureTiles(tileEntry) {
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