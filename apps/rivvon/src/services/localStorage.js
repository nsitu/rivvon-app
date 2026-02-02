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

const DB_NAME = 'rivvon-textures';
const DB_VERSION = 1;
const STORE_TEXTURE_SETS = 'texture-sets';
const STORE_TILES = 'tiles';

let dbInstance = null;

/**
 * Generate a unique ID for texture sets
 */
function generateId() {
    return `local_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
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
            if (!db.objectStoreNames.contains(STORE_TEXTURE_SETS)) {
                const textureSetStore = db.createObjectStore(STORE_TEXTURE_SETS, { keyPath: 'id' });
                textureSetStore.createIndex('created_at', 'created_at', { unique: false });
                textureSetStore.createIndex('name', 'name', { unique: false });
                console.log('[LocalStorage] Created texture-sets store');
            }

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
    onProgress
}) {
    const db = await openDatabase();
    const id = generateId();
    const createdAt = Date.now();

    // Calculate total size
    let totalSize = 0;
    const blobEntries = Object.entries(ktx2Blobs);
    for (const [, blob] of blobEntries) {
        if (blob instanceof Blob) {
            totalSize += blob.size;
        }
    }

    // Create texture set metadata
    const textureSet = {
        id,
        name,
        created_at: createdAt,
        tile_count: tileCount,
        tile_resolution: tileResolution,
        layer_count: layerCount,
        cross_section_type: crossSectionType,
        source_metadata: sourceMetadata,
        total_size: totalSize,
        thumbnail_data_url: thumbnailDataUrl
    };

    // Use a transaction for atomic writes
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_TEXTURE_SETS, STORE_TILES], 'readwrite');

        transaction.onerror = () => {
            console.error('[LocalStorage] Transaction failed:', transaction.error);
            reject(transaction.error);
        };

        transaction.oncomplete = () => {
            console.log(`[LocalStorage] Saved texture set: ${id} with ${blobEntries.length} tiles`);
            resolve(id);
        };

        // Save texture set metadata
        const textureSetStore = transaction.objectStore(STORE_TEXTURE_SETS);
        textureSetStore.add(textureSet);

        // Save each tile
        const tilesStore = transaction.objectStore(STORE_TILES);
        let savedCount = 0;

        for (const [tileIndex, blob] of blobEntries) {
            const tileId = `${id}_${tileIndex}`;
            const tile = {
                id: tileId,
                texture_set_id: id,
                tile_index: parseInt(tileIndex),
                blob: blob,
                file_size: blob instanceof Blob ? blob.size : 0
            };

            const request = tilesStore.add(tile);
            request.onsuccess = () => {
                savedCount++;
                if (onProgress) {
                    onProgress(savedCount, blobEntries.length);
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
        request.onsuccess = () => {
            // Sort by created_at descending (newest first)
            const results = request.result.sort((a, b) => b.created_at - a.created_at);
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
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_TEXTURE_SETS], 'readonly');
        const store = transaction.objectStore(STORE_TEXTURE_SETS);
        const request = store.get(id);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || null);
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
            const results = request.result.sort((a, b) => a.tile_index - b.tile_index);
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
        request.onsuccess = () => resolve(request.result || null);
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
 * Vue composable for local storage operations
 * @returns {Object} Local storage methods
 */
export function useLocalStorage() {
    return {
        saveTextureSet,
        getAllTextureSets,
        getTextureSet,
        getTiles,
        getTile,
        deleteTextureSet,
        getStorageUsage,
        exportTextureSetAsZip,
        downloadTextureSetAsZip
    };
}

// Also export individual functions for direct use
export {
    saveTextureSet,
    getAllTextureSets,
    getTextureSet,
    getTiles,
    getTile,
    deleteTextureSet,
    getStorageUsage,
    exportTextureSetAsZip,
    downloadTextureSetAsZip
};
