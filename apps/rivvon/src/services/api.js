import { useGoogleAuth } from '../composables/shared/useGoogleAuth'
import { useGoogleDrive } from './googleDrive'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://api.rivvon.ca'

/**
 * Rivvon API client with Google Auth (cookie-based session)
 * Must be used within Vue component context (setup or lifecycle hooks)
 */
export function useRivvonAPI() {
    const { isAuthenticated, user } = useGoogleAuth()
    const { ensureSlyceFolder, createTextureSetFolder, uploadTile: uploadTileToDrive } = useGoogleDrive()

    /**
     * Make an authenticated API request
     * Uses session cookie (credentials: 'include') for authentication
     */
    async function authFetch(url, options = {}) {
        const response = await fetch(url, {
            ...options,
            credentials: 'include', // Send session cookie
        })
        return response
    }

    /**
     * Create a new texture set and get upload info
     * POST /texture-set
     * @param {Object} metadata - Texture set metadata
     * @param {boolean} includeUserProfile - Whether to include user profile for DB sync
     */
    async function createTextureSet(metadata, includeUserProfile = true) {
        // Include user profile for database sync if requested
        const payload = { ...metadata }
        if (includeUserProfile && user.value) {
            payload.userProfile = {
                name: user.value.name,
                email: user.value.email,
                picture: user.value.picture,
            }
        }

        const response = await authFetch(`${API_BASE_URL}/texture-set`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
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
        const response = await authFetch(
            `${API_BASE_URL}/texture-set/${textureSetId}/tile/${tileIndex}`,
            {
                method: 'PUT',
                headers: {
                    'Content-Type': 'image/ktx2',
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
        const response = await authFetch(
            `${API_BASE_URL}/texture-set/${textureSetId}/complete`,
            {
                method: 'POST',
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
        // Determine content type from blob
        const contentType = imageBlob.type || 'image/jpeg'

        const response = await authFetch(
            `${API_BASE_URL}/texture-set/${textureSetId}/thumbnail`,
            {
                method: 'PUT',
                headers: {
                    'Content-Type': contentType,
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

    function formatUploadProgressDetail(progressLabelPrefix, detail) {
        const normalizedPrefix = typeof progressLabelPrefix === 'string' ? progressLabelPrefix.trim() : ''
        if (!normalizedPrefix || !detail) {
            return detail
        }

        return `${normalizedPrefix}: ${detail}`
    }

    /**
     * Complete texture set upload workflow using Google Drive
     * Creates set, uploads all tiles to Drive, marks complete
     * 
     * @param {Object} options - Upload options
     * @param {string} options.name - Texture set name
     * @param {string} options.description - Optional description
    * @param {string | null} options.parentTextureSetId - Optional family root/original texture set ID for derived variants
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
     * @param {string} [options.progressLabelPrefix] - Optional label prefix for progress details
     */
    async function uploadTextureSet(options) {
        const {
            name,
            description,
            isPublic = true,
            parentTextureSetId = null,
            tileResolution,
            layerCount,
            crossSectionType,
            sourceMetadata,
            tiles,
            thumbnailBlob,
            onProgress,
            progressLabelPrefix = '',
        } = options

        // 1. Ensure Slyce folder exists in Google Drive
        if (onProgress) onProgress('preparing', formatUploadProgressDetail(progressLabelPrefix, 'Setting up Google Drive folder...'))
        const slyceFolderId = await ensureSlyceFolder()

        // 2. Create a subfolder for this texture set
        const timestamp = new Date().toISOString().slice(0, 10)
        const folderName = `${name} (${timestamp})`
        const textureSetFolderId = await createTextureSetFolder(slyceFolderId, folderName)

        // 3. Create texture set in API (with google-drive storage provider)
        if (onProgress) onProgress('creating', formatUploadProgressDetail(progressLabelPrefix, 'Creating texture set...'))
        const createPayload = {
            name,
            description,
            isPublic,
            tileResolution,
            tileCount: tiles.length,
            layerCount,
            crossSectionType,
            sourceMetadata,
            storageProvider: 'google-drive',
        }
        if (parentTextureSetId) {
            createPayload.parentTextureSetId = parentTextureSetId
        }
        const { textureSetId, storageProvider } = await createTextureSet(createPayload)

        // 4. Upload each tile to Google Drive and register with API
        const uploadedTiles = []
        for (let i = 0; i < tiles.length; i++) {
            const tile = tiles[i]
            // Upload to Google Drive and register metadata
            const result = await uploadTileToDrive(
                textureSetId,
                tile.index,
                textureSetFolderId,
                tile.blob,
                (progress) => {
                    if (onProgress) {
                        onProgress('tile', formatUploadProgressDetail(progressLabelPrefix, `Uploading tile ${i + 1}/${tiles.length} (${progress}%)...`))
                    }
                }
            )
            uploadedTiles.push(result)

            if (onProgress) {
                onProgress('tile', formatUploadProgressDetail(progressLabelPrefix, `Uploaded tile ${i + 1}/${tiles.length}`))
            }
        }

        // 5. Upload thumbnail to R2 (not Google Drive - R2 is faster for CDN)
        let thumbnailUrl = null
        if (thumbnailBlob) {
            if (onProgress) onProgress('thumbnail', formatUploadProgressDetail(progressLabelPrefix, 'Uploading thumbnail...'))
            try {
                const result = await uploadThumbnail(textureSetId, thumbnailBlob)
                thumbnailUrl = result.thumbnailUrl
            } catch (err) {
                console.warn('Thumbnail upload failed (non-fatal):', err)
            }
        }

        // 6. Mark as complete
        if (onProgress) onProgress('completing', formatUploadProgressDetail(progressLabelPrefix, 'Finalizing...'))
        await completeTextureSet(textureSetId)

        // 7. Return texture set info with Google Drive URLs
        return {
            textureSetId,
            storageProvider: 'google-drive',
            driveFolderId: textureSetFolderId,
            thumbnailUrl,
            tiles: uploadedTiles.map((t) => ({
                tileIndex: t.tileIndex,
                url: `https://drive.google.com/uc?export=download&id=${t.driveFileId}`,
            })),
        }
    }

    /**
     * Update thumbnail URL for a texture set
     * PATCH /texture-set/:id/thumbnail-url
     */
    async function updateThumbnailUrl(textureSetId, thumbnailUrl) {
        const response = await authFetch(
            `${API_BASE_URL}/texture-set/${textureSetId}/thumbnail-url`,
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ thumbnailUrl }),
            }
        )
        // Non-fatal if this fails
        if (!response.ok) {
            console.warn('Failed to update thumbnail URL')
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
     * Complete texture set upload workflow using Cloudflare R2 (Admin only)
     * Creates set, uploads all tiles directly to R2 via API, marks complete
     * 
     * @param {Object} options - Upload options (same as uploadTextureSet)
     */
    async function uploadTextureSetToR2(options) {
        const {
            name,
            description,
            isPublic = true,
            parentTextureSetId = null,
            tileResolution,
            layerCount,
            crossSectionType,
            sourceMetadata,
            tiles,
            thumbnailBlob,
            onProgress,
            progressLabelPrefix = '',
        } = options

        // 1. Create texture set in API with R2 storage provider
        if (onProgress) onProgress('creating', formatUploadProgressDetail(progressLabelPrefix, 'Creating texture set (R2)...'))
        const createPayload = {
            name,
            description,
            isPublic,
            tileResolution,
            tileCount: tiles.length,
            layerCount,
            crossSectionType,
            sourceMetadata,
            storageProvider: 'r2',
        }
        if (parentTextureSetId) {
            createPayload.parentTextureSetId = parentTextureSetId
        }
        const { textureSetId, tiles: preallocatedTiles } = await createTextureSet(createPayload)

        // 2. Upload each tile directly to R2 via API
        const uploadedTiles = []
        for (let i = 0; i < tiles.length; i++) {
            const tile = tiles[i]
            if (onProgress) {
                onProgress('tile', formatUploadProgressDetail(progressLabelPrefix, `Uploading tile ${i + 1}/${tiles.length} to R2...`))
            }

            const result = await uploadTile(textureSetId, tile.index, tile.blob)
            uploadedTiles.push(result)
        }

        // 3. Upload thumbnail to R2
        let thumbnailUrl = null
        if (thumbnailBlob) {
            if (onProgress) onProgress('thumbnail', formatUploadProgressDetail(progressLabelPrefix, 'Uploading thumbnail...'))
            try {
                const result = await uploadThumbnail(textureSetId, thumbnailBlob)
                thumbnailUrl = result.thumbnailUrl
            } catch (err) {
                console.warn('Thumbnail upload failed (non-fatal):', err)
            }
        }

        // 4. Mark as complete
        if (onProgress) onProgress('completing', formatUploadProgressDetail(progressLabelPrefix, 'Finalizing...'))
        await completeTextureSet(textureSetId)

        // 5. Return texture set info with R2 CDN URLs
        return {
            textureSetId,
            storageProvider: 'r2',
            thumbnailUrl,
            tiles: uploadedTiles.map((t) => ({
                tileIndex: t.tileIndex,
                url: t.url || t.publicUrl,
            })),
        }
    }

    function sortFamilyVariants(variants = []) {
        return [...variants].sort((left, right) => {
            const leftResolution = Number(left?.tileResolution) || 0
            const rightResolution = Number(right?.tileResolution) || 0
            return rightResolution - leftResolution
        })
    }

    async function uploadTextureFamilyWithUploader(uploadMember, {
        root,
        variants = [],
        onProgress,
    }) {
        if (!root) {
            throw new Error('A family root texture is required for upload')
        }

        const orderedVariants = sortFamilyVariants(variants)
        const memberCount = orderedVariants.length + 1
        let rootResult = null
        const uploadedVariants = []

        try {
            onProgress?.('family', `Uploading root texture 1/${memberCount}...`, {
                memberIndex: 0,
                memberCount,
                kind: 'root',
                tileResolution: root.tileResolution,
            })

            rootResult = await uploadMember({
                ...root,
                parentTextureSetId: null,
                onProgress: (step, detail) => {
                    onProgress?.(step, detail, {
                        memberIndex: 0,
                        memberCount,
                        kind: 'root',
                        tileResolution: root.tileResolution,
                    })
                },
            })

            for (let index = 0; index < orderedVariants.length; index++) {
                const variant = orderedVariants[index]
                const memberIndex = index + 1

                onProgress?.('family', `Uploading ${variant.tileResolution}px variant ${memberIndex + 1}/${memberCount}...`, {
                    memberIndex,
                    memberCount,
                    kind: 'variant',
                    tileResolution: variant.tileResolution,
                })

                const uploadedVariant = await uploadMember({
                    ...variant,
                    parentTextureSetId: rootResult.textureSetId,
                    onProgress: (step, detail) => {
                        onProgress?.(step, detail, {
                            memberIndex,
                            memberCount,
                            kind: 'variant',
                            tileResolution: variant.tileResolution,
                        })
                    },
                })

                uploadedVariants.push(uploadedVariant)
            }
        } catch (error) {
            error.familyRootTextureSetId = rootResult?.textureSetId || null
            error.uploadedRoot = rootResult
            error.uploadedVariants = uploadedVariants
            throw error
        }

        onProgress?.('family-complete', `Uploaded ${memberCount} texture family member${memberCount === 1 ? '' : 's'}.`, {
            memberCount,
            rootTextureSetId: rootResult.textureSetId,
        })

        return {
            root: rootResult,
            variants: uploadedVariants,
            rootTextureSetId: rootResult.textureSetId,
            textureSetIds: [rootResult.textureSetId, ...uploadedVariants.map((variant) => variant.textureSetId)],
        }
    }

    async function uploadTextureFamily(options) {
        return uploadTextureFamilyWithUploader(uploadTextureSet, options)
    }

    async function uploadTextureFamilyToR2(options) {
        return uploadTextureFamilyWithUploader(uploadTextureSetToR2, options)
    }

    /**
     * Get current user's texture sets (authenticated)
     * GET /my-textures
     */
    async function getMyTextures({ limit = 50, offset = 0 } = {}) {
        const params = new URLSearchParams({
            limit: String(limit),
            offset: String(offset),
        })
        const response = await authFetch(`${API_BASE_URL}/my-textures?${params.toString()}`)

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
        const response = await authFetch(`${API_BASE_URL}/texture-set/${textureSetId}`, {
            method: 'DELETE',
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Failed to delete texture set' }))
            throw new Error(error.error || 'Failed to delete texture set')
        }

        return response.json()
    }

    /**
     * Update texture set metadata (name, description, isPublic, tileResolution)
     * PATCH /texture-set/:id
     */
    async function updateTextureSet(textureSetId, updates) {
        const response = await authFetch(`${API_BASE_URL}/texture-set/${textureSetId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(updates),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Failed to update texture set' }))
            const requestError = new Error(error.error || 'Failed to update texture set')
            requestError.status = response.status
            requestError.payload = error
            throw requestError
        }

        return response.json()
    }

    return {
        isAuthenticated,
        user,
        createTextureSet,
        uploadTile,
        completeTextureSet,
        uploadThumbnail,
        uploadTextureSet,
        uploadTextureFamily,
        uploadTextureSetToR2,
        uploadTextureFamilyToR2,
        listTextures,
        getTexture,
        getMyTextures,
        deleteTextureSet,
        updateTextureSet,
    }
}
