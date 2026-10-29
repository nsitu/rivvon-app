<script setup>
import { ref, watch, onBeforeUnmount } from 'vue';
import { useAuthStore } from '../../stores/authStore.js';
import { fetchClipBlob, clipAssetUrl } from '../../services/clipService.js';
const props = defineProps({ source: { type: Object, required: true }, presetId: { type: String, default: '' }, title: { type: String, default: '' }, full: Boolean });
const auth = useAuthStore(), url = ref(''), error = ref('');
const videoRef = ref(null);
let controller, objectUrl;
function cleanup() {
    controller?.abort();
    if (videoRef.value) { videoRef.value.pause(); videoRef.value.removeAttribute('src'); videoRef.value.load(); }
    if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = '';
}
watch(() => [props.source.kind, props.source.id, props.presetId, props.full, auth.user?.id], async () => {
    cleanup(); url.value = ''; error.value = '';
    if (props.full) { url.value = clipAssetUrl(props.source.id, { presetId: props.presetId }); return; }
    const request = controller = new AbortController();
    try {
        const blob = await fetchClipBlob(props.source.id, { presetId: props.presetId, asset: 'thumbnail', signal: request.signal });
        if (request.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob); url.value = objectUrl;
    } catch (e) { if (!request.signal.aborted) error.value = e.message; }
}, { immediate: true });
onBeforeUnmount(cleanup);
</script>
<template>
    <div class="clip-asset-preview" :aria-busy="!url && !error">
        <!-- Native transport is intentional: it provides accessible video playback. -->
        <video v-if="url && full" ref="videoRef" :key="url" :src="url" crossorigin="use-credentials" muted loop playsinline controls preload="metadata" :aria-label="title" @error="error = 'Clip preview unavailable'; url = ''" />
        <img v-else-if="url" :src="url" :alt="title" loading="lazy" @error="error = 'Clip preview unavailable'; url = ''" />
        <span v-else-if="error" class="clip-preview-message" role="status">{{ error }}</span>
        <span v-else class="clip-preview-message" role="status">Loading clip…</span>
    </div>
</template>
<style scoped>
.clip-asset-preview { display: grid; place-items: center; min-width: 0; width: 100%; height: 100%; min-height: 4rem; background: var(--p-content-background); }
.clip-asset-preview img, .clip-asset-preview video { display: block; width: 100%; height: 100%; object-fit: contain; }
.clip-preview-message { padding: 1rem; font-size: .875rem; color: var(--p-text-muted-color); overflow-wrap: anywhere; }
</style>
