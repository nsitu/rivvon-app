<script setup>
import { useId } from 'vue';
import RadioButton from 'primevue/radiobutton';
import LoadingIndicator from '../shared/LoadingIndicator.vue';

defineProps({
    modelValue: String,
    destinations: { type: Array, default: () => [] },
    busy: Boolean,
    locked: Boolean,
    progress: String,
    error: String,
});
const emit = defineEmits(['update:modelValue']);
const inputId = `texture-upload-${useId()}`;
</script>

<template>
    <div class="texture-upload-fields">
        <fieldset class="texture-upload-destinations" :disabled="busy || locked">
            <legend>Upload destination</legend>
            <label v-for="destination in destinations" :key="destination.value" class="texture-upload-option"
                :for="`${inputId}-${destination.value}`">
                <RadioButton :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)"
                    :input-id="`${inputId}-${destination.value}`" :name="inputId" :value="destination.value" :disabled="busy || locked" />
                <img :src="destination.icon" alt="" class="texture-upload-icon" />
                <span class="texture-upload-copy">
                    <strong>{{ destination.label }}</strong>
                    <span>{{ destination.description }}</span>
                </span>
            </label>
            <p v-if="!destinations.length">Sign in to choose an upload destination.</p>
        </fieldset>
        <LoadingIndicator v-if="busy" class="texture-upload-progress" :message="progress || 'Preparing upload…'" />
        <p v-else-if="progress" role="status">{{ progress }}</p>
        <p v-if="error" class="texture-upload-error" role="alert">{{ error }}</p>
    </div>
</template>

<style scoped>
.texture-upload-fields { display: flex; flex-direction: column; gap: 0.75rem; }
.texture-upload-destinations { display: flex; flex-direction: column; gap: 0.75rem; margin: 0; padding: 0; border: 0; min-width: 0; }
.texture-upload-destinations legend { padding: 0; margin-bottom: 0.75rem; font-weight: 600; }
.texture-upload-option { display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.75rem; border: 1px solid var(--p-content-border-color); border-radius: var(--p-content-border-radius); cursor: pointer; }
.texture-upload-option:has(input:checked) { border-color: var(--p-primary-color); }
.texture-upload-option:has(input:disabled) { cursor: default; }
.texture-upload-icon { width: 1.5rem; height: 1.5rem; object-fit: contain; }
.texture-upload-copy { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
.texture-upload-copy > span { font-size: 0.85rem; line-height: 1.4; color: var(--p-text-muted-color); }
.texture-upload-progress { --loading-indicator-spinner-size: 24px; --loading-indicator-spinner-border-width: 2px; --loading-indicator-text-size: 0.9rem; --loading-indicator-text-letter-spacing: normal; }
.texture-upload-fields p { margin: 0; }
.texture-upload-error { color: var(--p-red-400); }
</style>
