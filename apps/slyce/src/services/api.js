import { useAuth0 } from '@auth0/auth0-vue'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://api.rivvon.ca'

/**
 * Rivvon API client with Auth0 authentication
 * Must be used within Vue component context (setup or lifecycle hooks)
 */
export function useRivvonAPI() {
    const { getAccessTokenSilently, isAuthenticated, user } = useAuth0()

    /**
     * Get access token for API requests
     */
    async function getAccessToken() {
        try {
            const token = await getAccessTokenSilently()
            return token
        } catch (error) {
            console.error('Failed to get access token:', error)
            throw new Error('Authentication required')
        }
    }

    /**
     * Create a new texture set and get upload info
     * POST /texture-set
     * @param {Object} metadata - Texture set metadata
     * @param {boolean} includeUserProfile - Whether to include user profile for DB sync
     */
    async function createTextureSet(metadata, includeUserProfile = true) {
        const token = await getAccessToken()

        // Include user profile for database sync if requested
        const payload = { ...metadata }
        if (includeUserProfile && user.value) {
            payload.userProfile = {
                name: user.value.name,
                email: user.value.email,
                picture: user.value.picture,
            }
        }

        const response = await fetch(`${API_BASE_URL}/texture-set`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Failed to create texture set' }))
            throw new Error(error.error || 'Failed to create texture set')
        }

        return response.json()
    }

    /**
     * Upload a single tile to the texture set
     * PUT /texture-set/:setId/tile/:index
     */
    async function uploadTile(textureSetId, tileIndex, fileData) {
        const token = await getAccessToken()

        const response = await fetch(
            `${API_BASE_URL}/texture-set/${textureSetId}/tile/${tileIndex}`,
            {
                method: 'PUT',
                headers: {
                    'Content-Type': 'image/ktx2',
                    'Authorization': `Bearer ${token}`,
                },
                body: fileData,
            }
        )

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Tile upload failed' }))
            throw new Error(error.error || `Tile ${tileIndex} upload failed`)
        }

        return response.json()
    }

    /**
     * Mark texture set upload as complete
     * POST /texture-set/:id/complete
     */
    async function completeTextureSet(textureSetId) {
        const token = await getAccessToken()

        const response = await fetch(
            `${API_BASE_URL}/texture-set/${textureSetId}/complete`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            }
        )

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Failed to complete upload' }))
            throw new Error(error.error || 'Failed to complete upload')
        }

        return response.json()
    }

    /**
     * Upload a thumbnail for the texture set
     * PUT /texture-set/:setId/thumbnail
     */
    async function uploadThumbnail(textureSetId, imageBlob) {
        const token = await getAccessToken()

        // Determine content type from blob
        const contentType = imageBlob.type || 'image/jpeg'

        const response = await fetch(
            `${API_BASE_URL}/texture-set/${textureSetId}/thumbnail`,
            {
                method: 'PUT',
                headers: {
                    'Content-Type': contentType,
                    'Authorization': `Bearer ${token}`,
                },
                body: imageBlob,
            }
        )

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Thumbnail upload failed' }))
            throw new Error(error.error || 'Thumbnail upload failed')
        }

        return response.json()
    }

    /**
     * Complete texture set upload workflow
     * Creates set, uploads all tiles, marks complete
     * 
     * @param {Object} options - Upload options
     * @param {string} options.name - Texture set name
     * @param {string} options.description - Optional description
     * @param {number} options.tileResolution - Tile resolution (256, 512, 1024, etc.)
     * @param {number} options.layerCount - Layers per tile
     * @param {string} options.crossSectionType - 'planes' or 'waves'
     * @param {Object} options.sourceMetadata - Source file metadata
     * @param {string} options.sourceMetadata.filename - Original filename
     * @param {number} options.sourceMetadata.width - Source video width
     * @param {number} options.sourceMetadata.height - Source video height
     * @param {number} options.sourceMetadata.duration - Source video duration
     * @param {number} options.sourceMetadata.sourceFrameCount - Total frames in source video
     * @param {number} options.sourceMetadata.sampledFrameCount - Actual frames sampled (may be limited by user)
     * @param {Array<{index: number, blob: Blob}>} options.tiles - Array of tile data
     * @param {Blob} options.thumbnailBlob - Optional thumbnail image blob
     * @param {Function} options.onProgress - Progress callback (step, detail)
     */
    async function uploadTextureSet(options) {
        const {
            name,
            description,
            isPublic = true,
            tileResolution,
            layerCount,
            crossSectionType,
            sourceMetadata,
            tiles,
            thumbnailBlob,
            onProgress,
        } = options

        // 1. Create texture set
        if (onProgress) onProgress('creating', 'Creating texture set...')
        const { textureSetId, uploadUrls } = await createTextureSet({
            name,
            description,
            isPublic,
            tileResolution,
            tileCount: tiles.length,
            layerCount,
            crossSectionType,
            sourceMetadata,
        })

        // 2. Upload each tile
        for (let i = 0; i < tiles.length; i++) {
            const tile = tiles[i]
            // Convert blob to ArrayBuffer for upload
            const arrayBuffer = await tile.blob.arrayBuffer()
            await uploadTile(textureSetId, tile.index, arrayBuffer)

            if (onProgress) {
                onProgress('tile', `Uploading tile ${i + 1}/${tiles.length}...`)
            }
        }

        // 3. Upload thumbnail if provided
        let thumbnailUrl = null
        if (thumbnailBlob) {
            if (onProgress) onProgress('thumbnail', 'Uploading thumbnail...')
            try {
                const thumbResult = await uploadThumbnail(textureSetId, thumbnailBlob)
                thumbnailUrl = thumbResult.thumbnailUrl
            } catch (err) {
                console.warn('Thumbnail upload failed (non-fatal):', err)
            }
        }

        // 4. Mark as complete
        if (onProgress) onProgress('completing', 'Finalizing...')
        await completeTextureSet(textureSetId)

        // 5. Return texture set info with CDN URLs
        return {
            textureSetId,
            thumbnailUrl,
            cdnUrls: uploadUrls.map((info) => ({
                tileIndex: info.tileIndex,
                url: `https://cdn.rivvon.ca/${info.r2Key}`,
            })),
        }
    }

    /**
     * Get list of all textures (public endpoint)
     */
    async function listTextures() {
        const response = await fetch(`${API_BASE_URL}/textures`)

        if (!response.ok) {
            throw new Error('Failed to fetch textures')
        }

        return response.json()
    }

    /**
     * Get texture metadata by ID (public endpoint)
     */
    async function getTexture(textureId) {
        const response = await fetch(`${API_BASE_URL}/textures/${textureId}`)

        if (!response.ok) {
            throw new Error('Failed to fetch texture')
        }

        return response.json()
    }

    /**
     * Get current user's texture sets (authenticated)
     * GET /my-textures
     */
    async function getMyTextures() {
        const token = await getAccessToken()

        const response = await fetch(`${API_BASE_URL}/my-textures`, {
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Failed to fetch your textures' }))
            throw new Error(error.error || 'Failed to fetch your textures')
        }

        return response.json()
    }

    /**
     * Delete a texture set (authenticated, owner only)
     * DELETE /texture-set/:id
     */
    async function deleteTextureSet(textureSetId) {
        const token = await getAccessToken()

        const response = await fetch(`${API_BASE_URL}/texture-set/${textureSetId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Failed to delete texture set' }))
            throw new Error(error.error || 'Failed to delete texture set')
        }

        return response.json()
    }

    return {
        isAuthenticated,
        getAccessToken,
        createTextureSet,
        uploadTile,
        completeTextureSet,
        uploadThumbnail,
        uploadTextureSet,
        listTextures,
        getTexture,
        getMyTextures,
        deleteTextureSet,
    }
}
