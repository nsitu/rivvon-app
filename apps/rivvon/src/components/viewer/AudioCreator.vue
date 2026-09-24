<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import { useRouter } from 'vue-router';
import { useGoogleAuth } from '../../composables/shared/useGoogleAuth.js';
import { createAudioWaveform, inspectAudioSource, trimAudioSource } from '../../modules/viewer/audioProcessing.js';
import { publishAudioBlob } from '../../services/audioService.js';

const emit = defineEmits(['request-close']);

const router = useRouter();
const { isAuthenticated, login, user } = useGoogleAuth();
const fileInput = ref(null);
const sourceFile = ref(null);
const sourceMetadata = ref(null);
const waveform = ref([]);
const waveformCanvas = ref(null);
const mediaElement = ref(null);
const title = ref('');
const start = ref(0);
const end = ref(0);
const playhead = ref(0);
const isLoading = ref(false);
const isSaving = ref(false);
const progress = ref(0);
const status = ref('');
const error = ref('');
const objectUrl = ref('');
let activeHandle = null;

const hasSource = computed(() => Boolean(sourceFile.value && sourceMetadata.value));
const sourceIsVideo = computed(() => sourceFile.value?.type?.startsWith('video/'));
const selectedDuration = computed(() => Math.max(0, end.value - start.value));
const startPercent = computed(() => sourceMetadata.value?.duration ? (start.value / sourceMetadata.value.duration) * 100 : 0);
const endPercent = computed(() => sourceMetadata.value?.duration ? (end.value / sourceMetadata.value.duration) * 100 : 100);

function formatDuration(value) {
    const total = Math.max(0, Math.round(Number(value) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function filenameTitle(file) {
    return file.name.replace(/\.[^.]+$/, '').trim().slice(0, 120);
}

function drawWaveform() {
    const canvas = waveformCanvas.value;
    if (!canvas || !waveform.value.length) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(dpr, dpr);
    const cssWidth = rect.width;
    const cssHeight = rect.height;
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.fillStyle = '#101522';
    context.fillRect(0, 0, cssWidth, cssHeight);
    const middle = cssHeight / 2;
    const barWidth = cssWidth / waveform.value.length;
    waveform.value.forEach((peak, index) => {
        const height = Math.max(2, peak * (cssHeight * .82));
        const x = index * barWidth;
        const selected = index / waveform.value.length >= startPercent.value / 100
            && index / waveform.value.length <= endPercent.value / 100;
        context.fillStyle = selected ? '#68b8ff' : '#42516d';
        context.fillRect(x, middle - height / 2, Math.max(1, barWidth - .5), height);
    });
    const playheadX = sourceMetadata.value?.duration ? (playhead.value / sourceMetadata.value.duration) * cssWidth : 0;
    context.fillStyle = '#f8fafc';
    context.fillRect(Math.max(0, playheadX - 1), 0, 2, cssHeight);
}

function updateMediaTime(event) {
    playhead.value = Number(event.target.currentTime) || 0;
    drawWaveform();
}

function seekTo(time) {
    const bounded = Math.min(Math.max(0, Number(time) || 0), sourceMetadata.value?.duration || 0);
    playhead.value = bounded;
    if (mediaElement.value) mediaElement.value.currentTime = bounded;
    drawWaveform();
}

function handleWaveformPointer(event) {
    if (!sourceMetadata.value || !waveformCanvas.value) return;
    const rect = waveformCanvas.value.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const time = ratio * sourceMetadata.value.duration;
    if (!activeHandle) {
        activeHandle = Math.abs(time - start.value) <= Math.abs(time - end.value) ? 'start' : 'end';
    }
    if (activeHandle === 'start') start.value = Math.min(time, end.value - .05);
    else end.value = Math.max(time, start.value + .05);
    seekTo(time);
    drawWaveform();
}

function releaseWaveformPointer() {
    activeHandle = null;
    window.removeEventListener('pointermove', handleWaveformPointer);
    window.removeEventListener('pointerup', releaseWaveformPointer);
}

function beginWaveformPointer(event) {
    activeHandle = null;
    handleWaveformPointer(event);
    window.addEventListener('pointermove', handleWaveformPointer);
    window.addEventListener('pointerup', releaseWaveformPointer, { once: true });
}

function setStart(value) {
    start.value = Math.min(Math.max(0, Number(value) || 0), end.value - .05);
    if (playhead.value < start.value) seekTo(start.value);
    drawWaveform();
}

function setEnd(value) {
    end.value = Math.max(Math.min(sourceMetadata.value?.duration || 0, Number(value) || 0), start.value + .05);
    if (playhead.value > end.value) seekTo(end.value);
    drawWaveform();
}

function clearSource() {
    releaseWaveformPointer();
    if (objectUrl.value) URL.revokeObjectURL(objectUrl.value);
    objectUrl.value = '';
    sourceFile.value = null;
    sourceMetadata.value = null;
    waveform.value = [];
    title.value = '';
    start.value = 0;
    end.value = 0;
    playhead.value = 0;
    if (fileInput.value) fileInput.value.value = '';
}

async function handleFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    isLoading.value = true;
    error.value = '';
    status.value = 'Reading audio track…';
    try {
        clearSource();
        const metadata = await inspectAudioSource(file);
        const waveformResult = await createAudioWaveform(file, {
            onProgress: (value) => { progress.value = value; },
        });
        sourceFile.value = file;
        sourceMetadata.value = metadata;
        waveform.value = waveformResult.peaks;
        title.value = filenameTitle(file);
        start.value = 0;
        end.value = metadata.duration;
        objectUrl.value = URL.createObjectURL(file);
        status.value = 'Ready to trim and save.';
        await nextTick();
        drawWaveform();
    } catch (loadError) {
        error.value = loadError?.message || 'Unable to read the selected media.';
        status.value = '';
    } finally {
        isLoading.value = false;
    }
}

async function saveAudio() {
    if (isSaving.value || !hasSource.value) return;
    if (!isAuthenticated.value) {
        login();
        return;
    }
    if (!title.value.trim()) {
        error.value = 'Enter a title before saving.';
        return;
    }
    isSaving.value = true;
    error.value = '';
    progress.value = 0;
    try {
        status.value = 'Encoding selected range…';
        const blob = await trimAudioSource(sourceFile.value, {
            start: start.value,
            end: end.value,
            onProgress: (value) => { progress.value = value; },
        });
        await publishAudioBlob({
            metadata: {
                name: title.value.trim(),
                duration: selectedDuration.value,
                sampleRate: sourceMetadata.value.sampleRate,
                channelCount: sourceMetadata.value.channelCount,
                sourceFilename: sourceFile.value.name,
                sourceMimeType: sourceFile.value.type,
                userProfile: user.value ? {
                    name: user.value.name,
                    email: user.value.email,
                    picture: user.value.picture,
                } : null,
            },
            blob,
            onProgress: (value) => { progress.value = value; },
            onStatus: (value) => { status.value = value; },
        });
        status.value = 'Saved to your audio library.';
        emit('request-close');
        await router.push({ name: 'audio-library' });
    } catch (saveError) {
        error.value = saveError?.message || 'Unable to save the audio.';
        status.value = '';
    } finally {
        isSaving.value = false;
    }
}

function close() {
    clearSource();
    emit('request-close');
}

watch([start, end, waveform], drawWaveform);
onBeforeUnmount(() => {
    releaseWaveformPointer();
    if (objectUrl.value) URL.revokeObjectURL(objectUrl.value);
});
</script>

<template>
    <main class="audio-creator-panel">
        <div class="audio-creator-scroll viewer-chrome-panel-container">
            <section class="audio-creator-content">
                <div class="audio-creator-heading">
                    <div>
                        <p class="eyebrow">Create / Audio</p>
                        <h1>Create audio</h1>
                        <p>Extract a soundtrack from an audio or video file, trim it, and save it to your library.</p>
                    </div>
                    <Button severity="secondary" variant="outlined" :disabled="isSaving" @click="close">Close</Button>
                </div>

                <label class="audio-file-picker">
                    <span class="material-symbols-outlined">upload_file</span>
                    <span>{{ sourceFile ? 'Choose another file' : 'Choose audio or video file' }}</span>
                    <small>Audio files and videos with an audio track</small>
                    <input ref="fileInput" type="file" accept="audio/*,video/*" :disabled="isLoading || isSaving" @change="handleFileSelected">
                </label>

                <section v-if="hasSource" class="audio-editor" aria-label="Audio editor">
                    <div class="audio-source-row">
                        <div>
                            <strong>{{ sourceFile.name }}</strong>
                            <span>{{ formatDuration(sourceMetadata.duration) }} · {{ sourceMetadata.channelCount }} channel{{ sourceMetadata.channelCount === 1 ? '' : 's' }}</span>
                        </div>
                        <Button severity="secondary" variant="outlined" size="small" :disabled="isSaving" @click="clearSource">Remove</Button>
                    </div>

                    <div class="waveform-shell">
                        <canvas ref="waveformCanvas" @pointerdown="beginWaveformPointer"></canvas>
                        <div class="selection-window" :style="{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }"></div>
                    </div>
                    <div class="trim-controls">
                        <label>Start {{ formatDuration(start) }}
                            <input type="range" min="0" :max="sourceMetadata.duration" step="0.01" :value="start" @input="setStart($event.target.value)">
                        </label>
                        <label>End {{ formatDuration(end) }}
                            <input type="range" min="0" :max="sourceMetadata.duration" step="0.01" :value="end" @input="setEnd($event.target.value)">
                        </label>
                    </div>

                    <div class="audio-preview">
                        <video v-if="sourceIsVideo" ref="mediaElement" :src="objectUrl" controls playsinline preload="metadata" @timeupdate="updateMediaTime"></video>
                        <audio v-else ref="mediaElement" :src="objectUrl" controls preload="metadata" @timeupdate="updateMediaTime"></audio>
                    </div>

                    <div class="audio-title-field">
                        <label for="audio-title">Title</label>
                        <InputText id="audio-title" v-model="title" maxlength="120" :disabled="isSaving" required />
                    </div>
                    <p class="audio-selection-summary">Selected {{ formatDuration(selectedDuration) }} from {{ formatDuration(start) }} to {{ formatDuration(end) }}.</p>
                    <div v-if="status || error" class="audio-status" :class="{ error }" role="status">
                        <span class="material-symbols-outlined">{{ error ? 'warning' : 'cloud_upload' }}</span>
                        <span>{{ error || status }}</span>
                    </div>
                    <progress v-if="isLoading || isSaving" :value="progress" max="1" aria-label="Audio processing progress"></progress>
                    <div class="audio-actions">
                        <Button severity="secondary" variant="outlined" :disabled="isSaving" @click="seekTo(start)"><span class="material-symbols-outlined">play_arrow</span>Preview start</Button>
                        <Button :disabled="isSaving || selectedDuration < .05" @click="saveAudio"><span class="material-symbols-outlined">cloud_upload</span>{{ isAuthenticated ? 'Save to library' : 'Sign in to save' }}</Button>
                    </div>
                </section>

                <section v-else-if="isLoading" class="audio-empty"><span class="material-symbols-outlined audio-spinner">progress_activity</span><h2>Preparing audio…</h2></section>
                <section v-else class="audio-empty"><span class="material-symbols-outlined">equalizer</span><h2>Choose a source file to begin</h2><p>Your saved result will be available from Browse / Audio Library.</p></section>
            </section>
        </div>
    </main>
</template>

<style scoped>
.audio-creator-panel { position: absolute; inset: 0; z-index: 6; display: flex; flex-direction: column; color: #f8fafc; background: #1a1a1a; }
.audio-creator-scroll { flex: 1; min-height: 0; overflow-y: auto; }
.audio-creator-content { width: min(100%, 62rem); margin: 0 auto; padding: 1.5rem 1.25rem 5rem; }
.audio-creator-heading { display: flex; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
.eyebrow { margin: 0 0 .3rem; color: #60a5fa; font-size: .75rem; letter-spacing: .12em; text-transform: uppercase; }
h1 { margin: 0; font-size: clamp(1.5rem, 3vw, 2.4rem); }
.audio-creator-heading p:last-child { max-width: 42rem; color: #a1a1aa; line-height: 1.5; }
.audio-file-picker { display: grid; min-height: 8rem; padding: 1.25rem; border: 1px dashed #51709a; color: #dbeafe; background: #111827; cursor: pointer; place-items: center; text-align: center; }
.audio-file-picker .material-symbols-outlined { font-size: 2rem; color: #60a5fa; }
.audio-file-picker small { color: #94a3b8; }
.audio-file-picker input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.audio-editor { margin-top: 1.5rem; padding: 1rem; border: 1px solid #334155; background: #111827; }
.audio-source-row, .audio-actions { display: flex; align-items: center; justify-content: space-between; gap: .8rem; }
.audio-source-row span { display: block; margin-top: .25rem; color: #94a3b8; font-size: .8rem; }
.waveform-shell { position: relative; height: 11rem; margin-top: 1rem; overflow: hidden; border: 1px solid #334155; touch-action: none; }
.waveform-shell canvas { position: relative; z-index: 1; display: block; width: 100%; height: 100%; cursor: ew-resize; }
.selection-window { position: absolute; z-index: 2; top: 0; bottom: 0; border-inline: 2px solid #f8fafc; background: rgba(96, 165, 250, .11); pointer-events: none; }
.trim-controls { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0; }
.trim-controls label, .audio-title-field label { display: grid; gap: .45rem; color: #cbd5e1; font-size: .8rem; }
.trim-controls input { width: 100%; accent-color: #60a5fa; }
.audio-preview { margin: 1rem 0; }
.audio-preview audio, .audio-preview video { display: block; width: 100%; max-height: 18rem; background: #05070d; }
.audio-title-field { max-width: 32rem; }
.audio-selection-summary { color: #94a3b8; font-size: .82rem; }
.audio-status { display: flex; align-items: center; gap: .5rem; margin: 1rem 0; color: #86efac; font-size: .85rem; }
.audio-status.error { color: #fca5a5; }
progress { width: 100%; accent-color: #60a5fa; }
.audio-actions { justify-content: flex-end; margin-top: 1rem; flex-wrap: wrap; }
.audio-empty { display: grid; min-height: 30rem; place-items: center; text-align: center; }
.audio-empty .material-symbols-outlined { font-size: 3rem; color: #60a5fa; }
.audio-empty h2 { margin: .75rem 0 .25rem; }
.audio-empty p { color: #94a3b8; }
.audio-spinner { animation: audio-spin .9s linear infinite; }
@keyframes audio-spin { to { transform: rotate(360deg); } }
@media (max-width: 700px) { .audio-creator-heading { align-items: flex-start; flex-direction: column; } .trim-controls { grid-template-columns: 1fr; } .audio-source-row { align-items: flex-start; flex-direction: column; } .audio-actions > * { flex: 1; } }
</style>
