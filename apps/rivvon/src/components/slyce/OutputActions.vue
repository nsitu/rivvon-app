<template>
    <div class="download-section">
        <LocalSaveStatus
            :is-saving-locally="app.isSavingLocally"
            :save-local-progress="app.saveLocalProgress"
            :save-local-error="app.saveLocalError"
            :saved-local-texture-id="app.savedLocalTextureId"
            :show-pending="true"
            @retry="retrySaveLocally"
        >
            <template #success-actions>
                <button
                    @click="applyTexture"
                    class="apply-texture-btn bg-green-500 text-white px-4 py-2 rounded-md hover:bg-green-600 transition-colors duration-300 flex items-center gap-2"
                >
                    <span class="material-symbols-outlined">check</span>
                    Apply
                </button>

                <button
                    @click="openTextureBrowser"
                    class="view-local-btn bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 transition-colors duration-300 flex items-center gap-2"
                >
                    <span class="material-symbols-outlined">folder</span>
                    Browser
                </button>
            </template>
        </LocalSaveStatus>
    </div>
</template>

<script setup>
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
    .apply-texture-btn {
        min-height: 44px;
    }

    .view-local-btn {
        min-height: 44px;
    }
</style>
