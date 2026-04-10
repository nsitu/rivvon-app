<script setup>
    import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
    import { useViewerStore } from '../../stores/viewerStore';
    import { fetchTextures, fetchTextureWithTiles } from '../../services/textureService';
    import { useRivvonAPI } from '../../services/api.js';
    import { useGoogleAuth } from '../../composables/shared/useGoogleAuth';
    import { useLocalStorage } from '../../services/localStorage.js';
    import { fetchDriveFile } from '../../modules/viewer/auth.js';
    import TileLinearViewer from '../slyce/TileLinearViewer.vue';

    const props = defineProps({
        visible: {
            type: Boolean,
            default: false
        },
        initialTab: {
            type: String,
            default: 'all' // 'all' or 'mine'
        }
    });

    const emit = defineEmits(['close', 'select', 'select-local', 'select-multi']);

    // Multi-select state
    const MAX_MULTI_SELECT = 4;
    const multiSelectMode = ref(false);
    const selectedTextures = ref(new Map()); // id -> { texture, isLocal }

    const app = useViewerStore();
    const { deleteTextureSet, uploadTextureSet, uploadTextureSetToR2, updateTextureSet } = useRivvonAPI();
    const { isAuthenticated, isAdmin, user } = useGoogleAuth();
    const { getAllTextureSets: getLocalTextures, deleteTextureSet: deleteLocalTextureSet, getTiles: getLocalTiles, getTextureSet: getLocalTextureSet, updateTextureSet: updateLocalTextureSet, cacheCloudTexture, getCachedCloudIds, getCachedLocalId, evictCachedTexture } = useLocalStorage();

    // State
    const textures = ref([]);
    const localTextures = ref([]);
    const cachedCloudIds = ref(new Set()); // cloud IDs that have a local cache
    const isLoading = ref(false);
    const error = ref(null);
    const hasLoaded = ref(false);
    const activeTab = ref(props.initialTab);

    // Delete state
    const textureToDelete = ref(null);
    const deletingId = ref(null);
    const isLocalDelete = ref(false);

    // Copy state
    const textureToCopy = ref(null);
    const copyDestination = ref(null); // 'google-drive', 'r2', or 'local'
    const isCopying = ref(false);
    const copyProgress = ref('');
    const copyError = ref(null);
    const showCopyMenu = ref(null); // texture id to show copy menu for
    const copyMenuPosition = ref({ top: 0, left: 0 }); // position for teleported menu
    const copyMenuTexture = ref(null); // texture object for menu

    // Edit state
    const textureToEdit = ref(null);
    const editName = ref('');
    const isEditing = ref(false);
    const editError = ref(null);

    // Combined textures for display (adds isLocal flag to distinguish)
    const displayTextures = computed(() => {
        const tab = activeTab.value;
        const cachedIds = cachedCloudIds.value;

        // Map local textures with isLocal flag (exclude cache entries for the local tab)
        const localMapped = localTextures.value
            .filter(t => !t.cached_from) // hide cache entries from "My Local"
            .map(t => ({
                ...t,
                isLocal: true,
                thumbnail_url: t.thumbnail_data_url, // normalize field name
                total_size_bytes: t.total_size_bytes ?? t.total_size // normalize size field name
            }));

        // Map cloud textures with isLocal flag + isCached indicator
        // Filter out Google Drive textures for unauthenticated users (they require auth to access)
        const cloudMapped = textures.value
            .filter(t => {
                const provider = t.storage_provider || 'r2';
                // If not authenticated, only show R2/Cloudflare textures (not Google Drive)
                if (!isAuthenticated.value && provider === 'google-drive') {
                    return false;
                }
                return true;
            })
            .map(t => ({
                ...t,
                isLocal: false,
                isCached: cachedIds.has(t.id)
            }));

        switch (tab) {
            case 'local':
                // My Local: only user-created local textures (not caches)
                return localMapped;
            case 'cached':
                // Cached: cloud textures that have a local cache
                return cloudMapped.filter(t => t.isCached);
            case 'my-cloud':
                // My Cloud: user's own cloud textures
                if (!user.value) return [];
                return cloudMapped.filter(t => t.owner_google_id === user.value.googleId);
            case 'public':
                // Public: all cloud textures (stored on Cloudflare)
                return cloudMapped;
            case 'all':
            default:
                // All: combine local + cloud, sorted by date (newest first)
                return [...localMapped, ...cloudMapped].sort((a, b) => {
                    const dateA = a.created_at || 0;
                    const dateB = b.created_at || 0;
                    return dateB - dateA;
                });
        }
    });

    // Check if current user owns a texture (using google_id for cross-environment reliability)
    function isOwner(texture) {
        return user.value && texture.owner_google_id === user.value.googleId;
    }

    // Check if texture is local
    function isLocalTexture(texture) {
        return texture.isLocal === true;
    }

    // Load textures when component mounts or visibility changes
    watch(() => props.visible, async (isVisible) => {
        if (isVisible && !hasLoaded.value && !isLoading.value) {
            await loadTextures();
        }
        if (isVisible) {
            activeTab.value = props.initialTab;
        }
    }, { immediate: true });

    async function loadTextures() {
        isLoading.value = true;
        error.value = null;

        try {
            // Load remote, local, and cache status in parallel
            const [result, localResult, cachedIds] = await Promise.all([
                fetchTextures({ limit: 100 }),
                getLocalTextures().catch(err => {
                    console.warn('[TextureBrowser] Failed to load local textures:', err);
                    return [];
                }),
                getCachedCloudIds().catch(err => {
                    console.warn('[TextureBrowser] Failed to load cache status:', err);
                    return new Set();
                })
            ]);

            textures.value = result.textures || [];
            localTextures.value = localResult || [];
            cachedCloudIds.value = cachedIds;
            hasLoaded.value = true;
        } catch (err) {
            console.error('[TextureBrowser] Failed to load textures:', err);
            error.value = err.message;
        } finally {
            isLoading.value = false;
        }
    }

    function selectLocalTexture(texture) {
        console.log('[TextureBrowser] Selected local texture:', texture.id, texture.name);
        emit('select-local', texture);
        close();
    }

    function selectTexture(texture) {
        console.log('[TextureBrowser] Selected texture:', texture.id, texture.name);
        emit('select', texture);
        close();
    }

    // Multi-select helpers
    function toggleMultiSelectMode() {
        multiSelectMode.value = !multiSelectMode.value;
        if (!multiSelectMode.value) {
            selectedTextures.value = new Map();
        }
    }

    function isTextureSelected(texture) {
        return selectedTextures.value.has(texture.id);
    }

    function toggleTextureSelection(texture, event) {
        event.stopPropagation();
        const map = new Map(selectedTextures.value);
        if (map.has(texture.id)) {
            map.delete(texture.id);
        } else {
            if (map.size >= MAX_MULTI_SELECT) return; // cap reached
            map.set(texture.id, { texture, isLocal: isLocalTexture(texture) });
        }
        selectedTextures.value = map;
    }

    function handleCardClick(texture) {
        if (multiSelectMode.value) {
            toggleTextureSelection(texture, event);
        } else {
            if (isLocalTexture(texture)) {
                selectLocalTexture(texture);
            } else {
                selectTexture(texture);
            }
        }
    }

    function applyMultiSelection() {
        const raw = Array.from(selectedTextures.value.values());
        if (raw.length === 0) return;
        // Map to the shape RibbonView expects: { id, source, name }
        const selections = raw.map(entry => ({
            id: entry.texture.id,
            source: entry.isLocal ? 'local' : 'cloud',
            name: entry.texture.name
        }));
        console.log('[TextureBrowser] Applying multi-selection:', selections.length, 'textures');
        emit('select-multi', selections);
        close();
    }

    const multiSelectCount = computed(() => selectedTextures.value.size);
    const isMaxSelected = computed(() => selectedTextures.value.size >= MAX_MULTI_SELECT);

    function close() {
        multiSelectMode.value = false;
        selectedTextures.value = new Map();
        emit('close');
        app.hideTextureBrowser();
    }

    function handleKeydown(event) {
        if (event.key === 'Escape') {
            if (previewTexture.value) {
                closePreview();
            } else if (textureToEdit.value) {
                cancelEdit();
            } else if (textureToCopy.value) {
                cancelCopy();
            } else if (textureToDelete.value) {
                textureToDelete.value = null;
            } else if (showCopyMenu.value) {
                showCopyMenu.value = null;
            } else {
                close();
            }
        }
    }

    // Close copy menu when clicking outside
    function handleGlobalClick(event) {
        if (showCopyMenu.value &&
            !event.target.closest('.action-button.copy-button') &&
            !event.target.closest('.copy-menu-teleport')) {
            showCopyMenu.value = null;
            copyMenuTexture.value = null;
        }
    }

    // Set up global click listener
    watch(() => props.visible, (isVisible) => {
        if (isVisible) {
            document.addEventListener('click', handleGlobalClick);
        } else {
            document.removeEventListener('click', handleGlobalClick);
            showCopyMenu.value = null;
        }
    });

    // Delete functionality
    function confirmDelete(texture, event) {
        event.stopPropagation(); // Prevent card click
        textureToDelete.value = texture;
        isLocalDelete.value = isLocalTexture(texture);
    }

    async function performDelete() {
        if (!textureToDelete.value) return;

        deletingId.value = textureToDelete.value.id;
        try {
            if (isLocalDelete.value) {
                // Delete from IndexedDB
                await deleteLocalTextureSet(textureToDelete.value.id);
                localTextures.value = localTextures.value.filter(t => t.id !== textureToDelete.value.id);
            } else {
                // Delete from cloud
                await deleteTextureSet(textureToDelete.value.id);
                textures.value = textures.value.filter(t => t.id !== textureToDelete.value.id);
            }
            textureToDelete.value = null;
        } catch (err) {
            console.error('[TextureBrowser] Failed to delete texture:', err);
            error.value = 'Failed to delete: ' + err.message;
        } finally {
            deletingId.value = null;
            isLocalDelete.value = false;
        }
    }

    async function evictCache(texture, event) {
        event.stopPropagation();
        try {
            await evictCachedTexture(texture.id);
            cachedCloudIds.value = await getCachedCloudIds();
        } catch (err) {
            console.error('[TextureBrowser] Failed to evict cache:', err);
        }
    }

    // Copy functionality
    function toggleCopyMenu(texture, event) {
        event.stopPropagation();
        if (showCopyMenu.value === texture.id) {
            showCopyMenu.value = null;
            copyMenuTexture.value = null;
        } else {
            // Calculate position from button
            const button = event.currentTarget;
            const rect = button.getBoundingClientRect();
            copyMenuPosition.value = {
                top: rect.bottom + 4,
                left: rect.left // align left edge with button
            };
            showCopyMenu.value = texture.id;
            copyMenuTexture.value = texture;
        }
    }

    function closeCopyMenu() {
        showCopyMenu.value = null;
    }

    /**
     * Get available copy destinations for a texture
     * Rules:
     * - Local textures: can copy to Google Drive (if authenticated) or R2 (if admin)
     * - Google Drive textures: can copy to R2 (if admin)
     * - R2 textures: no copy needed (already on CDN)
     */
    function getCopyDestinations(texture) {
        const destinations = [];
        const isLocal = isLocalTexture(texture);
        const provider = texture.storage_provider || 'r2';

        if (isLocal) {
            // Local textures can be copied to cloud
            if (isAuthenticated.value) {
                destinations.push({
                    value: 'google-drive',
                    label: 'Google Drive',
                    icon: '/google-drive.svg'
                });
            }
            if (isAdmin.value) {
                destinations.push({
                    value: 'r2',
                    label: 'Cloudflare R2',
                    icon: '/cloudflare.svg'
                });
            }
        } else if (provider === 'google-drive') {
            // Google Drive textures can be copied to R2 (admin only)
            if (isAdmin.value) {
                destinations.push({
                    value: 'r2',
                    label: 'Cloudflare R2',
                    icon: '/cloudflare.svg'
                });
            }
        }
        // R2 textures have no copy destinations (already on CDN)

        return destinations;
    }

    async function startCopy(texture, destination, event) {
        event.stopPropagation();
        showCopyMenu.value = null;
        textureToCopy.value = texture;
        copyDestination.value = destination;
    }

    async function performCopy() {
        if (!textureToCopy.value || !copyDestination.value) return;

        isCopying.value = true;
        copyProgress.value = 'Preparing...';
        copyError.value = null;

        try {
            const texture = textureToCopy.value;
            const destination = copyDestination.value;
            const isLocal = isLocalTexture(texture);

            // 1. Fetch tiles from source
            let tiles = [];
            let thumbnailBlob = null;

            if (isLocal) {
                // Fetch from IndexedDB
                copyProgress.value = 'Loading tiles from local storage...';
                const localTiles = await getLocalTiles(texture.id);
                tiles = localTiles.map(t => ({
                    index: t.tile_index,
                    blob: t.blob
                }));

                // Convert thumbnail data URL to blob if available
                if (texture.thumbnail_data_url) {
                    const response = await fetch(texture.thumbnail_data_url);
                    thumbnailBlob = await response.blob();
                }
            } else {
                // Fetch from cloud (Google Drive or R2)
                copyProgress.value = 'Fetching tiles from cloud...';
                const textureData = await fetchTextureWithTiles(texture.id);
                const isGoogleDrive = texture.storage_provider === 'google-drive';

                // Download each tile as blob
                for (let i = 0; i < textureData.tiles.length; i++) {
                    copyProgress.value = `Downloading tile ${i + 1}/${textureData.tiles.length}...`;
                    const tile = textureData.tiles[i];
                    let blob;

                    if (isGoogleDrive && tile.driveFileId) {
                        // Use Google Drive API with OAuth token (CORS-safe)
                        const arrayBuffer = await fetchDriveFile(tile.driveFileId);
                        blob = new Blob([arrayBuffer], { type: 'image/ktx2' });
                    } else if (tile.url && tile.url.includes('drive.google.com')) {
                        // Parse Drive file ID from URL and use API
                        const fileIdMatch = tile.url.match(/[?&]id=([^&]+)/);
                        if (fileIdMatch) {
                            const arrayBuffer = await fetchDriveFile(fileIdMatch[1]);
                            blob = new Blob([arrayBuffer], { type: 'image/ktx2' });
                        } else {
                            throw new Error('Invalid Google Drive URL format');
                        }
                    } else {
                        // Direct URL (R2/CDN) - simple fetch
                        const response = await fetch(tile.url);
                        blob = await response.blob();
                    }

                    tiles.push({
                        index: tile.tileIndex,
                        blob
                    });
                }

                // Download thumbnail if available
                if (texture.thumbnail_url) {
                    try {
                        const response = await fetch(texture.thumbnail_url);
                        thumbnailBlob = await response.blob();
                    } catch (e) {
                        console.warn('Failed to fetch thumbnail:', e);
                    }
                }
            }

            // 2. Upload to destination
            const uploadOptions = {
                name: texture.name + ' (copy)',
                description: texture.description || `Copied on ${new Date().toLocaleDateString()}`,
                isPublic: texture.is_public !== false,
                tileResolution: texture.tile_resolution,
                layerCount: texture.layer_count,
                crossSectionType: texture.cross_section_type || 'waves',
                sourceMetadata: texture.source_metadata || {
                    filename: texture.name,
                    sourceFrameCount: texture.source_frame_count,
                    sampledFrameCount: texture.sampled_frame_count
                },
                tiles,
                thumbnailBlob,
                onProgress: (step, detail) => {
                    copyProgress.value = detail;
                }
            };

            if (destination === 'google-drive') {
                copyProgress.value = 'Uploading to Google Drive...';
                await uploadTextureSet(uploadOptions);
            } else if (destination === 'r2') {
                copyProgress.value = 'Uploading to Cloudflare R2...';
                await uploadTextureSetToR2(uploadOptions);
            }

            // 3. Refresh textures list
            copyProgress.value = 'Refreshing...';
            await loadTextures();

            // Close modal
            textureToCopy.value = null;
            copyDestination.value = null;
            copyProgress.value = '';

        } catch (err) {
            console.error('[TextureBrowser] Copy failed:', err);
            copyError.value = err.message || 'Copy failed';
        } finally {
            isCopying.value = false;
        }
    }

    function cancelCopy() {
        textureToCopy.value = null;
        copyDestination.value = null;
        copyProgress.value = '';
        copyError.value = null;
    }

    // Edit functionality
    function startEdit(texture, event) {
        event.stopPropagation();
        textureToEdit.value = texture;
        editName.value = texture.name || '';
        editError.value = null;
    }

    async function performEdit() {
        if (!textureToEdit.value || !editName.value.trim()) {
            editError.value = 'Name cannot be empty';
            return;
        }

        isEditing.value = true;
        editError.value = null;

        try {
            const texture = textureToEdit.value;
            const newName = editName.value.trim();
            const isLocal = isLocalTexture(texture);

            if (isLocal) {
                // Update in IndexedDB
                await updateLocalTextureSet(texture.id, { name: newName });
                // Update local ref
                const idx = localTextures.value.findIndex(t => t.id === texture.id);
                if (idx !== -1) {
                    localTextures.value[idx].name = newName;
                }
            } else {
                // Update in cloud
                await updateTextureSet(texture.id, { name: newName });
                // Update local ref
                const idx = textures.value.findIndex(t => t.id === texture.id);
                if (idx !== -1) {
                    textures.value[idx].name = newName;
                }
            }

            // Close modal
            textureToEdit.value = null;
            editName.value = '';
        } catch (err) {
            console.error('[TextureBrowser] Edit failed:', err);
            editError.value = err.message || 'Failed to update';
        } finally {
            isEditing.value = false;
        }
    }

    function cancelEdit() {
        textureToEdit.value = null;
        editName.value = '';
        editError.value = null;
    }

    function formatSize(bytes) {
        if (!bytes) return null;
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    function getStorageInfo(texture) {
        const provider = texture.storage_provider || 'r2';
        if (provider === 'google-drive') {
            return {
                icon: '/google-drive.svg',
                label: 'Google Drive',
                requiresAuth: true
            };
        }
        return {
            icon: '/cloudflare.svg',
            label: 'CDN',
            requiresAuth: false
        };
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatDate(timestamp) {
        if (!timestamp) return 'Unknown';
        return new Date(timestamp).toLocaleDateString();
    }

    // ── Animated Preview ──
    const previewTexture = ref(null);      // texture being previewed
    const previewBlobURLs = ref({});       // tileNumber → blob URL
    const previewLoading = ref(false);
    const previewError = ref(null);

    /**
     * Pre-calculate the expected canvas width for the preview panel.
     * Replicates the renderer's vertical-flow scale logic so the panel
     * can be sized before the canvas actually renders.
     */
    const previewCanvasWidth = computed(() => {
        if (!previewTexture.value) return 0;
        const tileSize = previewTexture.value.tile_resolution || 512;
        const tileCount = previewTexture.value.tile_count || 1;
        const maxH = 7680;

        const naturalHeight = tileSize * tileCount;
        let scale = Math.min(1, maxH / naturalHeight);

        // GPU clamp (same logic as renderer)
        const pixelRatio = Math.min(window.devicePixelRatio, 2);
        const maxCanvas = Math.floor(8192 / pixelRatio);
        const canvasHeight = Math.round(naturalHeight * scale);
        if (canvasHeight > maxCanvas) {
            scale *= maxCanvas / canvasHeight;
        }

        return Math.round(tileSize * scale);
    });

    async function openPreview(texture, event) {
        event.stopPropagation();
        previewTexture.value = texture;
        previewBlobURLs.value = {};
        previewLoading.value = true;
        previewError.value = null;
        app.showTexturePreview();

        try {
            if (isLocalTexture(texture)) {
                // Local: read tiles from IndexedDB
                const tiles = await getLocalTiles(texture.id);
                const urls = {};
                for (const tile of tiles) {
                    urls[tile.tile_index] = URL.createObjectURL(tile.blob);
                }
                previewBlobURLs.value = urls;
            } else {
                // Cloud texture — check cache first
                let loadedFromCache = false;
                if (cachedCloudIds.value.has(texture.id)) {
                    const localId = await getCachedLocalId(texture.id);
                    if (localId) {
                        const tiles = await getLocalTiles(localId);
                        if (tiles && tiles.length > 0) {
                            const urls = {};
                            for (const tile of tiles) {
                                urls[tile.tile_index] = URL.createObjectURL(tile.blob);
                            }
                            previewBlobURLs.value = urls;
                            loadedFromCache = true;
                        }
                    }
                }

                if (!loadedFromCache) {
                    // Remote: fetch tile metadata, then download KTX2 data
                    const textureSet = await fetchTextureWithTiles(texture.id);
                    const tiles = textureSet.tiles || [];
                    const downloadedBlobs = {}; // tileIndex → Blob for caching
                    for (const tile of tiles) {
                        const index = tile.tileIndex ?? tile.index ?? tile.tile_index;
                        let blob;
                        if (tile.driveFileId) {
                            const buffer = await fetchDriveFile(tile.driveFileId);
                            blob = new Blob([buffer], { type: 'image/ktx2' });
                        } else if (tile.url) {
                            const resp = await fetch(tile.url);
                            if (!resp.ok) throw new Error(`Failed to fetch tile ${index}`);
                            blob = await resp.blob();
                        } else {
                            continue;
                        }
                        downloadedBlobs[index] = blob;
                        // Update reactively so TileLinearViewer can load tiles incrementally
                        previewBlobURLs.value = { ...previewBlobURLs.value, [index]: URL.createObjectURL(blob) };
                    }

                    // Cache in background after preview is showing
                    if (Object.keys(downloadedBlobs).length > 0) {
                        cacheCloudTextureFromBlobs(texture, textureSet, downloadedBlobs);
                    }
                }
            }
        } catch (err) {
            console.error('[TextureBrowser] Preview failed:', err);
            previewError.value = err.message;
        } finally {
            previewLoading.value = false;
        }
    }

    /**
     * Cache downloaded cloud texture blobs to IndexedDB in background.
     * Does not block UI — fires and forgets with error logging.
     */
    function cacheCloudTextureFromBlobs(texture, textureSet, blobs) {
        // Convert thumbnail URL to data URL if needed
        const doCache = async () => {
            let thumbnailDataUrl = null;
            if (texture.thumbnail_url) {
                try {
                    const resp = await fetch(texture.thumbnail_url);
                    const thumbBlob = await resp.blob();
                    thumbnailDataUrl = await new Promise(resolve => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.readAsDataURL(thumbBlob);
                    });
                } catch (e) {
                    // Non-critical — skip thumbnail
                }
            }

            await cacheCloudTexture({
                cloudTextureId: texture.id,
                name: texture.name,
                tileCount: textureSet.tile_count ?? Object.keys(blobs).length,
                tileResolution: textureSet.tile_resolution ?? texture.tile_resolution,
                layerCount: textureSet.layer_count ?? texture.layer_count,
                crossSectionType: textureSet.cross_section_type ?? texture.cross_section_type ?? 'waves',
                sourceMetadata: textureSet.source_metadata ?? texture.source_metadata,
                thumbnailDataUrl,
                ktx2Blobs: blobs
            });

            // Update cache status reactively
            cachedCloudIds.value = new Set([...cachedCloudIds.value, texture.id]);
        };

        doCache().catch(err => {
            console.warn('[TextureBrowser] Background cache failed:', err);
        });
    }

    function closePreview() {
        // Revoke all blob URLs
        Object.values(previewBlobURLs.value).forEach(url => URL.revokeObjectURL(url));
        previewBlobURLs.value = {};
        previewTexture.value = null;
        previewError.value = null;
        app.hideTexturePreview();
    }

    // Watch store flag — AppHeader close button sets this to false
    watch(() => app.texturePreviewVisible, (visible) => {
        if (!visible && previewTexture.value) {
            // Store was cleared externally (e.g. AppHeader close) — clean up local state
            Object.values(previewBlobURLs.value).forEach(url => URL.revokeObjectURL(url));
            previewBlobURLs.value = {};
            previewTexture.value = null;
            previewError.value = null;
        }
    });

    onBeforeUnmount(() => {
        // Clean up preview blob URLs if component unmounts
        Object.values(previewBlobURLs.value).forEach(url => URL.revokeObjectURL(url));
    });
</script>

<template>
    <div
        class="texture-browser"
        :class="{ active: visible }"
        @keydown="handleKeydown"
        tabindex="-1"
    >
        <div
            class="texture-browser-container"
            :class="{ 'has-preview': previewTexture }"
            :style="previewTexture ? { '--preview-tile-size': previewCanvasWidth + 'px' } : undefined"
        >


            <!-- Normal browser content -->
            <div class="texture-browser-content">
                <!-- Header -->
                <div class="texture-browser-header">

                    <!-- Tabs + Multi-select toggle -->
                    <div class="texture-browser-tabs">
                        <!-- Multi-select toggle -->
                        <button
                            :class="['tab-button', 'multi-select-toggle', { active: multiSelectMode }]"
                            @click="toggleMultiSelectMode"
                            :title="multiSelectMode ? 'Exit multi-select' : 'Select multiple textures'"
                        >
                            <span
                                class="material-symbols-outlined"
                                style="font-size: 18px;"
                            >checklist</span>
                        </button>
                        <button
                            :class="['tab-button', { active: activeTab === 'all' }]"
                            @click="activeTab = 'all'"
                        >
                            All
                        </button>
                        <button
                            :class="['tab-button', { active: activeTab === 'local' }]"
                            @click="activeTab = 'local'"
                        >
                            My Local
                        </button>
                        <button
                            v-if="isAuthenticated"
                            :class="['tab-button', { active: activeTab === 'my-cloud' }]"
                            @click="activeTab = 'my-cloud'"
                        >
                            My Cloud
                        </button>
                        <button
                            :class="['tab-button', { active: activeTab === 'public' }]"
                            @click="activeTab = 'public'"
                        >
                            Public
                        </button>
                        <button
                            v-if="cachedCloudIds.size > 0"
                            :class="['tab-button', { active: activeTab === 'cached' }]"
                            @click="activeTab = 'cached'"
                        >
                            Cached
                        </button>
                    </div>
                </div>

                <!-- Loading state -->
                <div
                    v-if="isLoading"
                    class="texture-browser-loading"
                >
                    Loading textures...
                </div>

                <!-- Error state -->
                <div
                    v-else-if="error"
                    class="texture-browser-error"
                >
                    {{ error }}
                    <button
                        class="retry-button"
                        @click="loadTextures"
                    >Retry</button>
                </div>

                <!-- Empty state -->
                <div
                    v-else-if="displayTextures.length === 0"
                    class="texture-browser-empty"
                >
                    <template v-if="activeTab === 'local'">
                        No local textures saved yet.
                        <a
                            href="/slyce"
                            class="slyce-link"
                        >Create one in Create Texture</a>
                    </template>
                    <template v-else-if="activeTab === 'my-cloud'">
                        You haven't uploaded any textures to the cloud yet.
                        <a
                            href="/slyce"
                            class="slyce-link"
                        >Create one in Create Texture</a>
                    </template>
                    <template v-else-if="activeTab === 'cached'">
                        No cached textures yet. Preview or apply a cloud texture to cache it locally.
                    </template>
                    <template v-else>
                        No textures available yet.
                    </template>
                </div>

                <!-- Unified Texture grid -->
                <div
                    v-if="displayTextures.length > 0 && !isLoading && !error"
                    class="texture-browser-list"
                >
                    <div
                        v-for="texture in displayTextures"
                        :key="texture.id"
                        class="texture-card"
                        :class="{
                            'local-texture-card': isLocalTexture(texture),
                            'selected-card': multiSelectMode && isTextureSelected(texture)
                        }"
                        role="button"
                        tabindex="0"
                        @click="handleCardClick(texture)"
                        @keydown.enter="handleCardClick(texture)"
                        @keydown.space.prevent="handleCardClick(texture)"
                    >
                        <!-- Multi-select checkbox overlay (top-left of thumbnail) -->
                        <div
                            v-if="multiSelectMode"
                            class="multi-select-checkbox"
                            :class="{
                                checked: isTextureSelected(texture),
                                disabled: !isTextureSelected(texture) && isMaxSelected
                            }"
                            :title="!isTextureSelected(texture) && isMaxSelected ? `Maximum ${MAX_MULTI_SELECT} textures` : ''"
                            @click.stop="toggleTextureSelection(texture, $event)"
                        >
                            <span class="material-symbols-outlined">
                                {{ isTextureSelected(texture) ? 'check_box' : 'check_box_outline_blank' }}
                            </span>
                        </div>

                        <!-- Thumbnail -->
                        <div class="texture-card-thumbnail">
                            <img
                                v-if="texture.thumbnail_url"
                                :src="texture.thumbnail_url"
                                :alt="texture.name"
                            />
                            <div
                                v-else
                                class="texture-card-placeholder"
                            >
                                <span>{{ texture.tile_count }} tiles</span>
                            </div>
                            <!-- Storage indicator badge -->
                            <div
                                v-if="isLocalTexture(texture)"
                                class="storage-badge local-badge"
                                title="Stored locally in browser"
                            >
                                <span class="material-symbols-outlined">hard_drive</span>
                            </div>
                            <div
                                v-else
                                class="storage-badge"
                                :class="{ 'requires-auth': getStorageInfo(texture).requiresAuth }"
                                :title="getStorageInfo(texture).label"
                            >
                                <img
                                    :src="getStorageInfo(texture).icon"
                                    :alt="getStorageInfo(texture).label"
                                    class="storage-icon"
                                />
                            </div>
                            <!-- Cache indicator for cloud textures -->
                            <div
                                v-if="!isLocalTexture(texture) && texture.isCached"
                                class="storage-badge cached-badge"
                                title="Cached locally"
                            >
                                <span class="material-symbols-outlined">download_done</span>
                            </div>
                        </div>

                        <!-- Info -->
                        <div class="texture-card-info">
                            <h3 class="texture-card-name">{{ texture.name }}</h3>

                            <!-- Owner (cloud textures only) -->
                            <div
                                v-if="!isLocalTexture(texture) && texture.owner_name"
                                class="texture-card-owner"
                            >
                                <img
                                    v-if="texture.owner_picture"
                                    :src="texture.owner_picture"
                                    :alt="texture.owner_name"
                                    class="owner-avatar"
                                    referrerpolicy="no-referrer"
                                />
                                <span
                                    v-else
                                    class="owner-avatar-placeholder"
                                ></span>
                                <span class="owner-name">{{ texture.owner_name }}</span>
                            </div>

                            <!-- Meta info -->
                            <div class="texture-card-meta">
                                <span>{{ texture.tile_count }} tiles</span>
                                <span>{{ texture.tile_resolution }}px</span>
                                <span>{{ texture.cross_section_type || 'waves' }}</span>
                                <span>{{ texture.layer_count }} layers</span>
                                <span v-if="formatSize(texture.total_size_bytes)">
                                    {{ formatSize(texture.total_size_bytes) }}
                                </span>
                            </div>

                            <!-- Frame info / Created date -->
                            <p
                                v-if="isLocalTexture(texture)"
                                class="texture-card-frames"
                            >
                                Saved {{ formatDate(texture.created_at) }}
                            </p>
                            <p
                                v-else-if="texture.sampled_frame_count && texture.source_frame_count"
                                class="texture-card-frames"
                            >
                                Sampled from {{ texture.sampled_frame_count }} of {{ texture.source_frame_count }}
                                source frames
                            </p>
                            <p
                                v-else-if="texture.source_frame_count"
                                class="texture-card-frames"
                            >
                                Sampled from {{ texture.source_frame_count }} source frames
                            </p>

                            <!-- Description (cloud textures only) -->
                            <p
                                v-if="!isLocalTexture(texture) && texture.description"
                                class="texture-card-desc"
                            >
                                {{ texture.description }}
                            </p>

                            <!-- Action buttons (inline in info area) -->
                            <div class="texture-card-actions">
                                <!-- Preview button -->
                                <button
                                    class="action-button preview-button"
                                    title="Preview animation"
                                    @click="openPreview(texture, $event)"
                                >
                                    <span class="material-symbols-outlined">play_circle</span>
                                </button>
                                <!-- Edit button (owner or admin) -->
                                <button
                                    v-if="isLocalTexture(texture) || isOwner(texture) || isAdmin"
                                    class="action-button edit-button"
                                    title="Edit name"
                                    @click="startEdit(texture, $event)"
                                >
                                    <span class="material-symbols-outlined">edit</span>
                                </button>
                                <!-- Copy button -->
                                <button
                                    v-if="getCopyDestinations(texture).length > 0"
                                    class="action-button copy-button"
                                    title="Copy to another storage"
                                    @click="toggleCopyMenu(texture, $event)"
                                >
                                    <span class="material-symbols-outlined">content_copy</span>
                                </button>
                                <!-- Delete button (owner, admin, or local) -->
                                <button
                                    v-if="isLocalTexture(texture) || isOwner(texture) || isAdmin"
                                    class="action-button delete-button"
                                    title="Delete texture"
                                    @click="confirmDelete(texture, $event)"
                                >
                                    <span class="material-symbols-outlined">delete</span>
                                </button>
                                <!-- Evict cache button (cloud textures with local cache) -->
                                <button
                                    v-if="!isLocalTexture(texture) && texture.isCached"
                                    class="action-button evict-button"
                                    title="Remove local cache"
                                    @click="evictCache(texture, $event)"
                                >
                                    <span class="material-symbols-outlined">delete_sweep</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

            </div>

            <!-- Preview panel (side-by-side on desktop, replaces browser on mobile) -->
            <div
                v-if="previewTexture"
                class="texture-preview-panel"
            >
                <TileLinearViewer
                    v-if="Object.keys(previewBlobURLs).length > 0"
                    :ktx2BlobURLs="previewBlobURLs"
                    outputMode="rows"
                    :maxViewportHeight="7680"
                    :expectedTileCount="previewTexture.tile_count"
                />
                <div
                    v-else-if="previewLoading"
                    class="preview-loading"
                >
                    Loading tiles...
                </div>
                <div
                    v-else-if="previewError"
                    class="preview-error"
                >
                    Failed to load preview: {{ previewError }}
                </div>
            </div>

            <!-- Multi-select Apply bar -->
            <Transition name="slide-up">
                <div
                    v-if="multiSelectMode && multiSelectCount > 0 && !previewTexture"
                    class="multi-select-bar"
                >
                    <span class="multi-select-count">{{ multiSelectCount }} texture{{ multiSelectCount > 1 ? 's' : '' }}
                        selected</span>
                    <button
                        class="multi-select-apply"
                        @click="applyMultiSelection"
                    >
                        Apply ({{ multiSelectCount }})
                    </button>
                </div>
            </Transition>
        </div>

        <!-- Delete confirmation modal -->
        <Teleport to="body">
            <div
                v-if="textureToDelete"
                class="delete-modal-overlay"
                @click.self="textureToDelete = null; isLocalDelete = false"
            >
                <div class="delete-modal">
                    <h3>Delete {{ isLocalDelete ? 'Local' : 'Cloud' }} Texture</h3>
                    <p>Are you sure you want to delete "<strong>{{ textureToDelete.name }}</strong>"?</p>
                    <p class="delete-warning">
                        {{ isLocalDelete ?
                            'This will remove the texture from your browser storage.' :
                            'This action cannot be undone.'
                        }}
                    </p>
                    <div class="delete-modal-actions">
                        <button
                            class="cancel-button"
                            @click="textureToDelete = null; isLocalDelete = false"
                            :disabled="deletingId"
                        >
                            Cancel
                        </button>
                        <button
                            class="confirm-delete-button"
                            @click="performDelete"
                            :disabled="deletingId"
                        >
                            {{ deletingId ? 'Deleting...' : 'Delete' }}
                        </button>
                    </div>
                </div>
            </div>
        </Teleport>

        <!-- Copy confirmation modal -->
        <Teleport to="body">
            <div
                v-if="textureToCopy"
                class="delete-modal-overlay copy-modal-overlay"
                @click.self="cancelCopy"
            >
                <div class="delete-modal copy-modal">
                    <h3>Copy Texture</h3>
                    <p>
                        Copy "<strong>{{ textureToCopy.name }}</strong>" to
                        <strong>{{ copyDestination === 'google-drive' ? 'Google Drive' : 'Cloudflare R2' }}</strong>?
                    </p>
                    <p
                        v-if="copyProgress"
                        class="copy-progress"
                    >
                        {{ copyProgress }}
                    </p>
                    <p
                        v-if="copyError"
                        class="copy-error"
                    >
                        Error: {{ copyError }}
                    </p>
                    <div class="delete-modal-actions">
                        <button
                            class="cancel-button"
                            @click="cancelCopy"
                            :disabled="isCopying"
                        >
                            Cancel
                        </button>
                        <button
                            class="confirm-copy-button"
                            @click="performCopy"
                            :disabled="isCopying"
                        >
                            {{ isCopying ? 'Copying...' : 'Copy' }}
                        </button>
                    </div>
                </div>
            </div>
        </Teleport>

        <!-- Copy destination dropdown menu (teleported to body to avoid overflow issues) -->
        <Teleport to="body">
            <div
                v-if="showCopyMenu && copyMenuTexture"
                class="copy-menu-teleport"
                :style="{ top: copyMenuPosition.top + 'px', left: copyMenuPosition.left + 'px' }"
                @click.stop
            >
                <div class="copy-menu-header">Copy to:</div>
                <button
                    v-for="dest in getCopyDestinations(copyMenuTexture)"
                    :key="dest.value"
                    class="copy-menu-item"
                    @click="startCopy(copyMenuTexture, dest.value, $event)"
                >
                    <img
                        :src="dest.icon"
                        :alt="dest.label"
                        class="copy-menu-icon"
                    />
                    {{ dest.label }}
                </button>
            </div>
        </Teleport>

        <!-- Edit name modal -->
        <Teleport to="body">
            <div
                v-if="textureToEdit"
                class="delete-modal-overlay edit-modal-overlay"
                @click.self="cancelEdit"
            >
                <div class="delete-modal edit-modal">
                    <h3>Edit Texture Name</h3>
                    <div class="edit-input-container">
                        <input
                            v-model="editName"
                            type="text"
                            class="edit-name-input"
                            placeholder="Texture name"
                            @keydown.enter="performEdit"
                            @keydown.escape="cancelEdit"
                            autofocus
                        />
                    </div>
                    <p
                        v-if="editError"
                        class="edit-error"
                    >
                        {{ editError }}
                    </p>
                    <div class="delete-modal-actions">
                        <button
                            class="cancel-button"
                            @click="cancelEdit"
                            :disabled="isEditing"
                        >
                            Cancel
                        </button>
                        <button
                            class="confirm-edit-button"
                            @click="performEdit"
                            :disabled="isEditing || !editName.trim()"
                        >
                            {{ isEditing ? 'Saving...' : 'Save' }}
                        </button>
                    </div>
                </div>
            </div>
        </Teleport>

        <!-- Animated preview panel is now inline above (not a Teleport) -->
    </div>
</template>

<style scoped>
    .texture-browser {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 5;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease;
        display: flex;
        flex-direction: column;
    }

    .texture-browser.active {
        pointer-events: auto;
        opacity: 1;
    }

    .texture-browser-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        background: #1a1a1a;
        padding-top: 5.5rem;
        /* Space for AppHeader */
        padding-bottom: 5.5rem;
        /* Space for BottomToolbar */
    }

    /* On mobile, hide browser content when preview is active */
    .texture-browser-container.has-preview .texture-browser-content {
        display: none;
    }

    /* Desktop: side-by-side columns */
    @media (min-width: 768px) {
        .texture-browser-container.has-preview {
            flex-direction: row;
        }

        .texture-browser-container.has-preview .texture-browser-content {
            display: block;
        }

        .texture-browser-container.has-preview .texture-preview-panel {
            flex: none;
            width: calc(var(--preview-tile-size, 512px) + 2rem);
            border-right: 1px solid #333;
        }
    }

    .texture-browser-content {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        width: 100%;
    }

    .texture-browser-header {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin-bottom: 1.5rem;
    }

    @media (min-width: 640px) {
        .texture-browser-header {
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
        }
    }

    .texture-browser-header h2 {
        margin: 0;
        color: #fff;
        font-size: 1.5rem;
        font-weight: 600;
    }

    .texture-browser-tabs {
        display: flex;
        gap: 0.5rem;
    }

    .tab-button {
        background: transparent;
        border: 1px solid #555;
        border-radius: 8px;
        color: #888;
        font-size: 14px;
        padding: 8px 16px;
        cursor: pointer;
        transition: all 0.2s;
    }

    .tab-button:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.05);
        border-color: #888;
    }

    .tab-button.active {
        color: #4caf50;
        border-color: #4caf50;
        background: rgba(76, 175, 80, 0.1);
    }

    .texture-browser-loading,
    .texture-browser-error,
    .texture-browser-empty {
        text-align: center;
        padding: 60px 20px;
        color: #888;
    }

    .texture-browser-error {
        color: #ff6b6b;
    }

    .texture-browser-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 20px;
    }

    @media (min-width: 1024px) {
        .texture-browser-list {
            grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        }
    }

    .texture-card {
        position: relative;
        background: #252525;
        border-radius: 0;
        overflow: hidden;
        cursor: pointer;
        transition: all 0.2s;
        border: 2px solid transparent;
    }

    .texture-card:hover {
        border-color: #4caf50;
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
    }

    .texture-card:focus {
        outline: none;
        border-color: #4caf50;
    }

    .texture-card-thumbnail {
        aspect-ratio: 16 / 9;
        background: #333;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        position: relative;
    }

    .texture-card-thumbnail img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .texture-card-placeholder {
        color: #666;
        font-size: 14px;
        text-align: center;
    }

    .storage-badge {
        position: absolute;
        top: 8px;
        right: 8px;
        background: rgba(255, 255, 255, 0.8);
        padding: 4px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .storage-badge .storage-icon {
        width: 1.5rem;
    }

    .storage-badge.requires-auth .storage-icon {
        opacity: 1;
    }

    .storage-badge.cached-badge {
        top: 8px;
        right: auto;
        left: 8px;
        background: rgba(76, 175, 80, 0.85);
        color: #fff;
    }

    .storage-badge.cached-badge .material-symbols-outlined {
        font-size: 1rem;
    }

    .texture-card-info {
        padding: 12px;
    }

    .texture-card-name {
        margin: 0 0 8px 0;
        color: #fff;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .texture-card-owner {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
    }

    .texture-card-owner .owner-avatar {
        width: 20px;
        height: 20px;
        border-radius: 0;
        object-fit: cover;
        flex-shrink: 0;
    }

    .texture-card-owner .owner-avatar-placeholder {
        width: 20px;
        height: 20px;
        border-radius: 0;
        background: #444;
        flex-shrink: 0;
    }

    .texture-card-owner .owner-name {
        color: #aaa;
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .texture-card-meta {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }

    .texture-card-meta span {
        background: #333;
        color: #aaa;
        font-size: 11px;
        padding: 3px 8px;
        border-radius: 0;
    }

    .texture-card-desc {
        margin: 8px 0 0 0;
        color: #888;
        font-size: 12px;
        line-height: 1.4;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .texture-card-frames {
        margin: 6px 0 0 0;
        color: #666;
        font-size: 11px;
        font-style: italic;
    }

    .texture-browser-create {
        margin-top: 32px;
        padding: 32px 20px;
        text-align: center;
        border-top: 1px solid #333;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
    }

    .texture-browser-create .create-invite {
        color: #888;
        font-size: 1rem;
        margin: 0.25rem 0 0 0;
        white-space: pre;
    }

    .texture-browser-create .slyce-link {
        font-family: 'Cascadia Code', sans-serif;
        font-optical-sizing: auto;
        font-weight: 900;
        font-style: italic;
        font-size: 1.5rem;
        letter-spacing: -0.05rem;
        color: #eeeeee;
        text-decoration: none;
        display: inline-block;
        transition: transform 0.2s, color 0.2s;
    }

    .texture-browser-create .slyce-link:hover {
        color: #ffffff;
        transform: scale(1.05);
    }

    /* Retry button */
    .retry-button {
        margin-top: 12px;
        background: #4caf50;
        border: none;
        color: white;
        padding: 8px 16px;
        cursor: pointer;
        font-size: 14px;
    }

    .retry-button:hover {
        background: #45a049;
    }

    /* Delete modal */
    .delete-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 3000;
    }

    .delete-modal {
        background: #2a2a2a;
        padding: 24px;
        max-width: 400px;
        width: 90%;
        border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .delete-modal h3 {
        margin: 0 0 16px 0;
        color: #fff;
        font-size: 18px;
    }

    .delete-modal p {
        color: #ccc;
        margin: 0 0 12px 0;
        font-size: 14px;
    }

    .delete-modal .delete-warning {
        color: #ff6b6b;
        font-size: 13px;
    }

    .delete-modal-actions {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
        margin-top: 20px;
    }

    .cancel-button {
        background: #444;
        border: none;
        color: #fff;
        padding: 10px 20px;
        cursor: pointer;
        font-size: 14px;
    }

    .cancel-button:hover:not(:disabled) {
        background: #555;
    }

    .confirm-delete-button {
        background: #dc2626;
        border: none;
        color: #fff;
        padding: 10px 20px;
        cursor: pointer;
        font-size: 14px;
    }

    .confirm-delete-button:hover:not(:disabled) {
        background: #b91c1c;
    }

    .cancel-button:disabled,
    .confirm-delete-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    /* Local Texture Styling */
    .local-texture-card {
        border: 2px solid rgba(59, 130, 246, 0.3);
    }

    .local-texture-card:hover {
        border-color: #3b82f6;
    }

    .local-badge {
        background: rgba(59, 130, 246, 0.9);
        padding: 4px;
        min-width: 28px;
    }

    .local-badge .material-symbols-outlined {
        font-size: 18px;
        color: #fff;
    }

    /* Action buttons (inline in info area) */
    .texture-card-actions {
        display: flex;
        gap: 6px;
        margin-top: 8px;
    }

    .action-button {
        border: none;
        border-radius: 4px;
        padding: 4px;
        width: 28px;
        height: 28px;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        pointer-events: none;
        flex-shrink: 0;
    }

    .texture-card:hover .action-button {
        opacity: 1;
        pointer-events: auto;
    }

    /* Always show action buttons on touch/mobile devices (no hover) */
    @media (hover: none),
    (max-width: 768px) {
        .action-button {
            opacity: 1;
            pointer-events: auto;
        }
    }

    .action-button .material-symbols-outlined {
        font-size: 18px;
        color: #fff;
    }

    .action-button.copy-button {
        background: rgba(59, 130, 246, 0.9);
    }

    .action-button.copy-button:hover {
        background: #3b82f6;
        transform: scale(1.1);
    }

    .action-button.delete-button {
        background: rgba(220, 38, 38, 0.9);
    }

    .action-button.delete-button:hover {
        background: #dc2626;
        transform: scale(1.1);
    }

    .action-button.edit-button {
        background: rgba(34, 197, 94, 0.9);
    }

    .action-button.edit-button:hover {
        background: #22c55e;
        transform: scale(1.1);
    }

    .action-button.delete-button:hover {
        background: #dc2626;
        transform: scale(1.1);
    }

    .action-button.evict-button {
        background: rgba(234, 179, 8, 0.9);
    }

    .action-button.evict-button:hover {
        background: #eab308;
        transform: scale(1.1);
    }

    /* Teleported copy menu */
    .copy-menu-teleport {
        position: fixed;
        background: #2a2a2a;
        border: 1px solid #444;
        border-radius: 8px;
        padding: 6px 0;
        min-width: 140px;
        z-index: 9999;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    }

    .copy-menu-header {
        padding: 4px 10px;
        font-size: 10px;
        color: #888;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .copy-menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 10px;
        background: transparent;
        border: none;
        color: #fff;
        font-size: 12px;
        cursor: pointer;
        text-align: left;
        transition: background 0.2s ease;
    }

    .copy-menu-item:hover {
        background: rgba(59, 130, 246, 0.2);
    }

    .copy-menu-icon {
        width: 14px;
        height: 14px;
        object-fit: contain;
    }

    /* Copy modal styles */
    .copy-modal-overlay {
        background: rgba(0, 0, 0, 0.7);
    }

    .copy-modal {
        max-width: 400px;
    }

    .copy-progress {
        color: #60a5fa;
        font-size: 14px;
        margin: 12px 0;
        padding: 8px;
        background: rgba(59, 130, 246, 0.1);
        border-radius: 4px;
    }

    .copy-error {
        color: #f87171;
        font-size: 14px;
        margin: 12px 0;
    }

    .confirm-copy-button {
        background: #3b82f6;
        border: none;
        color: #fff;
        padding: 10px 20px;
        cursor: pointer;
        font-size: 14px;
        border-radius: 4px;
    }

    .confirm-copy-button:hover:not(:disabled) {
        background: #2563eb;
    }

    .confirm-copy-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    /* Edit modal styles */
    .edit-modal-overlay {
        background: rgba(0, 0, 0, 0.7);
    }

    .edit-modal {
        max-width: 400px;
    }

    .edit-input-container {
        margin: 16px 0;
    }

    .edit-name-input {
        width: 100%;
        padding: 10px 12px;
        background: #333;
        border: 1px solid #555;
        border-radius: 6px;
        color: #fff;
        font-size: 14px;
        outline: none;
        transition: border-color 0.2s ease;
    }

    .edit-name-input:focus {
        border-color: #22c55e;
    }

    .edit-name-input::placeholder {
        color: #888;
    }

    .edit-error {
        color: #f87171;
        font-size: 13px;
        margin: 8px 0;
    }

    .confirm-edit-button {
        background: #22c55e;
        border: none;
        color: #fff;
        padding: 10px 20px;
        cursor: pointer;
        font-size: 14px;
        border-radius: 4px;
    }

    .confirm-edit-button:hover:not(:disabled) {
        background: #16a34a;
    }

    .confirm-edit-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    /* Multi-select mode */
    .multi-select-toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 8px 10px !important;
    }

    .multi-select-toggle.active {
        color: #60a5fa !important;
        border-color: #60a5fa !important;
        background: rgba(96, 165, 250, 0.1) !important;
    }

    .multi-select-checkbox {
        position: absolute;
        top: 8px;
        left: 8px;
        z-index: 3;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 4px;
        background: rgba(0, 0, 0, 0.6);
        transition: all 0.2s ease;
    }

    .multi-select-checkbox .material-symbols-outlined {
        font-size: 22px;
        color: #888;
        transition: color 0.2s;
    }

    .multi-select-checkbox.checked .material-symbols-outlined {
        color: #4caf50;
    }

    .multi-select-checkbox.disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .multi-select-checkbox:hover:not(.disabled) .material-symbols-outlined {
        color: #fff;
    }

    .texture-card.selected-card {
        border-color: #4caf50 !important;
        box-shadow: 0 0 0 1px #4caf50, 0 8px 20px rgba(76, 175, 80, 0.2);
    }

    /* Multi-select apply bar */
    .multi-select-bar {
        position: sticky;
        bottom: 0;
        left: 0;
        right: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 20px;
        background: rgba(30, 30, 30, 0.95);
        backdrop-filter: blur(10px);
        border-top: 1px solid #333;
        z-index: 4;
    }

    .multi-select-count {
        color: #ccc;
        font-size: 14px;
    }

    .multi-select-apply {
        background: #4caf50;
        border: none;
        color: #fff;
        padding: 10px 24px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        border-radius: 4px;
        transition: background 0.2s;
    }

    .multi-select-apply:hover {
        background: #45a049;
    }

    /* Slide-up transition for apply bar */
    .slide-up-enter-active,
    .slide-up-leave-active {
        transition: transform 0.2s ease, opacity 0.2s ease;
    }

    .slide-up-enter-from,
    .slide-up-leave-to {
        transform: translateY(100%);
        opacity: 0;
    }

    /* Preview button */
    .preview-button {
        color: #64b5f6;
    }

    .preview-button:hover {
        color: #90caf9;
    }

    /* Animated preview fullscreen overlay */
    /* ── Texture Preview Panel (in-place, shares AppHeader/BottomToolbar spacing) ── */
    .texture-preview-panel {
        flex: 1;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        overflow: overlay;
        padding: 1rem;
    }

    .texture-preview-panel>* {
        margin-block: auto;
    }

    .texture-preview-panel :deep(.viewer-container) {
        padding: 0;
    }

    .preview-loading,
    .preview-error {
        color: #999;
        font-size: 14px;
        text-align: center;
    }

    .preview-error {
        color: #ef5350;
    }
</style>
