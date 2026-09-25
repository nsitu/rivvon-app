<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
    compact: {
        type: Boolean,
        default: false,
    },
    disabled: {
        type: Boolean,
        default: false,
    },
    resetKey: {
        type: Number,
        default: 0,
    },
});

const emit = defineEmits(['file-selected']);
const fileInput = ref(null);

watch(() => props.resetKey, () => {
    if (fileInput.value) fileInput.value.value = '';
});

function handleFileSelected(event) {
    const file = event.target.files?.[0];
    if (file) emit('file-selected', file);
}
</script>

<template>
    <label v-if="compact" class="replace-source-picker" :class="{ disabled }">
        <span class="material-symbols-outlined">upload_file</span>
        Choose another file
        <input
            ref="fileInput"
            type="file"
            accept="audio/*,video/*"
            :disabled="disabled"
            @change="handleFileSelected"
        >
    </label>

    <label v-else class="audio-file-picker">
        <span class="material-symbols-outlined">upload_file</span>
        <span>Choose audio or video file</span>
        <small>Audio files and videos with an audio track</small>
        <input
            ref="fileInput"
            type="file"
            accept="audio/*,video/*"
            :disabled="disabled"
            @change="handleFileSelected"
        >
    </label>
</template>

<style scoped>
.audio-file-picker { display: grid; min-height: 8rem; padding: 1.25rem; border: 1px dashed #51709a; color: #dbeafe; background: #111827; cursor: pointer; place-items: center; text-align: center; }
.audio-file-picker .material-symbols-outlined { font-size: 2rem; color: #60a5fa; }
.audio-file-picker small { color: #94a3b8; }
.audio-file-picker input, .replace-source-picker input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.replace-source-picker { display: inline-flex; align-items: center; gap: .35rem; padding: .45rem .65rem; border: 1px solid #475569; color: #cbd5e1; cursor: pointer; font-size: .8rem; }
.replace-source-picker:hover { border-color: #60a5fa; color: #dbeafe; }
.replace-source-picker.disabled { cursor: default; opacity: .55; }
</style>
