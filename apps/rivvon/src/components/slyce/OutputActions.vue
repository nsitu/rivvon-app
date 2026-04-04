<template>
    <LocalSaveStatus
        :is-saving-locally="app.isSavingLocally"
        :save-local-progress="app.saveLocalProgress"
        :save-local-error="app.saveLocalError"
        :saved-local-texture-id="app.savedLocalTextureId"
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
                Apply
            </Button>

            <Button
                type="button"
                @click="openTextureBrowser"
                class="view-local-btn"
                severity="secondary"
                variant="outlined"
            >
                <span class="material-symbols-outlined">folder</span>
                Browser
            </Button>
        </template>
    </LocalSaveStatus>
</template>

<script setup>
    import Button from 'primevue/button';
    import LocalSaveStatus from './LocalSaveStatus.vue';
    import { useRoute, useRouter } from 'vue-router';
    import { useSlyceStore } from '../../stores/slyceStore';
    import { useViewerStore } from '../../stores/viewerStore';
    import { buildFileTextureSaveSource, saveProcessedTextureSetLocally } from '../../modules/slyce/localTexturePersistence.js';

    // Access the Pinia stores
    const app = useSlyceStore();
    const viewerStore = useViewerStore();
    const router = useRouter();
    const route = useRoute();

    // Emit events
    const emit = defineEmits(['apply-texture']);

    // Apply texture to the ribbon
    const applyTexture = () => {
        if (!app.savedLocalTextureId) return;

        emit('apply-texture', {
            id: app.savedLocalTextureId,
            name: app.fileInfo?.name?.replace(/\.[^.]+$/, '') || 'texture',
            source: 'local',
            isLocal: true,
        });
    };

    const retrySaveLocally = async () => {
        await saveProcessedTextureSetLocally(app.getLocalSaveController(), buildFileTextureSaveSource(app));
    };

    const openTextureBrowser = () => {
        if (!app.savedLocalTextureId && !app.saveLocalError && !app.isSavingLocally) return;

        viewerStore.hideSlyce();
        router.push({ path: route.path, query: { ...route.query, textures: 'local' } });
    };
</script>

<style scoped>
    .apply-texture-btn {
        min-height: 44px;
    }

    .view-local-btn {
        min-height: 44px;
    }

    .apply-texture-btn .material-symbols-outlined,
    .view-local-btn .material-symbols-outlined {
        font-size: 1.1rem;
    }
</style>
