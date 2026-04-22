<script setup>
    import { computed, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import { useGoogleAuth } from '../../composables/shared/useGoogleAuth';
    import { createDrawingThumbnailDataUrl } from '../../modules/shared/drawingLibrary.js';
    import { useViewerStore } from '../../stores/viewerStore';
    import { useRivvonAPI } from '../../services/api.js';
    import { useDrawingStorage } from '../../services/drawingStorage.js';

    const props = defineProps({
        visible: {
            type: Boolean,
            default: false,
        }
    });

    const emit = defineEmits(['close', 'select']);

    const app = useViewerStore();
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
    const activeDrawingCount = computed(() => displayDrawings.value.length);
    const browserKicker = computed(() => {
        if (activeTab.value === 'local') {
            return 'Local saves';
        }

        if (activeTab.value === 'cloud') {
            return 'Cloud saves';
        }

        return isAuthenticated.value ? 'Local + cloud saves' : 'Local saves';
    });
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
    const cloudDuplicateDestination = computed(() => {
        if (!isAuthenticated.value) {
            return null;
        }

        if (isAdmin.value && app.drawingAutosaveTarget === 'r2') {
            return 'r2';
        }

        return 'google-drive';
    });
    const cloudDuplicateButtonLabel = computed(() => {
        if (cloudDuplicateDestination.value === 'r2') {
            return 'Copy to R2';
        }

        return 'Copy to Drive';
    });
    const emptyStateMessage = computed(() => {
        if (activeTab.value === 'cloud') {
            return isAuthenticated.value
                ? 'Cloud drawings will appear here after saves or duplicates to Google Drive or R2.'
                : 'Sign in to browse drawings saved to Google Drive or R2.';
        }

        if (activeTab.value === 'local') {
            return 'Local drawings and cached cloud copies will appear here after autosave or duplicate-to-local actions.';
        }

        return 'New gesture, walk, text, emoji, and SVG drawings will appear here after autosave, whether they are saved locally or in the cloud.';
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

    async function handleDuplicateCloud(drawing) {
        if (!isAuthenticated.value || !cloudDuplicateDestination.value) {
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
                const uploadResult = cloudDuplicateDestination.value === 'r2'
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
            error.value = `Failed to duplicate drawing to ${cloudDuplicateDestination.value === 'r2' ? 'R2' : 'Google Drive'}.`;
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
                    <div>
                        <p class="drawing-browser-kicker">{{ browserKicker }}</p>
                        <h2 class="drawing-browser-title">Saved drawings</h2>
                    </div>
                    <div class="drawing-browser-count">{{ activeDrawingCount }}</div>
                </div>

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
                        :key="drawing.id"
                        class="drawing-card"
                    >
                        <button
                            type="button"
                            class="drawing-card-preview"
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

                        <div class="drawing-card-body">
                            <div class="drawing-card-meta">
                                <span class="drawing-card-kind">{{ getKindLabel(drawing.kind) }} · {{ getStorageLabel(drawing) }}</span>
                                <span class="drawing-card-date">{{ formatTimestamp(drawing.updated_at) }}</span>
                            </div>

                            <h3 class="drawing-card-title">{{ drawing.name }}</h3>
                            <p class="drawing-card-summary">{{ getDrawingSummary(drawing) }}</p>

                            <div class="drawing-card-actions">
                                <Button
                                    type="button"
                                    size="small"
                                    label="Open"
                                    :disabled="isDrawingBusy(drawing)"
                                    @click="handleOpen(drawing)"
                                />
                                <Button
                                    type="button"
                                    size="small"
                                    severity="secondary"
                                    label="Edit"
                                    :disabled="isDrawingBusy(drawing)"
                                    @click="handleEdit(drawing)"
                                />
                                <Button
                                    type="button"
                                    size="small"
                                    severity="secondary"
                                    label="Copy Local"
                                    :disabled="isDrawingBusy(drawing)"
                                    @click="handleDuplicateLocal(drawing)"
                                />
                                <Button
                                    v-if="isAuthenticated"
                                    type="button"
                                    size="small"
                                    severity="secondary"
                                    :label="cloudDuplicateButtonLabel"
                                    :disabled="isDrawingBusy(drawing)"
                                    @click="handleDuplicateCloud(drawing)"
                                />
                                <Button
                                    type="button"
                                    size="small"
                                    severity="danger"
                                    label="Delete"
                                    :disabled="isDrawingBusy(drawing)"
                                    @click="handleDelete(drawing)"
                                />
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
        align-items: flex-end;
        justify-content: space-between;
        gap: 1rem;
        margin-bottom: 1rem;
    }

    .drawing-browser-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-bottom: 1.5rem;
    }

    .drawing-browser-tab {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.82);
        padding: 0.55rem 0.9rem;
        cursor: pointer;
        transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
    }

    .drawing-browser-tab.active {
        background: rgba(255, 255, 255, 0.14);
        border-color: rgba(255, 255, 255, 0.28);
        color: #fff;
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
        background: rgba(255, 255, 255, 0.1);
        font-size: 0.72rem;
        font-weight: 600;
    }

    .drawing-browser-kicker {
        margin: 0 0 0.35rem;
        font-size: 0.7rem;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.52);
    }

    .drawing-browser-title {
        margin: 0;
        font-size: clamp(1.8rem, 3vw, 2.6rem);
        font-weight: 500;
        color: #fff;
    }

    .drawing-browser-count {
        min-width: 2.5rem;
        height: 2.5rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.85);
        font-size: 0.95rem;
        font-weight: 600;
    }

    .drawing-browser-error,
    .drawing-browser-empty {
        margin: 0;
        padding: 1rem 1.15rem;
        border-radius: 1rem;
        background: rgba(255, 255, 255, 0.06);
        color: rgba(255, 255, 255, 0.76);
    }

    .drawing-browser-error {
        margin-bottom: 1rem;
    }

    .drawing-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 280px));
        justify-content: start;
        gap: 20px;
    }

    .drawing-card {
        display: flex;
        flex-direction: column;
        overflow: hidden;
        min-height: 100%;
        border-radius: 0;
        border: 2px solid transparent;
        background: #252525;
        transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
    }

    .drawing-card:hover {
        border-color: rgba(255, 255, 255, 0.22);
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.28);
    }

    .drawing-card-preview {
        padding: 0;
        border: none;
        background: transparent;
        cursor: pointer;
    }

    .drawing-card-image,
    .drawing-card-placeholder {
        display: block;
        width: 100%;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        background: #333;
    }

    .drawing-card-placeholder {
        display: grid;
        place-items: center;
        color: #777;
        font-size: 0.85rem;
    }

    .drawing-card-body {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 0.65rem;
        padding: 12px;
        min-height: 0;
    }

    .drawing-card-meta {
        display: flex;
        justify-content: space-between;
        gap: 0.75rem;
        font-size: 0.68rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.52);
    }

    .drawing-card-title {
        margin: 0;
        font-size: 0.95rem;
        font-weight: 600;
        color: #fff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .drawing-card-summary {
        margin: 0;
        color: rgba(255, 255, 255, 0.72);
        line-height: 1.45;
        line-clamp: 2;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        min-height: calc(1.45em * 2);
    }

    .drawing-card-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: auto;
    }

    .drawing-card-actions :deep(.p-button) {
        flex: 1 1 auto;
    }

    @media (min-width: 1280px) {
        .drawing-grid {
            grid-template-columns: repeat(auto-fill, minmax(240px, 300px));
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

        .drawing-browser-header {
            align-items: center;
        }

        .drawing-browser-tabs {
            gap: 0.5rem;
        }

        .drawing-browser-tab {
            padding: 0.5rem 0.8rem;
        }

        .drawing-grid {
            grid-template-columns: minmax(0, 1fr);
        }
    }
</style>