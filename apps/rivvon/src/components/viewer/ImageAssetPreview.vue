<script setup>
import { ref, watch, onBeforeUnmount } from 'vue';
import { useAuthStore } from '../../stores/authStore.js';
import { fetchImageBlob } from '../../services/imageService.js';
import { getBackgroundTextureOption } from '../../modules/viewer/backgroundTextures.js';
const props = defineProps({ source: { type: Object, required: true }, presetId: { type: String, default: '' }, title: { type: String, default: '' }, full: Boolean });
const auth = useAuthStore(), url = ref(''), error = ref('');
let controller, objectUrl;
function cleanup() { controller?.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = ''; }
watch(() => [props.source.kind, props.source.id, props.presetId, props.full, auth.user?.id], async () => {
    cleanup(); url.value = ''; error.value = '';
    if (props.source.kind === 'builtin') { url.value = getBackgroundTextureOption(props.source.id).url; return; }
    const request = controller = new AbortController();
    try {
        const blob = await fetchImageBlob(props.source.id, { presetId: props.presetId, asset: props.full ? 'image' : 'thumbnail', signal: request.signal });
        if (request.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob); url.value = objectUrl;
    } catch (e) { if (!request.signal.aborted) error.value = e.message; }
}, { immediate: true });
onBeforeUnmount(cleanup);
</script>
<template>
    <div class="image-asset-preview" :aria-busy="!url && !error">
        <img v-if="url" :src="url" :alt="title" loading="lazy" @error="error = 'Image preview unavailable'; url = ''" />
        <span v-else-if="error" class="image-preview-message" role="status">{{ error }}</span>
        <span v-else class="image-preview-message" role="status">Loading image…</span>
    </div>
</template>
<style scoped>
.image-asset-preview { display: grid; place-items: center; min-width: 0; width: 100%; height: 100%; min-height: 4rem; background: var(--p-content-background); }
.image-asset-preview img { display: block; width: 100%; height: 100%; object-fit: contain; }
.image-preview-message { padding: 1rem; font-size: .875rem; color: var(--p-text-muted-color); overflow-wrap: anywhere; }
</style>
