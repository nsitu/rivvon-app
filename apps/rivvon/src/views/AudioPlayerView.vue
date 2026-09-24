<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import Button from 'primevue/button';
import { fetchAudio } from '../services/audioService.js';

const route = useRoute();
const audio = ref(null);
const isLoading = ref(true);
const error = ref('');
const copied = ref(false);
const audioElement = ref(null);
const playbackUrl = computed(() => audio.value?.playback_url || '');

function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function formatFileSize(bytes) {
    const value = Number(bytes) || 0;
    return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;
}

async function loadAudio() {
    isLoading.value = true;
    error.value = '';
    try {
        const response = await fetchAudio(route.params.audioId);
        audio.value = response.audio;
    } catch (loadError) {
        error.value = loadError?.message || 'Unable to load this audio.';
    } finally {
        isLoading.value = false;
    }
}

async function copyLink() {
    try {
        await navigator.clipboard.writeText(window.location.href);
        copied.value = true;
        window.setTimeout(() => { copied.value = false; }, 1800);
    } catch {
        error.value = 'Unable to copy the audio link.';
    }
}

watch(() => route.params.audioId, loadAudio);
onMounted(loadAudio);
</script>

<template>
    <main class="audio-player-panel">
        <div class="audio-player-scroll viewer-chrome-panel-container">
            <section v-if="isLoading" class="audio-player-message"><span class="material-symbols-outlined audio-spinner">progress_activity</span><h1>Loading audio…</h1></section>
            <section v-else-if="error || !audio" class="audio-player-message audio-player-error"><span class="material-symbols-outlined">warning</span><h1>Audio unavailable</h1><p>{{ error }}</p></section>
            <article v-else class="audio-player-content">
                <div class="audio-player-art"><span class="material-symbols-outlined">equalizer</span></div>
                <h1>{{ audio.name }}</h1>
                <p class="audio-player-meta">{{ formatDuration(audio.duration) }} · {{ formatFileSize(audio.file_size) }} · {{ audio.channel_count }} channel{{ audio.channel_count === 1 ? '' : 's' }}</p>
                <audio ref="audioElement" :src="playbackUrl" controls autoplay preload="metadata"></audio>
                <div class="audio-player-actions">
                    <Button type="button" @click="copyLink"><span class="material-symbols-outlined">link</span>{{ copied ? 'Copied' : 'Copy Link' }}</Button>
                    <a :href="playbackUrl" :download="`${audio.name}.mp4`"><span class="material-symbols-outlined">download</span>Download</a>
                </div>
            </article>
        </div>
    </main>
</template>

<style scoped>
.audio-player-panel { position: absolute; inset: 0; z-index: 6; display: flex; flex-direction: column; color: #f8fafc; background: #1a1a1a; }
.audio-player-scroll { flex: 1; min-height: 0; overflow-y: auto; }
.audio-player-content { width: min(100%, 54rem); margin: 4rem auto; padding: 1.25rem; text-align: center; }
.audio-player-art { display: grid; width: min(24rem, 80vw); aspect-ratio: 1; margin: 0 auto 2rem; border: 1px solid #3b82f6; color: #60a5fa; background: radial-gradient(circle, #172554, #0f172a 70%); place-items: center; }
.audio-player-art .material-symbols-outlined { font-size: 8rem; }
.audio-player-content h1 { margin: 0; font-size: clamp(1.5rem, 4vw, 2.6rem); }
.audio-player-meta { color: #94a3b8; }
.audio-player-content audio { width: 100%; margin: 1.5rem 0; }
.audio-player-actions { display: flex; justify-content: center; gap: .6rem; flex-wrap: wrap; }
.audio-player-actions a, .audio-player-actions button { display: inline-flex; align-items: center; gap: .4rem; padding: .65rem .85rem; border: 1px solid #3c3c3c; color: #eef2ff; background: #202020; font: inherit; text-decoration: none; cursor: pointer; }
.audio-player-message { display: flex; min-height: 55vh; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.audio-player-message > .material-symbols-outlined { font-size: 3rem; color: #60a5fa; }
.audio-player-error > .material-symbols-outlined { color: #f87171; }
.audio-spinner { animation: audio-spin .9s linear infinite; }
@keyframes audio-spin { to { transform: rotate(360deg); } }
</style>
