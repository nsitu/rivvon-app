<script setup>
    import { ref, computed, onBeforeUnmount, watch, defineAsyncComponent } from 'vue';
    import { read } from 'ktx-parse';
    import { useViewerStore } from '../../stores/viewerStore';
    import { fetchTextures, fetchTextureWithTiles, groupTextureRecordsIntoFamilies } from '../../services/textureService';
    import { useRivvonAPI } from '../../services/api.js';
    import { useGoogleAuth } from '../../composables/shared/useGoogleAuth';
    import { useLocalStorage } from '../../services/localStorage.js';
    import { fetchDriveFile } from '../../modules/viewer/auth.js';
    import { getTextureVariantTargetResolutionOptions } from '../../modules/slyce/textureFamilyPlanning.js';
    import Button from 'primevue/button';
    import MultiSelect from 'primevue/multiselect';
    const TileLinearViewer = defineAsyncComponent(() => import('../slyce/TileLinearViewer.vue'));

    const props = defineProps({
        visible: {
            type: Boolean,
            default: false
        },
        initialTab: {
            type: String,
            default: 'all' // 'all', 'local', 'my-cloud', 'public', or 'cached'
        }
    });

    const emit = defineEmits(['close', 'select', 'select-local', 'select-multi']);

    // Multi-select state
    const MAX_MULTI_SELECT = 4;
    const multiSelectMode = ref(false);
    const selectedTextures = ref(new Map()); // id -> { texture, isLocal }
    const selectedFamilyVariantIds = ref(new Map()); // cardId -> selected variant id

    const app = useViewerStore();
    const { deleteTextureSet, uploadTextureSet, uploadTextureSetToR2, updateTextureSet } = useRivvonAPI();
    const { isAuthenticated, isAdmin, user } = useGoogleAuth();
    const { getAllTextureSets: getLocalTextures, deleteTextureSet: deleteLocalTextureSet, getTiles: getLocalTiles, updateTextureSet: updateLocalTextureSet, cacheCloudTexture, promoteTextureSetToCachedCloudTexture, getCachedCloudIds, getCachedLocalId, evictCachedTexture } = useLocalStorage();

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
    const deleteTextureIds = ref([]);
    const deleteVariantCount = ref(1);
    const deletingId = ref(null);
    const isLocalDelete = ref(false);

    // Copy state
    const textureToCopy = ref(null);
    const copyDestination = ref(null); // 'google-drive', 'r2', or 'local'
    const isCopying = ref(false);
    const copyProgress = ref('');
    const copyError = ref(null);
    const copyRetryTargetRootId = ref(null);
    const copyPendingVariantIds = ref([]);
    const showCopyMenu = ref(null); // texture id to show copy menu for
    const copyMenuPosition = ref({ top: 0, left: 0 }); // position for teleported menu
    const copyMenuTexture = ref(null); // texture object for menu

    // Derived variant state
    const textureToDerive = ref(null);
    const deriveTargetResolutions = ref([]);
    const isDeriving = ref(false);
    const deriveProgress = ref('');
    const deriveError = ref(null);
    const deriveResult = ref(null);
    let deriveModulePromise = null;

    // Edit state
    const textureToEdit = ref(null);
    const editName = ref('');
    const editDescription = ref('');
    const isEditing = ref(false);
    const editError = ref(null);
    const editTextureIds = ref([]);
    const editVariantCount = ref(1);

    function buildResolvedTextureRecord(rootTexture, resolvedSummary, fallbackRecord = null) {
        const baseTexture = fallbackRecord || rootTexture || null;
        if (!baseTexture && !resolvedSummary) {
            return null;
        }

        const resolvedResolution = Number(
            resolvedSummary?.resolution
            ?? resolvedSummary?.tile_resolution
            ?? baseTexture?.tile_resolution
        ) || null;
        const resolvedByteSize = Number(
            resolvedSummary?.total_size_bytes
            ?? resolvedSummary?.size_bytes
            ?? baseTexture?.total_size_bytes
            ?? baseTexture?.total_size
            ?? 0
        ) || 0;

        return {
            ...(baseTexture || {}),
            id: resolvedSummary?.id || baseTexture?.id || null,
            root_texture_id: resolvedSummary?.root_texture_id || baseTexture?.root_texture_id || rootTexture?.id || baseTexture?.id || null,
            parent_texture_set_id: resolvedSummary?.parent_texture_set_id || baseTexture?.parent_texture_set_id || null,
            tile_resolution: resolvedResolution || baseTexture?.tile_resolution || null,
            total_size: resolvedByteSize || baseTexture?.total_size || 0,
            total_size_bytes: resolvedByteSize || baseTexture?.total_size_bytes || baseTexture?.total_size || 0,
            storage_provider: resolvedSummary?.storage_provider || baseTexture?.storage_provider || (baseTexture?.isLocal ? 'local' : 'r2'),
            status: resolvedSummary?.status || baseTexture?.status || 'complete',
            created_at: Number(resolvedSummary?.created_at ?? baseTexture?.created_at ?? 0) || 0,
            updated_at: Number(resolvedSummary?.updated_at ?? baseTexture?.updated_at ?? 0) || 0,
        };
    }

    function buildFamilyCard(family, cachedIds = new Set()) {
        const rootTexture = family.root || family.records?.[0] || null;
        const resolvedSummary = family.resolvedVariantSummary || null;
        const resolvedTexture = buildResolvedTextureRecord(rootTexture, resolvedSummary, family.resolvedVariantRecord);
        const baseTexture = rootTexture || resolvedTexture || {};
        const availableResolutions = Array.isArray(family.availableResolutions) && family.availableResolutions.length > 0
            ? family.availableResolutions
            : [Number(rootTexture?.tile_resolution ?? resolvedTexture?.tile_resolution)].filter((resolution) => Number.isInteger(resolution) && resolution > 0);
        const familyMemberIds = Array.isArray(family.records)
            ? family.records.map((record) => record?.id).filter(Boolean)
            : [];
        const cachedFamily = Array.isArray(family.variantSummaries)
            ? family.variantSummaries.some((summary) => cachedIds.has(summary.id)) || familyMemberIds.some((id) => cachedIds.has(id))
            : familyMemberIds.some((id) => cachedIds.has(id));
        const rootResolution = Number(rootTexture?.tile_resolution ?? availableResolutions[0] ?? resolvedTexture?.tile_resolution) || null;
        const activeResolution = Number(resolvedSummary?.resolution ?? resolvedTexture?.tile_resolution ?? rootResolution) || null;
        const familyRootId = family.rootTextureId || baseTexture?.root_texture_id || baseTexture?.id || resolvedTexture?.id || null;
        const cardId = `${baseTexture?.isLocal ? 'local' : 'cloud'}:${familyRootId || baseTexture?.id || resolvedTexture?.id || 'unknown'}`;
        const defaultVariantId = resolvedSummary?.id || resolvedTexture?.id || rootTexture?.id || null;

        return {
            ...baseTexture,
            id: cardId,
            cardId,
            familyCard: true,
            defaultVariantId,
            rootTextureId: familyRootId,
            rootTexture: rootTexture || resolvedTexture || null,
            resolvedTexture: resolvedTexture || rootTexture || null,
            familyMembers: family.records || [],
            availableResolutions,
            variantSummaries: family.variantSummaries || [],
            rootResolution,
            activeResolution,
            isLocal: Boolean(baseTexture?.isLocal),
            isCached: cachedFamily,
            hasDerivedVariants: availableResolutions.length > 1,
            thumbnail_url: baseTexture?.thumbnail_url || baseTexture?.thumbnail_data_url || resolvedTexture?.thumbnail_url || resolvedTexture?.thumbnail_data_url || null,
            total_size_bytes: Number(resolvedTexture?.total_size_bytes ?? baseTexture?.total_size_bytes ?? baseTexture?.total_size ?? 0) || 0,
            tile_count: Number(resolvedTexture?.tile_count ?? baseTexture?.tile_count ?? 0) || 0,
            layer_count: Number(baseTexture?.layer_count ?? resolvedTexture?.layer_count ?? 0) || 0,
            cross_section_type: baseTexture?.cross_section_type || resolvedTexture?.cross_section_type || 'waves',
            storage_provider: resolvedTexture?.storage_provider || baseTexture?.storage_provider || (baseTexture?.isLocal ? 'local' : 'r2'),
            created_at: Number(baseTexture?.created_at ?? resolvedTexture?.created_at ?? 0) || 0,
        };
    }

    const localTextureCards = computed(() => {
        const anchoredCachedCloudIds = new Set(
            localTextures.value
                .filter((texture) => !texture.cached_from)
                .map((texture) => texture.root_texture_id)
                .filter(Boolean)
        );
        const localMapped = localTextures.value
            .filter((texture) => !texture.cached_from || anchoredCachedCloudIds.has(texture.cached_from))
            .map((texture) => ({
                ...texture,
                isLocal: true,
                thumbnail_url: texture.thumbnail_data_url,
                total_size_bytes: texture.total_size_bytes ?? texture.total_size,
            }));

        return groupTextureRecordsIntoFamilies(localMapped, {
            preferredMaxResolution: app.preferredTextureMaxResolution,
        }).map((family) => buildFamilyCard(family));
    });

    const cloudTextureCards = computed(() => {
        const cachedIds = cachedCloudIds.value;
        const cloudMapped = textures.value
            .filter((texture) => {
                const provider = texture.storage_provider || 'r2';
                if (!isAuthenticated.value && provider === 'google-drive') {
                    return false;
                }
                return true;
            })
            .map((texture) => ({
                ...texture,
                isLocal: false,
                isCached: cachedIds.has(texture.id),
            }));

        return groupTextureRecordsIntoFamilies(cloudMapped, {
            preferredMaxResolution: app.preferredTextureMaxResolution,
        }).map((family) => buildFamilyCard(family, cachedIds));
    });

    const displayTextures = computed(() => {
        const tab = activeTab.value;
        const localCards = localTextureCards.value;
        const cloudCards = cloudTextureCards.value;

        switch (tab) {
            case 'local':
                return localCards;
            case 'cached':
                return cloudCards.filter((texture) => texture.isCached);
            case 'my-cloud':
                if (!user.value) return [];
                return cloudCards.filter((texture) => texture.owner_google_id === user.value.googleId);
            case 'public':
                return cloudCards;
            case 'all':
            default:
                return [...localCards, ...cloudCards].sort((left, right) => {
                    const dateA = left.created_at || 0;
                    const dateB = right.created_at || 0;
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

    function getCardSelectionKey(texture) {
        return texture?.cardId || texture?.rootTextureId || texture?.id;
    }

    function getFamilyRootTexture(texture) {
        return texture?.rootTexture || texture;
    }

    function getFamilySelectionTexture(texture) {
        return getSelectedFamilyVariantEntry(texture)?.sourceTexture || texture?.resolvedTexture || texture;
    }

    function getFamilyActionTexture(texture) {
        return getFamilyRootTexture(texture);
    }

    function getFamilyMemberIds(texture) {
        const familyIds = Array.isArray(texture?.familyMembers)
            ? texture.familyMembers.map((member) => member?.id).filter(Boolean)
            : [];

        if (familyIds.length > 0) {
            return familyIds;
        }

        return [getFamilyActionTexture(texture)?.id].filter(Boolean);
    }

    function getFamilyAvailableResolutions(texture) {
        if (Array.isArray(texture?.availableResolutions) && texture.availableResolutions.length > 0) {
            return texture.availableResolutions
                .map((resolution) => Number(resolution))
                .filter((resolution) => Number.isInteger(resolution) && resolution > 0);
        }

        const tileResolution = Number(texture?.tile_resolution ?? texture?.variant_info?.target_resolution);
        return Number.isInteger(tileResolution) && tileResolution > 0 ? [tileResolution] : [];
    }

    function compareFamilyVariantEntries(left, right) {
        const resolutionDelta = (right?.resolution || 0) - (left?.resolution || 0);
        if (resolutionDelta !== 0) {
            return resolutionDelta;
        }

        if (left?.isRoot !== right?.isRoot) {
            return left?.isRoot ? -1 : 1;
        }

        return String(left?.id || '').localeCompare(String(right?.id || ''));
    }

    function getFamilyVariantEntries(texture, { variantIds = null } = {}) {
        if (!texture) {
            return [];
        }

        const rootTexture = getFamilyRootTexture(texture);
        const fallbackTexture = getFamilyActionTexture(texture) || texture;
        const familyMembers = Array.isArray(texture?.familyMembers)
            ? texture.familyMembers.filter(Boolean)
            : [];
        const recordsById = new Map(familyMembers.map((member) => [member.id, member]));
        const fallbackResolution = Number(fallbackTexture?.tile_resolution) || null;
        const rawVariantSummaries = Array.isArray(texture?.variantSummaries) && texture.variantSummaries.length > 0
            ? texture.variantSummaries.filter((summary) => summary?.id)
            : (fallbackTexture?.id
                ? [{
                    id: fallbackTexture.id,
                    resolution: fallbackResolution,
                    tile_resolution: fallbackResolution,
                    is_root: true,
                }]
                : []);
        const allowedVariantIds = Array.isArray(variantIds) && variantIds.length > 0
            ? new Set(variantIds.filter(Boolean))
            : null;

        return rawVariantSummaries
            .filter((summary) => !allowedVariantIds || allowedVariantIds.has(summary.id))
            .map((summary) => {
                const sourceTexture = recordsById.get(summary.id)
                    || (fallbackTexture?.id === summary.id ? fallbackTexture : null)
                    || buildResolvedTextureRecord(rootTexture, summary, recordsById.get(summary.id) || null);
                const resolution = Number(summary?.resolution ?? summary?.tile_resolution ?? sourceTexture?.tile_resolution) || null;

                return {
                    id: summary.id,
                    summary,
                    resolution,
                    isRoot: Boolean(summary?.is_root || summary?.id === texture?.rootTextureId),
                    sourceTexture,
                };
            })
            .sort(compareFamilyVariantEntries);
    }

    function getDefaultFamilyVariantId(texture, entries = null) {
        const variantEntries = Array.isArray(entries) && entries.length > 0
            ? entries
            : getFamilyVariantEntries(texture);
        const candidateIds = [
            texture?.defaultVariantId,
            texture?.resolvedTexture?.id,
            texture?.rootTextureId,
            getFamilyRootTexture(texture)?.id,
            texture?.id,
        ].filter(Boolean);

        for (const candidateId of candidateIds) {
            const matchedEntry = variantEntries.find((entry) => String(entry.id) === String(candidateId));
            if (matchedEntry) {
                return matchedEntry.id;
            }
        }

        return variantEntries[0]?.id || null;
    }

    function getSelectedFamilyVariantId(texture) {
        const variantEntries = getFamilyVariantEntries(texture);
        if (variantEntries.length === 0) {
            return null;
        }

        const configuredVariantId = selectedFamilyVariantIds.value.get(getCardSelectionKey(texture));
        if (configuredVariantId) {
            const matchedEntry = variantEntries.find((entry) => String(entry.id) === String(configuredVariantId));
            if (matchedEntry) {
                return matchedEntry.id;
            }
        }

        return getDefaultFamilyVariantId(texture, variantEntries);
    }

    function getSelectedFamilyVariantEntry(texture) {
        const variantEntries = getFamilyVariantEntries(texture);
        if (variantEntries.length === 0) {
            return null;
        }

        const selectedVariantId = getSelectedFamilyVariantId(texture);
        return variantEntries.find((entry) => String(entry.id) === String(selectedVariantId)) || variantEntries[0] || null;
    }

    function syncSelectedTextureVariant(texture) {
        const selectionKey = getCardSelectionKey(texture);
        if (!selectedTextures.value.has(selectionKey)) {
            return;
        }

        const map = new Map(selectedTextures.value);
        map.set(selectionKey, {
            texture: getFamilySelectionTexture(texture),
            isLocal: isLocalTexture(texture)
        });
        selectedTextures.value = map;
    }

    function setSelectedFamilyVariantId(texture, variantId) {
        const variantEntries = getFamilyVariantEntries(texture);
        const matchedEntry = variantEntries.find((entry) => String(entry.id) === String(variantId));
        const nextVariantId = matchedEntry?.id || getDefaultFamilyVariantId(texture, variantEntries);
        const map = new Map(selectedFamilyVariantIds.value);

        if (nextVariantId) {
            map.set(getCardSelectionKey(texture), nextVariantId);
        } else {
            map.delete(getCardSelectionKey(texture));
        }

        selectedFamilyVariantIds.value = map;
        syncSelectedTextureVariant(texture);
    }

    function handleFamilyVariantChange(texture, event) {
        event?.stopPropagation?.();
        setSelectedFamilyVariantId(texture, event?.target?.value);
    }

    function getFamilyVariantSizeBytes(entry) {
        return Number(
            entry?.summary?.total_size_bytes
            ?? entry?.summary?.size_bytes
            ?? entry?.sourceTexture?.total_size_bytes
            ?? entry?.sourceTexture?.total_size
            ?? 0
        ) || 0;
    }

    function formatVariantSize(bytes) {
        if (!bytes) {
            return null;
        }

        if (bytes < 1024 * 1024) {
            return `${Math.max(1, Math.round(bytes / 1024))} KB`;
        }

        return formatSize(bytes);
    }

    function formatFamilyVariantOptionLabel(entry) {
        const resolutionLabel = Number.isInteger(entry?.resolution) && entry.resolution > 0
            ? `${entry.resolution}px`
            : (entry?.isRoot ? 'Root' : 'Variant');
        const sizeLabel = formatVariantSize(getFamilyVariantSizeBytes(entry));

        return sizeLabel ? `${resolutionLabel} (${sizeLabel})` : resolutionLabel;
    }

    function getFamilyVariantOptions(texture) {
        return getFamilyVariantEntries(texture).map((entry) => ({
            id: entry.id,
            label: formatFamilyVariantOptionLabel(entry),
        }));
    }

    function getFamilyCopyEntries(texture, { variantIds = null } = {}) {
        const variantEntries = getFamilyVariantEntries(texture, { variantIds });

        if (variantEntries.length <= 1 || (Array.isArray(variantIds) && variantIds.length > 0)) {
            return variantEntries;
        }

        const rootTextureId = texture?.rootTextureId || getFamilyActionTexture(texture)?.id || null;
        const rootEntry = variantEntries.find((entry) => entry?.id === rootTextureId || entry?.isRoot);

        if (!rootEntry) {
            return variantEntries;
        }

        return [
            rootEntry,
            ...variantEntries.filter((entry) => entry.id !== rootEntry.id),
        ];
    }

    function getFamilyVariantCount(texture, { variantIds = null } = {}) {
        const variantEntries = getFamilyVariantEntries(texture, { variantIds });
        if (variantEntries.length > 0) {
            return variantEntries.length;
        }

        const availableResolutionCount = getFamilyAvailableResolutions(texture).length;
        if (availableResolutionCount > 0) {
            return availableResolutionCount;
        }

        return texture?.id ? 1 : 0;
    }

    function normalizeTextureFamilyName(name, { stripResolutionSuffix = false } = {}) {
        const trimmedName = typeof name === 'string' ? name.trim() : '';
        if (!trimmedName) {
            return '';
        }

        if (!stripResolutionSuffix) {
            return trimmedName;
        }

        return trimmedName.replace(/\s+\(\d+px\)$/i, '').trim();
    }

    function getTextureFamilyDisplayName(texture) {
        const rawName = getFamilyActionTexture(texture)?.name || texture?.name || 'Texture';
        const stripResolutionSuffix = getFamilyVariantCount(texture) > 1;
        return normalizeTextureFamilyName(rawName, { stripResolutionSuffix }) || rawName || 'Texture';
    }

    function buildCopiedTextureName(texture) {
        return `${getTextureFamilyDisplayName(texture)} (copy)`;
    }

    function formatCopyVariantLabel(entry) {
        if (Number.isInteger(entry?.resolution) && entry.resolution > 0) {
            return `${entry.resolution}px`;
        }

        return entry?.isRoot ? 'root' : 'variant';
    }

    function buildCopyProgressPrefix(entry, index, total) {
        if (total <= 1) {
            return 'Texture';
        }

        return `Variant ${index + 1}/${total} (${formatCopyVariantLabel(entry)})`;
    }

    function getCopyDestinationLabel(destination) {
        return destination === 'google-drive' ? 'Google Drive' : 'Cloudflare R2';
    }

    async function resolveTextureThumbnailBlob(texture, thumbnailDataUrl = null) {
        if (thumbnailDataUrl) {
            try {
                const response = await fetch(thumbnailDataUrl);
                if (response.ok) {
                    return await response.blob();
                }
            } catch (error) {
                console.warn('[TextureBrowser] Failed to resolve copied thumbnail from data URL:', error);
            }
        }

        if (isLocalTexture(texture) && texture?.thumbnail_data_url) {
            try {
                const response = await fetch(texture.thumbnail_data_url);
                if (response.ok) {
                    return await response.blob();
                }
            } catch (error) {
                console.warn('[TextureBrowser] Failed to load local thumbnail for copy:', error);
            }
        }

        if (!texture?.thumbnail_url) {
            return null;
        }

        try {
            const response = await fetch(texture.thumbnail_url);
            if (!response.ok) {
                return null;
            }

            return await response.blob();
        } catch (error) {
            console.warn('[TextureBrowser] Failed to fetch thumbnail for copy:', error);
            return null;
        }
    }

    function resetCopyRetryState() {
        copyRetryTargetRootId.value = null;
        copyPendingVariantIds.value = [];
    }

    function buildTileBlobMap(tileEntries = []) {
        return tileEntries.reduce((map, tileEntry) => {
            map[tileEntry.index] = tileEntry.blob;
            return map;
        }, {});
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

    function detectTileResolutionFromArrayBuffer(arrayBuffer) {
        const container = read(new Uint8Array(arrayBuffer));
        const width = Number(container?.pixelWidth);
        const height = Number(container?.pixelHeight);

        if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
            return null;
        }

        return Math.max(width, height);
    }

    async function detectTileResolutionFromBlob(blob) {
        if (!blob) return null;
        return detectTileResolutionFromArrayBuffer(await blob.arrayBuffer());
    }

    function getTileIndex(tile) {
        return tile?.tileIndex ?? tile?.index ?? tile?.tile_index ?? 0;
    }

    function sortTilesByIndex(tiles = []) {
        return [...tiles].sort((a, b) => getTileIndex(a) - getTileIndex(b));
    }

    function getTargetResolutionOptions(texture) {
        const sourceTexture = getFamilyRootTexture(texture);
        const sourceResolution = Number(
            sourceTexture?.tile_resolution
            ?? texture?.rootResolution
            ?? texture?.tile_resolution
        );

        const existingResolutions = new Set(getFamilyAvailableResolutions(texture));
        existingResolutions.add(sourceResolution);

        return getTextureVariantTargetResolutionOptions(sourceResolution)
            .filter((resolution) => !existingResolutions.has(resolution));
    }

    function canDeriveVariant(texture) {
        const sourceTexture = getFamilyRootTexture(texture);
        if (!sourceTexture || isLocalTexture(sourceTexture)) {
            return false;
        }

        if (!isOwner(sourceTexture) && !isAdmin.value) {
            return false;
        }

        return getTargetResolutionOptions(texture).length > 0;
    }

    function loadDeriveModule() {
        if (!deriveModulePromise) {
            deriveModulePromise = import('../../modules/slyce/ktx2RoundtripVariant.js');
        }

        return deriveModulePromise;
    }

    function formatDurationMs(value) {
        if (!Number.isFinite(value)) {
            return 'n/a';
        }

        return `${Math.round(value)} ms`;
    }

    async function blobToDataUrl(blob) {
        if (!blob) {
            return null;
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    }

    function buildPublishedVariantName(texture) {
        return (texture?.name || 'Texture')
            .replace(/\s+\(\d+px\)$/i, '')
            .trim();
    }

    function buildPublishedVariantInfo(texture, targetResolution) {
        const rootTextureSetId = texture?.variant_info?.root_texture_set_id
            || texture?.variant_info?.family_id
            || texture?.derived_from?.root_texture_set_id
            || texture?.id;

        return {
            family_id: rootTextureSetId,
            root_texture_set_id: rootTextureSetId,
            parent_texture_set_id: rootTextureSetId,
            source_resolution: texture?.tile_resolution,
            target_resolution: targetResolution,
            generated_at: Date.now(),
            method: 'cloud-browser-roundtrip-v1'
        };
    }

    function buildTextureSourceMetadata(texture, textureSetData = null) {
        return textureSetData?.source_metadata
            || texture?.source_metadata
            || {
            filename: texture?.name,
            sourceFrameCount: texture?.source_frame_count,
            sampledFrameCount: texture?.sampled_frame_count
        };
    }

    function isDerivedLocalVariant(texture) {
        return Boolean(texture?.variant_info?.target_resolution && texture?.derived_from);
    }

    function formatDerivedLineage(texture) {
        if (!isDerivedLocalVariant(texture)) {
            return null;
        }

        const sourceResolution = texture.variant_info?.source_resolution
            || texture.derived_from?.tile_resolution;
        const targetResolution = texture.variant_info?.target_resolution
            || texture.tile_resolution;
        const parentName = texture.derived_from?.name;
        const resolutionText = sourceResolution
            ? `${sourceResolution}px -> ${targetResolution}px`
            : `${targetResolution}px variant`;

        return parentName
            ? `${resolutionText} from ${parentName}`
            : resolutionText;
    }

    async function resolveTextureThumbnailDataUrl(texture) {
        if (isLocalTexture(texture) && texture?.thumbnail_data_url) {
            return texture.thumbnail_data_url;
        }

        if (!texture?.thumbnail_url) {
            return null;
        }

        try {
            const response = await fetch(texture.thumbnail_url);
            if (!response.ok) {
                return null;
            }

            return await blobToDataUrl(await response.blob());
        } catch (error) {
            console.warn('[TextureBrowser] Failed to load thumbnail for derived variant:', error);
            return null;
        }
    }

    function formatDeriveProgress(stage) {
        switch (stage?.stage) {
            case 'prepare-source':
                return 'Preparing source texture...';
            case 'variant-start':
                return `Preparing ${stage.targetResolution}px variant (${stage.variantNumber}/${stage.variantCount})...`;
            case 'variant-progress':
                switch (stage.nestedStage) {
                    case 'decode-layer':
                        return `${stage.targetResolution}px variant (${stage.variantNumber}/${stage.variantCount}): decoding layer ${stage.layerIndex + 1}/${stage.layerCount} for tile ${stage.tileNumber}/${stage.tileCount}...`;
                    case 'layer-complete':
                        return `${stage.targetResolution}px variant (${stage.variantNumber}/${stage.variantCount}): downscaled layer ${stage.layerIndex + 1}/${stage.layerCount} for tile ${stage.tileNumber}/${stage.tileCount}...`;
                    case 'encode':
                        return `${stage.targetResolution}px variant (${stage.variantNumber}/${stage.variantCount}): re-encoding ${stage.layerCount} layers for tile ${stage.tileNumber}/${stage.tileCount}...`;
                    case 'encode-progress':
                        return `${stage.targetResolution}px variant (${stage.variantNumber}/${stage.variantCount}): encoding layer ${stage.completed}/${stage.total} for tile ${stage.tileNumber}/${stage.tileCount}...`;
                    case 'tile-start':
                        return `${stage.targetResolution}px variant (${stage.variantNumber}/${stage.variantCount}): processing tile ${stage.tileNumber}/${stage.tileCount}...`;
                    case 'tile-complete':
                        return `${stage.targetResolution}px variant (${stage.variantNumber}/${stage.variantCount}): finished tile ${stage.tileNumber}/${stage.tileCount}.`;
                    default:
                        return `${stage.targetResolution}px variant (${stage.variantNumber}/${stage.variantCount}): processing...`;
                }
            case 'variant-complete':
                return `Prepared ${stage.targetResolution}px variant (${stage.variantNumber}/${stage.variantCount}).`;
            default:
                return 'Creating lower-resolution published variants...';
        }
    }

    async function downloadCloudTileBlob(tile) {
        if (tile.driveFileId) {
            const arrayBuffer = await fetchDriveFile(tile.driveFileId);
            return new Blob([arrayBuffer], { type: 'image/ktx2' });
        }

        if (tile.url && tile.url.includes('drive.google.com')) {
            const fileIdMatch = tile.url.match(/[?&]id=([^&]+)/);
            if (!fileIdMatch) {
                throw new Error('Invalid Google Drive URL format');
            }

            const arrayBuffer = await fetchDriveFile(fileIdMatch[1]);
            return new Blob([arrayBuffer], { type: 'image/ktx2' });
        }

        if (tile.url) {
            const response = await fetch(tile.url);
            if (!response.ok) {
                throw new Error(`Failed to fetch tile ${getTileIndex(tile)}`);
            }

            return response.blob();
        }

        throw new Error('Tile is missing a retrievable source');
    }

    async function fetchTextureSourceBundle(texture, onProgress) {
        if (isLocalTexture(texture)) {
            onProgress?.('Loading source tiles from local storage...');
            const localTiles = sortTilesByIndex(await getLocalTiles(texture.id));

            if (localTiles.length === 0) {
                throw new Error('No local tiles found for this texture');
            }

            return {
                sourceTextureSet: texture,
                tileEntries: localTiles.map((tile) => ({
                    index: getTileIndex(tile),
                    blob: tile.blob,
                    label: `${texture.name} tile ${getTileIndex(tile)}`
                })),
                thumbnailDataUrl: texture.thumbnail_data_url || null,
                fetchedFrom: 'local',
                downloadedSourceBlobs: null
            };
        }

        onProgress?.('Fetching source texture metadata...');
        const sourceTextureSet = await fetchTextureWithTiles(texture.id);

        if (cachedCloudIds.value.has(texture.id)) {
            onProgress?.('Loading source tiles from local cache...');
            const cachedLocalId = await getCachedLocalId(texture.id);
            if (cachedLocalId) {
                const cachedTiles = sortTilesByIndex(await getLocalTiles(cachedLocalId));

                if (cachedTiles.length > 0) {
                    return {
                        sourceTextureSet,
                        tileEntries: cachedTiles.map((tile) => ({
                            index: getTileIndex(tile),
                            blob: tile.blob,
                            label: `${texture.name} tile ${getTileIndex(tile)}`
                        })),
                        thumbnailDataUrl: await resolveTextureThumbnailDataUrl(texture),
                        fetchedFrom: 'cached',
                        downloadedSourceBlobs: null
                    };
                }
            }
        }

        const remoteTiles = sortTilesByIndex(sourceTextureSet.tiles || []);
        if (remoteTiles.length === 0) {
            throw new Error('No cloud tiles found for this texture');
        }

        const downloadedSourceBlobs = {};
        const tileEntries = [];

        for (let tileOffset = 0; tileOffset < remoteTiles.length; tileOffset++) {
            const tile = remoteTiles[tileOffset];
            const tileIndex = getTileIndex(tile);
            onProgress?.(`Downloading tile ${tileOffset + 1}/${remoteTiles.length}...`);
            const blob = await downloadCloudTileBlob(tile);
            downloadedSourceBlobs[tileIndex] = blob;
            tileEntries.push({
                index: tileIndex,
                blob,
                label: `${texture.name} tile ${tileIndex}`
            });
        }

        return {
            sourceTextureSet,
            tileEntries,
            thumbnailDataUrl: await resolveTextureThumbnailDataUrl(texture),
            fetchedFrom: 'cloud',
            downloadedSourceBlobs
        };
    }

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

    function applyTextureSelection(texture, event) {
        event?.stopPropagation?.();
        const selectionTexture = getFamilySelectionTexture(texture);

        if (!selectionTexture) {
            return;
        }

        if (isLocalTexture(selectionTexture)) {
            selectLocalTexture(selectionTexture);
            return;
        }

        selectTexture(selectionTexture);
    }

    // Multi-select helpers
    function toggleMultiSelectMode() {
        multiSelectMode.value = !multiSelectMode.value;
        if (!multiSelectMode.value) {
            selectedTextures.value = new Map();
        }
    }

    function isTextureSelected(texture) {
        return selectedTextures.value.has(getCardSelectionKey(texture));
    }

    function toggleTextureSelection(texture, event) {
        event?.stopPropagation?.();
        const map = new Map(selectedTextures.value);
        const selectionKey = getCardSelectionKey(texture);

        if (map.has(selectionKey)) {
            map.delete(selectionKey);
        } else {
            if (map.size >= MAX_MULTI_SELECT) return; // cap reached
            map.set(selectionKey, {
                texture: getFamilySelectionTexture(texture),
                isLocal: isLocalTexture(texture)
            });
        }
        selectedTextures.value = map;
    }

    function handleCardClick(texture, event) {
        if (multiSelectMode.value) {
            toggleTextureSelection(texture, event);
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
    const isDeletingFamily = computed(() => deleteVariantCount.value > 1);

    function close() {
        multiSelectMode.value = false;
        selectedTextures.value = new Map();
        selectedFamilyVariantIds.value = new Map();
        emit('close');
        app.hideTextureBrowser();
    }

    function cancelDelete() {
        textureToDelete.value = null;
        deleteTextureIds.value = [];
        deleteVariantCount.value = 1;
        isLocalDelete.value = false;
    }

    function handleKeydown(event) {
        if (event.key === 'Escape') {
            if (previewTexture.value) {
                closePreview();
            } else if (textureToDerive.value && !isDeriving.value) {
                cancelDeriveVariant();
            } else if (textureToEdit.value) {
                cancelEdit();
            } else if (textureToCopy.value) {
                cancelCopy();
            } else if (textureToDelete.value) {
                cancelDelete();
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
        textureToDelete.value = getFamilyActionTexture(texture);
        deleteTextureIds.value = getFamilyMemberIds(texture);
        deleteVariantCount.value = Array.isArray(texture?.availableResolutions) && texture.availableResolutions.length > 0
            ? texture.availableResolutions.length
            : deleteTextureIds.value.length;
        isLocalDelete.value = isLocalTexture(texture);
    }

    async function performDelete() {
        if (!textureToDelete.value) return;

        deletingId.value = textureToDelete.value.id;
        try {
            if (isLocalDelete.value) {
                // Delete from IndexedDB
                for (const textureId of deleteTextureIds.value) {
                    await deleteLocalTextureSet(textureId);
                }
                localTextures.value = localTextures.value.filter((texture) => !deleteTextureIds.value.includes(texture.id));
            } else {
                // Delete from cloud
                await deleteTextureSet(textureToDelete.value.id);
                textures.value = textures.value.filter((texture) => texture.id !== textureToDelete.value.id);
            }
            cancelDelete();
        } catch (err) {
            console.error('[TextureBrowser] Failed to delete texture:', err);
            error.value = 'Failed to delete: ' + err.message;
        } finally {
            deletingId.value = null;
        }
    }

    async function evictCache(texture, event) {
        event.stopPropagation();
        try {
            const cachedVariantIds = Array.from(new Set(
                (Array.isArray(texture?.variantSummaries) && texture.variantSummaries.length > 0
                    ? texture.variantSummaries.map((summary) => summary.id)
                    : [texture.id]
                ).filter(Boolean)
            ));

            await Promise.all(cachedVariantIds.map((textureId) => evictCachedTexture(textureId)));
            cachedCloudIds.value = await getCachedCloudIds();
        } catch (err) {
            console.error('[TextureBrowser] Failed to evict cache:', err);
        }
    }

    // Copy functionality
    function toggleCopyMenu(texture, event) {
        event.stopPropagation();
        const actionTexture = getFamilyActionTexture(texture);
        if (!actionTexture?.id) {
            return;
        }

        if (showCopyMenu.value === actionTexture.id) {
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
            showCopyMenu.value = actionTexture.id;
            copyMenuTexture.value = texture;
        }
    }

    function closeCopyMenu() {
        showCopyMenu.value = null;
        copyMenuTexture.value = null;
    }

    function canCopyTexture(texture) {
        return getCopyDestinations(texture).length > 0;
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
        closeCopyMenu();
        textureToCopy.value = texture;
        copyDestination.value = destination;
        copyProgress.value = '';
        copyError.value = null;
        resetCopyRetryState();
    }

    async function performCopy() {
        if (!textureToCopy.value || !copyDestination.value) return;

        isCopying.value = true;
        copyProgress.value = 'Preparing...';
        copyError.value = null;

        try {
            const texture = textureToCopy.value;
            const destination = copyDestination.value;
            const pendingVariantIds = copyPendingVariantIds.value.length > 0
                ? [...copyPendingVariantIds.value]
                : null;
            const isRetryAttempt = Boolean(copyRetryTargetRootId.value && pendingVariantIds?.length);
            const attemptEntries = getFamilyCopyEntries(texture, { variantIds: pendingVariantIds });

            if (attemptEntries.length === 0) {
                throw new Error('No variants available to copy');
            }

            const totalFamilyVariants = getFamilyVariantCount(texture);
            const sourceRootTexture = getFamilyActionTexture(texture) || attemptEntries[0]?.sourceTexture || texture;
            const copiedTextureName = buildCopiedTextureName(texture);
            const copiedDescription = sourceRootTexture?.description || `Copied on ${new Date().toLocaleDateString()}`;
            const copiedIsPublic = sourceRootTexture?.is_public !== false;
            const successfulEntries = [];
            const failedEntries = [];
            let destinationRootId = copyRetryTargetRootId.value || null;

            for (let entryIndex = 0; entryIndex < attemptEntries.length; entryIndex++) {
                const entry = attemptEntries[entryIndex];
                const sourceTexture = entry.sourceTexture || sourceRootTexture;
                const progressPrefix = buildCopyProgressPrefix(entry, entryIndex, attemptEntries.length);
                const isRootUpload = !destinationRootId;

                try {
                    const sourceBundle = await fetchTextureSourceBundle(sourceTexture, (message) => {
                        copyProgress.value = `${progressPrefix}: ${message}`;
                    });
                    let detectedTileResolution = Number(
                        sourceBundle?.sourceTextureSet?.tile_resolution
                        ?? sourceTexture?.tile_resolution
                        ?? entry?.resolution
                    ) || null;

                    if (!detectedTileResolution && sourceBundle.tileEntries[0]?.blob) {
                        detectedTileResolution = await detectTileResolutionFromBlob(sourceBundle.tileEntries[0].blob);
                    }

                    const thumbnailBlob = isRootUpload
                        ? await resolveTextureThumbnailBlob(sourceTexture, sourceBundle.thumbnailDataUrl)
                        : null;
                    const uploadOptions = {
                        name: copiedTextureName,
                        description: copiedDescription,
                        isPublic: copiedIsPublic,
                        parentTextureSetId: isRootUpload ? null : destinationRootId,
                        tileResolution: detectedTileResolution ?? entry?.resolution ?? sourceTexture?.tile_resolution,
                        layerCount: Number(
                            sourceBundle?.sourceTextureSet?.layer_count
                            ?? sourceTexture?.layer_count
                            ?? sourceRootTexture?.layer_count
                        ) || 1,
                        crossSectionType: sourceBundle?.sourceTextureSet?.cross_section_type
                            || sourceTexture?.cross_section_type
                            || sourceRootTexture?.cross_section_type
                            || 'waves',
                        sourceMetadata: buildTextureSourceMetadata(sourceRootTexture, sourceBundle.sourceTextureSet),
                        tiles: sourceBundle.tileEntries.map((tileEntry) => ({
                            index: tileEntry.index,
                            blob: tileEntry.blob,
                        })),
                        thumbnailBlob,
                        onProgress: (_step, detail) => {
                            copyProgress.value = `${progressPrefix}: ${detail}`;
                        }
                    };

                    const result = destination === 'google-drive'
                        ? await uploadTextureSet(uploadOptions)
                        : await uploadTextureSetToR2(uploadOptions);

                    if (isRootUpload) {
                        destinationRootId = result.textureSetId;
                    }

                    successfulEntries.push({
                        ...entry,
                        sourceTexture,
                        sourceTextureSet: sourceBundle.sourceTextureSet,
                        sourceBlobs: buildTileBlobMap(sourceBundle.tileEntries),
                        destinationTextureSetId: result.textureSetId,
                    });
                } catch (err) {
                    console.error('[TextureBrowser] Copy variant failed:', {
                        variantId: entry.id,
                        resolution: entry.resolution,
                        error: err,
                    });
                    failedEntries.push({ entry, error: err });

                    if (isRootUpload) {
                        break;
                    }
                }
            }

            if (!failedEntries.length && isLocalTexture(sourceRootTexture) && destinationRootId) {
                const successfulResolutions = successfulEntries
                    .map((entry) => Number(entry?.resolution ?? entry?.sourceTexture?.tile_resolution))
                    .filter((resolution) => Number.isInteger(resolution) && resolution > 0)
                    .sort((left, right) => right - left);
                const variantSummaries = successfulEntries.map((entry) => ({
                    id: entry.destinationTextureSetId,
                    root_texture_id: destinationRootId,
                    parent_texture_set_id: entry.isRoot ? null : destinationRootId,
                    resolution: Number(entry?.resolution ?? entry?.sourceTexture?.tile_resolution) || null,
                    tile_resolution: Number(entry?.resolution ?? entry?.sourceTexture?.tile_resolution) || null,
                    storage_provider: destination,
                    status: 'complete',
                    created_at: Date.now(),
                    updated_at: Date.now(),
                    is_root: Boolean(entry.isRoot),
                }));
                const rootSummary = variantSummaries.find((summary) => summary.is_root) || null;

                if (rootSummary) {
                    await promoteTextureSetToCachedCloudTexture(sourceRootTexture.id, {
                        cloudTextureId: destinationRootId,
                        name: copiedTextureName,
                        description: copiedDescription,
                        rootTextureSetId: destinationRootId,
                        parentTextureSetId: null,
                        sourceMetadata: sourceRootTexture.source_metadata,
                        thumbnailDataUrl: sourceRootTexture.thumbnail_data_url || null,
                        variantSummaries,
                        availableResolutions: successfulResolutions,
                    });
                }

                for (const entry of successfulEntries.filter((candidate) => !candidate.isRoot)) {
                    const resolution = Number(entry?.resolution ?? entry?.sourceTexture?.tile_resolution) || null;
                    await cacheCloudTexture({
                        cloudTextureId: entry.destinationTextureSetId,
                        name: copiedTextureName,
                        description: copiedDescription,
                        tileCount: Object.keys(entry.sourceBlobs || {}).length,
                        tileResolution: resolution,
                        layerCount: Number(
                            entry?.sourceTextureSet?.layer_count
                            ?? entry?.sourceTexture?.layer_count
                            ?? sourceRootTexture?.layer_count
                        ) || 1,
                        crossSectionType: entry?.sourceTextureSet?.cross_section_type
                            || entry?.sourceTexture?.cross_section_type
                            || sourceRootTexture?.cross_section_type
                            || 'waves',
                        sourceMetadata: buildTextureSourceMetadata(sourceRootTexture, entry.sourceTextureSet),
                        thumbnailDataUrl: null,
                        ktx2Blobs: entry.sourceBlobs,
                        rootTextureSetId: destinationRootId,
                        parentTextureSetId: destinationRootId,
                        variantInfo: {
                            family_id: destinationRootId,
                            root_texture_set_id: destinationRootId,
                            parent_texture_set_id: destinationRootId,
                            source_resolution: sourceRootTexture?.tile_resolution,
                            target_resolution: resolution,
                            generated_at: Date.now(),
                            method: 'browser-copy-cloud-cache-v1',
                        },
                    });

                    await deleteLocalTextureSet(entry.sourceTexture.id);
                }

                cachedCloudIds.value = await getCachedCloudIds();
            }

            copyProgress.value = 'Refreshing...';
            await loadTextures();

            if (failedEntries.length > 0) {
                if (destinationRootId) {
                    copyRetryTargetRootId.value = destinationRootId;
                    copyPendingVariantIds.value = failedEntries
                        .map(({ entry }) => entry?.id)
                        .filter(Boolean);
                }

                const failedLabels = failedEntries
                    .map(({ entry }) => formatCopyVariantLabel(entry))
                    .join(', ');

                if (copyRetryTargetRootId.value && copyPendingVariantIds.value.length > 0) {
                    const copiedVariantCount = totalFamilyVariants - copyPendingVariantIds.value.length;
                    copyProgress.value = isRetryAttempt
                        ? `Retried ${successfulEntries.length} variant${successfulEntries.length === 1 ? '' : 's'} on ${getCopyDestinationLabel(destination)}.`
                        : `Copied ${copiedVariantCount} of ${totalFamilyVariants} variants to ${getCopyDestinationLabel(destination)}.`;
                    copyError.value = `Missing variants: ${failedLabels}. Successful copies were kept. Press Copy again to retry the missing variants.`;
                } else {
                    copyProgress.value = '';
                    copyError.value = failedEntries[0]?.error?.message || `Copy failed for ${failedLabels}.`;
                }

                return;
            }

            cancelCopy();

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
        resetCopyRetryState();
    }

    function clearDeriveResult() {
        deriveResult.value = null;
    }

    function startDeriveVariant(texture, event) {
        event.stopPropagation();

        clearDeriveResult();
        textureToDerive.value = texture;
        deriveTargetResolutions.value = getTargetResolutionOptions(texture);
        deriveProgress.value = '';
        deriveError.value = null;
    }

    async function performDeriveVariant() {
        if (!textureToDerive.value || deriveTargetResolutions.value.length === 0 || isDeriving.value) {
            return;
        }

        clearDeriveResult();
        isDeriving.value = true;
        deriveProgress.value = 'Preparing source texture...';
        deriveError.value = null;

        try {
            const sourceTexture = getFamilyRootTexture(textureToDerive.value);
            if (!sourceTexture || isLocalTexture(sourceTexture)) {
                throw new Error('Only published cloud textures can receive derived variants');
            }

            if (!isOwner(sourceTexture) && !isAdmin.value) {
                throw new Error('Only the owner or an admin can publish a new family variant');
            }

            const { deriveKtx2TextureFamily } = await loadDeriveModule();
            const sourceBundle = await fetchTextureSourceBundle(sourceTexture, (message) => {
                deriveProgress.value = message;
            });
            const targetResolutions = deriveTargetResolutions.value
                .map((value) => Number(value))
                .filter((value) => Number.isInteger(value) && value > 0);
            const variantName = buildPublishedVariantName(sourceTexture);
            const destination = sourceTexture.storage_provider === 'r2' ? 'r2' : 'google-drive';
            const publishLabel = destination === 'r2' ? 'R2' : 'Google Drive';
            const uploadVariant = destination === 'r2' ? uploadTextureSetToR2 : uploadTextureSet;

            const familyResult = await deriveKtx2TextureFamily({
                sourceTiles: sourceBundle.tileEntries,
                sourceResolution: Number(sourceTexture.tile_resolution ?? sourceBundle.sourceTextureSet?.tile_resolution) || null,
                targetResolutions,
                onProgress: (stage) => {
                    deriveProgress.value = formatDeriveProgress(stage);
                }
            });

            if (!isLocalTexture(textureToDerive.value) && sourceBundle.downloadedSourceBlobs) {
                cacheCloudTextureFromBlobs(sourceTexture, sourceBundle.sourceTextureSet, sourceBundle.downloadedSourceBlobs);
            }

            const publishedVariants = [];

            for (let variantIndex = 0; variantIndex < familyResult.variants.length; variantIndex++) {
                const variant = familyResult.variants[variantIndex];
                const targetResolution = Number(variant.targetResolution);
                const variantInfo = buildPublishedVariantInfo(sourceTexture, targetResolution);

                deriveProgress.value = `Uploading ${targetResolution}px variant (${variantIndex + 1}/${familyResult.variants.length}) to ${publishLabel}...`;
                const publishedVariant = await uploadVariant({
                    name: variantName,
                    tileCount: variant.result.output.tileCount,
                    tileResolution: variant.result.output.pixelWidth,
                    layerCount: variant.result.output.layerCount,
                    description: sourceTexture.description || null,
                    parentTextureSetId: sourceTexture.id,
                    progressLabelPrefix: `${targetResolution}px variant`,
                    crossSectionType: sourceBundle.sourceTextureSet?.cross_section_type
                        || sourceTexture.cross_section_type
                        || 'waves',
                    sourceMetadata: buildTextureSourceMetadata(sourceTexture, sourceBundle.sourceTextureSet),
                    tiles: Object.entries(variant.result.outputBlobs)
                        .map(([tileIndex, blob]) => ({
                            index: Number(tileIndex),
                            blob,
                        }))
                        .sort((left, right) => left.index - right.index),
                    thumbnailBlob: null,
                    onProgress: (_step, detail) => {
                        deriveProgress.value = detail || `Uploading ${targetResolution}px variant (${variantIndex + 1}/${familyResult.variants.length}) to ${publishLabel}...`;
                    }
                });

                await cacheCloudTexture({
                    cloudTextureId: publishedVariant.textureSetId,
                    name: variantName,
                    description: sourceTexture.description || '',
                    tileCount: variant.result.output.tileCount,
                    tileResolution: variant.result.output.pixelWidth,
                    layerCount: variant.result.output.layerCount,
                    crossSectionType: sourceBundle.sourceTextureSet?.cross_section_type
                        || sourceTexture.cross_section_type
                        || 'waves',
                    sourceMetadata: buildTextureSourceMetadata(sourceTexture, sourceBundle.sourceTextureSet),
                    thumbnailDataUrl: null,
                    ktx2Blobs: variant.result.outputBlobs,
                    rootTextureSetId: sourceTexture.id,
                    parentTextureSetId: sourceTexture.id,
                    variantInfo,
                });

                publishedVariants.push({
                    resolution: variant.result.output.pixelWidth,
                    textureSetId: publishedVariant.textureSetId,
                    output: variant.result.output,
                    timings: variant.result.timings,
                    encodeConfig: variant.result.encodeConfig,
                    validation: variant.result.validation,
                });
            }

            activeTab.value = 'my-cloud';
            await loadTextures();

            deriveResult.value = {
                source: familyResult.variants[0]?.result?.source || null,
                output: {
                    totalByteLength: publishedVariants.reduce((total, variant) => total + (variant.output?.totalByteLength || 0), 0),
                },
                timings: {
                    totalDurationMs: familyResult.timings.totalDurationMs,
                    encodeDurationMs: publishedVariants.reduce((total, variant) => total + (variant.timings?.encodeDurationMs || 0), 0),
                },
                encodeConfig: publishedVariants[0]?.encodeConfig || null,
                validation: {
                    viewerCompatibleShape: publishedVariants.every((variant) => variant.validation?.viewerCompatibleShape),
                },
                sourceFetchOrigin: sourceBundle.fetchedFrom,
                savedTextureName: variantName,
                rootTextureSetId: sourceTexture.id,
                publishedDestination: publishLabel,
                publishedVariants,
                publishedResolutions: publishedVariants.map((variant) => variant.resolution),
            };

            deriveProgress.value = `Published ${publishedVariants.map((variant) => `${variant.resolution}px`).join(', ')} to ${publishLabel}.`;
        } catch (err) {
            console.error('[TextureBrowser] Cloud variant derivation failed:', err);
            deriveError.value = err.message || 'Variant derivation failed';
        } finally {
            isDeriving.value = false;
        }
    }

    function cancelDeriveVariant() {
        if (isDeriving.value) {
            return;
        }

        clearDeriveResult();
        textureToDerive.value = null;
        deriveTargetResolutions.value = [];
        deriveProgress.value = '';
        deriveError.value = null;
    }

    // Edit functionality
    function startEdit(texture, event) {
        event.stopPropagation();
        const actionTexture = getFamilyActionTexture(texture);
        textureToEdit.value = actionTexture;
        editName.value = getTextureFamilyDisplayName(texture);
        editDescription.value = actionTexture?.description || '';
        editError.value = null;
        editTextureIds.value = getFamilyMemberIds(texture);
        editVariantCount.value = getFamilyVariantCount(texture);
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
            const newDescription = editDescription.value.trim();
            const isLocal = isLocalTexture(texture);

            if (isLocal) {
                const targetIds = editTextureIds.value.length > 0
                    ? [...new Set(editTextureIds.value)]
                    : [texture.id];

                await Promise.all(targetIds.map((textureId) => updateLocalTextureSet(textureId, {
                    name: newName,
                    description: newDescription,
                })));
            } else {
                await updateTextureSet(texture.id, {
                    name: newName,
                    description: newDescription || null,
                });

                const targetIds = editTextureIds.value.length > 0
                    ? [...new Set(editTextureIds.value)]
                    : [texture.id];
                await Promise.all(targetIds.map(async (cloudTextureId) => {
                    const cachedLocalId = await getCachedLocalId(cloudTextureId);
                    if (!cachedLocalId) {
                        return;
                    }

                    await updateLocalTextureSet(cachedLocalId, {
                        name: newName,
                        description: newDescription,
                    });
                }));
            }

            const activeTextureId = app.currentTextureId;
            const editedFamilyIds = editTextureIds.value.length > 0
                ? editTextureIds.value
                : [texture.id];
            if (activeTextureId && editedFamilyIds.includes(activeTextureId)) {
                app.setCurrentTextureMetadata({
                    id: activeTextureId,
                    name: newName,
                    description: newDescription,
                });
            }

            await loadTextures();
            cancelEdit();
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
        editDescription.value = '';
        editError.value = null;
        editTextureIds.value = [];
        editVariantCount.value = 1;
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
    const previewViewerRef = ref(null);
    const previewCanApply = computed(() => Boolean(previewTexture.value));
    const deriveValidationStatus = computed(() => {
        const viewerCompatible = Boolean(deriveResult.value?.validation?.viewerCompatibleShape);

        return {
            className: viewerCompatible ? 'derive-status-ok' : 'derive-status-bad',
            label: viewerCompatible ? 'Viewer-compatible' : 'Validation failed'
        };
    });
    const hasDeriveCompleted = computed(() => Boolean(deriveResult.value));
    const deriveTargetOptions = computed(() => {
        if (!textureToDerive.value) {
            return [];
        }

        return getTargetResolutionOptions(textureToDerive.value).map((resolution) => ({
            label: `${resolution} px`,
            value: resolution,
        }));
    });
    const deriveModalTitle = computed(() => {
        if (hasDeriveCompleted.value) {
            return deriveResult.value?.publishedVariants?.length > 1
                ? 'Variants Published'
                : 'Variant Published';
        }

        return deriveTargetResolutions.value.length > 1
            ? 'Publish Lower-Resolution Variants'
            : 'Publish Lower-Resolution Variant';
    });
    const deriveSelectionSummary = computed(() => {
        if (deriveTargetResolutions.value.length === 0) {
            return 'Choose one or more lower power-of-two resolutions to publish into the existing cloud family.';
        }

        return `Publish ${deriveTargetResolutions.value.map((resolution) => `${resolution}px`).join(', ')} into the existing cloud family.`;
    });
    const derivePrimaryActionLabel = computed(() => {
        if (isDeriving.value) {
            return 'Publishing...';
        }

        return deriveTargetResolutions.value.length > 1 ? 'Publish Variants' : 'Publish Variant';
    });
    const isEditingFamilyName = computed(() => editVariantCount.value > 1);
    const copyTotalVariantCount = computed(() => getFamilyVariantCount(textureToCopy.value));
    const isCopyRetryPending = computed(() => Boolean(copyRetryTargetRootId.value) && copyPendingVariantIds.value.length > 0);
    const copyAttemptVariantCount = computed(() => {
        if (!textureToCopy.value) {
            return 0;
        }

        return isCopyRetryPending.value
            ? getFamilyVariantCount(textureToCopy.value, { variantIds: copyPendingVariantIds.value })
            : copyTotalVariantCount.value;
    });
    const isCopyingFamily = computed(() => copyTotalVariantCount.value > 1);
    const copyDestinationLabel = computed(() => getCopyDestinationLabel(copyDestination.value));
    const copyTextureDisplayName = computed(() => {
        return textureToCopy.value ? getTextureFamilyDisplayName(textureToCopy.value) : 'Texture';
    });
    const copyModalTitle = computed(() => {
        return isCopyingFamily.value ? 'Copy Texture Family' : 'Copy Texture';
    });
    const copyModalMessage = computed(() => {
        if (!textureToCopy.value || !copyDestination.value) {
            return '';
        }

        if (isCopyRetryPending.value) {
            const pendingCount = copyAttemptVariantCount.value;
            return `Retry the ${pendingCount} missing variant${pendingCount === 1 ? '' : 's'} for "${copyTextureDisplayName.value}" on ${copyDestinationLabel.value}?`;
        }

        if (isCopyingFamily.value) {
            return `Copy "${copyTextureDisplayName.value}" with all ${copyTotalVariantCount.value} resolutions to ${copyDestinationLabel.value}?`;
        }

        return `Copy "${copyTextureDisplayName.value}" to ${copyDestinationLabel.value}?`;
    });
    const copyModalHelper = computed(() => {
        if (isCopyRetryPending.value) {
            return 'Only the missing variants will be retried. Successful copies remain in the destination.';
        }

        if (isCopyingFamily.value) {
            return 'The canonical source root uploads first, then the remaining variants follow in descending resolution order.';
        }

        return null;
    });
    const copyPrimaryActionLabel = computed(() => {
        if (isCopying.value) {
            return 'Copying...';
        }

        if (isCopyRetryPending.value) {
            return 'Retry Missing Variants';
        }

        return isCopyingFamily.value ? 'Copy Family' : 'Copy';
    });
    const editModalTitle = computed(() => {
        return isEditingFamilyName.value ? 'Edit Family Metadata' : 'Edit Texture Metadata';
    });

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
                description: textureSet.description ?? texture.description ?? '',
                tileCount: textureSet.tile_count ?? Object.keys(blobs).length,
                tileResolution: textureSet.tile_resolution ?? texture.tile_resolution,
                layerCount: textureSet.layer_count ?? texture.layer_count,
                crossSectionType: textureSet.cross_section_type ?? texture.cross_section_type ?? 'waves',
                sourceMetadata: textureSet.source_metadata ?? texture.source_metadata,
                thumbnailDataUrl,
                ktx2Blobs: blobs,
                rootTextureSetId: textureSet.root_texture_id || texture.root_texture_id || texture.id,
                parentTextureSetId: textureSet.parent_texture_set_id || texture.parent_texture_set_id || null,
                variantInfo: textureSet.variant_info || texture.variant_info || null,
                variantSummaries: textureSet.variant_summaries || texture.variant_summaries || null,
                availableResolutions: textureSet.available_resolutions || texture.available_resolutions || null,
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

    watch(() => deriveTargetResolutions.value.join(','), (nextValue, previousValue) => {
        if (nextValue !== previousValue && deriveResult.value) {
            clearDeriveResult();
            deriveProgress.value = '';
        }
    });

    onBeforeUnmount(() => {
        // Clean up preview blob URLs if component unmounts
        Object.values(previewBlobURLs.value).forEach(url => URL.revokeObjectURL(url));
        clearDeriveResult();
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
                            Drafts
                        </button>
                        <button
                            v-if="isAuthenticated"
                            :class="['tab-button', { active: activeTab === 'my-cloud' }]"
                            @click="activeTab = 'my-cloud'"
                        >
                            My Published
                        </button>
                        <button
                            :class="['tab-button', { active: activeTab === 'public' }]"
                            @click="activeTab = 'public'"
                        >
                            Published
                        </button>
                        <button
                            v-if="cachedCloudIds.size > 0"
                            :class="['tab-button', { active: activeTab === 'cached' }]"
                            @click="activeTab = 'cached'"
                        >
                            Cloud Cache
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
                        No draft textures yet.
                        <a
                            href="/slyce"
                            class="slyce-link"
                        >Create one in Create Texture</a>
                    </template>
                    <template v-else-if="activeTab === 'my-cloud'">
                        You haven't published any textures yet.
                        <a
                            href="/slyce"
                            class="slyce-link"
                        >Create one in Create Texture</a>
                    </template>
                    <template v-else-if="activeTab === 'cached'">
                        No cached cloud textures yet. Preview or apply a published texture to cache it locally.
                    </template>
                    <template v-else-if="activeTab === 'public'">
                        No published textures available yet.
                    </template>
                    <template v-else>
                        No draft or published textures available yet.
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
                            'is-multi-selectable': multiSelectMode,
                            'local-texture-card': isLocalTexture(texture),
                            'selected-card': multiSelectMode && isTextureSelected(texture)
                        }"
                        :role="multiSelectMode ? 'button' : undefined"
                        :tabindex="multiSelectMode ? 0 : undefined"
                        @click="handleCardClick(texture, $event)"
                        @keydown.enter="multiSelectMode ? handleCardClick(texture, $event) : null"
                        @keydown.space.prevent="multiSelectMode ? handleCardClick(texture, $event) : null"
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
                                <span>{{ texture.cross_section_type || 'waves' }}</span>
                                <span>{{ texture.layer_count }} layers</span>
                            </div>

                            <div
                                v-if="getFamilyVariantOptions(texture).length > 0"
                                class="texture-card-variant-controls"
                                @click.stop
                            >
                                <select
                                    class="texture-variant-select"
                                    :value="getSelectedFamilyVariantId(texture)"
                                    aria-label="Choose texture resolution"
                                    @change="handleFamilyVariantChange(texture, $event)"
                                    @click.stop
                                >
                                    <option
                                        v-for="option in getFamilyVariantOptions(texture)"
                                        :key="option.id"
                                        :value="option.id"
                                    >
                                        {{ option.label }}
                                    </option>
                                </select>

                                <button
                                    v-if="!multiSelectMode"
                                    type="button"
                                    class="texture-apply-button"
                                    @click="applyTextureSelection(texture, $event)"
                                >
                                    Apply
                                </button>
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

                            <!-- Description / caption -->
                            <p
                                v-if="texture.description"
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
                                    @click="openPreview(getFamilySelectionTexture(texture), $event)"
                                >
                                    <span class="material-symbols-outlined">play_circle</span>
                                </button>
                                <!-- Edit button (owner or admin) -->
                                <button
                                    v-if="isLocalTexture(texture) || isOwner(getFamilyActionTexture(texture)) || isAdmin"
                                    class="action-button edit-button"
                                    title="Edit metadata"
                                    @click="startEdit(texture, $event)"
                                >
                                    <span class="material-symbols-outlined">edit</span>
                                </button>
                                <!-- Copy button -->
                                <button
                                    v-if="canCopyTexture(texture)"
                                    class="action-button copy-button"
                                    title="Copy to another storage"
                                    @click="toggleCopyMenu(texture, $event)"
                                >
                                    <span class="material-symbols-outlined">content_copy</span>
                                </button>
                                <button
                                    v-if="canDeriveVariant(texture)"
                                    class="action-button derive-button"
                                    title="Publish lower-resolution variants"
                                    @click="startDeriveVariant(texture, $event)"
                                >
                                    <span class="material-symbols-outlined">resize</span>
                                </button>
                                <!-- Delete button (owner, admin, or local) -->
                                <button
                                    v-if="isLocalTexture(texture) || isOwner(getFamilyActionTexture(texture)) || isAdmin"
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
                <div class="preview-scroll-area">
                    <TileLinearViewer
                        ref="previewViewerRef"
                        v-if="Object.keys(previewBlobURLs).length > 0"
                        :ktx2BlobURLs="previewBlobURLs"
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
                <div
                    v-if="previewViewerRef?.tileCount > 0 || previewTexture?.tile_count"
                    class="preview-tile-info"
                >
                    <template v-if="previewViewerRef?.tileCount < previewTexture?.tile_count">
                        {{ previewViewerRef?.tileCount || 0 }} / {{ previewTexture.tile_count }} tiles
                    </template>
                    <template v-else>
                        {{ previewViewerRef?.tileCount || previewTexture?.tile_count }} tile{{
                            (previewViewerRef?.tileCount || previewTexture?.tile_count) > 1 ? 's' : '' }}
                    </template>
                    <span v-if="previewViewerRef?.displayScale < 1">({{ Math.round(previewViewerRef.displayScale * 100)
                    }}%
                        scale)</span>
                </div>
                <Button
                    v-if="previewCanApply"
                    type="button"
                    class="preview-apply-button"
                    severity="info"
                    title="Apply texture to ribbon"
                    @click="applyTextureSelection(previewTexture)"
                >
                    <span class="material-symbols-outlined">check</span>
                    Apply
                </Button>
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
                @click.self="cancelDelete"
            >
                <div class="delete-modal">
                    <h3>Delete {{ isLocalDelete ? 'Local' : 'Cloud' }} {{ isDeletingFamily ? 'Family' : 'Texture' }}
                    </h3>
                    <p>
                        Are you sure you want to delete "<strong>{{ textureToDelete.name }}</strong>"{{
                            isDeletingFamily ? ' and its linked variants' : '' }}?
                    </p>
                    <p class="delete-warning">
                        {{ isLocalDelete ?
                            (isDeletingFamily
                                ? 'This will remove every local resolution in this family from your browser storage.'
                                : 'This will remove the texture from your browser storage.') :
                            (isDeletingFamily
                                ? 'This will delete the root and all linked variants.'
                                : 'This action cannot be undone.')
                        }}
                    </p>
                    <div class="delete-modal-actions">
                        <button
                            class="cancel-button"
                            @click="cancelDelete"
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
                    <h3>{{ copyModalTitle }}</h3>
                    <p>{{ copyModalMessage }}</p>
                    <p
                        v-if="copyModalHelper"
                        class="copy-helper"
                    >
                        {{ copyModalHelper }}
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
                            {{ copyPrimaryActionLabel }}
                        </button>
                    </div>
                </div>
            </div>
        </Teleport>

        <!-- Publish variant modal -->
        <Teleport to="body">
            <div
                v-if="textureToDerive"
                class="delete-modal-overlay derive-modal-overlay"
                @click.self="cancelDeriveVariant"
            >
                <div class="delete-modal derive-modal">
                    <div class="derive-modal-header">
                        <div
                            v-if="hasDeriveCompleted"
                            class="derive-success-indicator"
                            aria-hidden="true"
                        >
                            <span class="derive-success-check">✓</span>
                        </div>
                        <h3>{{ deriveModalTitle }}</h3>
                    </div>
                    <p>
                        <template v-if="hasDeriveCompleted">
                            Published lower-resolution variant{{ deriveResult?.publishedVariants?.length > 1 ? 's' : ''
                            }} of
                        </template>
                        <template v-else>
                            Generate and publish one or more lower-resolution variants of
                        </template>
                        <strong>{{ textureToDerive.name }}</strong>.
                    </p>
                    <div
                        v-if="!hasDeriveCompleted"
                        class="derive-field"
                    >
                        <label
                            for="derive-target-resolutions"
                            class="derive-label"
                        >Target resolutions</label>
                        <MultiSelect
                            id="derive-target-resolutions"
                            v-model="deriveTargetResolutions"
                            :options="deriveTargetOptions"
                            optionLabel="label"
                            optionValue="value"
                            display="chip"
                            appendTo="self"
                            overlayClass="derive-multiselect-panel"
                            placeholder="Choose one or more resolutions"
                            selectedItemsLabel="{0} resolutions"
                            class="derive-multiselect"
                            :disabled="isDeriving || deriveTargetOptions.length === 0"
                        />
                    </div>

                    <p
                        v-if="!hasDeriveCompleted"
                        class="derive-note"
                    >
                        {{ deriveSelectionSummary }}
                    </p>

                    <p
                        v-if="!hasDeriveCompleted && deriveTargetOptions.length === 0"
                        class="derive-note"
                    >
                        No lower power-of-two target resolutions are available for this texture.
                    </p>

                    <p
                        v-if="deriveProgress"
                        class="copy-progress derive-progress"
                    >
                        {{ deriveProgress }}
                    </p>
                    <p
                        v-if="deriveError"
                        class="copy-error"
                    >
                        Error: {{ deriveError }}
                    </p>

                    <details
                        v-if="deriveResult"
                        class="derive-result-details"
                    >
                        <summary class="derive-result-summary">Details</summary>
                        <div class="derive-result">
                            <div class="derive-result-row">
                                <span>Published family</span>
                                <strong>{{ deriveResult.savedTextureName }}</strong>
                            </div>
                            <div class="derive-result-row">
                                <span>Published resolutions</span>
                                <strong>
                                    {{deriveResult.publishedResolutions.map((res) => `${res}px`).join(', ')}}
                                </strong>
                            </div>
                            <div class="derive-result-row">
                                <span>Destination</span>
                                <strong>{{ deriveResult.publishedDestination }}</strong>
                            </div>
                            <div class="derive-result-row">
                                <span>Source tiles</span>
                                <strong>{{ deriveResult.source.tileCount }} ({{ deriveResult.sourceFetchOrigin
                                    }})</strong>
                            </div>
                            <div class="derive-result-row">
                                <span>Layer count</span>
                                <strong>{{ deriveResult.source.layerCount }}</strong>
                            </div>
                            <div class="derive-result-row">
                                <span>Combined output size</span>
                                <strong>{{ formatSize(deriveResult.output.totalByteLength) ||
                                    (deriveResult.output.totalByteLength +
                                        ' bytes') }}</strong>
                            </div>
                            <div class="derive-result-row">
                                <span>Total time</span>
                                <strong>{{ formatDurationMs(deriveResult.timings.totalDurationMs) }}</strong>
                            </div>
                            <div class="derive-result-row">
                                <span>Encode time</span>
                                <strong>{{ formatDurationMs(deriveResult.timings.encodeDurationMs) }}</strong>
                            </div>
                            <div class="derive-result-row">
                                <span>Encoder workers</span>
                                <strong>{{ deriveResult.encodeConfig?.workerCount ?? 'n/a' }}</strong>
                            </div>
                            <div class="derive-result-row">
                                <span>Lineage root</span>
                                <strong>{{ deriveResult.rootTextureSetId }}</strong>
                            </div>
                            <div class="derive-result-row">
                                <span>Published variants</span>
                                <strong>{{ deriveResult.publishedVariants.length }}</strong>
                            </div>
                            <div
                                v-for="variant in deriveResult.publishedVariants"
                                :key="variant.textureSetId"
                                class="derive-result-row"
                            >
                                <span>{{ variant.resolution }}px ID</span>
                                <strong>{{ variant.textureSetId }}</strong>
                            </div>
                            <div class="derive-result-row">
                                <span>Validation</span>
                                <strong :class="deriveValidationStatus.className">{{ deriveValidationStatus.label
                                    }}</strong>
                            </div>
                        </div>
                    </details>

                    <div class="delete-modal-actions derive-modal-actions">
                        <button
                            class="cancel-button"
                            @click="cancelDeriveVariant"
                            :disabled="isDeriving"
                        >
                            {{ hasDeriveCompleted ? 'Done' : 'Cancel' }}
                        </button>
                        <button
                            v-if="!hasDeriveCompleted"
                            class="confirm-copy-button derive-run-button"
                            @click="performDeriveVariant"
                            :disabled="isDeriving || deriveTargetResolutions.length === 0 || deriveTargetOptions.length === 0"
                        >
                            {{ derivePrimaryActionLabel }}
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

        <!-- Edit metadata modal -->
        <Teleport to="body">
            <div
                v-if="textureToEdit"
                class="delete-modal-overlay edit-modal-overlay"
                @click.self="cancelEdit"
            >
                <div class="delete-modal edit-modal">
                    <h3>{{ editModalTitle }}</h3>
                    <p v-if="isEditingFamilyName">
                        This updates the title and caption for the root and every linked variant in the family.
                    </p>
                    <div class="edit-input-container">
                        <label
                            class="edit-field-label"
                            for="editTextureName"
                        >Title</label>
                        <input
                            v-model="editName"
                            id="editTextureName"
                            type="text"
                            class="edit-name-input"
                            placeholder="Texture title"
                            @keydown.enter="performEdit"
                            @keydown.escape="cancelEdit"
                            autofocus
                        />
                    </div>
                    <div class="edit-input-container">
                        <label
                            class="edit-field-label"
                            for="editTextureDescription"
                        >Description / caption</label>
                        <textarea
                            v-model="editDescription"
                            id="editTextureDescription"
                            rows="4"
                            class="edit-description-input"
                            placeholder="Optional caption shown when the viewer overlay is enabled"
                            @keydown.escape="cancelEdit"
                        ></textarea>
                        <p class="edit-field-hint">Optional. This text can be surfaced as a viewer overlay.</p>
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
        cursor: default;
        transition: all 0.2s;
        border: 2px solid transparent;
    }

    .texture-card.is-multi-selectable {
        cursor: pointer;
    }

    .texture-card:hover {
        border-color: #4caf50;
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
    }

    .texture-card:not(.is-multi-selectable):hover {
        transform: none;
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

    .texture-card-variant-controls {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-top: 10px;
    }

    .texture-variant-select {
        flex: 1;
        min-width: 0;
        padding: 8px 10px;
        background: #1f1f1f;
        border: 1px solid #4b5563;
        color: #f8fafc;
        font-size: 12px;
        border-radius: 6px;
        outline: none;
    }

    .texture-variant-select:focus {
        border-color: #60a5fa;
    }

    .texture-apply-button {
        border: none;
        border-radius: 6px;
        padding: 8px 12px;
        background: #60a5fa;
        color: #0f172a;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        transition: background 0.2s ease, transform 0.2s ease;
        flex-shrink: 0;
    }

    .texture-apply-button:hover {
        background: #93c5fd;
    }

    .texture-apply-button:active {
        transform: translateY(1px);
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

    .texture-card-lineage {
        margin: 8px 0 0 0;
        color: #fbbf24;
        font-size: 11px;
        line-height: 1.4;
    }

    .texture-card-resolutions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
    }

    .texture-resolution-badge {
        background: #333;
        color: #cbd5e1;
        font-size: 11px;
        padding: 3px 8px;
        border-radius: 999px;
        border: 1px solid transparent;
    }

    .texture-resolution-badge.active {
        background: rgba(76, 175, 80, 0.14);
        border-color: rgba(76, 175, 80, 0.45);
        color: #86efac;
    }

    .texture-card-resolution-status {
        margin: 8px 0 0 0;
        color: #93c5fd;
        font-size: 11px;
        line-height: 1.4;
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

    .action-button.derive-button {
        background: rgba(245, 158, 11, 0.9);
    }

    .action-button.derive-button:hover {
        background: #f59e0b;
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

    .derive-modal {
        max-width: 460px;
    }

    .derive-modal-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
    }

    .derive-modal-header h3 {
        margin: 0;
    }

    .derive-success-indicator {
        width: 28px;
        height: 28px;
        border-radius: 999px;
        background: #16a34a;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.18);
    }

    .derive-success-check {
        color: #f0fdf4;
        font-size: 16px;
        font-weight: 700;
        line-height: 1;
    }

    .derive-helper,
    .derive-note {
        color: #9ca3af;
        font-size: 13px;
        line-height: 1.5;
    }

    .derive-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 16px;
    }

    .derive-label {
        color: #d1d5db;
        font-size: 13px;
        font-weight: 600;
    }

    .derive-multiselect {
        width: 100%;
    }

    .derive-multiselect-panel {
        z-index: 1;
    }

    .derive-result-details {
        margin-top: 16px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.02);
        overflow: hidden;
    }

    .derive-result-summary {
        cursor: pointer;
        padding: 12px;
        color: #d1d5db;
        font-size: 13px;
        font-weight: 600;
        list-style: none;
        user-select: none;
    }

    .derive-result-summary::-webkit-details-marker {
        display: none;
    }

    .derive-result-summary::before {
        content: '▸';
        display: inline-block;
        margin-right: 8px;
        color: #9ca3af;
        transition: transform 0.2s ease;
    }

    .derive-result-details[open] .derive-result-summary::before {
        transform: rotate(90deg);
    }

    .derive-result {
        padding: 0 12px 12px;
        background: rgba(255, 255, 255, 0.04);
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .derive-result-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        color: #d1d5db;
        font-size: 13px;
    }

    .derive-result-row span {
        color: #9ca3af;
    }

    .derive-result-row strong {
        color: #fff;
        text-align: right;
        word-break: break-word;
    }

    .derive-status-ok {
        color: #4ade80 !important;
    }

    .derive-status-bad {
        color: #f87171 !important;
    }

    .derive-modal-actions {
        flex-wrap: wrap;
    }

    .derive-run-button {
        min-width: 120px;
    }

    /* Edit modal styles */
    .edit-modal-overlay {
        background: rgba(0, 0, 0, 0.7);
    }

    .edit-modal {
        max-width: 480px;
    }

    .edit-input-container {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 16px 0 0;
    }

    .edit-field-label {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: #cbd5e1;
    }

    .edit-name-input,
    .edit-description-input {
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

    .edit-description-input {
        min-height: 96px;
        resize: vertical;
        line-height: 1.5;
    }

    .edit-name-input:focus,
    .edit-description-input:focus {
        border-color: #22c55e;
    }

    .edit-name-input::placeholder,
    .edit-description-input::placeholder {
        color: #888;
    }

    .edit-field-hint {
        margin: 0;
        color: #94a3b8;
        font-size: 12px;
        line-height: 1.45;
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
        position: relative;
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .preview-scroll-area {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: safe center;
        overflow: overlay;
        padding: 1rem;
    }

    .preview-scroll-area>* {
        margin-block: auto;
    }

    .preview-tile-info {
        position: absolute;
        top: 0.5rem;
        left: 50%;
        transform: translateX(-50%);
        font-size: 12px;
        color: rgba(255, 255, 255, 0.5);
        background: rgba(0, 0, 0, 0.5);
        padding: 4px 8px;
        border-radius: 4px;
        pointer-events: none;
        z-index: 2;
    }

    .preview-apply-button {
        position: absolute;
        bottom: 1rem;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: auto;
        z-index: 2;
    }

    .preview-apply-button .material-symbols-outlined {
        font-size: 1.1rem;
        margin-right: 0.3rem;
    }

    /* Hide built-in tile-info inside preview (replaced by fixed overlay) */
    .texture-preview-panel :deep(.tile-info) {
        display: none;
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
