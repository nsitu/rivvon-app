<script setup>
import { computed, getCurrentInstance } from 'vue';
import Slider from 'primevue/slider';
import ToggleSwitch from 'primevue/toggleswitch';
import ProgressBar from 'primevue/progressbar';

const props = defineProps({ audio: { type: Object, required: true } });
const prefix = `audio-reactive-${getCurrentInstance().uid}`;
const state = computed(() => props.audio.state);
const analysisError = computed(() => state.value.microphoneActive || state.value.microphonePending ? '' : state.value.analysisError);
const amount = computed({
    get: () => Math.round(state.value.amount * 100),
    set: (value) => { state.value.amount = value / 100; },
});
</script>

<template>
    <div class="audio-reactive-settings">
        <div class="audio-toggle-row">
            <label :for="`${prefix}-enabled`">Audio reactive camera zoom</label>
            <ToggleSwitch v-model="state.reactiveEnabled" :input-id="`${prefix}-enabled`" :disabled="!!analysisError" />
        </div>
        <p v-if="analysisError" class="audio-message audio-error" role="alert">{{ analysisError }}</p>
        <template v-else>
            <ProgressBar :value="state.level * 100" :show-value="false" aria-label="Audio amplitude" class="audio-level" />
            <template v-if="state.reactiveEnabled">
                <div class="audio-setting-field">
                    <label :id="`${prefix}-amount`">Zoom amount {{ amount }}%</label>
                    <Slider v-model="amount" :min="0" :max="50" :aria-labelledby="`${prefix}-amount`" aria-label="Audio reactive zoom amount" />
                </div>
                <div class="audio-setting-field">
                    <label :id="`${prefix}-sensitivity`">Sensitivity {{ state.sensitivity.toFixed(1) }}</label>
                    <Slider v-model="state.sensitivity" :min="0.5" :max="12" :step="0.5" :aria-labelledby="`${prefix}-sensitivity`" aria-label="Audio sensitivity" />
                </div>
                <p class="audio-message">Louder sounds zoom in; quieter sounds return to your view.</p>
            </template>
        </template>
    </div>
</template>

<style scoped>
.audio-reactive-settings { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.audio-toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
.audio-toggle-row label { display: flex; align-items: center; min-height: var(--rivvon-button-min-target-size); font-size: 0.8rem; }
.audio-setting-field { display: flex; flex-direction: column; gap: 0.65rem; font-size: 0.8rem; }
.audio-message { margin: 0; font-size: 0.75rem; color: var(--p-text-muted-color); }
.audio-error { color: var(--p-red-400); }
.audio-level { height: 0.4rem; }
</style>
