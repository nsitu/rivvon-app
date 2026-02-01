<template>
    <!-- Download UI (format-agnostic) -->
    <div class="download-section">
        <h4 class="text-lg font-semibold mb-3">Download Tiles</h4>

        <!-- Download All Button -->
        <button
            @click="downloadAll"
            :disabled="isDownloadingZip"
            class="download-all-button bg-green-500 text-white px-6 py-2 rounded-md hover:bg-green-600 transition-colors duration-300 mb-4 flex items-center disabled:opacity-60 disabled:cursor-not-allowed"
        >
            <span v-if="isDownloadingZip">Creating ZIP...</span>
            <span v-else>Download All as ZIP</span>

            <svg
                v-if="isDownloadingZip"
                class="animate-spin h-5 w-5 text-white ml-2"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
            >
                <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                ></circle>
                <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                ></path>
            </svg>
        </button>

        <!-- Upload Options (only show when authenticated) -->
        <div
            v-if="isAuthenticated"
            class="upload-options mb-4 p-3 rounded-md"
        >
            <h5 class="text-sm font-semibold upload-options-title mb-3">Upload Options</h5>

            <!-- Texture Name Input -->
            <div class="mb-3">
                <label
                    for="textureName"
                    class="block text-xs font-medium upload-options-label mb-1"
                >Texture Name</label>
                <input
                    id="textureName"
                    v-model="textureName"
                    type="text"
                    :placeholder="app.fileInfo?.name?.replace(/\.[^.]+$/, '') || 'texture'"
                    class="texture-name-input w-full px-3 py-2 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
            </div>

            <!-- Public Toggle -->
            <div class="flex items-center justify-between">
                <label
                    for="isPublic"
                    class="text-xs font-medium upload-options-label"
                >Make texture public</label>
                <button
                    id="isPublic"
                    type="button"
                    @click="isPublic = !isPublic"
                    :class="isPublic ? 'bg-purple-600' : 'toggle-off'"
                    class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
                    role="switch"
                    :aria-checked="isPublic"
                >
                    <span
                        :class="isPublic ? 'translate-x-5' : 'translate-x-0'"
                        class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                    ></span>
                </button>
            </div>
        </div>

        <!-- Upload to CDN Button -->
        <button
            @click="uploadToCDN"
            :disabled="isUploading || !isAuthenticated"
            class="upload-cdn-button px-6 py-2 rounded-md transition-colors duration-300 mb-4 flex items-center"
            :class="isAuthenticated ? 'bg-purple-500 text-white hover:bg-purple-600' : 'bg-gray-400 text-gray-200 cursor-not-allowed'"
            :title="!isAuthenticated ? 'Login required to upload' : 'Upload all tiles to Rivvon CDN'"
        >
            <span v-if="isUploading && uploadProgress">{{ uploadProgress }}</span>
            <span v-else-if="isUploading">Uploading...</span>
            <span v-else-if="!isAuthenticated">Login to Upload</span>
            <span v-else>Upload to CDN</span>

            <svg
                v-if="isUploading"
                class="animate-spin h-5 w-5 text-white ml-2"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
            >
                <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                ></circle>
                <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                ></path>
            </svg>

            <span
                v-if="uploadSuccess"
                class="ml-2 text-green-200"
            >✓ Uploaded!</span>
            <span
                v-if="uploadError"
                class="ml-2 text-red-200"
            >✗ {{ uploadError }}</span>
        </button>

        <!-- Show uploaded texture with Apply button -->
        <div
            v-if="uploadedTextureSetId"
            class="uploaded-texture-container mb-4 p-3 rounded-md flex items-center gap-4"
        >
            <!-- Thumbnail preview -->
            <img
                v-if="uploadedThumbnailUrl"
                :src="uploadedThumbnailUrl"
                alt="Texture thumbnail"
                class="w-16 h-16 object-cover rounded border border-green-500"
            />
            <div
                v-else
                class="w-16 h-16 rounded bg-gray-600 flex items-center justify-center"
            >
                <span class="material-symbols-outlined text-gray-400">texture</span>
            </div>

            <div class="flex-1">
                <p class="text-sm font-medium uploaded-text-title">Texture uploaded!</p>
                <p class="text-xs uploaded-text-secondary">Ready to apply to ribbon</p>
            </div>

            <button
                @click="applyTexture"
                class="apply-texture-btn bg-green-500 text-white px-4 py-2 rounded-md hover:bg-green-600 transition-colors duration-300 flex items-center gap-2"
            >
                <span class="material-symbols-outlined">check</span>
                Apply
            </button>
        </div>
    </div>
</template>

<script setup>
    import { computed, reactive, ref } from 'vue';
    import { useGoogleAuth } from '../../composables/shared/useGoogleAuth';
    import { downloadAllAsZip } from '../../modules/slyce/zipDownloader.js';
    import { useSlyceStore } from '../../stores/slyceStore';
    import { useRivvonAPI } from '../../services/api.js';

    // Access the Pinia store
    const app = useSlyceStore();

    // Emit events
    const emit = defineEmits(['apply-texture']);

    // Google Auth and API integration
    const { isAuthenticated } = useGoogleAuth();
    const { uploadTextureSet } = useRivvonAPI();

    // Upload state
    const isUploading = ref(false);
    const uploadProgress = ref('');
    const uploadSuccess = ref(false);
    const uploadError = ref(null);
    const uploadedTextureSetId = ref(null);
    const uploadedUrls = ref([]);
    const uploadedThumbnailUrl = ref(null);

    // Upload options
    const textureName = ref('');
    const isPublic = ref(true);

    // Computed property for current blob URLs based on format
    const currentBlobURLs = computed(() => {
        return app.outputFormat === 'ktx2' ? app.ktx2BlobURLs : app.blobURLs;
    });

    const isDownloadingZip = ref(false);

    // Download all tiles as ZIP
    const downloadAll = async () => {
        if (isDownloadingZip.value) return;

        isDownloadingZip.value = true;

        try {
            const format = app.outputFormat === 'ktx2'
                ? { mime: 'image/ktx2', extension: 'ktx2' }
                : { mime: 'video/webm', extension: 'webm' };

            await downloadAllAsZip(currentBlobURLs.value, app.fileInfo, format, app);
        } catch (error) {
            console.error('Failed to create ZIP:', error);
            alert('Failed to create ZIP file. Files may be too large.');
        } finally {
            isDownloadingZip.value = false;
        }
    };

    // Upload all tiles to Rivvon CDN
    const uploadToCDN = async () => {
        if (isUploading.value || !isAuthenticated.value) return;

        isUploading.value = true;
        uploadSuccess.value = false;
        uploadError.value = null;
        uploadProgress.value = 'Preparing upload...';
        uploadedUrls.value = [];
        uploadedTextureSetId.value = null;
        uploadedThumbnailUrl.value = null;

        try {
            const blobUrls = Object.entries(currentBlobURLs.value);
            const defaultName = app.fileInfo?.name?.replace(/\.[^.]+$/, '') || 'texture';
            const finalName = textureName.value.trim() || defaultName;

            // Calculate effective frame count (what was actually sampled)
            const effectiveFrameCount = app.framesToSample > 0
                ? Math.min(app.framesToSample, app.frameCount)
                : app.frameCount;

            // Use thumbnail from store (captured during video processing)
            const thumbnailBlob = app.thumbnailBlob;
            if (thumbnailBlob) {
                console.log('[DownloadArea] Using pre-captured thumbnail:', thumbnailBlob.size, 'bytes');
            } else {
                console.log('[DownloadArea] No thumbnail available');
            }

            // Prepare tiles array with blobs
            uploadProgress.value = 'Preparing tiles...';
            const tiles = [];
            for (const [tileNumber, blobUrl] of blobUrls) {
                const response = await fetch(blobUrl);
                const blob = await response.blob();
                tiles.push({
                    index: parseInt(tileNumber),
                    blob,
                });
            }

            // Upload texture set with all tiles and thumbnail
            const result = await uploadTextureSet({
                name: finalName,
                description: `Uploaded from Slyce on ${new Date().toLocaleDateString()}`,
                isPublic: isPublic.value,
                tileResolution: app.potResolution || 512,
                layerCount: app.crossSectionCount || 60,
                crossSectionType: app.crossSectionType || 'planes',
                sourceMetadata: {
                    filename: app.fileInfo?.name,
                    width: app.fileInfo?.width,
                    height: app.fileInfo?.height,
                    duration: app.fileInfo?.duration,
                    sourceFrameCount: app.frameCount,
                    sampledFrameCount: effectiveFrameCount,
                },
                tiles,
                thumbnailBlob,
                onProgress: (step, detail) => {
                    uploadProgress.value = detail;
                },
            });

            uploadedTextureSetId.value = result.textureSetId;
            uploadedUrls.value = result.tiles.map((t) => t.url);
            uploadedThumbnailUrl.value = result.thumbnailUrl;

            // Log CDN URLs to console for reference
            console.log('[DownloadArea] Texture uploaded successfully:', {
                textureSetId: result.textureSetId,
                thumbnailUrl: result.thumbnailUrl,
                tileUrls: result.tiles.map((t) => t.url),
            });

            uploadSuccess.value = true;
            uploadProgress.value = '';
            setTimeout(() => { uploadSuccess.value = false; }, 5000);
        } catch (error) {
            console.error('CDN upload failed:', error);
            uploadError.value = error.message || 'Upload failed';
            uploadProgress.value = '';
            setTimeout(() => { uploadError.value = null; }, 5000);
        } finally {
            isUploading.value = false;
        }
    };

    // Apply texture to the ribbon
    const applyTexture = () => {
        if (!uploadedTextureSetId.value) return;

        emit('apply-texture', {
            id: uploadedTextureSetId.value,
            name: textureName.value.trim() || app.fileInfo?.name?.replace(/\.[^.]+$/, '') || 'texture',
            thumbnail_url: uploadedThumbnailUrl.value,
        });
    };
</script>

<style scoped>
    .download-section {
        padding: 0.75rem;
        border: 1px solid var(--border-primary);
        border-radius: 0.5rem;
        background: var(--bg-secondary);
        text-align: left;
    }

    @media (min-width: 640px) {
        .download-section {
            padding: 0.75rem 1rem;
        }
    }

    /* Upload options styling */
    .upload-options {
        background-color: var(--accent-purple-light);
        border: 1px solid #9333ea40;
    }

    .upload-options-title {
        color: var(--text-primary);
    }

    .upload-options-label {
        color: var(--text-secondary);
    }

    .texture-name-input {
        background-color: var(--bg-input);
        border: 1px solid var(--border-secondary);
        color: var(--text-primary);
    }

    .texture-name-input::placeholder {
        color: var(--text-muted);
    }

    .toggle-off {
        background-color: var(--bg-muted-alt);
    }

    /* Uploaded URLs styling */
    .uploaded-texture-container {
        background-color: var(--accent-green-light);
        border: 1px solid #10b98140;
    }

    .uploaded-text-title {
        color: var(--text-primary);
    }

    .uploaded-text-secondary {
        color: var(--text-secondary);
    }

    .apply-texture-btn {
        min-height: 44px;
    }

    .download-all-button,
    .upload-cdn-button {
        width: 100%;
        min-height: 44px;
        justify-content: center;
    }

    @media (min-width: 640px) {

        .download-all-button,
        .upload-cdn-button {
            width: auto;
        }
    }

    .upload-options input[type="text"] {
        min-height: 44px;
    }
</style>
