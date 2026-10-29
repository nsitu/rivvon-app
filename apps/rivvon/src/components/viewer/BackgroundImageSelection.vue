<script setup>
import { computed, inject, ref, watch } from 'vue';
import Button from 'primevue/button';
import { useViewerStore } from '../../stores/viewerStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import { IMAGE_LIBRARY_KEY, imageMetadataRevision, fetchImage } from '../../services/imageService.js';
import { getBackgroundTextureOption } from '../../modules/viewer/backgroundTextures.js';
import ImageAssetPreview from './ImageAssetPreview.vue';
defineProps({ disabled: Boolean });
const app = useViewerStore(), auth = useAuthStore(), library = inject(IMAGE_LIBRARY_KEY, null);
const name = ref(''), unavailable = ref(false);
const source = computed(() => app.backgroundTextureSource || { kind: 'builtin', id: app.backgroundTexture });
let generation = 0;
watch(() => [source.value, app.backgroundImagePresetId, auth.user?.id, imageMetadataRevision.value], async () => {
    const token = ++generation; unavailable.value = false;
    if (source.value.kind === 'builtin') { name.value = getBackgroundTextureOption(source.value.id).label; return; }
    name.value = 'Selected image';
    try { const image = await fetchImage(source.value.id, app.backgroundImagePresetId); if (token === generation) name.value = image.name; }
    catch { if (token === generation) { name.value = 'Image unavailable'; unavailable.value = true; } }
}, { immediate: true, deep: true });
</script>
<template>
    <div class="background-image-selection">
        <div class="background-image-thumbnail"><ImageAssetPreview :source="source" :preset-id="app.backgroundImagePresetId" :title="name" /></div>
        <div class="background-image-summary">
            <span>{{ name }}</span>
            <small v-if="unavailable || app.backgroundImageError" role="status">{{ app.backgroundImageError || 'Choose an available image to restore this background.' }}</small>
            <Button type="button" variant="link" :disabled="disabled || !library" @click="library.open()">Change image</Button>
        </div>
    </div>
</template>
<style scoped>
.background-image-selection { display: flex; align-items: center; gap: .75rem; margin-block: .75rem; }
.background-image-thumbnail { width: 5rem; height: 4rem; flex-shrink: 0; }
.background-image-summary { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; overflow-wrap: anywhere; }
.background-image-summary small { color: var(--p-text-muted-color); }
</style>
