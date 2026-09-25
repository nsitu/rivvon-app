<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import Button from 'primevue/button';

defineProps({
    disabled: {
        type: Boolean,
        default: false,
    },
    isRecording: {
        type: Boolean,
        default: false,
    },
    recordingDuration: {
        type: Number,
        default: 0,
    },
    recordingSupported: {
        type: Boolean,
        default: false,
    },
});

const emit = defineEmits(['start', 'stop', 'canvas-ready']);
const recordingWaveformCanvas = ref(null);

function formatDuration(value) {
    const total = Math.max(0, Math.round(Number(value) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

onMounted(() => emit('canvas-ready', recordingWaveformCanvas.value));
onBeforeUnmount(() => emit('canvas-ready', null));
</script>

<template>
    <section class="audio-recording-card" aria-label="Record audio">
        <span class="material-symbols-outlined recording-icon">mic</span>
        <h2>Record from your microphone</h2>
        <p v-if="!recordingSupported" class="recording-error">This browser does not support microphone recording.</p>
        <p v-else>Record a clip, then trim it before saving it to your audio library.</p>
        <canvas ref="recordingWaveformCanvas" class="recording-waveform" aria-label="Live recording waveform"></canvas>
        <output class="recording-timer" aria-live="polite">{{ formatDuration(recordingDuration) }}</output>
        <Button
            v-if="!isRecording"
            class="recording-action"
            :disabled="disabled || !recordingSupported"
            @click="emit('start')"
        >
            <span class="material-symbols-outlined">mic</span>Start recording
        </Button>
        <Button
            v-else
            severity="danger"
            class="recording-action recording-stop-action"
            :disabled="disabled"
            @click="emit('stop')"
        >
            <span class="material-symbols-outlined">stop</span>Stop recording
        </Button>
        <p class="recording-hint">Microphone access is requested only when you start recording.</p>
    </section>
</template>

<style scoped>
.audio-recording-card { display: grid; min-height: 14rem; padding: 1.5rem; border: 1px solid #51709a; color: #dbeafe; background: #111827; place-items: center; text-align: center; }
.recording-icon { font-size: 2.5rem; color: #f87171; }
.audio-recording-card h2 { margin: .25rem 0 0; color: #f8fafc; }
.audio-recording-card p { max-width: 34rem; margin: .25rem 0; color: #94a3b8; }
.recording-waveform { display: block; width: min(100%, 38rem); height: 6rem; border: 1px solid #334155; background: #101522; }
.recording-timer { color: #f8fafc; font-variant-numeric: tabular-nums; font-size: 2rem; font-weight: 600; }
.recording-error { color: #fca5a5 !important; }
.recording-hint { font-size: .75rem; }
.recording-action { gap: .4rem; }
</style>
