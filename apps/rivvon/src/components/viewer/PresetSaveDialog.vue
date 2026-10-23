<script setup>
import { computed, ref, watch } from 'vue';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import ScrollPanel from 'primevue/scrollpanel';
import PanelActionBar from '../shared/PanelActionBar.vue';
import TextureUploadFields from './TextureUploadFields.vue';
import { useGoogleAuth } from '../../composables/shared/useGoogleAuth';
import { getTextureStorageDestinations } from '../../services/textureStorage.js';
const props = defineProps({ visible: Boolean, capture: Object, busy: Boolean, progress: String, error: String, link: String, initialVisibility: String });
const emit = defineEmits(['update:visible', 'save', 'copy', 'share']);
const name = ref('');
const visibility = ref('private');
const storageProvider = ref(null);
const { isAuthenticated, isAdmin } = useGoogleAuth();
const destinations = computed(() => getTextureStorageDestinations({ isAuthenticated: isAuthenticated.value, isAdmin: isAdmin.value }));
const localUploads = computed(() => {
    const seen = new Set();
    return (props.capture?.uploads || []).filter(upload => {
        const key = upload.localId || upload.assignment;
        if (props.capture.scene.textures[upload.assignment].id || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
});
const needsUpload = computed(() => localUploads.value.length > 0);
const hasUploadStep = ref(false);
const showUploadFields = computed(() => needsUpload.value || (props.busy && hasUploadStep.value));
const validDestination = computed(() => destinations.value.some(option => option.value === storageProvider.value));
const saveLabel = computed(() => {
    if (showUploadFields.value) return visibility.value === 'private' ? 'Upload and Save Preset' : 'Upload, Save and Create Link';
    return visibility.value === 'private' ? 'Save Preset' : 'Save and Create Link';
});
function submit() {
    if (props.link || props.busy || !name.value.trim() || (needsUpload.value && !validDestination.value)) return;
    emit('save', { name: name.value.trim(), visibility: visibility.value, storageProvider: storageProvider.value });
}
const options = [{ label: 'Private — only you', value: 'private' }, { label: 'Unlisted — anyone with the link', value: 'unlisted' }, { label: 'Public — listed in Browse', value: 'public' }];
const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
watch(() => props.capture, capture => {
    name.value = capture?.scene.geometry.title || 'Untitled ribbon';
    visibility.value = props.initialVisibility || 'private';
    hasUploadStep.value = (capture?.uploads || []).some(upload => !capture.scene.textures[upload.assignment].id);
    storageProvider.value = destinations.value.length === 1 ? destinations.value[0].value : null;
}, { immediate: true });
</script>

<template>
    <Dialog :visible="visible" @update:visible="emit('update:visible', $event)" modal
        :header="link ? 'Preset saved' : 'Save Preset'" :closable="!busy" :close-on-escape="!busy"
        :style="{ width: '36rem', maxWidth: 'calc(100vw - 2rem)', maxHeight: 'calc(100dvh - 2rem)' }"
        :pt="{ content: { style: { overflow: 'hidden' } } }">
        <form class="preset-save-form" @submit.prevent="submit">
          <ScrollPanel class="rivvon-scroll-panel preset-save-scroll">
           <div class="preset-save-fields">
            <img v-if="capture?.previewUrl" :src="capture.previewUrl" alt="Scene captured for this preset" class="preset-save-preview" />
            <template v-if="!link">
                <label for="preset-name">Name</label>
                <InputText id="preset-name" v-model="name" :disabled="busy" maxlength="200" required autofocus />
                <label for="preset-visibility">Visibility</label>
                <Select input-id="preset-visibility" v-model="visibility" :options="options" option-label="label" option-value="value" :disabled="busy" />
                <p>Includes the ribbon, textures, scene settings, camera, and saved audio. Device preferences stay on each device.</p>
                <section v-if="showUploadFields" class="preset-upload-step" aria-label="Upload required textures">
                    <strong>Texture upload required</strong>
                    <p>These textures are stored only in this browser. Choose where to upload them before saving this preset.</p>
                    <ul v-if="needsUpload"><li v-for="upload in localUploads" :key="upload.localId || upload.assignment">{{ capture.scene.textures[upload.assignment].name }}</li></ul>
                    <TextureUploadFields v-model="storageProvider" :destinations="destinations" :busy="busy" :progress="progress" :error="error" />
                    <p>The preset will reference the uploaded textures. Deleting a texture also requires confirmation to delete its dependent presets.</p>
                    <p>Preset visibility controls its listing and links. Uploaded media can be read by link.</p>
                </section>
                <p v-if="capture?.microphoneExcluded">Live microphone input cannot be saved. Audio response settings are included; the recipient can start their own microphone.</p>
            </template>
            <template v-else>
                <label for="saved-preset-link">Share link</label>
                <InputText id="saved-preset-link" :model-value="link" readonly @focus="$event.target.select()" />
            </template>
            <p v-if="busy && !showUploadFields" role="status">{{ progress || 'Saving preset…' }}</p>
            <p v-if="error && !showUploadFields" role="alert">{{ error }}</p>
           </div>
          </ScrollPanel>
            <PanelActionBar>
                <Button v-if="!link" type="button" label="Cancel" severity="secondary" :disabled="busy" @click="emit('update:visible', false)" />
                <Button v-if="!link" type="submit" :label="saveLabel" :loading="busy" :disabled="!name.trim() || (needsUpload && !validDestination)" />
                <template v-else>
                    <Button type="button" label="Copy Link" @click="emit('copy')" />
                    <Button v-if="canNativeShare" type="button" label="Share" @click="emit('share')" />
                    <Button type="button" label="Done" severity="secondary" @click="emit('update:visible', false)" />
                </template>
            </PanelActionBar>
        </form>
    </Dialog>
</template>

<style scoped>
.preset-save-form { display: flex; flex-direction: column; height: min(45rem, calc(100dvh - 10rem)); min-height: 0; }
.preset-save-fields { display: flex; flex-direction: column; gap: 0.75rem; padding: 0 0.25rem 0.5rem; }
.preset-upload-step { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem 0; border-top: 1px solid var(--p-content-border-color); }
.preset-upload-step ul { margin: 0; padding-left: 1.25rem; }
.preset-save-preview { width: 100%; max-height: 16rem; object-fit: contain; border-radius: var(--p-content-border-radius); }
.preset-save-form p { margin: 0; font-size: 0.9rem; color: var(--p-text-muted-color); }
</style>
