<script setup>
import { computed, onMounted, onBeforeUnmount, watch, ref, inject } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import ScrollPanel from 'primevue/scrollpanel';
import PanelActionBar from '../components/shared/PanelActionBar.vue';
import ChromeButton from '../components/shared/ChromeButton.vue';
import { VIEWER_AUDIO_KEY } from '../modules/viewer/audioReactivity.js';
import { getAudioPlaybackUrl } from '../modules/viewer/audioPlayback.js';
import { useGoogleAuth } from '../composables/shared/useGoogleAuth.js';
import { deleteAudioPublication, fetchMyAudios, fetchAudioPresetDependencies } from '../services/audioService.js';

const { isAuthenticated, login } = useGoogleAuth();
const audios = ref([]);
const isLoading = ref(false);
const error = ref('');
const deletingIds = ref(new Set());
const audioElements = new Map();
const router = useRouter();
const emit = defineEmits(['request-use-audio']);
const viewerAudio = inject(VIEWER_AUDIO_KEY, null);
const pendingDeletion = ref(null);
const linkedPresetsToDelete = ref([]), checkingDependencies = ref(false), dependencyError = ref('');
watch(pendingDeletion, async (audio) => {
    linkedPresetsToDelete.value = []; dependencyError.value = '';
    if (!audio) { checkingDependencies.value = false; return; }
    checkingDependencies.value = true;
    try {
        const data = await fetchAudioPresetDependencies(audio.id);
        if (pendingDeletion.value?.id === audio.id) linkedPresetsToDelete.value = data.linkedPresets;
    } catch (failure) { if (pendingDeletion.value?.id === audio.id) dependencyError.value = failure.message; }
    finally { if (pendingDeletion.value?.id === audio.id) checkingDependencies.value = false; }
});

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
        pausePreviews();
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
    viewerAudio?.pause();
    audioElements.forEach((element) => {
        if (element !== event.target) element.pause();
    });
}

function pausePreviews() {
    audioElements.forEach((element) => element.pause());
}

function useInViewer(audio) {
    pausePreviews();
    emit('request-use-audio', audio);
}

async function deleteAudio(audio) {
    deletingIds.value = new Set([...deletingIds.value, audio.id]);
    try {
        await deleteAudioPublication(audio.id, linkedPresetsToDelete.value.map(preset => preset.id));
        audioElements.get(audio.id)?.pause();
        audios.value = audios.value.filter((entry) => entry.id !== audio.id);
        if (viewerAudio?.state.track?.id === audio.id) viewerAudio.remove();
        pendingDeletion.value = null;
    } catch (deleteError) {
        if (deleteError.payload?.code === 'PRESET_DEPENDENCIES') {
            linkedPresetsToDelete.value = deleteError.payload.linkedPresets;
            dependencyError.value = '';
            return;
        }
        error.value = deleteError?.message || 'Unable to delete the audio.';
        dependencyError.value = error.value;
    } finally {
        const next = new Set(deletingIds.value);
        next.delete(audio.id);
        deletingIds.value = next;
    }
}

watch(isAuthenticated, loadAudios);
onMounted(loadAudios);
onBeforeUnmount(pausePreviews);
</script>

<template>
    <main class="audio-library-panel viewer-panel">
        <div class="audio-library-container viewer-chrome-panel-container">
            <PanelActionBar placement="top" appearance="chrome" aria-label="Audio library navigation">
                <ChromeButton @click="router.push({ name: 'home' })">
                    <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
                    Back to viewer
                </ChromeButton>
            </PanelActionBar>
            <ScrollPanel class="rivvon-scroll-panel audio-library-scroll">
            <div class="audio-library-content">

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
                        <audio :ref="(element) => setAudioElement(audio.id, element)" :src="getAudioPlaybackUrl(audio.playback_url)" crossorigin="anonymous" controls preload="metadata" @play="handlePlay"></audio>
                        <div class="audio-card-meta">
                            <span>{{ formatDuration(audio.duration) }}</span>
                            <span>{{ formatFileSize(audio.file_size) }}</span>
                            <span>{{ formatDate(audio.created_at) }}</span>
                        </div>
                        <div class="audio-card-footer">
                            <Button type="button" severity="secondary" variant="outlined" @click="useInViewer(audio)">
                                <span class="material-symbols-outlined" aria-hidden="true">play_arrow</span>
                                {{ viewerAudio?.state.track?.id === audio.id ? 'Active in viewer' : 'Use in viewer' }}
                            </Button>
                            <RouterLink :to="{ name: 'audio-player', params: { audioId: audio.id } }">Open player</RouterLink>
                            <Button type="button" severity="secondary" variant="text" class="rivvon-icon-action" :disabled="deletingIds.has(audio.id)" :aria-label="`Delete ${audio.name}`" @click="pendingDeletion = audio">
                                <span class="material-symbols-outlined" aria-hidden="true">delete</span>
                            </Button>
                        </div>
                    </article>
                </section>
            </div>
            </ScrollPanel>
            <PanelActionBar aria-label="Audio library actions">
                <Button type="button" severity="secondary" @click="router.push({ name: 'home' })">Done</Button>
            </PanelActionBar>
        </div>
        <Dialog :visible="!!pendingDeletion" modal header="Delete audio" :style="{ width: 'min(26rem, 90vw)' }"
            :closable="!deletingIds.has(pendingDeletion?.id)" :close-on-escape="!deletingIds.has(pendingDeletion?.id)"
            @update:visible="(visible) => { if (!visible) pendingDeletion = null; }">
            <p>Delete “{{ pendingDeletion?.name }}” from your audio library?</p>
            <p v-if="checkingDependencies" role="status">Checking linked presets…</p>
            <div v-if="linkedPresetsToDelete.length" role="alert">
                <p>This also deletes {{ linkedPresetsToDelete.length }} linked preset(s) and disables their shared links:</p>
                <ul><li v-for="preset in linkedPresetsToDelete.slice(0, 6)" :key="preset.id">{{ preset.name }}</li></ul>
                <p v-if="linkedPresetsToDelete.length > 6">And {{ linkedPresetsToDelete.length - 6 }} more.</p>
                <p>Cancel to keep the audio and presets.</p>
            </div>
            <p v-if="dependencyError" role="alert">{{ dependencyError }}</p>
            <template #footer>
                <Button type="button" severity="secondary" variant="text" :disabled="deletingIds.has(pendingDeletion?.id)" @click="pendingDeletion = null">Cancel</Button>
                <Button type="button" severity="danger" :loading="deletingIds.has(pendingDeletion?.id)" :disabled="checkingDependencies || Boolean(dependencyError)" @click="deleteAudio(pendingDeletion)">{{ linkedPresetsToDelete.length ? 'Delete Audio and Presets' : 'Delete' }}</Button>
            </template>
        </Dialog>
    </main>
</template>

<style scoped>
.audio-library-panel { position: absolute; inset: 0; z-index: 6; display: flex; flex-direction: column; color: #f8fafc; }
.audio-library-container { display: flex; width: 100%; height: 100%; min-height: 0; flex-direction: column; box-sizing: border-box; }
.audio-library-content { width: min(100%, 72rem); margin: auto; padding: 1.5rem 1.25rem; }
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
.audio-card-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: .5rem; padding-top: .65rem; border-top: 1px solid #26364d; font-size: .8rem; }
.audio-library-empty { display: flex; min-height: 45vh; max-width: 36rem; margin: auto; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.audio-library-empty > .material-symbols-outlined { font-size: 3rem; color: #60a5fa; }
.audio-library-empty h2 { margin: .8rem 0 .3rem; }
.audio-library-empty p { color: #94a3b8; }
.audio-library-error > .material-symbols-outlined { color: #f87171; }
.audio-spinner { animation: audio-spin .9s linear infinite; }
@keyframes audio-spin { to { transform: rotate(360deg); } }
</style>
