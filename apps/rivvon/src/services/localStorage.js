/**
 * Local Storage Service for Slyce Textures
 * 
 * Provides IndexedDB-backed storage for texture sets and tiles,
 * allowing users to save textures locally without Google OAuth.
 * 
 * Database: 'rivvon-textures'
 * Stores:
 *   - texture-sets: Metadata (name, resolution, layer count, thumbnail, etc.)
 *   - tiles: KTX2 binary blobs indexed by (texture_set_id, tile_index)
 */

import {
    getTextureAvailableResolutions,
    getTextureRootId,
    normalizeTextureVariantSummaries,
} from '../modules/shared/textureFamilyResolver.js';

const DB_NAME = 'rivvon-textures';
const DB_VERSION = 2;
const STORE_TEXTURE_SETS = 'texture-sets';
const STORE_TILES = 'tiles';
const TILE_MIME_TYPE = 'image/ktx2';

let dbInstance = null;

/**
 * Generate a unique ID for texture sets
 */
function generateId() {
    return `local_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function isArrayBufferView(value) {
    return ArrayBuffer.isView(value);
}

function getTileByteLength(tile) {
    if (typeof tile.file_size === 'number' && tile.file_size > 0) {
        return tile.file_size;
    }
    if (tile.bytes instanceof ArrayBuffer) {
        return tile.bytes.byteLength;
    }
    if (isArrayBufferView(tile.bytes)) {
        return tile.bytes.byteLength;
    }
    if (tile.blob instanceof Blob) {
        return tile.blob.size;
    }
    return 0;
}

async function toTileArrayBuffer(tileData) {
    if (tileData instanceof ArrayBuffer) {
        return tileData;
    }
    if (isArrayBufferView(tileData)) {
        return tileData.buffer.slice(tileData.byteOffset, tileData.byteOffset + tileData.byteLength);
    }
    if (tileData instanceof Blob) {
        return await tileData.arrayBuffer();
    }

    throw new Error('Unsupported local texture tile payload');
}

function createTileBlob(tile) {
    if (tile.blob instanceof Blob) {
        return new Blob([tile.blob], { type: tile.blob.type || TILE_MIME_TYPE });
    }
    if (tile.bytes instanceof ArrayBuffer || isArrayBufferView(tile.bytes)) {
        return new Blob([tile.bytes], { type: TILE_MIME_TYPE });
    }
    return null;
}

function normalizeTileRecord(tile) {
    return {
        ...tile,
        blob: createTileBlob(tile),
        file_size: getTileByteLength(tile)
    };
}

function normalizeTimestamp(value, fallback = Date.now()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildExplicitFamilyFields(textureSet = {}) {
    const currentId = textureSet?.id || null;
    let rootTextureId = getTextureRootId(textureSet) || currentId;
    if (
        textureSet?.cached_from
        && (!textureSet?.root_texture_id || textureSet.root_texture_id === currentId)
        && !textureSet?.variant_info?.root_texture_set_id
        && !textureSet?.derived_from?.root_texture_set_id
    ) {
        rootTextureId = textureSet.cached_from;
    }
    const explicitParentTextureSetId = textureSet?.parent_texture_set_id
        || textureSet?.variant_info?.parent_texture_set_id
        || textureSet?.derived_from?.texture_set_id
        || textureSet?.derived_from?.root_texture_set_id
        || (rootTextureId && currentId && rootTextureId !== currentId ? rootTextureId : null)
        || null;

    return {
        rootTextureId,
        parentTextureSetId: explicitParentTextureSetId,
    };
}

function normalizeTextureSetRecord(textureSet = {}) {
    if (!textureSet?.id) {
        return textureSet;
    }

    const createdAt = normalizeTimestamp(textureSet.created_at);
    const updatedAt = normalizeTimestamp(textureSet.updated_at, createdAt);
    const { rootTextureId, parentTextureSetId } = buildExplicitFamilyFields(textureSet);
    const normalizedVariantInfo = textureSet.variant_info
        ? {
            ...textureSet.variant_info,
            family_id: textureSet.variant_info.family_id || rootTextureId,
            root_texture_set_id: textureSet.variant_info.root_texture_set_id || rootTextureId,
            parent_texture_set_id: textureSet.variant_info.parent_texture_set_id || parentTextureSetId,
        }
        : null;
    const normalizedDerivedFrom = textureSet.derived_from
        ? {
            ...textureSet.derived_from,
            root_texture_set_id: textureSet.derived_from.root_texture_set_id || rootTextureId,
        }
        : null;
    const normalizedRecord = {
        ...textureSet,
        created_at: createdAt,
        updated_at: updatedAt,
        storage_provider: textureSet.storage_provider || 'local',
        status: textureSet.status || 'complete',
        root_texture_id: rootTextureId,
        parent_texture_set_id: parentTextureSetId,
        variant_info: normalizedVariantInfo,
        derived_from: normalizedDerivedFrom,
        total_size_bytes: Number(textureSet.total_size_bytes ?? textureSet.total_size ?? 0) || 0,
        total_size: Number(textureSet.total_size_bytes ?? textureSet.total_size ?? 0) || 0,
    };
    const variantSummaries = normalizeTextureVariantSummaries({
        ...normalizedRecord,
        variant_summaries: Array.isArray(textureSet.variant_summaries)
            ? textureSet.variant_summaries
            : normalizedRecord.variant_summaries,
    });

    return {
        ...normalizedRecord,
        variant_summaries: variantSummaries,
        available_resolutions: getTextureAvailableResolutions({
            ...normalizedRecord,
            variant_summaries: variantSummaries,
            available_resolutions: textureSet.available_resolutions,
        }),
    };
}

function hasTextureSetNormalizationChanges(original = {}, normalized = {}) {
    const keysToCompare = [
        'created_at',
        'updated_at',
        'storage_provider',
        'status',
        'root_texture_id',
        'parent_texture_set_id',
        'total_size',
        'total_size_bytes',
        'variant_info',
        'derived_from',
        'variant_summaries',
        'available_resolutions',
    ];

    return keysToCompare.some((key) => JSON.stringify(original?.[key] ?? null) !== JSON.stringify(normalized?.[key] ?? null));
}

function migrateTextureSetStore(textureSetStore) {
    const cursorRequest = textureSetStore.openCursor();
    cursorRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
            return;
        }

        const normalizedRecord = normalizeTextureSetRecord(cursor.value);
        if (hasTextureSetNormalizationChanges(cursor.value, normalizedRecord)) {
            cursor.update(normalizedRecord);
        }

        cursor.continue();
    };
}

async function getTextureSetRecord(id) {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_TEXTURE_SETS], 'readonly');
        const store = transaction.objectStore(STORE_TEXTURE_SETS);
        const request = store.get(id);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result ? normalizeTextureSetRecord(request.result) : null);
    });
}

async function putTextureSetRecord(textureSet) {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_TEXTURE_SETS], 'readwrite');

        transaction.onerror = () => reject(transaction.error);
        transaction.oncomplete = () => resolve();

        transaction.objectStore(STORE_TEXTURE_SETS).put(textureSet);
    });
}

/**
 * Open or create the IndexedDB database
 */
async function openDatabase() {
    if (dbInstance) {
        return dbInstance;
    }

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('[LocalStorage] Failed to open database:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            dbInstance = request.result;
            console.log('[LocalStorage] Database opened successfully');
            resolve(dbInstance);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            console.log('[LocalStorage] Upgrading database schema...');

            // Create texture-sets store
            let textureSetStore;
            if (!db.objectStoreNames.contains(STORE_TEXTURE_SETS)) {
                textureSetStore = db.createObjectStore(STORE_TEXTURE_SETS, { keyPath: 'id' });
                console.log('[LocalStorage] Created texture-sets store');
            } else {
                textureSetStore = event.target.transaction.objectStore(STORE_TEXTURE_SETS);
            }

            if (!textureSetStore.indexNames.contains('created_at')) {
                textureSetStore.createIndex('created_at', 'created_at', { unique: false });
            }
            if (!textureSetStore.indexNames.contains('name')) {
                textureSetStore.createIndex('name', 'name', { unique: false });
            }
            if (!textureSetStore.indexNames.contains('root_texture_id')) {
                textureSetStore.createIndex('root_texture_id', 'root_texture_id', { unique: false });
            }
            if (!textureSetStore.indexNames.contains('parent_texture_set_id')) {
                textureSetStore.createIndex('parent_texture_set_id', 'parent_texture_set_id', { unique: false });
            }
            if (!textureSetStore.indexNames.contains('cached_from')) {
                textureSetStore.createIndex('cached_from', 'cached_from', { unique: false });
            }

            migrateTextureSetStore(textureSetStore);

            // Create tiles store with compound key
            if (!db.objectStoreNames.contains(STORE_TILES)) {
                const tilesStore = db.createObjectStore(STORE_TILES, { keyPath: 'id' });
                tilesStore.createIndex('texture_set_id', 'texture_set_id', { unique: false });
                tilesStore.createIndex('tile_index', 'tile_index', { unique: false });
                console.log('[LocalStorage] Created tiles store');
            }
        };
    });
}

/**
 * Calculate total bytes for a texture set by summing tile sizes
 * @param {string} textureSetId - Texture set ID
 * @returns {Promise<number>} Total size in bytes
 */
async function calculateTextureSetSize(textureSetId) {
    const tiles = await getTiles(textureSetId);
    return tiles.reduce((total, tile) => {
        return total + getTileByteLength(tile);
    }, 0);
}

/**
 * Save a texture set with all its tiles to IndexedDB
 * 
 * @param {Object} params
 * @param {string} params.name - Texture name
 * @param {number} params.tileCount - Number of tiles
 * @param {number} params.tileResolution - Resolution of each tile (e.g., 512, 1024)
 * @param {number} params.layerCount - Layers per tile
 * @param {string} params.crossSectionType - 'planes' or 'waves'
 * @param {Object} params.sourceMetadata - Original video metadata
 * @param {string} params.thumbnailDataUrl - Base64 data URL for thumbnail
 * @param {Object} params.ktx2Blobs - Map of tile index to Blob
 * @param {Object|null} params.derivedFrom - Optional immediate parent reference for derived variants
 * @param {Object|null} params.variantInfo - Optional derived-variant metadata
 * @param {Function} params.onProgress - Progress callback (current, total)
 * @returns {Promise<string>} The saved texture set ID
 */
async function saveTextureSet({
    name,
    tileCount,
    tileResolution,
    layerCount,
    crossSectionType,
    sourceMetadata,
    thumbnailDataUrl,
    ktx2Blobs,
    derivedFrom = null,
    variantInfo = null,
    parentTextureSetId = null,
    rootTextureSetId = null,
    storageProvider = 'local',
    cachedFrom = null,
    onProgress
}) {
    const tileEntries = await Promise.all(
        Object.entries(ktx2Blobs).map(async ([tileIndex, tileData]) => {
            const bytes = await toTileArrayBuffer(tileData);
            return {
                tileIndex: parseInt(tileIndex, 10),
                bytes,
                fileSize: bytes.byteLength
            };
        })
    );

    const db = await openDatabase();
    const id = generateId();
    const createdAt = Date.now();

    // Calculate total size
    const totalSize = tileEntries.reduce((sum, entry) => sum + entry.fileSize, 0);

    // Create texture set metadata
    const textureSet = normalizeTextureSetRecord({
        id,
        name,
        created_at: createdAt,
        updated_at: createdAt,
        tile_count: tileCount,
        tile_resolution: tileResolution,
        layer_count: layerCount,
        cross_section_type: crossSectionType,
        source_metadata: sourceMetadata,
        total_size: totalSize,
        total_size_bytes: totalSize,
        thumbnail_data_url: thumbnailDataUrl,
        derived_from: derivedFrom,
        variant_info: variantInfo
            ? {
                ...variantInfo,
                root_texture_set_id: variantInfo.root_texture_set_id || rootTextureSetId || id,
                family_id: variantInfo.family_id || rootTextureSetId || id,
                parent_texture_set_id: variantInfo.parent_texture_set_id || parentTextureSetId,
            }
            : null,
        root_texture_id: rootTextureSetId || id,
        parent_texture_set_id: parentTextureSetId,
        storage_provider: storageProvider,
        status: 'complete',
        cached_from: cachedFrom,
    });

    // Use a transaction for atomic writes
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_TEXTURE_SETS, STORE_TILES], 'readwrite');

        transaction.onerror = () => {
            console.error('[LocalStorage] Transaction failed:', transaction.error);
            reject(transaction.error);
        };

        transaction.oncomplete = () => {
            console.log(`[LocalStorage] Saved texture set: ${id} with ${tileEntries.length} tiles`);
            resolve(id);
        };

        // Save texture set metadata
        const textureSetStore = transaction.objectStore(STORE_TEXTURE_SETS);
        textureSetStore.add(textureSet);

        // Save each tile
        const tilesStore = transaction.objectStore(STORE_TILES);
        let savedCount = 0;

        for (const entry of tileEntries) {
            const tileId = `${id}_${entry.tileIndex}`;
            const tile = {
                id: tileId,
                texture_set_id: id,
                tile_index: entry.tileIndex,
                bytes: entry.bytes,
                file_size: entry.fileSize
            };

            const request = tilesStore.add(tile);
            request.onsuccess = () => {
                savedCount++;
                if (onProgress) {
                    onProgress(savedCount, tileEntries.length);
                }
            };
        }
    });
}

/**
 * Get all texture sets (metadata only, no tiles)
 * @returns {Promise<Array>} Array of texture set metadata
 */
async function getAllTextureSets() {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_TEXTURE_SETS], 'readonly');
        const store = transaction.objectStore(STORE_TEXTURE_SETS);
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = async () => {
            const withSize = await Promise.all(request.result.map(async (textureSet) => {
                const normalizedRecord = normalizeTextureSetRecord(textureSet);
                const existingSize = normalizedRecord.total_size_bytes ?? normalizedRecord.total_size;
                if (typeof existingSize === 'number' && existingSize > 0) {
                    return {
                        ...normalizedRecord,
                        total_size: existingSize,
                        total_size_bytes: existingSize
                    };
                }

                const calculatedSize = await calculateTextureSetSize(normalizedRecord.id);
                return {
                    ...normalizedRecord,
                    total_size: calculatedSize,
                    total_size_bytes: calculatedSize
                };
            }));

            // Sort by created_at descending (newest first)
            const results = withSize.sort((a, b) => b.created_at - a.created_at);
            resolve(results);
        };
    });
}

/**
 * Get a single texture set by ID (metadata only)
 * @param {string} id - Texture set ID
 * @returns {Promise<Object|null>} Texture set metadata or null
 */
async function getTextureSet(id) {
    const textureSet = await getTextureSetRecord(id);
    return textureSet ? normalizeTextureSetRecord(textureSet) : null;
}

/**
 * Get all local family members for a texture set or root ID.
 * @param {string} textureSetId - Texture set ID or root texture set ID
 * @returns {Promise<Array>} Local family members sorted by root first, then resolution desc
 */
async function getTextureFamilyMembers(textureSetId) {
    if (!textureSetId) {
        return [];
    }

    const textureSets = await getAllTextureSets();
    const matchingTexture = textureSets.find((textureSet) => textureSet.id === textureSetId);
    const rootTextureId = matchingTexture?.root_texture_id || matchingTexture?.id || textureSetId;

    return textureSets
        .filter((textureSet) => !textureSet.cached_from && (textureSet.root_texture_id || textureSet.id) === rootTextureId)
        .sort((left, right) => {
            const leftIsRoot = left.id === rootTextureId;
            const rightIsRoot = right.id === rootTextureId;

            if (leftIsRoot !== rightIsRoot) {
                return leftIsRoot ? -1 : 1;
            }

            return (Number(right.tile_resolution) || 0) - (Number(left.tile_resolution) || 0);
        });
}

/**
 * Get all tiles for a texture set
 * @param {string} textureSetId - Texture set ID
 * @returns {Promise<Array>} Array of tile objects with blobs
 */
async function getTiles(textureSetId) {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_TILES], 'readonly');
        const store = transaction.objectStore(STORE_TILES);
        const index = store.index('texture_set_id');
        const request = index.getAll(textureSetId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            // Sort by tile_index
            const results = request.result
                .sort((a, b) => a.tile_index - b.tile_index)
                .map(normalizeTileRecord);
            resolve(results);
        };
    });
}

/**
 * Get a single tile by texture set ID and tile index
 * @param {string} textureSetId - Texture set ID
 * @param {number} tileIndex - Tile index
 * @returns {Promise<Object|null>} Tile object with blob or null
 */
async function getTile(textureSetId, tileIndex) {
    const db = await openDatabase();
    const tileId = `${textureSetId}_${tileIndex}`;

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_TILES], 'readonly');
        const store = transaction.objectStore(STORE_TILES);
        const request = store.get(tileId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result ? normalizeTileRecord(request.result) : null);
    });
}

/**
 * Delete a texture set and all its tiles
 * @param {string} id - Texture set ID
 * @returns {Promise<void>}
 */
async function deleteTextureSet(id) {
    const db = await openDatabase();

    // First, get all tile IDs for this texture set
    const tiles = await getTiles(id);
    const tileIds = tiles.map(t => t.id);

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_TEXTURE_SETS, STORE_TILES], 'readwrite');

        transaction.onerror = () => reject(transaction.error);
        transaction.oncomplete = () => {
            console.log(`[LocalStorage] Deleted texture set: ${id} with ${tileIds.length} tiles`);
            resolve();
        };

        // Delete texture set metadata
        const textureSetStore = transaction.objectStore(STORE_TEXTURE_SETS);
        textureSetStore.delete(id);

        // Delete all tiles
        const tilesStore = transaction.objectStore(STORE_TILES);
        for (const tileId of tileIds) {
            tilesStore.delete(tileId);
        }
    });
}

/**
 * Update a texture set's metadata (name, etc.)
 * @param {string} id - Texture set ID
 * @param {Object} updates - Fields to update (e.g., { name: 'New Name' })
 * @returns {Promise<void>}
 */
async function updateTextureSet(id, updates) {
    // Get existing texture set
    const existing = await getTextureSetRecord(id);
    if (!existing) {
        throw new Error('Texture set not found');
    }

    // Merge updates
    const updated = normalizeTextureSetRecord({
        ...existing,
        ...updates,
        updated_at: Date.now(),
    });

    await putTextureSetRecord(updated);
    console.log(`[LocalStorage] Updated texture set: ${id}`);
}

/**
 * Get storage usage estimate
 * @returns {Promise<{used: number, quota: number}>}
 */
async function getStorageUsage() {
    if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        return {
            used: estimate.usage || 0,
            quota: estimate.quota || 0
        };
    }
    return { used: 0, quota: 0 };
}

/**
 * Export a texture set as a downloadable ZIP file
 * @param {string} textureSetId - Texture set ID
 * @returns {Promise<Blob>} ZIP file blob
 */
async function exportTextureSetAsZip(textureSetId) {
    const textureSet = await getTextureSet(textureSetId);
    if (!textureSet) {
        throw new Error(`Texture set not found: ${textureSetId}`);
    }

    const tiles = await getTiles(textureSetId);
    if (tiles.length === 0) {
        throw new Error('No tiles found for texture set');
    }

    // Dynamic import JSZip
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    // Create metadata.json (similar to zipDownloader.js format)
    const metadata = {
        generatedBy: 'Slyce',
        generatedAt: new Date().toISOString(),
        video: {
            name: textureSet.source_metadata?.filename,
            width: textureSet.source_metadata?.width,
            height: textureSet.source_metadata?.height,
            duration: textureSet.source_metadata?.duration,
            sourceFrameCount: textureSet.source_metadata?.frame_count,
        },
        settings: {
            crossSectionType: textureSet.cross_section_type,
            potResolution: textureSet.tile_resolution,
            crossSectionCount: textureSet.layer_count,
            outputFormat: 'ktx2',
        },
        output: {
            format: 'ktx2',
            mimeType: 'image/ktx2',
            tileCount: textureSet.tile_count,
        }
    };

    zip.file('metadata.json', JSON.stringify(metadata, null, 2));

    // Add each tile
    for (const tile of tiles) {
        if (!tile.blob) {
            throw new Error(`Tile ${tile.tile_index} is missing KTX2 data`);
        }
        zip.file(`${tile.tile_index}.ktx2`, tile.blob, { binary: true });
    }

    // Generate ZIP with compression
    const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
    });

    return zipBlob;
}

/**
 * Download a texture set as a ZIP file
 * @param {string} textureSetId - Texture set ID
 */
async function downloadTextureSetAsZip(textureSetId) {
    const textureSet = await getTextureSet(textureSetId);
    const zipBlob = await exportTextureSetAsZip(textureSetId);

    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${textureSet.name || 'texture'}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Cache a cloud texture locally in IndexedDB.
 * Stores the texture with a `cached_from` field linking to the cloud texture ID.
 * If already cached, returns the existing local ID without re-saving.
 * 
 * @param {Object} params
 * @param {string} params.cloudTextureId - The cloud texture set ID being cached
 * @param {string} params.name - Texture name
 * @param {number} params.tileCount - Number of tiles
 * @param {number} params.tileResolution - Resolution of each tile
 * @param {number} params.layerCount - Layers per tile
 * @param {string} params.crossSectionType - 'planes' or 'waves'
 * @param {Object} params.sourceMetadata - Original video metadata
 * @param {string} params.thumbnailDataUrl - Base64 data URL or URL for thumbnail
 * @param {Object} params.ktx2Blobs - Map of tile index to Blob/ArrayBuffer
 * @returns {Promise<string>} The local texture set ID (new or existing)
 */
async function cacheCloudTexture({
    cloudTextureId,
    name,
    tileCount,
    tileResolution,
    layerCount,
    crossSectionType,
    sourceMetadata,
    thumbnailDataUrl,
    ktx2Blobs,
    rootTextureSetId = null,
    parentTextureSetId = null,
    variantInfo = null,
    variantSummaries = null,
    availableResolutions = null,
}) {
    // Check if already cached
    const existing = await getCachedLocalId(cloudTextureId);
    if (existing) {
        console.log(`[LocalStorage] Cloud texture ${cloudTextureId} already cached as ${existing}`);
        return existing;
    }

    const tileEntries = await Promise.all(
        Object.entries(ktx2Blobs).map(async ([tileIndex, tileData]) => {
            const bytes = await toTileArrayBuffer(tileData);
            return {
                tileIndex: parseInt(tileIndex, 10),
                bytes,
                fileSize: bytes.byteLength
            };
        })
    );

    const db = await openDatabase();
    const id = generateId();
    const createdAt = Date.now();
    const totalSize = tileEntries.reduce((sum, entry) => sum + entry.fileSize, 0);

    const textureSet = normalizeTextureSetRecord({
        id,
        name,
        created_at: createdAt,
        updated_at: createdAt,
        tile_count: tileCount,
        tile_resolution: tileResolution,
        layer_count: layerCount,
        cross_section_type: crossSectionType,
        source_metadata: sourceMetadata,
        total_size: totalSize,
        total_size_bytes: totalSize,
        thumbnail_data_url: thumbnailDataUrl,
        cached_from: cloudTextureId,
        root_texture_id: rootTextureSetId || cloudTextureId,
        parent_texture_set_id: parentTextureSetId,
        variant_info: variantInfo,
        variant_summaries: variantSummaries,
        available_resolutions: availableResolutions,
        status: 'complete',
    });

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_TEXTURE_SETS, STORE_TILES], 'readwrite');
        transaction.onerror = () => reject(transaction.error);
        transaction.oncomplete = () => {
            console.log(`[LocalStorage] Cached cloud texture ${cloudTextureId} as ${id} (${tileEntries.length} tiles)`);
            resolve(id);
        };

        transaction.objectStore(STORE_TEXTURE_SETS).add(textureSet);

        const tilesStore = transaction.objectStore(STORE_TILES);
        for (const entry of tileEntries) {
            tilesStore.add({
                id: `${id}_${entry.tileIndex}`,
                texture_set_id: id,
                tile_index: entry.tileIndex,
                bytes: entry.bytes,
                file_size: entry.fileSize
            });
        }
    });
}

async function promoteTextureSetToCachedCloudTexture(localTextureSetId, {
    cloudTextureId,
    name = null,
    rootTextureSetId = null,
    parentTextureSetId = null,
    variantInfo = null,
    variantSummaries = null,
    availableResolutions = null,
    sourceMetadata = null,
    thumbnailDataUrl = null,
}) {
    if (!localTextureSetId) {
        throw new Error('A local texture set ID is required for cache promotion');
    }

    if (!cloudTextureId) {
        throw new Error('A cloud texture set ID is required for cache promotion');
    }

    const existingTextureSet = await getTextureSetRecord(localTextureSetId);
    if (!existingTextureSet) {
        throw new Error(`Local texture set not found: ${localTextureSetId}`);
    }

    const conflictingCacheId = await getCachedLocalId(cloudTextureId);
    if (conflictingCacheId && conflictingCacheId !== localTextureSetId) {
        await deleteTextureSet(conflictingCacheId);
    }

    const promotedTextureSet = normalizeTextureSetRecord({
        ...existingTextureSet,
        name: name || existingTextureSet.name,
        updated_at: Date.now(),
        cached_from: cloudTextureId,
        root_texture_id: rootTextureSetId || cloudTextureId,
        parent_texture_set_id: parentTextureSetId,
        source_metadata: sourceMetadata || existingTextureSet.source_metadata,
        thumbnail_data_url: thumbnailDataUrl || existingTextureSet.thumbnail_data_url,
        variant_info: variantInfo,
        variant_summaries: variantSummaries,
        available_resolutions: availableResolutions,
        status: 'complete',
    });

    await putTextureSetRecord(promotedTextureSet);
    console.log(`[LocalStorage] Promoted local texture ${localTextureSetId} to cache for cloud texture ${cloudTextureId}`);
    return promotedTextureSet.id;
}

/**
 * Get the local ID for a cached cloud texture, or null if not cached.
 * @param {string} cloudTextureId - The cloud texture set ID
 * @returns {Promise<string|null>} Local texture set ID or null
 */
async function getCachedLocalId(cloudTextureId) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_TEXTURE_SETS], 'readonly');
        const store = transaction.objectStore(STORE_TEXTURE_SETS);
        const request = store.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const match = request.result.find(ts => ts.cached_from === cloudTextureId);
            resolve(match ? match.id : null);
        };
    });
}

/**
 * Get a Set of cloud texture IDs that have been cached locally.
 * @returns {Promise<Set<string>>} Set of cloud texture IDs
 */
async function getCachedCloudIds() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_TEXTURE_SETS], 'readonly');
        const store = transaction.objectStore(STORE_TEXTURE_SETS);
        const request = store.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const ids = new Set();
            for (const ts of request.result) {
                if (ts.cached_from) {
                    ids.add(ts.cached_from);
                }
            }
            resolve(ids);
        };
    });
}

/**
 * Remove the local cache entry for a cloud texture.
 * @param {string} cloudTextureId - The cloud texture set ID
 * @returns {Promise<boolean>} True if a cache entry was removed
 */
async function evictCachedTexture(cloudTextureId) {
    const localId = await getCachedLocalId(cloudTextureId);
    if (!localId) return false;
    await deleteTextureSet(localId);
    console.log(`[LocalStorage] Evicted cache for cloud texture ${cloudTextureId}`);
    return true;
}

/**
 * Vue composable for local storage operations
 * @returns {Object} Local storage methods
 */
export function useLocalStorage() {
    return {
        saveTextureSet,
        getAllTextureSets,
        getTextureSet,
        getTextureFamilyMembers,
        getTiles,
        getTile,
        deleteTextureSet,
        updateTextureSet,
        getStorageUsage,
        exportTextureSetAsZip,
        downloadTextureSetAsZip,
        cacheCloudTexture,
        promoteTextureSetToCachedCloudTexture,
        getCachedLocalId,
        getCachedCloudIds,
        evictCachedTexture
    };
}

// Also export individual functions for direct use
export {
    saveTextureSet,
    getAllTextureSets,
    getTextureSet,
    getTextureFamilyMembers,
    getTiles,
    getTile,
    deleteTextureSet,
    updateTextureSet,
    getStorageUsage,
    exportTextureSetAsZip,
    downloadTextureSetAsZip,
    cacheCloudTexture,
    promoteTextureSetToCachedCloudTexture,
    getCachedLocalId,
    getCachedCloudIds,
    evictCachedTexture
};
