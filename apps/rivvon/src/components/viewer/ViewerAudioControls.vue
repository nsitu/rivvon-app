<script setup>
import { computed, ref } from 'vue';
import Button from 'primevue/button';
import Slider from 'primevue/slider';
import ToggleSwitch from 'primevue/toggleswitch';
import ProgressBar from 'primevue/progressbar';
import ScrollPanel from 'primevue/scrollpanel';

const props = defineProps({ audio: { type: Object, required: true } });
const expanded = ref(false);
const state = computed(() => props.audio.state);
const seekPosition = computed({ get: () => state.value.currentTime, set: (value) => props.audio.seek(value) });
const volume = computed({ get: () => Math.round(state.value.volume * 100), set: (value) => props.audio.setVolume(value / 100) });
const amount = computed({ get: () => Math.round(state.value.amount * 100), set: (value) => { state.value.amount = value / 100; } });
const looping = computed({ get: () => state.value.loop, set: (value) => props.audio.setLoop(value) });
function formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
</script>

<template>
    <section v-if="state.track" class="viewer-audio-controls" :class="{ 'viewer-audio-controls--expanded': expanded }" aria-label="Viewer audio">
        <div class="audio-transport-row">
            <Button type="button" severity="secondary" variant="text" class="rivvon-icon-action"
                :disabled="state.blocked" :aria-label="state.playing || state.pending ? 'Pause viewer audio' : 'Play viewer audio'"
                @click="state.playing || state.pending ? audio.pause() : audio.play()">
                <span class="material-symbols-outlined" aria-hidden="true">{{ state.playing || state.pending ? 'pause' : 'play_arrow' }}</span>
            </Button>
            <div class="audio-track-copy">
                <span class="audio-track-name" :title="state.track.name">{{ state.track.name }}</span>
                <span class="audio-track-time">{{ formatTime(state.currentTime) }} / {{ formatTime(state.duration) }}{{ state.buffering || state.pending ? ' · Loading…' : '' }}</span>
            </div>
            <Button type="button" severity="secondary" variant="text" class="rivvon-icon-action"
                aria-label="Audio settings" aria-controls="viewer-audio-settings" :aria-expanded="expanded" @click="expanded = !expanded">
                <span class="material-symbols-outlined" aria-hidden="true">settings</span>
            </Button>
            <Button type="button" severity="secondary" variant="text" class="rivvon-icon-action"
                aria-label="Remove viewer audio" @click="audio.remove()">
                <span class="material-symbols-outlined" aria-hidden="true">close</span>
            </Button>
        </div>
        <Slider v-model="seekPosition" :min="0" :max="Math.max(1, state.duration)" :step="0.1"
            :disabled="!state.duration || state.blocked" aria-label="Audio position" class="audio-seek" />
        <p v-if="state.error" class="audio-message audio-error" role="alert">{{ state.error }}</p>
        <p v-if="state.blocked" class="audio-message" role="status">Audio paused while the viewer is busy.</p>
        <ScrollPanel v-if="expanded" id="viewer-audio-settings" class="rivvon-scroll-panel audio-settings-scroll">
            <div class="audio-settings">
                <div class="audio-volume-row">
                    <Button type="button" severity="secondary" variant="text" class="rivvon-icon-action"
                        :aria-label="state.muted ? 'Unmute audio' : 'Mute audio'" :aria-pressed="state.muted" @click="audio.setMuted(!state.muted)">
                        <span class="material-symbols-outlined" aria-hidden="true">{{ state.muted ? 'volume_off' : 'volume_up' }}</span>
                    </Button>
                    <div class="audio-setting-field">
                        <label id="viewer-audio-volume-label">Volume {{ volume }}%</label>
                        <Slider v-model="volume" :min="0" :max="100" aria-labelledby="viewer-audio-volume-label" aria-label="Audio volume" />
                    </div>
                </div>
                <div class="audio-toggle-row">
                    <label for="viewer-audio-loop">Loop track</label>
                    <ToggleSwitch v-model="looping" input-id="viewer-audio-loop" />
                </div>
                <div class="audio-toggle-row">
                    <label for="viewer-audio-reactive">Audio reactive camera zoom</label>
                    <ToggleSwitch v-model="state.reactiveEnabled" input-id="viewer-audio-reactive" :disabled="!!state.analysisError" />
                </div>
                <p v-if="state.analysisError" class="audio-message audio-error" role="alert">{{ state.analysisError }}</p>
                <template v-else>
                    <ProgressBar :value="state.level * 100" :show-value="false" aria-label="Audio amplitude" class="audio-level" />
                    <div v-if="state.reactiveEnabled" class="audio-reactive-settings">
                        <div class="audio-setting-field">
                            <label id="viewer-audio-amount-label">Zoom amount {{ amount }}%</label>
                            <Slider v-model="amount" :min="0" :max="50" aria-labelledby="viewer-audio-amount-label" aria-label="Audio reactive zoom amount" />
                        </div>
                        <div class="audio-setting-field">
                            <label id="viewer-audio-sensitivity-label">Sensitivity {{ state.sensitivity.toFixed(1) }}</label>
                            <Slider v-model="state.sensitivity" :min="0.5" :max="12" :step="0.5" aria-labelledby="viewer-audio-sensitivity-label" aria-label="Audio sensitivity" />
                        </div>
                        <p class="audio-message">Louder passages zoom in; quieter passages return to your view.</p>
                    </div>
                </template>
            </div>
        </ScrollPanel>
    </section>
</template>

<style scoped>
/* A compact floating transport expands upward. On mobile it spans the viewport;
   its constrained ScrollPanel keeps all settings above the bottom toolbar. */
.viewer-audio-controls {
    position: fixed; right: 1rem; bottom: calc(var(--viewer-bottom-chrome-height) + 0.5rem);
    z-index: 5; width: min(24rem, calc(100vw - 2rem));
    max-height: calc(100dvh - var(--viewer-header-chrome-height) - var(--viewer-bottom-chrome-height) - 1.5rem);
    display: flex; flex-direction: column; min-height: 0; box-sizing: border-box;
    color: var(--p-text-color); background: var(--viewer-toolbar-panel-background);
    border: 1px solid var(--p-content-border-color); border-radius: var(--p-border-radius-md);
    padding: 0.5rem; pointer-events: auto;
}
.audio-transport-row, .audio-volume-row, .audio-toggle-row { display: flex; align-items: center; gap: 0.5rem; }
.viewer-audio-controls--expanded { height: min(30rem, calc(100dvh - var(--viewer-header-chrome-height) - var(--viewer-bottom-chrome-height) - 1.5rem)); }
.audio-transport-row { flex-shrink: 0; }
.audio-toggle-row { justify-content: space-between; }
.audio-toggle-row label { display: flex; align-items: center; min-height: var(--rivvon-button-min-target-size); }
:deep(.rivvon-icon-action) { min-width: var(--rivvon-button-min-target-size); min-height: var(--rivvon-button-min-target-size); }
.audio-track-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.audio-track-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.85rem; }
.audio-track-time, .audio-message { font-size: 0.75rem; color: var(--p-text-muted-color); }
.audio-seek { margin: 0.65rem 0.5rem; flex-shrink: 0; }
.audio-settings-scroll { flex: 1; min-height: 0; }
.audio-settings, .audio-reactive-settings { display: flex; flex-direction: column; gap: 1rem; }
.audio-settings { padding: 0.75rem 0.5rem; }
.audio-setting-field { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.65rem; font-size: 0.8rem; }
.audio-toggle-row label { font-size: 0.8rem; }
.audio-message { margin: 0.25rem 0.5rem; }
.audio-error { color: var(--p-red-400); }
.audio-level { height: 0.4rem; }
@media (max-width: 600px) { .viewer-audio-controls { right: 0.5rem; width: calc(100vw - 1rem); } }
</style>
