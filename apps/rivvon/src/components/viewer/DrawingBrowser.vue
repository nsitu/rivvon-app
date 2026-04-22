<script setup>
    import { computed, ref, watch } from 'vue';
    import { useGoogleAuth } from '../../composables/shared/useGoogleAuth';
    import { createDrawingThumbnailDataUrl } from '../../modules/shared/drawingLibrary.js';
    import { useRivvonAPI } from '../../services/api.js';
    import { useDrawingStorage } from '../../services/drawingStorage.js';

    const props = defineProps({
        visible: {
            type: Boolean,
            default: false,
        }
    });

    const emit = defineEmits(['close', 'select']);

    const { user, isAdmin, isAuthenticated } = useGoogleAuth();
    const { saveDrawing: saveLocalDrawing, getAllDrawings, updateDrawing: updateLocalDrawing, deleteDrawing: deleteLocalDrawing } = useDrawingStorage();
    const {
        getMyDrawings,
        getDrawing,
        uploadDrawing,
        uploadDrawingToR2,
        updateDrawing: updateCloudDrawing,
        deleteDrawing: deleteCloudDrawing,
    } = useRivvonAPI();

    const localDrawings = ref([]);
    const cloudDrawings = ref([]);
    const activeTab = ref('all');
    const actionDrawingId = ref(null);
    const isLoading = ref(false);
    const error = ref('');

    const drawings = computed(() => mergeDrawings(localDrawings.value, cloudDrawings.value));
    const displayDrawings = computed(() => {
        switch (activeTab.value) {
            case 'local':
                return drawings.value.filter((drawing) => drawing.is_local);
            case 'cloud':
                return drawings.value.filter((drawing) => drawing.is_cloud);
            case 'all':
            default:
                return drawings.value;
        }
    });
    const hasDrawings = computed(() => displayDrawings.value.length > 0);
    const drawingTabs = computed(() => ([
        {
            value: 'all',
            label: 'All',
            count: drawings.value.length,
            disabled: false,
        },
        {
            value: 'local',
            label: 'Local',
            count: drawings.value.filter((drawing) => drawing.is_local).length,
            disabled: false,
        },
        {
            value: 'cloud',
            label: 'Cloud',
            count: drawings.value.filter((drawing) => drawing.is_cloud).length,
            disabled: !isAuthenticated.value,
        },
    ]));
    const emptyStateMessage = computed(() => {
        if (activeTab.value === 'cloud') {
            return isAuthenticated.value
                ? 'Cloud drawings will appear here after you copy drawings to Google Drive or R2.'
                : 'Sign in to browse drawings saved to Google Drive or R2.';
        }

        if (activeTab.value === 'local') {
            return 'New drawings autosave locally. Local copies and older cached cloud copies will appear here.';
        }

        return 'New gesture, walk, text, emoji, and SVG drawings autosave locally. Use the browser to copy them to Google Drive or R2 when you want a cloud copy.';
    });

    function normalizeTimestamp(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function createLocalBrowserRecord(drawing) {
        return {
            ...drawing,
            local_id: drawing.id,
            cloud_id: null,
            is_local: true,
            is_cloud: false,
            browser_origin: drawing.cached_from ? 'cached-local' : 'local',
            browser_sort_time: normalizeTimestamp(drawing.updated_at),
        };
    }

    function createCloudBrowserRecord(drawing, localDrawing = null) {
        return {
            ...drawing,
            local_id: localDrawing?.id || null,
            cloud_id: drawing.id,
            cached_from: localDrawing?.cached_from || null,
            root_drawing_id: drawing.root_drawing_id || localDrawing?.root_drawing_id || localDrawing?.cached_from || drawing.id,
            paths: localDrawing?.paths || null,
            source: localDrawing?.source || null,
            thumbnail_data_url: localDrawing?.thumbnail_data_url || null,
            is_local: Boolean(localDrawing),
            is_cloud: true,
            browser_origin: localDrawing ? 'cloud-cached' : 'cloud',
            browser_sort_time: Math.max(
                normalizeTimestamp(drawing.updated_at),
                normalizeTimestamp(localDrawing?.updated_at)
            ),
        };
    }

    function mergeDrawings(localRecords = [], cloudRecords = []) {
        const mergedLocalIds = new Set();
        const latestLocalByCloudId = new Map();

        for (const localDrawing of localRecords) {
            if (!localDrawing?.cached_from) {
                continue;
            }

            const previousMatch = latestLocalByCloudId.get(localDrawing.cached_from);
            if (!previousMatch || normalizeTimestamp(localDrawing.updated_at) >= normalizeTimestamp(previousMatch.updated_at)) {
                latestLocalByCloudId.set(localDrawing.cached_from, localDrawing);
            }
        }

        const mergedDrawings = cloudRecords.map((cloudDrawing) => {
            const matchedLocal = latestLocalByCloudId.get(cloudDrawing.id) || null;
            if (matchedLocal?.id) {
                mergedLocalIds.add(matchedLocal.id);
            }
            return createCloudBrowserRecord(cloudDrawing, matchedLocal);
        });

        for (const localDrawing of localRecords) {
            if (mergedLocalIds.has(localDrawing.id)) {
                continue;
            }

            mergedDrawings.push(createLocalBrowserRecord(localDrawing));
        }

        return mergedDrawings.sort((left, right) => right.browser_sort_time - left.browser_sort_time);
    }

    function getDrawingIdentity(drawing) {
        return drawing?.cloud_id || drawing?.local_id || drawing?.id || null;
    }

    function getRootDrawingIdentity(drawing) {
        return drawing?.root_drawing_id || drawing?.cached_from || drawing?.cloud_id || drawing?.local_id || drawing?.id || null;
    }

    function isDrawingBusy(drawing) {
        return actionDrawingId.value && actionDrawingId.value === getDrawingIdentity(drawing);
    }

    function buildDuplicateName(name) {
        const baseName = typeof name === 'string' && name.trim() ? name.trim() : 'Untitled drawing';
        return / copy(?: \d+)?$/i.test(baseName) ? `${baseName} 2` : `${baseName} Copy`;
    }

    function getCloudCopyActions(drawing) {
        if (!isAuthenticated.value) {
            return [];
        }

        const actions = [];
        const storageProvider = drawing?.storage_provider || 'local';

        if (!drawing?.is_cloud) {
            actions.push({
                destination: 'google-drive',
                label: 'Copy to Drive',
            });

            if (isAdmin.value) {
                actions.push({
                    destination: 'r2',
                    label: 'Copy to R2',
                });
            }

            return actions;
        }

        if (storageProvider === 'google-drive' && isAdmin.value) {
            actions.push({
                destination: 'r2',
                label: 'Copy to R2',
            });
        }

        return actions;
    }

    function getCloudParentDrawingId(drawing) {
        const cloudSourceId = drawing?.cloud_id || drawing?.cached_from || null;
        if (!cloudSourceId) {
            return null;
        }

        if (!isAdmin.value) {
            return cloudSourceId;
        }

        const currentUserGoogleId = user.value?.googleId || null;
        return currentUserGoogleId && drawing?.owner_google_id === currentUserGoogleId
            ? cloudSourceId
            : null;
    }

    function getCloudRootDrawingId(drawing) {
        const rootCandidate = drawing?.is_cloud
            ? (drawing?.root_drawing_id || drawing?.cloud_id || drawing?.id || null)
            : (drawing?.cached_from ? (drawing?.root_drawing_id || drawing?.cached_from) : null);

        if (!rootCandidate) {
            return null;
        }

        if (!isAdmin.value) {
            return rootCandidate;
        }

        const currentUserGoogleId = user.value?.googleId || null;
        return currentUserGoogleId && drawing?.owner_google_id === currentUserGoogleId
            ? rootCandidate
            : null;
    }

    async function withDrawingAction(drawing, callback) {
        const drawingIdentity = getDrawingIdentity(drawing);
        actionDrawingId.value = drawingIdentity;
        error.value = '';

        try {
            return await callback();
        } finally {
            if (actionDrawingId.value === drawingIdentity) {
                actionDrawingId.value = null;
            }
        }
    }

    async function createThumbnailBlob(paths) {
        const thumbnailDataUrl = createDrawingThumbnailDataUrl(paths, { size: 256 });
        if (!thumbnailDataUrl) {
            return null;
        }

        const response = await fetch(thumbnailDataUrl);
        return response.blob();
    }

    async function resolveDrawingRecord(drawing) {
        if (Array.isArray(drawing?.paths) && drawing.paths.length > 0) {
            return {
                kind: drawing.kind,
                name: drawing.name,
                description: typeof drawing.description === 'string' ? drawing.description : '',
                paths: drawing.paths,
                source: drawing.source ?? null,
                parentDrawingId: drawing.parent_drawing_id || null,
                rootDrawingId: getRootDrawingIdentity(drawing),
            };
        }

        const cloudDrawingId = drawing?.cloud_id || (drawing?.is_cloud ? drawing?.id : null);
        if (!cloudDrawingId) {
            return {
                kind: drawing?.kind,
                name: drawing?.name || 'Untitled drawing',
                description: typeof drawing?.description === 'string' ? drawing.description : '',
                paths: [],
                source: drawing?.source ?? null,
                parentDrawingId: drawing?.parent_drawing_id || null,
                rootDrawingId: getRootDrawingIdentity(drawing),
            };
        }

        const cloudDrawing = await getDrawing(cloudDrawingId);
        return {
            kind: cloudDrawing?.kind || drawing?.kind,
            name: cloudDrawing?.name || drawing?.name || 'Untitled drawing',
            description: typeof cloudDrawing?.description === 'string'
                ? cloudDrawing.description
                : (typeof drawing?.description === 'string' ? drawing.description : ''),
            paths: Array.isArray(cloudDrawing?.payload?.paths) ? cloudDrawing.payload.paths : [],
            source: cloudDrawing?.payload?.source ?? drawing?.source ?? null,
            parentDrawingId: cloudDrawing?.parent_drawing_id || drawing?.parent_drawing_id || null,
            rootDrawingId: cloudDrawing?.root_drawing_id || getRootDrawingIdentity(drawing),
        };
    }

    function getKindLabel(kind) {
        switch (kind) {
            case 'gesture':
                return 'Gesture';
            case 'walk':
                return 'Walk';
            case 'text':
                return 'Text';
            case 'emoji':
                return 'Emoji';
            case 'svg':
                return 'SVG';
            default:
                return 'Drawing';
        }
    }

    function getStorageLabel(drawing) {
        if (drawing.browser_origin === 'cloud-cached') {
            return drawing.storage_provider === 'r2' ? 'R2 + local cache' : 'Drive + local cache';
        }

        if (drawing.browser_origin === 'cloud') {
            return drawing.storage_provider === 'r2' ? 'R2' : 'Google Drive';
        }

        if (drawing.cached_from) {
            return 'Local cache';
        }

        return 'Local only';
    }

    function getStorageInfo(drawing) {
        if (drawing?.is_cloud) {
            if (drawing.storage_provider === 'google-drive') {
                return {
                    icon: '/google-drive.svg',
                    label: drawing.browser_origin === 'cloud-cached' ? 'Google Drive + local cache' : 'Google Drive',
                    usesImage: true,
                };
            }

            return {
                icon: '/cloudflare.svg',
                label: drawing.browser_origin === 'cloud-cached' ? 'Cloudflare R2 + local cache' : 'Cloudflare R2',
                usesImage: true,
            };
        }

        return {
            icon: 'hard_drive',
            label: drawing?.cached_from ? 'Local cached copy' : 'Stored locally in browser',
            usesImage: false,
        };
    }

    function hasLocalCacheBadge(drawing) {
        return drawing?.browser_origin === 'cloud-cached' || drawing?.browser_origin === 'cached-local';
    }

    function getDrawingMetric(drawing) {
        if (drawing?.kind === 'walk' && Number.isFinite(drawing?.point_count)) {
            return `${drawing.point_count} points`;
        }

        if (Number.isFinite(drawing?.path_count)) {
            return `${drawing.path_count} path${drawing.path_count === 1 ? '' : 's'}`;
        }

        return drawing?.is_cloud ? 'Cloud copy' : 'Local copy';
    }

    function getCopyActionIcon(destination) {
        return destination === 'google-drive' ? '/google-drive.svg' : '/cloudflare.svg';
    }

    function getCopyActionTitle(action) {
        return action?.destination === 'r2' ? 'Copy to Cloudflare R2' : 'Copy to Google Drive';
    }

    function formatTimestamp(value) {
        if (!value) {
            return 'Unknown';
        }

        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(new Date(value));
    }

    function getDrawingSummary(drawing) {
        if (drawing.description) {
            return drawing.description;
        }

        if (drawing.kind === 'text' && typeof drawing.source?.text === 'string') {
            return drawing.source.text.trim();
        }

        if (drawing.kind === 'emoji' && typeof drawing.source?.label === 'string') {
            return drawing.source.label.trim();
        }

        if (drawing.kind === 'svg' && typeof drawing.source?.fileName === 'string') {
            return drawing.source.fileName.trim();
        }

        if (drawing.kind === 'walk' && Number.isFinite(drawing.point_count)) {
            return `${drawing.point_count} points captured`;
        }

        if (drawing.kind === 'gesture' && Number.isFinite(drawing.path_count)) {
            return `${drawing.path_count} path${drawing.path_count === 1 ? '' : 's'}`;
        }

        if (drawing.browser_origin === 'cloud' || drawing.browser_origin === 'cloud-cached') {
            return `Saved in ${getStorageLabel(drawing)}`;
        }

        if (drawing.browser_origin === 'cached-local') {
            return 'Local cached copy';
        }

        return 'Saved locally';
    }

    function getDrawingThumbnailUrl(drawing) {
        const regeneratedThumbnail = createDrawingThumbnailDataUrl(drawing?.paths, {
            size: 256,
        });

        return regeneratedThumbnail || drawing?.thumbnail_data_url || drawing?.thumbnail_url || null;
    }

    async function loadDrawings() {
        isLoading.value = true;
        error.value = '';

        const loadErrors = [];
        const [localResult, cloudResult] = await Promise.allSettled([
            getAllDrawings(),
            isAuthenticated.value
                ? getMyDrawings({ limit: 100, offset: 0 })
                : Promise.resolve({ drawings: [] }),
        ]);

        if (localResult.status === 'fulfilled') {
            localDrawings.value = Array.isArray(localResult.value) ? localResult.value : [];
        } else {
            localDrawings.value = [];
            console.error('[DrawingBrowser] Failed to load local drawings:', localResult.reason);
            loadErrors.push('Failed to load local drawings.');
        }

        if (cloudResult.status === 'fulfilled') {
            cloudDrawings.value = Array.isArray(cloudResult.value?.drawings) ? cloudResult.value.drawings : [];
        } else {
            cloudDrawings.value = [];
            if (isAuthenticated.value) {
                console.error('[DrawingBrowser] Failed to load cloud drawings:', cloudResult.reason);
                loadErrors.push('Failed to load cloud drawings.');
            }
        }

        error.value = loadErrors.join(' ');
        isLoading.value = false;
    }

    async function handleEdit(drawing) {
        const nextName = prompt('Edit drawing name', drawing.name || '');
        if (typeof nextName !== 'string') {
            return;
        }

        const trimmedName = nextName.trim();
        if (!trimmedName) {
            error.value = 'Drawing name cannot be empty.';
            return;
        }

        const nextDescription = prompt('Edit drawing description', drawing.description || '');
        if (typeof nextDescription !== 'string') {
            return;
        }

        const trimmedDescription = nextDescription.trim();
        if (trimmedName === drawing.name && trimmedDescription === (drawing.description || '')) {
            return;
        }

        try {
            await withDrawingAction(drawing, async () => {
                if (drawing.is_cloud && drawing.cloud_id) {
                    await updateCloudDrawing(drawing.cloud_id, {
                        name: trimmedName,
                        description: trimmedDescription,
                    });
                }

                if (drawing.local_id) {
                    await updateLocalDrawing(drawing.local_id, {
                        name: trimmedName,
                        description: trimmedDescription,
                    });
                }

                await loadDrawings();
            });
        } catch (editError) {
            console.error('[DrawingBrowser] Failed to edit drawing metadata:', editError);
            error.value = 'Failed to update drawing metadata.';
        }
    }

    async function handleDuplicateLocal(drawing) {
        try {
            await withDrawingAction(drawing, async () => {
                const resolvedDrawing = await resolveDrawingRecord(drawing);
                if (!Array.isArray(resolvedDrawing.paths) || resolvedDrawing.paths.length === 0) {
                    throw new Error('Drawing payload is missing geometry.');
                }

                await saveLocalDrawing({
                    kind: resolvedDrawing.kind,
                    name: buildDuplicateName(resolvedDrawing.name),
                    description: resolvedDrawing.description,
                    paths: resolvedDrawing.paths,
                    source: resolvedDrawing.source,
                    storageProvider: 'local',
                    parentDrawingId: getDrawingIdentity(drawing),
                    rootDrawingId: resolvedDrawing.rootDrawingId,
                });

                await loadDrawings();
            });
        } catch (duplicateError) {
            console.error('[DrawingBrowser] Failed to duplicate drawing locally:', duplicateError);
            error.value = 'Failed to duplicate drawing to local storage.';
        }
    }

    async function handleDuplicateCloud(drawing, destination) {
        if (!isAuthenticated.value || !destination) {
            return;
        }

        try {
            await withDrawingAction(drawing, async () => {
                const resolvedDrawing = await resolveDrawingRecord(drawing);
                if (!Array.isArray(resolvedDrawing.paths) || resolvedDrawing.paths.length === 0) {
                    throw new Error('Drawing payload is missing geometry.');
                }

                const duplicateName = buildDuplicateName(resolvedDrawing.name);
                const thumbnailBlob = await createThumbnailBlob(resolvedDrawing.paths);
                const uploadOptions = {
                    name: duplicateName,
                    description: resolvedDrawing.description,
                    kind: resolvedDrawing.kind,
                    paths: resolvedDrawing.paths,
                    source: resolvedDrawing.source,
                    parentDrawingId: getCloudParentDrawingId(drawing),
                    rootDrawingId: getCloudRootDrawingId(drawing),
                    thumbnailBlob,
                };
                const uploadResult = destination === 'r2'
                    ? await uploadDrawingToR2(uploadOptions)
                    : await uploadDrawing(uploadOptions);

                await saveLocalDrawing({
                    kind: resolvedDrawing.kind,
                    name: duplicateName,
                    description: resolvedDrawing.description,
                    paths: resolvedDrawing.paths,
                    source: resolvedDrawing.source,
                    storageProvider: 'local',
                    cachedFrom: uploadResult?.drawingId || null,
                    parentDrawingId: getDrawingIdentity(drawing),
                    rootDrawingId: resolvedDrawing.rootDrawingId,
                });

                await loadDrawings();
            });
        } catch (duplicateError) {
            console.error('[DrawingBrowser] Failed to duplicate drawing to cloud:', duplicateError);
            error.value = `Failed to duplicate drawing to ${destination === 'r2' ? 'R2' : 'Google Drive'}.`;
        }
    }

    async function handleDelete(drawing) {
        const confirmed = confirm(`Delete "${drawing.name}"?`);
        if (!confirmed) {
            return;
        }

        try {
            await withDrawingAction(drawing, async () => {
                if (drawing.is_cloud && drawing.cloud_id) {
                    await deleteCloudDrawing(drawing.cloud_id);
                    cloudDrawings.value = cloudDrawings.value.filter((entry) => entry.id !== drawing.cloud_id);
                }

                if (drawing.local_id) {
                    await deleteLocalDrawing(drawing.local_id);
                    localDrawings.value = localDrawings.value.filter((entry) => entry.id !== drawing.local_id);
                }
            });
        } catch (deleteError) {
            console.error('[DrawingBrowser] Failed to delete drawing:', deleteError);
            error.value = 'Failed to delete drawing.';
        }
    }

    function handleOpen(drawing) {
        emit('select', drawing);
        emit('close');
    }

    watch([() => props.visible, isAuthenticated], ([visible, authenticated]) => {
        if (!authenticated && activeTab.value === 'cloud') {
            activeTab.value = 'all';
        }

        if (visible) {
            loadDrawings();
        }
    }, { immediate: true });
</script>

<template>
    <div
        class="drawing-browser"
        :class="{ active: visible }"
    >
        <div class="drawing-browser-container">
            <div class="drawing-browser-content">
                <div class="drawing-browser-header">
                    <h2>Saved Drawings</h2>

                    <div class="drawing-browser-tabs">
                        <button
                            v-for="tab in drawingTabs"
                            :key="tab.value"
                            type="button"
                            class="drawing-browser-tab"
                            :class="{ active: activeTab === tab.value, disabled: tab.disabled }"
                            :disabled="tab.disabled"
                            @click="activeTab = tab.value"
                        >
                            <span>{{ tab.label }}</span>
                            <span class="drawing-browser-tab-count">{{ tab.count }}</span>
                        </button>
                    </div>
                </div>

                <p
                    v-if="error"
                    class="drawing-browser-error"
                >{{ error }}</p>

                <div
                    v-if="isLoading"
                    class="drawing-browser-empty"
                >Loading saved drawings…</div>

                <div
                    v-else-if="!hasDrawings"
                    class="drawing-browser-empty"
                >{{ emptyStateMessage }}</div>

                <div
                    v-else
                    class="drawing-grid"
                >
                    <article
                        v-for="drawing in displayDrawings"
                        :key="getDrawingIdentity(drawing)"
                        class="drawing-card"
                        :class="{ 'local-drawing-card': !drawing.is_cloud }"
                    >
                        <div class="drawing-card-thumbnail">
                            <button
                                type="button"
                                class="drawing-card-preview"
                                :title="`Open ${drawing.name}`"
                                @click="handleOpen(drawing)"
                            >
                                <img
                                    v-if="getDrawingThumbnailUrl(drawing)"
                                    :src="getDrawingThumbnailUrl(drawing)"
                                    :alt="drawing.name"
                                    class="drawing-card-image"
                                />
                                <div
                                    v-else
                                    class="drawing-card-placeholder"
                                >No preview</div>
                            </button>

                            <div
                                class="storage-badge"
                                :class="{ 'requires-auth': getStorageInfo(drawing).usesImage }"
                                :title="getStorageInfo(drawing).label"
                            >
                                <img
                                    v-if="getStorageInfo(drawing).usesImage"
                                    :src="getStorageInfo(drawing).icon"
                                    :alt="getStorageInfo(drawing).label"
                                    class="storage-icon"
                                />
                                <span
                                    v-else
                                    class="material-symbols-outlined"
                                >{{ getStorageInfo(drawing).icon }}</span>
                            </div>

                            <div
                                v-if="hasLocalCacheBadge(drawing)"
                                class="storage-badge cached-badge"
                                title="Cached locally"
                            >
                                <span class="material-symbols-outlined">download_done</span>
                            </div>
                        </div>

                        <div class="drawing-card-info">
                            <h3 class="drawing-card-name">{{ drawing.name }}</h3>

                            <div
                                v-if="drawing.is_cloud && drawing.owner_name"
                                class="drawing-card-owner"
                            >
                                <img
                                    v-if="drawing.owner_picture"
                                    :src="drawing.owner_picture"
                                    :alt="drawing.owner_name"
                                    class="owner-avatar"
                                    referrerpolicy="no-referrer"
                                />
                                <span
                                    v-else
                                    class="owner-avatar-placeholder"
                                ></span>
                                <span class="owner-name">{{ drawing.owner_name }}</span>
                            </div>

                            <div class="drawing-card-meta">
                                <span>{{ getKindLabel(drawing.kind) }}</span>
                                <span>{{ getDrawingMetric(drawing) }}</span>
                                <span>{{ getStorageLabel(drawing) }}</span>
                            </div>

                            <p class="drawing-card-frames">Saved {{ formatTimestamp(drawing.updated_at) }}</p>

                            <p class="drawing-card-desc">{{ getDrawingSummary(drawing) }}</p>

                            <div class="drawing-card-actions">
                                <button
                                    type="button"
                                    class="action-button open-button"
                                    title="Open drawing"
                                    :disabled="isDrawingBusy(drawing)"
                                    @click="handleOpen(drawing)"
                                >
                                    <span class="material-symbols-outlined">visibility</span>
                                </button>
                                <button
                                    type="button"
                                    class="action-button edit-button"
                                    title="Edit metadata"
                                    :disabled="isDrawingBusy(drawing)"
                                    @click="handleEdit(drawing)"
                                >
                                    <span class="material-symbols-outlined">edit</span>
                                </button>
                                <button
                                    type="button"
                                    class="action-button copy-button local-copy-button"
                                    title="Copy to local storage"
                                    :disabled="isDrawingBusy(drawing)"
                                    @click="handleDuplicateLocal(drawing)"
                                >
                                    <span class="material-symbols-outlined">content_copy</span>
                                    <span class="action-provider-badge material-symbols-outlined">hard_drive</span>
                                </button>
                                <button
                                    v-for="action in getCloudCopyActions(drawing)"
                                    :key="`${getDrawingIdentity(drawing)}-${action.destination}`"
                                    type="button"
                                    class="action-button copy-button"
                                    :class="{
                                        'drive-copy-button': action.destination === 'google-drive',
                                        'r2-copy-button': action.destination === 'r2'
                                    }"
                                    :title="getCopyActionTitle(action)"
                                    :disabled="isDrawingBusy(drawing)"
                                    @click="handleDuplicateCloud(drawing, action.destination)"
                                >
                                    <span class="material-symbols-outlined">content_copy</span>
                                    <img
                                        :src="getCopyActionIcon(action.destination)"
                                        :alt="getCopyActionTitle(action)"
                                        class="action-provider-icon"
                                    />
                                </button>
                                <button
                                    type="button"
                                    class="action-button delete-button"
                                    title="Delete drawing"
                                    :disabled="isDrawingBusy(drawing)"
                                    @click="handleDelete(drawing)"
                                >
                                    <span class="material-symbols-outlined">delete</span>
                                </button>
                            </div>
                        </div>
                    </article>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .drawing-browser {
        position: absolute;
        inset: 0;
        z-index: 6;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease;
        display: flex;
        flex-direction: column;
        background:
            radial-gradient(circle at top, rgba(255, 255, 255, 0.08), transparent 28%),
            linear-gradient(180deg, rgba(5, 10, 19, 0.94) 0%, rgba(5, 8, 16, 0.98) 100%);
    }

    .drawing-browser.active {
        opacity: 1;
        pointer-events: auto;
    }

    .drawing-browser-container {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        padding-top: 5.5rem;
        padding-bottom: 5.5rem;
        min-height: 0;
    }

    .drawing-browser-content {
        flex: 1;
        min-height: 0;
        padding: 20px;
        overflow-y: auto;
        scrollbar-gutter: stable;
    }

    .drawing-browser-header {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin-bottom: 1.5rem;
    }

    .drawing-browser-header h2 {
        margin: 0;
        color: #fff;
        font-size: 1.5rem;
        font-weight: 600;
    }

    @media (min-width: 640px) {
        .drawing-browser-header {
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
        }
    }

    .drawing-browser-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
    }

    .drawing-browser-tab {
        background: transparent;
        border: 1px solid #555;
        border-radius: 8px;
        color: #888;
        font-size: 14px;
        padding: 8px 16px;
        cursor: pointer;
        transition: all 0.2s;
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
    }

    .drawing-browser-tab:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.05);
        border-color: #888;
    }

    .drawing-browser-tab.active {
        color: #4caf50;
        border-color: #4caf50;
        background: rgba(76, 175, 80, 0.1);
    }

    .drawing-browser-tab.disabled {
        opacity: 0.45;
        cursor: default;
    }

    .drawing-browser-tab-count {
        min-width: 1.4rem;
        height: 1.4rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        background: #333;
        color: currentColor;
        font-size: 0.72rem;
        font-weight: 600;
    }

    .drawing-browser-error,
    .drawing-browser-empty {
        text-align: center;
        padding: 60px 20px;
        color: #888;
        margin: 0;
    }

    .drawing-browser-error {
        margin-bottom: 1rem;
        color: #ff6b6b;
    }

    .drawing-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 20px;
    }

    .drawing-card {
        position: relative;
        display: flex;
        flex-direction: column;
        background: #252525;
        border-radius: 0;
        overflow: hidden;
        cursor: default;
        transition: all 0.2s;
        border: 2px solid transparent;
    }

    .drawing-card.local-drawing-card {
        border-color: rgba(59, 130, 246, 0.3);
    }

    .drawing-card:hover {
        border-color: #4caf50;
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
    }

    .drawing-card.local-drawing-card:hover {
        border-color: #3b82f6;
    }

    .drawing-card-thumbnail {
        aspect-ratio: 16 / 9;
        background: #333;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        position: relative;
    }

    .drawing-card-preview {
        width: 100%;
        height: 100%;
        padding: 0;
        border: none;
        background: transparent;
        cursor: pointer;
    }

    .drawing-card-preview:focus-visible {
        outline: 2px solid #60a5fa;
        outline-offset: -2px;
    }

    .drawing-card-image,
    .drawing-card-placeholder {
        display: block;
        width: 100%;
        height: 100%;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        background: #333;
    }

    .drawing-card-placeholder {
        color: #666;
        font-size: 14px;
        text-align: center;
        display: flex;
        align-items: center;
        justify-content: center;
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

    .drawing-card-info {
        padding: 12px;
    }

    .drawing-card-name {
        margin: 0 0 8px 0;
        color: #fff;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .drawing-card-owner {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
    }

    .drawing-card-owner .owner-avatar {
        width: 20px;
        height: 20px;
        border-radius: 0;
        object-fit: cover;
        flex-shrink: 0;
    }

    .drawing-card-owner .owner-avatar-placeholder {
        width: 20px;
        height: 20px;
        border-radius: 0;
        background: #444;
        flex-shrink: 0;
    }

    .drawing-card-owner .owner-name {
        color: #aaa;
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .drawing-card-meta {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }

    .drawing-card-meta span {
        background: #333;
        color: #aaa;
        font-size: 11px;
        padding: 3px 8px;
        border-radius: 0;
    }

    .drawing-card-frames {
        margin: 6px 0 0 0;
        color: #666;
        font-size: 11px;
        font-style: italic;
    }

    .drawing-card-desc {
        margin: 8px 0 0 0;
        color: #888;
        font-size: 12px;
        line-height: 1.45;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .drawing-card-actions {
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
        position: relative;
    }

    .drawing-card:hover .action-button {
        opacity: 1;
        pointer-events: auto;
    }

    .action-button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        pointer-events: auto;
    }

    .action-button .material-symbols-outlined {
        font-size: 18px;
        color: #fff;
    }

    .action-button.open-button {
        background: rgba(100, 181, 246, 0.9);
    }

    .action-button.open-button:hover:not(:disabled) {
        background: #90caf9;
        transform: scale(1.1);
    }

    .action-button.edit-button {
        background: rgba(34, 197, 94, 0.9);
    }

    .action-button.edit-button:hover:not(:disabled) {
        background: #22c55e;
        transform: scale(1.1);
    }

    .action-button.copy-button {
        background: rgba(59, 130, 246, 0.9);
    }

    .action-button.copy-button:hover:not(:disabled) {
        background: #3b82f6;
        transform: scale(1.1);
    }

    .action-button.r2-copy-button {
        background: rgba(249, 115, 22, 0.92);
    }

    .action-button.r2-copy-button:hover:not(:disabled) {
        background: #f97316;
    }

    .action-button.delete-button {
        background: rgba(220, 38, 38, 0.9);
    }

    .action-button.delete-button:hover:not(:disabled) {
        background: #dc2626;
        transform: scale(1.1);
    }

    .action-provider-icon,
    .action-provider-badge {
        position: absolute;
        right: -3px;
        bottom: -3px;
        width: 14px;
        height: 14px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.92);
        border: 1px solid rgba(255, 255, 255, 0.16);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .action-provider-badge.material-symbols-outlined {
        font-size: 10px;
        color: #e2e8f0;
    }

    @media (hover: none),
    (max-width: 768px) {
        .action-button {
            opacity: 1;
            pointer-events: auto;
        }
    }

    @media (min-width: 1024px) {
        .drawing-grid {
            grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        }
    }

    @media (max-width: 768px) {
        .drawing-browser-container {
            padding-top: 5.5rem;
            padding-bottom: 5.5rem;
        }

        .drawing-browser-content {
            padding: 16px;
        }

        .drawing-browser-tab {
            padding: 8px 12px;
        }

        .drawing-grid {
            grid-template-columns: minmax(0, 1fr);
        }
    }
</style>