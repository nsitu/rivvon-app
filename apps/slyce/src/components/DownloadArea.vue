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
            class="upload-options mb-4 p-3 bg-purple-50 border border-purple-200 rounded-md"
        >
            <h5 class="text-sm font-semibold text-purple-800 mb-3">Upload Options</h5>

            <!-- Texture Name Input -->
            <div class="mb-3">
                <label
                    for="textureName"
                    class="block text-xs font-medium text-purple-700 mb-1"
                >Texture Name</label>
                <input
                    id="textureName"
                    v-model="textureName"
                    type="text"
                    :placeholder="app.fileInfo?.name?.replace(/\.[^.]+$/, '') || 'texture'"
                    class="w-full px-3 py-2 text-sm border border-purple-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
            </div>

            <!-- Public Toggle -->
            <div class="flex items-center justify-between">
                <label
                    for="isPublic"
                    class="text-xs font-medium text-purple-700"
                >Make texture public</label>
                <button
                    id="isPublic"
                    type="button"
                    @click="isPublic = !isPublic"
                    :class="isPublic ? 'bg-purple-600' : 'bg-gray-300'"
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

        <!-- Show uploaded URLs -->
        <div
            v-if="uploadedTextureSetId"
            class="uploaded-urls mb-4 p-3 bg-green-50 border border-green-200 rounded-md"
        >
            <p class="text-sm font-medium text-green-800 mb-2">
                Texture Set: <code class="bg-green-100 px-1 rounded">{{ uploadedTextureSetId }}</code>
            </p>

            <!-- Thumbnail preview -->
            <div
                v-if="uploadedThumbnailUrl"
                class="mb-3"
            >
                <p class="text-xs text-green-700 mb-1">Thumbnail:</p>
                <a
                    :href="uploadedThumbnailUrl"
                    target="_blank"
                >
                    <img
                        :src="uploadedThumbnailUrl"
                        alt="Texture thumbnail"
                        class="w-24 h-24 object-cover rounded border border-green-300 hover:border-green-500 transition-colors"
                    />
                </a>
            </div>

            <p class="text-xs text-green-700 mb-2">CDN URLs:</p>
            <ul class="text-xs text-green-700 space-y-1">
                <li
                    v-for="(url, index) in uploadedUrls"
                    :key="index"
                    class="break-all"
                >
                    <a
                        :href="url"
                        target="_blank"
                        class="hover:underline"
                    >{{ url }}</a>
                </li>
            </ul>
        </div>

        <div class="flex flex-wrap gap-2">
            <button
                v-for="(blobURL, tileNumber) in currentBlobURLs"
                :key="tileNumber"
                :disabled="downloadingTiles.has(blobURL)"
                class="download-button bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 transition-colors duration-300 flex items-center justify-center"
                @click="download(blobURL, tileNumber)"
                :aria-label="`Download Tile ${tileNumber}`"
            >
                <span v-if="downloadingTiles.has(blobURL)">Downloading...</span>
                <span v-else>Tile {{ tileNumber }}</span>

                <!-- Spinner -->
                <svg
                    v-if="downloadingTiles.has(blobURL)"
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

                <!-- Success/Error indicators -->
                <span
                    v-if="downloadSuccess[tileNumber]"
                    class="ml-2"
                >✓</span>
                <span
                    v-if="downloadError[tileNumber]"
                    class="ml-2"
                >✗</span>
            </button>
        </div>
    </div>
</template>

<script setup>
    import { computed, reactive, ref } from 'vue';
    import { useAuth0 } from '@auth0/auth0-vue';
    import { downloadBlob } from '../modules/blobDownloader.js';
    import { downloadAllAsZip } from '../modules/zipDownloader.js';
    import { useAppStore } from '../stores/appStore';
    import { useRivvonAPI } from '../services/api.js';

    // Access the Pinia store
    const app = useAppStore();

    // Auth0 and API integration
    const { isAuthenticated } = useAuth0();
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

    // Reactive sets to track downloading, success, and error states
    const downloadingTiles = reactive(new Set());
    const downloadSuccess = reactive({});
    const downloadError = reactive({});
    const isDownloadingZip = ref(false);

    // Download function
    const download = async (blobUrl, tileNumber) => {
        if (downloadingTiles.has(blobUrl)) return; // Prevent multiple downloads

        downloadingTiles.add(blobUrl);
        delete downloadSuccess[tileNumber];
        delete downloadError[tileNumber];

        try {
            // Determine format descriptor based on output format
            const format = app.outputFormat === 'ktx2'
                ? { mime: 'image/ktx2', extension: 'ktx2' }
                : { mime: 'video/webm', extension: 'webm' };

            await downloadBlob(blobUrl, tileNumber, app.fileInfo, format);
            downloadSuccess[tileNumber] = true;
            // Remove success message after 3 seconds
            setTimeout(() => delete downloadSuccess[tileNumber], 3000);
        } catch (error) {
            console.error(`Download failed for tile ${tileNumber}:`, error);
            downloadError[tileNumber] = true;
            // Remove error message after 3 seconds
            setTimeout(() => delete downloadError[tileNumber], 3000);
        } finally {
            downloadingTiles.delete(blobUrl);
        }
    };

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
            uploadedUrls.value = result.cdnUrls.map((t) => t.url);
            uploadedThumbnailUrl.value = result.thumbnailUrl;

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
</script>

<style scoped>
    .download-section {
        padding: 0.75rem 1rem;
        border: 1px solid #e2e8f0;
        border-radius: 0.5rem;
        background: #f8fafc;
        text-align: left;
    }

    .download-button {
        min-width: 100px;
        transition: background-color 0.3s;
    }

    .download-button:hover:not(:disabled) {
        background-color: #2563eb;
    }

    .download-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }
</style>
