/**
 * Google Drive Service for Slyce
 * Handles texture uploads to user's Google Drive as bring-your-own storage
 */

import { useGoogleAuth } from '@/composables/useGoogleAuth'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://api.rivvon.ca'
const SLYCE_FOLDER_NAME = 'Slyce Textures'

/**
 * Google Drive service for uploading textures
 * Must be used within Vue component context
 */
export function useGoogleDrive() {
    const { getAccessToken, getDriveFolderId } = useGoogleAuth()

    /**
     * Get or create the Slyce folder in the user's Google Drive
     * Returns the folder ID
     */
    async function ensureSlyceFolder() {
        // Check if we already have the folder ID cached
        const cachedFolderId = getDriveFolderId()
        if (cachedFolderId) {
            // Verify folder still exists
            const verified = await verifyFolderExists(cachedFolderId)
            if (verified) {
                return cachedFolderId
            }
        }

        const accessToken = await getAccessToken()
        if (!accessToken) {
            throw new Error('Not authenticated with Google Drive')
        }

        // Search for existing Slyce folder
        const searchResponse = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=name='${SLYCE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false&spaces=drive&fields=files(id,name)`,
            {
                headers: { Authorization: `Bearer ${accessToken}` },
            }
        )

        if (!searchResponse.ok) {
            throw new Error('Failed to search Google Drive')
        }

        const searchResult = await searchResponse.json()

        if (searchResult.files && searchResult.files.length > 0) {
            const folderId = searchResult.files[0].id
            // Save folder ID to backend
            await saveFolderIdToBackend(folderId)
            return folderId
        }

        // Create new Slyce folder
        const createResponse = await fetch(
            'https://www.googleapis.com/drive/v3/files',
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: SLYCE_FOLDER_NAME,
                    mimeType: 'application/vnd.google-apps.folder',
                }),
            }
        )

        if (!createResponse.ok) {
            throw new Error('Failed to create Slyce folder')
        }

        const folder = await createResponse.json()
        
        // Save folder ID to backend
        await saveFolderIdToBackend(folder.id)
        
        return folder.id
    }

    /**
     * Verify a folder still exists in Drive
     */
    async function verifyFolderExists(folderId) {
        try {
            const accessToken = await getAccessToken()
            const response = await fetch(
                `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,trashed`,
                {
                    headers: { Authorization: `Bearer ${accessToken}` },
                }
            )
            
            if (!response.ok) {
                return false
            }
            
            const file = await response.json()
            return file.id && !file.trashed
        } catch {
            return false
        }
    }

    /**
     * Save folder ID to backend for caching
     */
    async function saveFolderIdToBackend(folderId) {
        try {
            await fetch(`${API_BASE_URL}/auth/drive-folder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ folderId }),
            })
        } catch (err) {
            console.warn('Failed to save folder ID to backend:', err)
        }
    }

    /**
     * Create a subfolder for a specific texture set
     * @param {string} parentFolderId - The Slyce folder ID
     * @param {string} textureSetName - Name for the subfolder
     * @returns {string} The created subfolder ID
     */
    async function createTextureSetFolder(parentFolderId, textureSetName) {
        const accessToken = await getAccessToken()
        if (!accessToken) {
            throw new Error('Not authenticated with Google Drive')
        }

        // Create subfolder for this texture set
        const response = await fetch(
            'https://www.googleapis.com/drive/v3/files',
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: textureSetName,
                    mimeType: 'application/vnd.google-apps.folder',
                    parents: [parentFolderId],
                }),
            }
        )

        if (!response.ok) {
            const error = await response.json().catch(() => ({}))
            throw new Error(error.message || 'Failed to create texture set folder')
        }

        const folder = await response.json()
        return folder.id
    }

    /**
     * Upload a file to Google Drive using resumable upload
     * Supports progress tracking for large files
     * @param {string} folderId - Parent folder ID
     * @param {string} fileName - Name for the file
     * @param {Blob|ArrayBuffer} fileData - The file content
     * @param {Function} onProgress - Progress callback (0-100)
     * @returns {{ id: string, size: number }} File info
     */
    async function uploadFile(folderId, fileName, fileData, onProgress = null) {
        const accessToken = await getAccessToken()
        if (!accessToken) {
            throw new Error('Not authenticated with Google Drive')
        }

        const blob = fileData instanceof Blob ? fileData : new Blob([fileData], { type: 'image/ktx2' })
        const fileSize = blob.size

        // Step 1: Initialize resumable upload session
        const initResponse = await fetch(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'X-Upload-Content-Type': 'image/ktx2',
                    'X-Upload-Content-Length': fileSize.toString(),
                },
                body: JSON.stringify({
                    name: fileName,
                    parents: [folderId],
                }),
            }
        )

        if (!initResponse.ok) {
            const error = await initResponse.json().catch(() => ({}))
            throw new Error(error.message || 'Failed to initialize upload')
        }

        const uploadUrl = initResponse.headers.get('Location')
        if (!uploadUrl) {
            throw new Error('No upload URL returned')
        }

        // Step 2: Upload the file data
        // For files up to ~10MB, single request is fine
        // For larger files, we could implement chunked upload
        const uploadResponse = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Length': fileSize.toString(),
                'Content-Type': 'image/ktx2',
            },
            body: blob,
        })

        if (!uploadResponse.ok) {
            const error = await uploadResponse.json().catch(() => ({}))
            throw new Error(error.message || 'Failed to upload file')
        }

        if (onProgress) {
            onProgress(100)
        }

        const file = await uploadResponse.json()

        // Step 3: Make the file publicly accessible via link
        await makeFilePublic(file.id)

        return {
            id: file.id,
            size: fileSize,
        }
    }

    /**
     * Make a file publicly accessible via link
     */
    async function makeFilePublic(fileId) {
        const accessToken = await getAccessToken()
        
        try {
            await fetch(
                `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        role: 'reader',
                        type: 'anyone',
                    }),
                }
            )
        } catch (err) {
            console.warn('Failed to make file public:', err)
            // Don't fail the whole upload for this - file can still be accessed by owner
        }
    }

    /**
     * Upload a tile and register its metadata with the API
     * @param {string} textureSetId - The API texture set ID
     * @param {number} tileIndex - Tile index (0-based)
     * @param {string} folderId - Google Drive folder ID
     * @param {Blob|ArrayBuffer} tileData - The KTX2 tile data
     * @param {Function} onProgress - Progress callback
     */
    async function uploadTile(textureSetId, tileIndex, folderId, tileData, onProgress = null) {
        // Upload to Google Drive
        const fileName = `${tileIndex}.ktx2`
        const fileInfo = await uploadFile(folderId, fileName, tileData, onProgress)

        // Register with API
        const response = await fetch(
            `${API_BASE_URL}/texture-set/${textureSetId}/tile/${tileIndex}/metadata`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    driveFileId: fileInfo.id,
                    fileSize: fileInfo.size,
                }),
            }
        )

        if (!response.ok) {
            const error = await response.json().catch(() => ({}))
            throw new Error(error.error || `Failed to register tile ${tileIndex}`)
        }

        return {
            tileIndex,
            driveFileId: fileInfo.id,
            fileSize: fileInfo.size,
        }
    }

    /**
     * Upload a thumbnail to Google Drive
     * @param {string} folderId - Folder ID
     * @param {Blob} thumbnailBlob - The thumbnail image
     * @returns {string} Public URL for the thumbnail
     */
    async function uploadThumbnail(folderId, thumbnailBlob) {
        const fileInfo = await uploadFile(folderId, 'thumbnail.webp', thumbnailBlob)
        return `https://drive.google.com/uc?export=download&id=${fileInfo.id}`
    }

    /**
     * Delete a folder and all its contents
     * @param {string} folderId - The folder to delete
     */
    async function deleteFolder(folderId) {
        const accessToken = await getAccessToken()
        if (!accessToken) {
            throw new Error('Not authenticated with Google Drive')
        }

        await fetch(
            `https://www.googleapis.com/drive/v3/files/${folderId}`,
            {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${accessToken}` },
            }
        )
    }

    return {
        ensureSlyceFolder,
        createTextureSetFolder,
        uploadFile,
        uploadTile,
        uploadThumbnail,
        deleteFolder,
    }
}
