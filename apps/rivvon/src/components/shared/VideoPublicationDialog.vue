<script setup>
import { ref, useId, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import ScrollPanel from 'primevue/scrollpanel';
import Textarea from 'primevue/textarea';
import ToggleSwitch from 'primevue/toggleswitch';

const props = defineProps({
    visible: { type: Boolean, default: false },
    draft: { type: Boolean, default: false },
    file: { type: Object, default: null },
    filename: { type: String, default: '' },
    metadata: { type: Object, default: null },
    initialName: { type: String, default: '' },
    isUploading: { type: Boolean, default: false },
    progress: { type: Number, default: 0 },
    status: { type: String, default: '' },
    error: { type: String, default: '' },
});
const emit = defineEmits(['update:visible', 'select-file', 'submit', 'cancel']);
const formId = useId();
const name = ref('');
const description = ref('');
const isPublic = ref(true);

watch(() => props.visible, visible => {
    if (!visible) return;
    name.value = props.initialName.slice(0, 120);
    description.value = '';
    isPublic.value = true;
}, { immediate: true });
watch(() => props.initialName, value => { name.value = value.slice(0, 120); });

function close() {
    if (!props.isUploading) emit('update:visible', false);
}

function submit() {
    if (props.isUploading || !props.file || !props.metadata || !name.value.trim()) return;
    emit('submit', { name: name.value.trim(), description: description.value, isPublic: isPublic.value });
}

function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
</script>

<template>
    <Dialog :visible="visible" modal :header="draft ? 'Publish draft' : 'Upload video'"
        :closable="!isUploading" :close-on-escape="!isUploading" :dismissable-mask="!isUploading"
        :style="{ width: 'min(34rem, calc(100vw - 2rem))', height: 'min(40rem, calc(100dvh - 2rem))' }"
        :content-style="{ display: 'flex', flex: '1', minHeight: '0', overflow: 'hidden' }"
        @update:visible="close">
        <ScrollPanel class="rivvon-scroll-panel publication-scroll">
            <form :id="formId" class="publication-form" @submit.prevent="submit">
                <p class="publication-description">{{ draft
                    ? 'Upload this completed encoding and its thumbnail to the video gallery.'
                    : 'Add a rendered loop directly to the video gallery.' }}</p>
                <!-- File selection requires the native browser file picker. -->
                <label v-if="!draft" class="publication-field">
                    <span>Video file</span>
                    <input type="file" accept="video/mp4,video/webm" :disabled="isUploading"
                        @change="emit('select-file', $event)">
                    <small>Choose an MP4 or WebM file, up to 2 GB.</small>
                </label>
                <div v-if="file" class="publication-file">
                    <span class="material-symbols-outlined" aria-hidden="true">movie</span>
                    <span class="publication-filename">{{ filename || file.name }}</span>
                    <span v-if="metadata" class="publication-file-meta">
                        {{ metadata.width }}×{{ metadata.height }} · {{ formatDuration(metadata.duration) }}
                    </span>
                </div>
                <div class="publication-field">
                    <label :for="`${formId}-name`">Title</label>
                    <InputText :id="`${formId}-name`" v-model="name" maxlength="120" :disabled="isUploading" required />
                </div>
                <div class="publication-field">
                    <label :for="`${formId}-description`">Description</label>
                    <Textarea :id="`${formId}-description`" v-model="description" rows="3" maxlength="2000"
                        auto-resize :disabled="isUploading" />
                </div>
                <div class="publication-visibility">
                    <div class="publication-field">
                        <label :for="`${formId}-public`">Public Gallery</label>
                        <small>{{ isPublic ? 'Anyone can view this video.' : 'Only you can view this video in My Videos.' }}</small>
                    </div>
                    <ToggleSwitch :input-id="`${formId}-public`" v-model="isPublic" :disabled="isUploading" />
                </div>
                <div v-if="error || status" class="publication-status" :class="{ error }" :role="error ? 'alert' : 'status'">
                    <span class="material-symbols-outlined" aria-hidden="true">{{ error ? 'warning' : 'cloud_upload' }}</span>
                    <span>{{ error || status }}</span>
                </div>
                <progress v-if="isUploading" class="publication-progress" :value="progress" max="1" aria-label="Video upload progress" />
            </form>
        </ScrollPanel>
        <template #footer>
            <Button type="button" severity="secondary" variant="outlined" @click="emit('cancel')">
                {{ isUploading ? 'Cancel upload' : 'Cancel' }}
            </Button>
            <Button type="submit" :form="formId" :disabled="isUploading || !file || !metadata || !name.trim()">
                <span class="material-symbols-outlined" aria-hidden="true">cloud_upload</span>
                {{ isUploading ? 'Uploading…' : 'Upload to Gallery' }}
            </Button>
        </template>
    </Dialog>
</template>

<style scoped>
.publication-scroll { flex: 1; min-height: 0; }
.publication-form { display: flex; flex-direction: column; gap: 1rem; padding: 0 .25rem .25rem 0; }
.publication-description { margin: 0; color: var(--p-text-muted-color); }
.publication-field { display: flex; flex-direction: column; gap: .4rem; min-width: 0; }
.publication-field label, .publication-field > span { font-weight: 600; }
.publication-field small { color: var(--p-text-muted-color); }
.publication-field input[type='file'] { max-width: 100%; }
.publication-file { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem; min-width: 0; padding: .75rem; background: var(--p-content-hover-background); border-radius: var(--p-content-border-radius); }
.publication-filename { min-width: 0; overflow-wrap: anywhere; }
.publication-file-meta { color: var(--p-text-muted-color); }
.publication-visibility { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.publication-status { display: flex; align-items: center; gap: .5rem; color: var(--p-text-muted-color); }
.publication-status.error { color: var(--p-red-300); }
.publication-progress { width: 100%; accent-color: var(--p-primary-color); }
</style>
