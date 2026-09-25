<script setup>
import { computed, onMounted, watch, ref } from 'vue';
import { RouterLink } from 'vue-router';
import Button from 'primevue/button';
import { useGoogleAuth } from '../composables/shared/useGoogleAuth.js';
import { deleteAudioPublication, fetchMyAudios } from '../services/audioService.js';

const { isAuthenticated, login } = useGoogleAuth();
const audios = ref([]);
const isLoading = ref(false);
const error = ref('');
const deletingIds = ref(new Set());
const audioElements = new Map();

const hasAudios = computed(() => audios.value.length > 0);

function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function formatFileSize(bytes) {
    const value = Number(bytes) || 0;
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function formatDate(timestamp) {
    return new Date(Number(timestamp) * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

async function loadAudios() {
    if (!isAuthenticated.value) {
        audios.value = [];
        return;
    }
    isLoading.value = true;
    error.value = '';
    try {
        const response = await fetchMyAudios();
        audios.value = response.audios || [];
    } catch (loadError) {
        error.value = loadError?.message || 'Unable to load your audio library.';
    } finally {
        isLoading.value = false;
    }
}

function setAudioElement(id, element) {
    if (element) audioElements.set(id, element);
    else audioElements.delete(id);
}

function handlePlay(event) {
    audioElements.forEach((element) => {
        if (element !== event.target) element.pause();
    });
}

async function deleteAudio(audio) {
    if (!window.confirm(`Delete “${audio.name}” from your audio library?`)) return;
    deletingIds.value = new Set([...deletingIds.value, audio.id]);
    try {
        await deleteAudioPublication(audio.id);
        audios.value = audios.value.filter((entry) => entry.id !== audio.id);
    } catch (deleteError) {
        error.value = deleteError?.message || 'Unable to delete the audio.';
    } finally {
        const next = new Set(deletingIds.value);
        next.delete(audio.id);
        deletingIds.value = next;
    }
}

watch(isAuthenticated, loadAudios);
onMounted(loadAudios);
</script>

<template>
    <main class="audio-library-panel">
        <div class="audio-library-scroll viewer-chrome-panel-container">
            <div class="audio-library-content">
                <div class="audio-library-heading">
                    <div>
                        <p class="eyebrow">Browse / Audio</p>
                        <h1>Audio Library</h1>
                        <p>Your saved audio tracks are ready to preview and reuse.</p>
                    </div>
                    <RouterLink to="/" class="viewer-link">Back to viewer</RouterLink>
                </div>

                <section v-if="!isAuthenticated" class="audio-library-empty">
                    <span class="material-symbols-outlined">login</span>
                    <h2>Sign in to see your audio</h2>
                    <p>Audio you create and save will appear here.</p>
                    <Button @click="login">Sign in</Button>
                </section>
                <section v-else-if="isLoading" class="audio-library-empty" aria-live="polite">
                    <span class="material-symbols-outlined audio-spinner">progress_activity</span>
                    <h2>Loading audio…</h2>
                </section>
                <section v-else-if="error" class="audio-library-empty audio-library-error" role="alert">
                    <span class="material-symbols-outlined">warning</span>
                    <h2>Audio library unavailable</h2>
                    <p>{{ error }}</p>
                    <Button severity="secondary" @click="loadAudios">Try again</Button>
                </section>
                <section v-else-if="!hasAudios" class="audio-library-empty">
                    <span class="material-symbols-outlined">equalizer</span>
                    <h2>No saved audio yet</h2>
                    <p>Choose Create / Audio to extract or record your first track.</p>
                    <RouterLink to="/" class="viewer-link">Open the viewer</RouterLink>
                </section>
                <section v-else class="audio-card-grid" aria-live="polite">
                    <article v-for="audio in audios" :key="audio.id" class="audio-card">
                        <RouterLink :to="{ name: 'audio-player', params: { audioId: audio.id } }" class="audio-card-title">
                            <span class="material-symbols-outlined">equalizer</span>
                            <span>{{ audio.name }}</span>
                        </RouterLink>
                        <audio :ref="(element) => setAudioElement(audio.id, element)" :src="audio.playback_url" controls preload="metadata" @play="handlePlay"></audio>
                        <div class="audio-card-meta">
                            <span>{{ formatDuration(audio.duration) }}</span>
                            <span>{{ formatFileSize(audio.file_size) }}</span>
                            <span>{{ formatDate(audio.created_at) }}</span>
                        </div>
                        <div class="audio-card-footer">
                            <RouterLink :to="{ name: 'audio-player', params: { audioId: audio.id } }">Open player</RouterLink>
                            <button type="button" class="delete-audio-button" :disabled="deletingIds.has(audio.id)" :aria-label="`Delete ${audio.name}`" @click="deleteAudio(audio)">
                                <span class="material-symbols-outlined">delete</span>
                            </button>
                        </div>
                    </article>
                </section>
            </div>
        </div>
    </main>
</template>

<style scoped>
.audio-library-panel { position: absolute; inset: 0; z-index: 6; display: flex; flex-direction: column; color: #f8fafc; background: #1a1a1a; }
.audio-library-scroll { flex: 1; min-height: 0; overflow-y: auto; }
.audio-library-content { width: min(100%, 72rem); margin: auto; padding: 1.5rem 1.25rem 5rem; }
.audio-library-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
.eyebrow { margin: 0 0 .3rem; color: #60a5fa; font-size: .75rem; letter-spacing: .12em; text-transform: uppercase; }
h1 { margin: 0; font-size: clamp(1.5rem, 3vw, 2.4rem); }
.audio-library-heading p:last-child { color: #a1a1aa; }
.viewer-link, .audio-card-footer a { color: #93c5fd; text-decoration: none; }
.audio-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr)); gap: 1rem; }
.audio-card { display: flex; flex-direction: column; gap: .8rem; padding: 1rem; border: 1px solid #334155; background: #111827; }
.audio-card:hover { border-color: #60a5fa; }
.audio-card-title { display: flex; align-items: center; gap: .6rem; min-width: 0; color: #f8fafc; font-weight: 600; text-decoration: none; }
.audio-card-title span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.audio-card-title .material-symbols-outlined { color: #60a5fa; }
.audio-card audio { width: 100%; }
.audio-card-meta { display: flex; gap: .7rem; color: #94a3b8; font-size: .75rem; }
.audio-card-meta span + span::before { content: '·'; margin-right: .7rem; }
.audio-card-footer { display: flex; align-items: center; justify-content: space-between; padding-top: .65rem; border-top: 1px solid #26364d; font-size: .8rem; }
.delete-audio-button { display: grid; width: 2rem; height: 2rem; border: 0; color: #fca5a5; background: transparent; cursor: pointer; place-items: center; }
.delete-audio-button:hover { background: rgba(239,68,68,.12); }
.audio-library-empty { display: flex; min-height: 45vh; max-width: 36rem; margin: auto; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.audio-library-empty > .material-symbols-outlined { font-size: 3rem; color: #60a5fa; }
.audio-library-empty h2 { margin: .8rem 0 .3rem; }
.audio-library-empty p { color: #94a3b8; }
.audio-library-error > .material-symbols-outlined { color: #f87171; }
.audio-spinner { animation: audio-spin .9s linear infinite; }
@keyframes audio-spin { to { transform: rotate(360deg); } }
@media (max-width: 700px) { .audio-library-heading { flex-direction: column; } }
</style>
