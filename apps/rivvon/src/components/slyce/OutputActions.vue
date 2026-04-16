<template>
    <div class="output-actions-stack">
        <template v-if="!app.uploadToCloud">
            <LocalSaveStatus
                :is-saving-locally="app.isSavingLocally"
                :save-local-progress="app.saveLocalProgress"
                :save-local-error="app.saveLocalError"
                :saved-local-texture-id="app.savedLocalTextureId"
                saving-detail="The finished root texture is being persisted to browser storage as a draft."
                success-title="Saved draft locally."
                success-detail="Apply the draft now or open the browser to manage it later."
                :show-pending="true"
                @retry="retrySaveLocally"
            >
                <template #success-actions>
                    <Button
                        type="button"
                        @click="applyTexture"
                        class="apply-texture-btn"
                        severity="success"
                    >
                        <span class="material-symbols-outlined">check</span>
                        Apply Draft
                    </Button>

                    <Button
                        type="button"
                        @click="openTextureBrowser"
                        class="view-local-btn"
                        severity="secondary"
                        variant="outlined"
                    >
                        <span class="material-symbols-outlined">folder</span>
                        Drafts
                    </Button>
                </template>
            </LocalSaveStatus>

            <p
                v-if="app.saveLocalNotice"
                class="local-save-note"
            >
                {{ app.saveLocalNotice }}
            </p>
        </template>

        <template v-else>
            <section
                class="publish-status"
                :class="`is-${publishState}`"
            >
                <div class="publish-icon-wrap">
                    <svg
                        v-if="publishState === 'publishing'"
                        class="publish-spinner"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                    >
                        <circle
                            class="spinner-track"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            stroke-width="4"
                        ></circle>
                        <path
                            class="spinner-head"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v8H4z"
                        ></path>
                    </svg>

                    <span
                        v-else-if="publishState === 'error'"
                        class="material-symbols-outlined publish-icon error"
                    >error</span>

                    <span
                        v-else-if="publishState === 'success'"
                        class="material-symbols-outlined publish-icon success"
                    >cloud_done</span>

                    <span
                        v-else
                        class="material-symbols-outlined publish-icon pending"
                    >schedule</span>
                </div>

                <div class="publish-copy">
                    <p class="publish-title">{{ publishTitle }}</p>
                    <p class="publish-detail">{{ publishDetail }}</p>
                </div>

                <div
                    v-if="showPublishActions"
                    class="publish-actions"
                >
                    <Button
                        v-if="publishState === 'error' && !isAuthenticated"
                        type="button"
                        severity="secondary"
                        variant="outlined"
                        @click="login"
                    >
                        <span class="material-symbols-outlined">login</span>
                        Sign In
                    </Button>

                    <Button
                        v-if="publishState === 'error'"
                        type="button"
                        @click="retryPublishFamily"
                    >
                        <span class="material-symbols-outlined">refresh</span>
                        Retry Publish
                    </Button>

                    <Button
                        v-if="publishState === 'success'"
                        type="button"
                        @click="applyTexture"
                        class="apply-texture-btn"
                        severity="success"
                    >
                        <span class="material-symbols-outlined">check</span>
                        Apply Published
                    </Button>

                    <Button
                        v-if="publishState === 'success' || app.publishLocalDraftId"
                        type="button"
                        @click="openTextureBrowser"
                        class="view-local-btn"
                        severity="secondary"
                        variant="outlined"
                    >
                        <span class="material-symbols-outlined">folder</span>
                        {{ publishBrowserLabel }}
                    </Button>
                </div>
            </section>

            <p
                v-if="app.publishNotice"
                class="publish-note"
            >
                {{ app.publishNotice }}
            </p>
        </template>
    </div>
</template>

<script setup>
    import { computed, onMounted } from 'vue';
    import Button from 'primevue/button';
    import LocalSaveStatus from './LocalSaveStatus.vue';
    import { useRoute, useRouter } from 'vue-router';
    import { useSlyceStore } from '../../stores/slyceStore';
    import { useViewerStore } from '../../stores/viewerStore';
    import { useGoogleAuth } from '../../composables/shared/useGoogleAuth.js';
    import { useRivvonAPI } from '../../services/api.js';
    import { useLocalStorage } from '../../services/localStorage.js';
    import { buildFileTextureSaveSource, saveProcessedTextureSetLocally } from '../../modules/slyce/localTexturePersistence.js';
    import { normalizeTextureVariantTargetResolutions } from '../../modules/slyce/textureFamilyPlanning.js';

    const app = useSlyceStore();
    const viewerStore = useViewerStore();
    const router = useRouter();
    const route = useRoute();
    const { isAuthenticated, login } = useGoogleAuth();
    const { uploadTextureSet, uploadTextureSetToR2 } = useRivvonAPI();
    const {
        saveTextureSet,
        cacheCloudTexture,
        promoteTextureSetToCachedCloudTexture,
    } = useLocalStorage();

    const emit = defineEmits(['apply-texture']);

    const publishDestinationLabel = computed(() => app.publishDestination === 'r2' ? 'R2' : 'Google Drive');
    const publishedFamilyCount = computed(() => {
        if (Array.isArray(app.publishedCloudTextureFamilyIds) && app.publishedCloudTextureFamilyIds.length > 0) {
            return app.publishedCloudTextureFamilyIds.length;
        }

        return app.publishedCloudRootId ? 1 : 0;
    });
    const publishPendingLabel = computed(() => {
        if (!Array.isArray(app.publishPendingResolutions) || app.publishPendingResolutions.length === 0) {
            return '';
        }

        return app.publishPendingResolutions.map((resolution) => `${resolution}px`).join(', ');
    });
    const publishState = computed(() => {
        if (app.isPublishingToCloud) {
            return 'publishing';
        }

        if (app.publishError) {
            return 'error';
        }

        if (app.publishedCloudRootId) {
            return 'success';
        }

        return 'pending';
    });
    const publishTitle = computed(() => {
        switch (publishState.value) {
            case 'publishing':
                return app.publishProgress || `Publishing to ${publishDestinationLabel.value}...`;
            case 'error':
                return `Cloud publish failed: ${app.publishError}`;
            case 'success':
                return `Published to ${publishDestinationLabel.value}.`;
            default:
                return `Preparing cloud publish for ${publishDestinationLabel.value}...`;
        }
    });
    const publishDetail = computed(() => {
        switch (publishState.value) {
            case 'publishing':
                return 'The root is uploaded first. Any selected lower-resolution variants are derived locally, uploaded into the same family, and cached without a re-download.';
            case 'error':
                if (app.publishedCloudRootId) {
                    return app.publishPendingResolutions.length > 0
                        ? `The root is already live. Retry the remaining variants: ${publishPendingLabel.value}.`
                        : 'The root is already live, but the publish job did not finish cleanly.';
                }

                return 'The root draft was retained locally so you can retry publishing or manage it from Drafts.';
            case 'success': {
                const memberCount = publishedFamilyCount.value;
                return memberCount > 1
                    ? `Published ${memberCount} family members and cached the published root locally for immediate use.`
                    : 'Published the root texture and cached it locally for immediate use.';
            }
            default:
                return 'The encoded root texture is ready for upload.';
        }
    });
    const showPublishActions = computed(() => publishState.value === 'error' || publishState.value === 'success');
    const publishBrowserLabel = computed(() => app.publishedCloudRootId ? 'My Published' : 'Drafts');

    function getDefaultTextureName(fileInfo) {
        return fileInfo?.name?.replace(/\.[^.]+$/, '') || 'texture';
    }

    async function blobToDataUrl(blob) {
        if (!blob) {
            return null;
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error('Failed to read thumbnail blob'));
            reader.readAsDataURL(blob);
        });
    }

    async function collectKtx2BlobsFromUrls(blobUrls = {}) {
        const ktx2Blobs = {};

        for (const [tileIndex, blobUrl] of Object.entries(blobUrls)) {
            const response = await fetch(blobUrl);
            if (!response.ok) {
                throw new Error(`Failed to load generated tile ${tileIndex}`);
            }

            ktx2Blobs[tileIndex] = await response.blob();
        }

        return ktx2Blobs;
    }

    function buildUploadTilesFromBlobs(ktx2Blobs = {}) {
        return Object.entries(ktx2Blobs)
            .map(([tileIndex, blob]) => ({
                index: Number(tileIndex),
                blob,
            }))
            .sort((left, right) => left.index - right.index);
    }

    function buildSourceTilesFromBlobs(ktx2Blobs = {}) {
        return Object.entries(ktx2Blobs)
            .map(([tileIndex, blob]) => ({
                tileIndex: Number(tileIndex),
                source: blob,
                label: `tile-${tileIndex}`,
            }))
            .sort((left, right) => left.tileIndex - right.tileIndex);
    }

    function getEffectiveFrameCount(source = {}) {
        const framesToSample = Number(source.framesToSample) || 0;
        const frameCount = Number(source.frameCount) || 0;
        return framesToSample > 0 ? Math.min(framesToSample, frameCount) : frameCount;
    }

    function buildSourceMetadata(source = {}, effectiveFrameCount) {
        return source.sourceMetadata || {
            filename: source.fileInfo?.name,
            width: source.fileInfo?.width,
            height: source.fileInfo?.height,
            duration: source.fileInfo?.duration,
            sourceFrameCount: effectiveFrameCount,
            frame_count: effectiveFrameCount,
        };
    }

    function buildVariantSummary(id, resolution, rootTextureSetId, parentTextureSetId = null) {
        const timestamp = Date.now();
        return {
            id,
            root_texture_id: rootTextureSetId,
            parent_texture_set_id: parentTextureSetId,
            resolution,
            tile_resolution: resolution,
            storage_provider: app.publishDestination,
            status: 'complete',
            created_at: timestamp,
            updated_at: timestamp,
            is_root: id === rootTextureSetId,
        };
    }

    function buildPublishVariantProgress(stage) {
        if (stage?.stage === 'variant-start' || stage?.stage === 'variant-progress') {
            switch (stage?.nestedStage) {
                case 'decode-layer':
                    return `Preparing ${stage.targetResolution}px variant: decoding layer ${stage.layerIndex + 1}/${stage.layerCount} for tile ${stage.tileNumber}/${stage.tileCount}...`;
                case 'layer-complete':
                    return `Preparing ${stage.targetResolution}px variant: scaled layer ${stage.layerIndex + 1}/${stage.layerCount} for tile ${stage.tileNumber}/${stage.tileCount}...`;
                case 'encode':
                    return `Preparing ${stage.targetResolution}px variant: encoding tile ${stage.tileNumber}/${stage.tileCount}...`;
                case 'encode-progress':
                    return `Preparing ${stage.targetResolution}px variant: encoding layer ${stage.completed}/${stage.total} for tile ${stage.tileNumber}/${stage.tileCount}...`;
                case 'tile-complete':
                    return `Prepared ${stage.targetResolution}px variant: finished tile ${stage.tileNumber}/${stage.tileCount}.`;
                default:
                    return `Preparing ${stage.targetResolution}px variant (${stage.variantNumber}/${stage.variantCount})...`;
            }
        }

        if (stage?.stage === 'variant-complete') {
            return `Prepared ${stage.targetResolution}px variant (${stage.variantNumber}/${stage.variantCount}).`;
        }

        return 'Preparing cloud variants...';
    }

    async function buildSourceBundle() {
        const source = buildFileTextureSaveSource(app);
        const effectiveFrameCount = getEffectiveFrameCount(source);
        const ktx2Blobs = await collectKtx2BlobsFromUrls(source.ktx2BlobURLs);
        const thumbnailBlob = source.thumbnailBlob || null;
        const thumbnailDataUrl = await blobToDataUrl(thumbnailBlob);
        const textureName = getDefaultTextureName(source.fileInfo);

        return {
            textureName,
            tileCount: Object.keys(ktx2Blobs).length,
            tileResolution: Number(source.tileResolution ?? source.potResolution ?? 512) || 512,
            layerCount: Number(source.crossSectionCount ?? 60) || 60,
            crossSectionType: source.crossSectionType || 'planes',
            sourceMetadata: buildSourceMetadata(source, effectiveFrameCount),
            thumbnailBlob,
            thumbnailDataUrl,
            ktx2Blobs,
        };
    }

    function getPublishUploader(destination) {
        return destination === 'r2' ? uploadTextureSetToR2 : uploadTextureSet;
    }

    function setPublishRunningState(destination) {
        const controller = app.getPublishController();

        if (!app.publishError && !app.publishLocalDraftId && !app.publishedCloudRootId) {
            controller.beginPublish(destination);
            return controller;
        }

        controller.set('isPublishingToCloud', true);
        controller.set('publishProgress', '');
        controller.set('publishError', null);
        controller.set('publishNotice', null);
        controller.set('publishDestination', destination);
        return controller;
    }

    async function ensureLocalRootDraft(sourceBundle) {
        if (app.publishLocalDraftId) {
            return app.publishLocalDraftId;
        }

        const draftTextureId = await saveTextureSet({
            name: sourceBundle.textureName,
            tileCount: sourceBundle.tileCount,
            tileResolution: sourceBundle.tileResolution,
            layerCount: sourceBundle.layerCount,
            crossSectionType: sourceBundle.crossSectionType,
            sourceMetadata: sourceBundle.sourceMetadata,
            thumbnailDataUrl: sourceBundle.thumbnailDataUrl,
            ktx2Blobs: sourceBundle.ktx2Blobs,
        });

        app.getPublishController().set('publishLocalDraftId', draftTextureId);
        return draftTextureId;
    }

    async function publishRootTexture(sourceBundle, uploader, destination) {
        if (app.publishedCloudRootId) {
            return app.publishedCloudRootId;
        }

        const controller = app.getPublishController();
        controller.set('publishProgress', `Uploading root texture to ${publishDestinationLabel.value}...`);
        const localDraftId = await ensureLocalRootDraft(sourceBundle);

        const rootResult = await uploader({
            name: sourceBundle.textureName,
            description: '',
            tileResolution: sourceBundle.tileResolution,
            layerCount: sourceBundle.layerCount,
            crossSectionType: sourceBundle.crossSectionType,
            sourceMetadata: sourceBundle.sourceMetadata,
            tiles: buildUploadTilesFromBlobs(sourceBundle.ktx2Blobs),
            thumbnailBlob: sourceBundle.thumbnailBlob,
            onProgress: (_step, detail) => {
                controller.set('publishProgress', detail || `Uploading root texture to ${publishDestinationLabel.value}...`);
            },
        });

        controller.set('publishedCloudRootId', rootResult.textureSetId);
        controller.set('publishedCloudTextureFamilyIds', [rootResult.textureSetId]);

        await promoteTextureSetToCachedCloudTexture(localDraftId, {
            cloudTextureId: rootResult.textureSetId,
            name: sourceBundle.textureName,
            rootTextureSetId: rootResult.textureSetId,
            parentTextureSetId: null,
            sourceMetadata: sourceBundle.sourceMetadata,
            thumbnailDataUrl: sourceBundle.thumbnailDataUrl,
            variantSummaries: [buildVariantSummary(rootResult.textureSetId, sourceBundle.tileResolution, rootResult.textureSetId)],
            availableResolutions: [sourceBundle.tileResolution],
        });

        controller.set('publishNotice', `Root published to ${destination === 'r2' ? 'R2' : 'Google Drive'} and cached locally.`);
        return rootResult.textureSetId;
    }

    async function publishDerivedVariants(sourceBundle, uploader, rootTextureSetId) {
        const controller = app.getPublishController();
        const targetResolutions = app.publishPendingResolutions.length > 0
            ? [...app.publishPendingResolutions]
            : normalizeTextureVariantTargetResolutions(sourceBundle.tileResolution, app.autoDeriveResolutions);

        if (targetResolutions.length === 0) {
            controller.set('publishPendingResolutions', []);
            return [];
        }

        const { deriveKtx2TextureFamily } = await import('../../modules/slyce/ktx2RoundtripVariant.js');
        controller.set('publishProgress', 'Preparing lower-resolution cloud variants...');

        const familyResult = await deriveKtx2TextureFamily({
            sourceTiles: buildSourceTilesFromBlobs(sourceBundle.ktx2Blobs),
            sourceResolution: sourceBundle.tileResolution,
            targetResolutions,
            onProgress: (stage) => {
                controller.set('publishProgress', buildPublishVariantProgress(stage));
            },
        });

        const uploadedIds = Array.isArray(app.publishedCloudTextureFamilyIds)
            ? app.publishedCloudTextureFamilyIds.filter((id) => id !== rootTextureSetId)
            : [];
        const uploadedSummaries = [];

        for (let variantIndex = 0; variantIndex < familyResult.variants.length; variantIndex++) {
            const variant = familyResult.variants[variantIndex];
            const remainingResolutions = targetResolutions.slice(variantIndex);
            controller.set('publishPendingResolutions', remainingResolutions);
            controller.set('publishProgress', `Uploading ${variant.targetResolution}px variant to ${publishDestinationLabel.value}...`);

            const uploadedVariant = await uploader({
                name: sourceBundle.textureName,
                description: '',
                parentTextureSetId: rootTextureSetId,
                tileResolution: variant.result.output.pixelWidth,
                layerCount: variant.result.output.layerCount,
                crossSectionType: sourceBundle.crossSectionType,
                sourceMetadata: sourceBundle.sourceMetadata,
                tiles: buildUploadTilesFromBlobs(variant.result.outputBlobs),
                thumbnailBlob: null,
                onProgress: (_step, detail) => {
                    controller.set('publishProgress', detail || `Uploading ${variant.targetResolution}px variant to ${publishDestinationLabel.value}...`);
                },
            });

            uploadedIds.push(uploadedVariant.textureSetId);
            uploadedSummaries.push(
                buildVariantSummary(uploadedVariant.textureSetId, variant.result.output.pixelWidth, rootTextureSetId, rootTextureSetId)
            );

            await cacheCloudTexture({
                cloudTextureId: uploadedVariant.textureSetId,
                name: sourceBundle.textureName,
                tileCount: variant.result.output.tileCount,
                tileResolution: variant.result.output.pixelWidth,
                layerCount: variant.result.output.layerCount,
                crossSectionType: sourceBundle.crossSectionType,
                sourceMetadata: sourceBundle.sourceMetadata,
                thumbnailDataUrl: null,
                ktx2Blobs: variant.result.outputBlobs,
                rootTextureSetId,
                parentTextureSetId: rootTextureSetId,
                variantInfo: {
                    family_id: rootTextureSetId,
                    root_texture_set_id: rootTextureSetId,
                    parent_texture_set_id: rootTextureSetId,
                    source_resolution: sourceBundle.tileResolution,
                    target_resolution: variant.targetResolution,
                    generated_at: Date.now(),
                    method: 'file-mode-roundtrip-cloud-v1',
                },
            });

            controller.set('publishedCloudTextureFamilyIds', [
                rootTextureSetId,
                ...uploadedIds,
            ]);
            controller.set('publishPendingResolutions', targetResolutions.slice(variantIndex + 1));
        }

        return uploadedSummaries;
    }

    async function startPublishFamily() {
        if (app.isPublishingToCloud) {
            return;
        }

        if (!isAuthenticated.value) {
            app.getPublishController().set('publishError', 'Sign in before publishing to cloud storage');
            app.getPublishController().set('publishNotice', 'The root draft will stay local until you retry with an authenticated session.');
            return;
        }

        const destination = app.publishDestination === 'r2' ? 'r2' : 'google-drive';
        const controller = setPublishRunningState(destination);

        try {
            const sourceBundle = await buildSourceBundle();
            const uploader = getPublishUploader(destination);
            const rootTextureSetId = await publishRootTexture(sourceBundle, uploader, destination);
            const uploadedVariantSummaries = await publishDerivedVariants(sourceBundle, uploader, rootTextureSetId);
            const allVariantSummaries = [
                buildVariantSummary(rootTextureSetId, sourceBundle.tileResolution, rootTextureSetId),
                ...uploadedVariantSummaries,
            ];

            if (app.publishLocalDraftId) {
                await promoteTextureSetToCachedCloudTexture(app.publishLocalDraftId, {
                    cloudTextureId: rootTextureSetId,
                    name: sourceBundle.textureName,
                    rootTextureSetId,
                    parentTextureSetId: null,
                    sourceMetadata: sourceBundle.sourceMetadata,
                    thumbnailDataUrl: sourceBundle.thumbnailDataUrl,
                    variantSummaries: allVariantSummaries,
                    availableResolutions: [
                        sourceBundle.tileResolution,
                        ...normalizeTextureVariantTargetResolutions(sourceBundle.tileResolution, app.autoDeriveResolutions),
                    ].sort((left, right) => right - left),
                });
            }

            controller.set('publishPendingResolutions', []);
            controller.set('publishError', null);
            const publishedMemberCount = publishedFamilyCount.value || 1;
            controller.set(
                'publishNotice',
                publishedMemberCount > 1
                    ? `Published ${publishedMemberCount} family members to ${publishDestinationLabel.value}.`
                    : `Published the root texture to ${publishDestinationLabel.value}.`
            );
        } catch (error) {
            console.error('[OutputActions] Cloud publish failed:', error);

            if (!app.publishedCloudRootId) {
                controller.set(
                    'publishPendingResolutions',
                    normalizeTextureVariantTargetResolutions(app.potResolution, app.autoDeriveResolutions)
                );
                controller.set('publishNotice', 'The root draft was saved locally so you can retry publishing or manage it from Drafts.');
            } else if (!app.publishNotice) {
                controller.set(
                    'publishNotice',
                    app.publishPendingResolutions.length > 0
                        ? `Root published successfully. Retry the remaining variants: ${publishPendingLabel.value}.`
                        : 'Root published successfully. Retry to finish the remaining cloud work.'
                );
            }

            controller.set('publishError', error?.message || 'Cloud publish failed');
        } finally {
            controller.set('publishProgress', '');
            controller.finishPublish();
        }
    }

    function applyTexture() {
        if (app.uploadToCloud) {
            if (!app.publishedCloudRootId) {
                return;
            }

            emit('apply-texture', {
                id: app.publishedCloudRootId,
                name: getDefaultTextureName(app.fileInfo),
                source: 'cloud',
                isLocal: false,
            });
            return;
        }

        if (!app.savedLocalTextureId) {
            return;
        }

        emit('apply-texture', {
            id: app.savedLocalTextureId,
            name: getDefaultTextureName(app.fileInfo),
            source: 'local',
            isLocal: true,
        });
    }

    async function retrySaveLocally() {
        await saveProcessedTextureSetLocally(app.getLocalSaveController(), buildFileTextureSaveSource(app));
    }

    async function retryPublishFamily() {
        await startPublishFamily();
    }

    function openTextureBrowser() {
        viewerStore.hideSlyce();

        const targetTab = app.uploadToCloud
            ? (app.publishedCloudRootId ? 'my-cloud' : 'local')
            : 'local';

        router.push({ path: route.path, query: { ...route.query, textures: targetTab } });
    }

    onMounted(() => {
        if (app.uploadToCloud) {
            if (!app.isPublishingToCloud && !app.publishedCloudRootId && !app.publishError) {
                void startPublishFamily();
            }
            return;
        }

        if (!app.isSavingLocally && !app.savedLocalTextureId && !app.saveLocalError) {
            void retrySaveLocally();
        }
    });
</script>

<style scoped>
    .output-actions-stack {
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
    }

    .apply-texture-btn,
    .view-local-btn {
        min-height: 44px;
    }

    .apply-texture-btn .material-symbols-outlined,
    .view-local-btn .material-symbols-outlined {
        font-size: 1.1rem;
    }

    .local-save-note,
    .publish-note,
    .publish-title,
    .publish-detail {
        margin: 0;
        line-height: 1.45;
    }

    .local-save-note,
    .publish-note {
        font-size: 0.95rem;
        color: #8a5a00;
    }

    .publish-status {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        column-gap: 0.9rem;
        row-gap: 0.75rem;
        align-items: start;
        width: 100%;
        padding: 0.9rem 1rem;
        border-radius: 0.85rem;
        border: 1px solid rgba(59, 130, 246, 0.4);
        background: rgba(59, 130, 246, 0.1);
        color: var(--text-primary, rgba(255, 255, 255, 0.94));
        text-align: left;
    }

    .publish-status.is-error {
        border-color: rgba(220, 38, 38, 0.45);
        background: rgba(220, 38, 38, 0.1);
    }

    .publish-status.is-success {
        border-color: rgba(34, 197, 94, 0.4);
        background: rgba(34, 197, 94, 0.1);
    }

    .publish-icon-wrap {
        grid-column: 1;
        grid-row: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        margin-top: 0.1rem;
        color: #60a5fa;
    }

    .publish-status.is-error .publish-icon-wrap {
        color: #f87171;
    }

    .publish-status.is-success .publish-icon-wrap {
        color: #4ade80;
    }

    .publish-spinner {
        width: 1.25rem;
        height: 1.25rem;
        animation: publish-spin 0.9s linear infinite;
    }

    .spinner-track {
        opacity: 0.25;
    }

    .spinner-head {
        opacity: 0.8;
    }

    .publish-icon {
        font-size: 1.3rem;
    }

    .publish-copy {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .publish-title {
        font-size: 1rem;
        font-weight: 600;
    }

    .publish-detail {
        font-size: 0.95rem;
        opacity: 0.92;
    }

    .publish-actions {
        grid-column: 1 / -1;
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
    }

    @keyframes publish-spin {
        from {
            transform: rotate(0deg);
        }

        to {
            transform: rotate(360deg);
        }
    }
</style>