<script setup>
import { ref, watch } from 'vue';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import PanelActionBar from '../shared/PanelActionBar.vue';
const props = defineProps({ visible: Boolean, capture: Object, busy: Boolean, progress: String, error: String, link: String, initialVisibility: String });
const emit = defineEmits(['update:visible', 'save', 'copy', 'share']);
const name = ref('');
const visibility = ref('private');
const options = [{ label: 'Private — only you', value: 'private' }, { label: 'Unlisted — anyone with the link', value: 'unlisted' }, { label: 'Public — listed in Browse', value: 'public' }];
const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
watch(() => props.capture, capture => {
    name.value = capture?.scene.geometry.title || 'Untitled ribbon';
    visibility.value = props.initialVisibility || 'private';
}, { immediate: true });
</script>

<template>
    <Dialog :visible="visible" @update:visible="emit('update:visible', $event)" modal
        :header="link ? 'Preset saved' : 'Save Preset'" :closable="!busy" :close-on-escape="!busy"
        :style="{ width: '32rem', maxWidth: 'calc(100vw - 2rem)' }">
        <form class="preset-save-form" @submit.prevent="!link && !busy && emit('save', { name: name.trim(), visibility })">
            <img v-if="capture?.previewUrl" :src="capture.previewUrl" alt="Scene captured for this preset" class="preset-save-preview" />
            <template v-if="!link">
                <label for="preset-name">Name</label>
                <InputText id="preset-name" v-model="name" :disabled="busy" maxlength="200" required autofocus />
                <label for="preset-visibility">Visibility</label>
                <Select input-id="preset-visibility" v-model="visibility" :options="options" option-label="label" option-value="value" :disabled="busy" />
                <p>Includes the ribbon, textures, scene settings, camera, and saved audio. Device preferences stay on each device.</p>
                <p v-if="capture?.uploads?.length">{{ capture.uploads.length }} local texture(s) will be uploaded to your texture library. This preset will reference those assets.</p>
                <p v-if="capture?.microphoneExcluded">Live microphone input cannot be saved. Audio response settings are included; the recipient can start their own microphone.</p>
            </template>
            <template v-else>
                <label for="saved-preset-link">Share link</label>
                <InputText id="saved-preset-link" :model-value="link" readonly @focus="$event.target.select()" />
            </template>
            <p v-if="busy" role="status">{{ progress || 'Saving preset…' }}</p>
            <p v-if="error" role="alert">{{ error }}</p>
            <PanelActionBar>
                <Button v-if="!link" type="button" label="Cancel" severity="secondary" :disabled="busy" @click="emit('update:visible', false)" />
                <Button v-if="!link" type="submit" :label="visibility === 'private' ? 'Save Preset' : 'Save and Create Link'" :loading="busy" :disabled="!name.trim()" />
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
.preset-save-form { display: flex; flex-direction: column; gap: 0.75rem; }
.preset-save-preview { width: 100%; max-height: 16rem; object-fit: contain; border-radius: var(--p-content-border-radius); }
.preset-save-form p { margin: 0; font-size: 0.9rem; color: var(--p-text-muted-color); }
</style>
