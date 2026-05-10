import {
    createBlobMapFromRemoteTextureTiles,
    createObjectUrlsFromRemoteTextureTiles,
    getCachedRemoteTextureTiles,
    getOrFetchRemoteTextureTiles,
} from './remoteTextureCache.js';

const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

function hasValidKtx2Identifier(bytes) {
    if (!bytes || bytes.length < KTX2_IDENTIFIER.length) {
        return false;
    }

    return KTX2_IDENTIFIER.every((value, index) => bytes[index] === value);
}

async function readTileHeaderBytes(tile, byteCount = KTX2_IDENTIFIER.length) {
    if (tile?.bytes instanceof ArrayBuffer) {
        return new Uint8Array(tile.bytes.slice(0, byteCount));
    }

    if (ArrayBuffer.isView(tile?.bytes)) {
        return new Uint8Array(tile.bytes.buffer.slice(tile.bytes.byteOffset, tile.bytes.byteOffset + Math.min(tile.bytes.byteLength, byteCount)));
    }

    if (tile?.blob instanceof Blob) {
        return new Uint8Array(await tile.blob.slice(0, byteCount).arrayBuffer());
    }

    return null;
}

async function hasValidLocalKtx2Tiles(tiles = []) {
    for (const tile of tiles) {
        const headerBytes = await readTileHeaderBytes(tile);
        if (!hasValidKtx2Identifier(headerBytes)) {
            return false;
        }
    }

    return tiles.length > 0;
}

function buildFallbackLocalTextureSet(texture, localTextureId) {
    return {
        ...texture,
        id: localTextureId,
        thumbnail_data_url: texture?.thumbnail_data_url || texture?.thumbnail_url || null,
    };
}

async function resolveLocalTexturePayload(texture, localTextureId, {
    getLocalTextureSet = null,
    getLocalTiles = null,
    includeLocalTiles = false,
}) {
    const [localTextureSet, localTiles] = await Promise.all([
        typeof getLocalTextureSet === 'function'
            ? getLocalTextureSet(localTextureId)
            : Promise.resolve(null),
        includeLocalTiles && typeof getLocalTiles === 'function'
            ? getLocalTiles(localTextureId)
            : Promise.resolve(null),
    ]);

    return {
        textureSet: localTextureSet || buildFallbackLocalTextureSet(texture, localTextureId),
        localTiles: Array.isArray(localTiles) ? localTiles : null,
    };
}

async function resolveThumbnailDataUrl(texture, textureSet) {
    const inlineThumbnail = textureSet?.thumbnail_data_url || texture?.thumbnail_data_url || null;
    if (typeof inlineThumbnail === 'string' && inlineThumbnail.startsWith('data:')) {
        return inlineThumbnail;
    }

    const thumbnailUrl = textureSet?.thumbnail_url || texture?.thumbnail_url || inlineThumbnail;
    if (!thumbnailUrl || typeof thumbnailUrl !== 'string') {
        return null;
    }

    try {
        const response = await fetch(thumbnailUrl);
        const blob = await response.blob();
        return await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}

export async function resolveTextureLoadTarget({
    texture,
    isLocal = false,
    getLocalTextureSet = null,
    getLocalTiles = null,
    getCachedLocalId = null,
    onInvalidCachedLocal = null,
    fetchRemoteTextureSet = null,
    includeLocalTiles = false,
    includeRemoteTileEntry = false,
    preferSessionCache = false,
    onRemoteProgress = null,
}) {
    if (!texture) {
        throw new Error('Texture is required');
    }

    if (isLocal) {
        const localPayload = await resolveLocalTexturePayload(texture, texture.id, {
            getLocalTextureSet,
            getLocalTiles,
            includeLocalTiles,
        });

        return {
            kind: 'local',
            textureSet: localPayload.textureSet,
            localTiles: localPayload.localTiles,
            cachedLocalId: null,
            remoteTileEntry: null,
            hasDriveTiles: false,
        };
    }

    const resolveRemoteTextureSet = async () => {
        if (typeof fetchRemoteTextureSet !== 'function') {
            throw new Error('fetchRemoteTextureSet is required for remote textures');
        }

        const textureSet = await fetchRemoteTextureSet(texture.id);
        const hasDriveTiles = Array.isArray(textureSet?.tiles)
            && textureSet.tiles.some((tile) => tile.driveFileId || (tile.url && tile.url.includes('drive.google.com')));

        return {
            textureSet,
            hasDriveTiles,
        };
    };

    if (preferSessionCache) {
        const cachedRemoteEntry = getCachedRemoteTextureTiles(texture.id);

        if (cachedRemoteEntry) {
            const remotePayload = await resolveRemoteTextureSet();

            return {
                kind: 'session-remote',
                textureSet: remotePayload.textureSet,
                localTiles: null,
                cachedLocalId: null,
                remoteTileEntry: includeRemoteTileEntry ? cachedRemoteEntry : null,
                hasDriveTiles: remotePayload.hasDriveTiles,
            };
        }
    }

    let cachedLocalId = null;
    if (typeof getCachedLocalId === 'function') {
        cachedLocalId = await getCachedLocalId(texture.id);
    }

    if (cachedLocalId) {
        try {
            const localPayload = await resolveLocalTexturePayload(texture, cachedLocalId, {
                getLocalTextureSet,
                getLocalTiles,
                includeLocalTiles,
            });

            const expectedLocalTileCount = Number(localPayload.textureSet?.tile_count ?? texture?.tile_count ?? 0);
            const localTiles = Array.isArray(localPayload.localTiles) ? localPayload.localTiles : [];
            const hasUsableTilePayloads = !includeLocalTiles || localTiles.every((tile) => {
                return tile?.blob instanceof Blob || tile?.bytes instanceof ArrayBuffer || ArrayBuffer.isView(tile?.bytes);
            });
            const hasValidKtx2Tiles = !includeLocalTiles || await hasValidLocalKtx2Tiles(localTiles);
            const hasUsableLocalTiles = !includeLocalTiles
                || (
                    localTiles.length > 0
                    && hasUsableTilePayloads
                    && hasValidKtx2Tiles
                    && (expectedLocalTileCount <= 0 || localTiles.length >= expectedLocalTileCount)
                );

            if (hasUsableLocalTiles) {
                return {
                    kind: 'cached-local',
                    textureSet: localPayload.textureSet,
                    localTiles: localPayload.localTiles,
                    cachedLocalId,
                    remoteTileEntry: null,
                    hasDriveTiles: false,
                };
            }

            if (!hasValidKtx2Tiles) {
                await onInvalidCachedLocal?.({
                    cloudTextureId: texture.id,
                    cachedLocalId,
                    reason: 'invalid-ktx2',
                });
            }

            console.warn(`[TextureCacheCoordinator] Cached local texture ${cachedLocalId} has no readable tiles, falling back to remote`);
        } catch (error) {
            console.warn(`[TextureCacheCoordinator] Failed to read cached local texture ${cachedLocalId}, falling back to remote`, error);
        }
    }

    const remotePayload = await resolveRemoteTextureSet();
    const textureSet = remotePayload.textureSet;
    const hasDriveTiles = remotePayload.hasDriveTiles;

    let kind = 'remote';
    let remoteTileEntry = null;
    if (includeRemoteTileEntry) {
        const cachedRemoteEntry = getCachedRemoteTextureTiles(textureSet);
        kind = cachedRemoteEntry ? 'session-remote' : 'remote';
        remoteTileEntry = await getOrFetchRemoteTextureTiles(textureSet, { onProgress: onRemoteProgress });
    }

    return {
        kind,
        textureSet,
        localTiles: null,
        cachedLocalId: null,
        remoteTileEntry,
        hasDriveTiles,
    };
}

export function createObjectUrlsFromLocalTiles(tiles = []) {
    const urls = {};

    for (const tile of tiles) {
        if (!tile?.blob) {
            continue;
        }

        const tileIndex = tile.tile_index ?? tile.tileIndex ?? tile.index;
        if (tileIndex === undefined || tileIndex === null) {
            continue;
        }

        urls[tileIndex] = URL.createObjectURL(tile.blob);
    }

    return urls;
}

export function buildKtx2BlobsFromTileManager(tileManager) {
    const ktx2Blobs = {};
    const zipFiles = tileManager?.zipFiles || {};

    for (const [filename, data] of Object.entries(zipFiles)) {
        const index = Number.parseInt(String(filename).replace('.ktx2', ''), 10);
        if (Number.isNaN(index)) {
            continue;
        }

        try {
            if (data instanceof ArrayBuffer) {
                ktx2Blobs[index] = data.slice(0);
                continue;
            }

            if (ArrayBuffer.isView(data)) {
                ktx2Blobs[index] = new Uint8Array(data);
            }
        } catch (error) {
            console.warn(`[TextureCacheCoordinator] Failed to clone tile buffer ${filename} from TileManager`, error);
        }
    }

    return ktx2Blobs;
}

export function cacheCloudTextureInBackground({
    texture,
    textureSet,
    cacheCloudTexture,
    remoteTileEntry = null,
    tileManager = null,
    ktx2Blobs = null,
    onPersisted = null,
    logPrefix = '[TextureCacheCoordinator]',
}) {
    const doCache = async () => {
        if (typeof cacheCloudTexture !== 'function' || !texture || !textureSet) {
            return null;
        }

        const tileBlobMap = ktx2Blobs
            || (remoteTileEntry ? createBlobMapFromRemoteTextureTiles(remoteTileEntry) : null)
            || (tileManager ? buildKtx2BlobsFromTileManager(tileManager) : null)
            || {};
        const expectedTileCount = Number(textureSet.tile_count) || Number(texture?.tile_count) || 0;

        if (Object.keys(tileBlobMap).length === 0) {
            return null;
        }

        if (remoteTileEntry && remoteTileEntry.isComplete === false) {
            return null;
        }

        if (expectedTileCount > 0 && Object.keys(tileBlobMap).length < expectedTileCount) {
            return null;
        }

        const thumbnailDataUrl = await resolveThumbnailDataUrl(texture, textureSet);
        const cachedLocalId = await cacheCloudTexture({
            cloudTextureId: texture.id,
            name: texture.name,
            description: textureSet.description ?? texture.description ?? '',
            tileCount: textureSet.tile_count ?? Object.keys(tileBlobMap).length,
            tileResolution: textureSet.tile_resolution ?? texture.tile_resolution,
            layerCount: textureSet.layer_count ?? texture.layer_count,
            crossSectionType: textureSet.cross_section_type ?? texture.cross_section_type ?? 'waves',
            sourceMetadata: textureSet.source_metadata ?? texture.source_metadata,
            thumbnailDataUrl,
            ktx2Blobs: tileBlobMap,
            rootTextureSetId: textureSet.root_texture_id || texture.root_texture_id || texture.id,
            parentTextureSetId: textureSet.parent_texture_set_id || texture.parent_texture_set_id || null,
            variantInfo: textureSet.variant_info || texture.variant_info || null,
            variantSummaries: textureSet.variant_summaries || texture.variant_summaries || null,
            availableResolutions: textureSet.available_resolutions || texture.available_resolutions || null,
        });

        await onPersisted?.(cachedLocalId);
        console.log(`${logPrefix} Cached texture ${texture.id} locally as ${cachedLocalId}`);
        return cachedLocalId;
    };

    void doCache().catch((error) => {
        console.warn(`${logPrefix} Background texture cache failed:`, error);
    });
}

export {
    createObjectUrlsFromRemoteTextureTiles,
    getCachedRemoteTextureTiles,
};