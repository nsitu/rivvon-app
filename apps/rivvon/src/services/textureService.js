// src/services/textureService.js
// Service for fetching textures from the Rivvon API

const API_BASE = 'https://api.rivvon.ca';

/**
 * Fetch list of available public textures
 * @param {Object} options - Query options
 * @param {number} options.limit - Max results (default 50)
 * @param {number} options.offset - Pagination offset (default 0)
 * @returns {Promise<{textures: Array, pagination: Object}>}
 */
export async function fetchTextures({ limit = 50, offset = 0 } = {}) {
    const url = `${API_BASE}/textures?limit=${limit}&offset=${offset}`;
    console.log('[TextureService] Fetching textures from:', url);

    const response = await fetch(url);
    console.log('[TextureService] Response status:', response.status, response.statusText);

    if (!response.ok) {
        throw new Error(`Failed to fetch textures: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[TextureService] Response data:', data);
    return data;
}

/**
 * Fetch a single texture set with tile URLs
 * @param {string} textureSetId - The texture set ID
 * @returns {Promise<Object>} Texture set with tiles array
 */
export async function fetchTextureSet(textureSetId) {
    const url = `${API_BASE}/textures/${textureSetId}`;

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch texture set: ${response.statusText}`);
    }

    return await response.json();
}

/**
 * Format file size for display
 * @param {number} bytes 
 * @returns {string}
 */
export function formatFileSize(bytes) {
    if (!bytes) return 'Unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format date for display
 * @param {number} unixTimestamp 
 * @returns {string}
 */
export function formatDate(unixTimestamp) {
    if (!unixTimestamp) return 'Unknown';
    return new Date(unixTimestamp * 1000).toLocaleDateString();
}
