<script setup>
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue';
import { CLIP_FILE_ACCEPT } from '../../../../packages/shared-types/src/clipAsset.js';
import Button from 'primevue/button';
import ScrollPanel from 'primevue/scrollpanel';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import FileUpload from 'primevue/fileupload';
import ProgressBar from 'primevue/progressbar';
import PanelActionBar from '../components/shared/PanelActionBar.vue';
import ClipAssetPreview from '../components/viewer/ClipAssetPreview.vue';
import { useViewerStore } from '../stores/viewerStore.js';
import { useGoogleAuth } from '../composables/shared/useGoogleAuth';
import { fetchClips, uploadClip, renameClip, deleteClip, fetchClipDependencies } from '../services/clipService.js';
defineProps({ canApply: { type: Boolean, default: true } });
const emit = defineEmits(['apply', 'close', 'deleted']);
const app = useViewerStore(), { isAuthenticated, login, user } = useGoogleAuth();
const collection = ref('mine');
const clips = ref([]), total = ref(0), loading = ref(false), error = ref(''), selected = ref(null), jobs = ref([]);
const previewButton = ref(null);
const cards = computed(() => clips.value);
const busy = computed(() => jobs.value.some(job => ['queued', 'uploading'].includes(job.state)));
const pendingRename = ref(null), newName = ref(''), renaming = ref(false), renameError = ref('');
const pendingDelete = ref(null), linkedPresets = ref([]), checking = ref(false), deleting = ref(false), deletionError = ref('');
let generation = 0, dependencyGeneration = 0, alive = true, previewOrigin = null;
async function loadMore(reset = false) {
    const token = ++generation; loading.value = true; error.value = '';
    try {
        const result = await fetchClips({ offset: reset ? 0 : clips.value.length });
        if (token !== generation || !alive) return;
        const rows = result.clips.map(clip => ({ ...clip, source: { kind: 'clip', id: clip.id } }));
        clips.value = reset ? rows : [...clips.value, ...rows]; total.value = result.pagination.total;
    } catch (e) { if (token === generation) error.value = e.message; }
    finally { if (token === generation) loading.value = false; }
}
watch(() => [collection.value, isAuthenticated.value, user.value?.id], () => {
    generation++; selected.value = null; clips.value = []; total.value = 0; loading.value = false;
    if (collection.value === 'mine' && isAuthenticated.value) void loadMore(true);
}, { immediate: true });
watch(() => user.value?.id || user.value?.email, () => { for (const job of jobs.value) { job.state = 'cancelled'; job.controller?.abort(); } jobs.value = []; });
function select(clip, event) { previewOrigin = event?.currentTarget; selected.value = clip; nextTick(() => previewButton.value?.$el?.focus()); }
function closePreview() { selected.value = null; nextTick(() => { if (previewOrigin?.isConnected) previewOrigin.focus(); }); }
function apply(clip) { emit('apply', clip); }
async function runQueue() {
    if (jobs.value.some(job => job.state === 'uploading')) return;
    for (const job of jobs.value) {
        if (!alive || job.state !== 'queued') continue;
        job.state = 'uploading'; job.controller = new AbortController(); job.error = '';
        try {
            await uploadClip(job.file, { signal: job.controller.signal, onProgress: value => { job.progress = Math.round(value * 100); }, onStatus: value => { job.status = value; } });
            job.state = 'complete'; job.status = 'Saved'; job.progress = 100;
            if (alive) await loadMore(true);
        } catch (e) { job.state = e.name === 'AbortError' ? 'cancelled' : 'error'; job.error = e.name === 'AbortError' ? 'Cancelled' : e.message; }
    }
}
function uploadFiles(event) {
    for (const file of event.files) jobs.value.push({ key: crypto.randomUUID(), file, state: 'queued', status: 'Waiting…', progress: 0, error: '', controller: null });
    void runQueue();
}
function cancel(job) { if (job.state === 'queued') { job.state = 'cancelled'; job.error = 'Cancelled'; } else job.controller?.abort(); }
function retry(job) { job.state = 'queued'; job.progress = 0; void runQueue(); }
function edit(clip) { pendingRename.value = clip; newName.value = clip.name; renameError.value = ''; }
async function saveName() {
    if (renaming.value || !newName.value.trim()) return;
    renaming.value = true; renameError.value = '';
    try { await renameClip(pendingRename.value.id, newName.value); pendingRename.value.name = newName.value.trim(); pendingRename.value = null; }
    catch (e) { renameError.value = e.message; } finally { renaming.value = false; }
}
watch(pendingDelete, async clip => {
    const token = ++dependencyGeneration; linkedPresets.value = []; deletionError.value = ''; checking.value = Boolean(clip);
    if (!clip) return;
    try { const result = await fetchClipDependencies(clip.id); if (token === dependencyGeneration) linkedPresets.value = result.linkedPresets; }
    catch (e) { if (token === dependencyGeneration) deletionError.value = e.message; }
    finally { if (token === dependencyGeneration) checking.value = false; }
});
async function confirmDelete() {
    deleting.value = true; deletionError.value = '';
    try {
        const id = pendingDelete.value.id;
        await deleteClip(id, linkedPresets.value.map(preset => preset.id));
        if (selected.value?.id === id) selected.value = null;
        pendingDelete.value = null; emit('deleted', id); await loadMore(true);
    } catch (e) {
        if (e.payload?.linkedPresets) { linkedPresets.value = e.payload.linkedPresets; deletionError.value = 'Linked presets changed. Review the list and confirm again.'; }
        else deletionError.value = e.message;
    } finally { deleting.value = false; }
}
onBeforeUnmount(() => { alive = false; generation++; dependencyGeneration++; for (const job of jobs.value) job.controller?.abort(); });
</script>
<template>
    <!-- A self-contained library uses the shared header X and a persistent Done
         action. On narrow screens its preview replaces the card grid. -->
    <main class="clip-library-panel" :class="{ 'has-preview': selected }" aria-label="Clip library">
        <div class="viewer-chrome-panel-container clip-library-container">
            <div class="clip-library-columns">
                <ScrollPanel class="rivvon-scroll-panel clip-library-grid-scroll">
                    <div class="clip-library-content">
                        <section v-if="collection === 'mine' && !isAuthenticated" class="clip-library-state">
                            <p>Sign in to upload and manage your clips.</p><Button @click="login">Sign in</Button>
                        </section>
                        <template v-else>
                            <section v-if="collection === 'mine'" class="clip-upload-section" aria-label="Upload clips">
                                <p>Clips are saved to Rivvon’s private cloud storage. Sharing a preset grants access to its background clip.</p>
                                <p class="clip-library-hint">Videos that Mediabunny can read and this browser can decode, up to 1 GB (1,000,000,000 bytes), 60 seconds, 60 fps and 1920 × 1080 pixels (portrait supported). MP4, MOV, WebM, MKV and MPEG-TS are supported when their video codec is decodable. Original files are retained; scene playback is muted.</p>
                                <FileUpload mode="basic" name="clips" :accept="CLIP_FILE_ACCEPT" multiple custom-upload auto choose-label="Upload clips" @uploader="uploadFiles" />
                                <div v-for="job in jobs" :key="job.key" class="clip-upload-job" :aria-label="job.file.name">
                                    <span>{{ job.file.name }} · {{ job.error || job.status }}</span>
                                    <ProgressBar v-if="job.state === 'uploading'" :value="job.progress" />
                                    <Button v-if="['queued', 'uploading'].includes(job.state)" size="small" severity="secondary" @click="cancel(job)">Cancel</Button>
                                    <Button v-if="['error', 'cancelled'].includes(job.state)" size="small" severity="secondary" @click="retry(job)">Retry</Button>
                                </div>
                            </section>
                            <div v-if="error" role="alert" class="clip-library-state"><p>{{ error }}</p><Button severity="secondary" @click="loadMore(true)">Try again</Button></div>
                            <p v-if="loading" role="status">Loading clips…</p>
                            <p v-if="!cards.length && !loading && !error" class="clip-library-state">No saved clips yet. Upload a clip to get started.</p>
                            <div class="clip-card-grid">
                                <article v-for="clip in cards" :key="clip.id" class="clip-card" :class="{ 'clip-card-active': app.backgroundTextureSource?.kind === clip.source.kind && app.backgroundTextureSource?.id === clip.id }">
                                    <Button type="button" variant="text" severity="secondary" class="clip-card-preview" :aria-label="`Preview ${clip.name}`" @click="select(clip, $event)">
                                        <ClipAssetPreview :source="clip.source" :title="clip.name" />
                                    </Button>
                                    <div class="clip-card-body"><span class="clip-card-name">{{ clip.name }}</span><small v-if="clip.width">{{ clip.width }} × {{ clip.height }} · {{ Number(clip.duration).toFixed(1) }} s</small>
                                        <div class="clip-card-actions">
                                            <Button type="button" size="small" :disabled="!canApply" @click="apply(clip)">Apply as background</Button>
                                            <template v-if="clip.source.kind === 'clip'">
                                                <Button type="button" variant="text" severity="secondary" class="rivvon-icon-action" :aria-label="`Rename ${clip.name}`" @click="edit(clip)"><span class="material-symbols-outlined" aria-hidden="true">edit</span></Button>
                                                <Button type="button" variant="text" severity="secondary" class="rivvon-icon-action" :aria-label="`Delete ${clip.name}`" @click="pendingDelete = clip"><span class="material-symbols-outlined" aria-hidden="true">delete</span></Button>
                                            </template>
                                        </div>
                                    </div>
                                </article>
                            </div>
                            <Button v-if="collection === 'mine' && clips.length < total" :loading="loading" severity="secondary" @click="loadMore()">Load more clips</Button>
                        </template>
                    </div>
                </ScrollPanel>
                <section v-if="selected" class="clip-library-preview" :aria-label="`Preview ${selected.name}`">
                    <ScrollPanel class="rivvon-scroll-panel"><div class="clip-preview-content"><div class="clip-large-preview"><ClipAssetPreview :source="selected.source" :title="selected.name" full /></div><p>{{ selected.name }}</p><p v-if="selected.width">{{ selected.width }} × {{ selected.height }}</p></div></ScrollPanel>
                    <PanelActionBar><Button ref="previewButton" type="button" :disabled="!canApply" @click="apply(selected)">Apply as background</Button><Button severity="secondary" @click="closePreview">Back to Clips</Button></PanelActionBar>
                </section>
            </div>
            <PanelActionBar aria-label="Clip library actions"><Button severity="secondary" @click="emit('close')">{{ busy ? 'Cancel uploads and close' : 'Done' }}</Button></PanelActionBar>
        </div>
        <Dialog :visible="!!pendingRename" modal header="Rename clip" :closable="!renaming" @update:visible="value => { if (!value) pendingRename = null; }">
            <label for="clip-name">Name</label><InputText id="clip-name" v-model="newName" maxlength="120" autofocus @keydown.enter="saveName" /><p v-if="renameError" role="alert">{{ renameError }}</p>
            <template #footer><Button severity="secondary" :disabled="renaming" @click="pendingRename = null">Cancel</Button><Button :loading="renaming" :disabled="!newName.trim()" @click="saveName">Save</Button></template>
        </Dialog>
        <Dialog :visible="!!pendingDelete" modal header="Delete clip" :closable="!deleting" @update:visible="value => { if (!value) pendingDelete = null; }">
            <p>Delete “{{ pendingDelete?.name }}” from your clip library?</p><p v-if="checking" role="status">Checking linked presets…</p>
            <div v-if="linkedPresets.length"><p>This also deletes these {{ linkedPresets.length }} presets and disables their shared links:</p><ul><li v-for="preset in linkedPresets" :key="preset.id">{{ preset.name }}</li></ul></div>
            <p v-if="deletionError" role="alert">{{ deletionError }}</p>
            <template #footer><Button severity="secondary" :disabled="deleting" @click="pendingDelete = null">Cancel</Button><Button severity="danger" :loading="deleting" :disabled="checking || (!!deletionError && !linkedPresets.length)" @click="confirmDelete">{{ linkedPresets.length ? 'Delete Clip and Presets' : 'Delete' }}</Button></template>
        </Dialog>
    </main>
</template>
<style scoped>
.clip-library-panel { position: absolute; inset: 0; z-index: 8; color: var(--p-text-color); display: flex; background: var(--viewer-panel-background); }
.clip-library-container { width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; }
.clip-library-columns { display: flex; flex: 1; min-height: 0; }
.clip-library-grid-scroll { flex: 1; min-width: 0; }
.clip-library-content { padding: 1.25rem; max-width: 80rem; margin-inline: auto; }
.clip-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr)); gap: 1rem; margin-block: 1rem; }
.clip-card { min-width: 0; border: 1px solid var(--p-content-border-color); background: var(--p-content-background); }
.clip-card-active { border-color: var(--p-primary-color); }
.clip-card-preview { width: 100%; height: 10rem; padding: 0; border-radius: 0; }
.clip-card-body { display: flex; flex-direction: column; gap: .5rem; padding: .75rem; }
.clip-card-name { overflow-wrap: anywhere; font-weight: 600; }
.clip-card-actions { display: flex; flex-wrap: wrap; gap: .25rem; align-items: center; }
.clip-library-preview { display: flex; flex-direction: column; width: 45%; min-width: 0; border-left: 1px solid var(--p-content-border-color); }
.clip-preview-content { padding: 1rem; }
.clip-large-preview { height: min(55vh, 40rem); }
.clip-library-state { text-align: center; padding: 2rem; }
.clip-library-hint, .clip-card small { color: var(--p-text-muted-color); font-size: .875rem; }
.clip-upload-section { margin-bottom: 1rem; }
.clip-upload-job { display: grid; gap: .5rem; margin-top: .75rem; overflow-wrap: anywhere; }
@media (max-width: 767px) {
    .has-preview .clip-library-grid-scroll { display: none; }
    .clip-library-preview { width: 100%; border-left: 0; }
    .has-preview :deep(.panel-action-bar-top) { display: none; }
}
</style>
