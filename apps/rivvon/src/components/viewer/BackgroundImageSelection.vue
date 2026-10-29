<script setup>
import { computed, inject, ref, watch } from 'vue';
import Button from 'primevue/button';
import { useViewerStore } from '../../stores/viewerStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import { IMAGE_LIBRARY_KEY, imageMetadataRevision, fetchImage } from '../../services/imageService.js';
import { getBackgroundTextureOption } from '../../modules/viewer/backgroundTextures.js';
import ImageAssetPreview from './ImageAssetPreview.vue';
import ClipAssetPreview from './ClipAssetPreview.vue';
import Select from 'primevue/select';
import { CLIP_LIBRARY_KEY, fetchClip, clipMetadataRevision } from '../../services/clipService.js';
import { createClipTimingPlan } from '../../modules/viewer/clipTiming.js';
import { resumeBackgroundClips } from '../../services/backgroundClip.js';
defineProps({ disabled: Boolean });
const app = useViewerStore(), auth = useAuthStore(), library = inject(IMAGE_LIBRARY_KEY, null);
const clips = inject(CLIP_LIBRARY_KEY, null);
const mediaLibraries = [{ label: 'Images', value: 'image' }, { label: 'Clips', value: 'clip' }];
const playbackModes = [{ label: 'Original speed', value: 'native' }, { label: 'Speed up to align with loop', value: 'alignLoop' }];
const name = ref(''), unavailable = ref(false);
const timing = computed(() => app.backgroundClipDuration > 0 && (app.backgroundClipPreviewDuration || app.backgroundClipLiveDuration) > 0
    ? createClipTimingPlan(app.backgroundClipDuration, app.backgroundClipPreviewDuration || app.backgroundClipLiveDuration, app.backgroundClipPlaybackMode) : null);
const source = computed(() => app.backgroundTextureSource || { kind: 'builtin', id: app.backgroundTexture });
let generation = 0;
watch(() => [source.value, app.backgroundImagePresetId, auth.user?.id, imageMetadataRevision.value, clipMetadataRevision.value], async () => {
    const token = ++generation; unavailable.value = false;
    if (source.value.kind === 'builtin') { name.value = getBackgroundTextureOption(source.value.id).label; return; }
    name.value = source.value.kind === 'clip' ? 'Selected clip' : 'Selected image';
    try { const media = await (source.value.kind === 'clip' ? fetchClip : fetchImage)(source.value.id, app.backgroundImagePresetId); if (token === generation) name.value = media.name; }
    catch { if (token === generation) { name.value = 'Background media unavailable'; unavailable.value = true; } }
}, { immediate: true, deep: true });
</script>
<template>
    <div class="background-image-selection">
        <div class="background-image-thumbnail"><component :is="source.kind === 'clip' ? ClipAssetPreview : ImageAssetPreview" :source="source" :preset-id="app.backgroundImagePresetId" :title="name" /></div>
        <div class="background-image-summary">
            <span>{{ name }}</span>
            <small v-if="unavailable || app.backgroundImageError" role="status">{{ app.backgroundImageError || 'Choose available media to restore this background.' }}</small>
            <Select :model-value="null" :options="mediaLibraries" option-label="label" option-value="value" placeholder="Change media" aria-label="Choose background media library" :disabled="disabled" @update:model-value="value => value === 'clip' ? clips?.open() : library?.open()" />
            <template v-if="source.kind === 'clip'">
                <Select :model-value="app.backgroundClipPlaybackMode" :options="playbackModes" option-label="label" option-value="value" aria-label="Background clip playback" :disabled="disabled" @update:model-value="app.setBackgroundClipPlaybackMode" />
                <small v-if="timing?.mode === 'alignLoop'">{{ timing.rate.toFixed(3) }}× (+{{ ((timing.rate - 1) * 100).toFixed(1) }}%) · {{ timing.repetitions }} repetitions per {{ timing.targetDuration.toFixed(3) }} s loop.</small>
                <small>Muted · {{ Number(app.backgroundClipDuration).toFixed(1) }} s. Speed alignment repeats the full clip and never slows it down.</small>
                <small v-if="app.backgroundClipPlaybackError" role="status">{{ app.backgroundClipPlaybackError }}</small>
                <Button v-if="app.backgroundClipPaused || app.backgroundClipPlaybackError" type="button" variant="link" :disabled="disabled" @click="app.backgroundClipPaused = false; resumeBackgroundClips()">Play background clip</Button>
                <Button v-else type="button" variant="link" :disabled="disabled" @click="app.backgroundClipPaused = true">Pause background clip</Button>
            </template>
        </div>
    </div>
</template>
<style scoped>
.background-image-selection { display: flex; align-items: center; gap: .75rem; margin-block: .75rem; }
.background-image-thumbnail { width: 5rem; height: 4rem; flex-shrink: 0; }
.background-image-summary { display: flex; flex: 1; flex-direction: column; align-items: flex-start; gap: .5rem; min-width: 0; overflow-wrap: anywhere; }
.background-image-summary :deep(.p-select) { width: 100%; max-width: 100%; min-width: 0; }
.background-image-summary small { color: var(--p-text-muted-color); }
</style>
