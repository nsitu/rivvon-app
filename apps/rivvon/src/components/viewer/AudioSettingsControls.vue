<script setup>
import { computed, inject } from 'vue';
import Button from 'primevue/button';
import AudioReactiveSettings from './AudioReactiveSettings.vue';
import { VIEWER_AUDIO_KEY } from '../../modules/viewer/audioReactivity.js';

const audio = inject(VIEWER_AUDIO_KEY, null);
const state = computed(() => audio?.state);
const microphoneSelected = computed(() => state.value?.microphoneActive || state.value?.microphonePending);
</script>

<template>
    <section v-if="audio" class="tools-section" aria-label="Audio">
        <div class="tools-section-label">Audio</div>
        <div class="tools-section-items audio-tools-settings">
            <p class="audio-description">Use your microphone to make the camera react to sounds around you. Input is analysed locally without recording or speaker playback.</p>
            <Button type="button" severity="secondary" :disabled="state.blocked"
                :label="state.microphonePending ? 'Cancel microphone request' : state.microphoneActive ? 'Stop microphone' : 'Start microphone'"
                @click="microphoneSelected ? audio.stopMicrophone() : audio.startMicrophone()">
                <template #icon><span class="material-symbols-outlined" aria-hidden="true">mic</span></template>
            </Button>
            <p class="audio-description" role="status" aria-live="polite">
                {{ state.microphonePending ? 'Waiting for microphone permission…' : state.microphoneActive ? `Listening: ${state.microphoneName}` : 'Microphone off' }}
            </p>
            <p v-if="state.microphoneError" class="audio-description audio-error" role="alert">{{ state.microphoneError }}</p>
            <p v-if="state.microphoneNotice" class="audio-description" role="status">{{ state.microphoneNotice }}</p>
            <p v-if="state.blocked" class="audio-description">Audio is unavailable while the viewer is busy.</p>
            <div v-if="state.track" class="audio-library-source">
                <span class="audio-description">Library track: {{ state.track.name }}</span>
                <Button type="button" severity="secondary" variant="outlined" :disabled="state.blocked"
                    :label="state.playing || state.pending ? 'Pause library audio' : 'Play library audio'"
                    @click="state.playing || state.pending ? audio.pause() : audio.play()" />
            </div>
            <p v-if="microphoneSelected && state.track" class="audio-description">Library playback is paused while the microphone is active.</p>
            <AudioReactiveSettings :audio="audio" />
        </div>
    </section>
</template>

<style scoped>
.audio-tools-settings { gap: 1rem; padding: 0.75rem; min-width: 0; }
:deep(.p-button) { min-height: var(--rivvon-button-min-target-size); }
.audio-description { margin: 0; color: var(--p-text-muted-color); font-size: 0.8rem; line-height: 1.4; overflow-wrap: anywhere; }
.audio-error { color: var(--p-red-400); }
.audio-library-source { display: flex; flex-direction: column; gap: 0.5rem; }
</style>
