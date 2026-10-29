<script setup>
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue';
import Button from 'primevue/button';
import ScrollPanel from 'primevue/scrollpanel';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import FileUpload from 'primevue/fileupload';
import ProgressBar from 'primevue/progressbar';
import ChromeButton from '../components/shared/ChromeButton.vue';
import PanelActionBar from '../components/shared/PanelActionBar.vue';
import ImageAssetPreview from '../components/viewer/ImageAssetPreview.vue';
import { useViewerStore } from '../stores/viewerStore.js';
import { useGoogleAuth } from '../composables/shared/useGoogleAuth';
import { BACKGROUND_TEXTURE_OPTIONS } from '../modules/viewer/backgroundTextures.js';
import { fetchImages, uploadImage, renameImage, deleteImage, fetchImageDependencies } from '../services/imageService.js';
defineProps({ canApply: { type: Boolean, default: true } });
const emit = defineEmits(['apply', 'close', 'deleted']);
const app = useViewerStore(), { isAuthenticated, login, user } = useGoogleAuth();
const collection = ref(app.backgroundTextureSource?.kind === 'image' ? 'mine' : 'builtin');
const images = ref([]), total = ref(0), loading = ref(false), error = ref(''), selected = ref(null), jobs = ref([]);
const previewButton = ref(null);
const builtins = BACKGROUND_TEXTURE_OPTIONS.map(item => ({ id: item.value, name: item.label, source: { kind: 'builtin', id: item.value } }));
const cards = computed(() => collection.value === 'builtin' ? builtins : images.value);
const busy = computed(() => jobs.value.some(job => ['queued', 'uploading'].includes(job.state)));
const pendingRename = ref(null), newName = ref(''), renaming = ref(false), renameError = ref('');
const pendingDelete = ref(null), linkedPresets = ref([]), checking = ref(false), deleting = ref(false), deletionError = ref('');
let generation = 0, dependencyGeneration = 0, alive = true, previewOrigin = null;
async function loadMore(reset = false) {
    const token = ++generation; loading.value = true; error.value = '';
    try {
        const result = await fetchImages({ offset: reset ? 0 : images.value.length });
        if (token !== generation || !alive) return;
        const rows = result.images.map(image => ({ ...image, source: { kind: 'image', id: image.id } }));
        images.value = reset ? rows : [...images.value, ...rows]; total.value = result.pagination.total;
    } catch (e) { if (token === generation) error.value = e.message; }
    finally { if (token === generation) loading.value = false; }
}
watch(() => [collection.value, isAuthenticated.value, user.value?.id], () => {
    generation++; selected.value = null; images.value = []; total.value = 0; loading.value = false;
    if (collection.value === 'mine' && isAuthenticated.value) void loadMore(true);
}, { immediate: true });
watch(() => user.value?.id || user.value?.email, () => { for (const job of jobs.value) { job.state = 'cancelled'; job.controller?.abort(); } jobs.value = []; });
function select(image, event) { previewOrigin = event?.currentTarget; selected.value = image; nextTick(() => previewButton.value?.$el?.focus()); }
function closePreview() { selected.value = null; nextTick(() => { if (previewOrigin?.isConnected) previewOrigin.focus(); }); }
function apply(image) { emit('apply', image); }
async function runQueue() {
    if (jobs.value.some(job => job.state === 'uploading')) return;
    for (const job of jobs.value) {
        if (!alive || job.state !== 'queued') continue;
        job.state = 'uploading'; job.controller = new AbortController(); job.error = '';
        try {
            await uploadImage(job.file, { signal: job.controller.signal, onProgress: value => { job.progress = Math.round(value * 100); }, onStatus: value => { job.status = value; } });
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
function edit(image) { pendingRename.value = image; newName.value = image.name; renameError.value = ''; }
async function saveName() {
    if (renaming.value || !newName.value.trim()) return;
    renaming.value = true; renameError.value = '';
    try { await renameImage(pendingRename.value.id, newName.value); pendingRename.value.name = newName.value.trim(); pendingRename.value = null; }
    catch (e) { renameError.value = e.message; } finally { renaming.value = false; }
}
watch(pendingDelete, async image => {
    const token = ++dependencyGeneration; linkedPresets.value = []; deletionError.value = ''; checking.value = Boolean(image);
    if (!image) return;
    try { const result = await fetchImageDependencies(image.id); if (token === dependencyGeneration) linkedPresets.value = result.linkedPresets; }
    catch (e) { if (token === dependencyGeneration) deletionError.value = e.message; }
    finally { if (token === dependencyGeneration) checking.value = false; }
});
async function confirmDelete() {
    deleting.value = true; deletionError.value = '';
    try {
        const id = pendingDelete.value.id;
        await deleteImage(id, linkedPresets.value.map(preset => preset.id));
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
    <main class="image-library-panel" :class="{ 'has-preview': selected }" aria-label="Image library">
        <div class="viewer-chrome-panel-container image-library-container">
            <PanelActionBar appearance="chrome" placement="top" aria-label="Image collections">
                <ChromeButton type="button" :active="collection === 'builtin'" :aria-pressed="collection === 'builtin'" @click="collection = 'builtin'">Built-in</ChromeButton>
                <ChromeButton type="button" :active="collection === 'mine'" :aria-pressed="collection === 'mine'" @click="collection = 'mine'">My Images</ChromeButton>
            </PanelActionBar>
            <div class="image-library-columns">
                <ScrollPanel class="rivvon-scroll-panel image-library-grid-scroll">
                    <div class="image-library-content">
                        <section v-if="collection === 'mine' && !isAuthenticated" class="image-library-state">
                            <p>Sign in to upload and manage your images.</p><Button @click="login">Sign in</Button>
                        </section>
                        <template v-else>
                            <section v-if="collection === 'mine'" class="image-upload-section" aria-label="Upload images">
                                <p>Images are saved to Rivvon’s private cloud storage. Sharing a preset also shares its background image.</p>
                                <p class="image-library-hint">JPEG, PNG or static WebP, up to 20 MiB and 40 megapixels. Images are resized to at most 4096 pixels; originals are not retained.</p>
                                <FileUpload mode="basic" name="images" accept="image/jpeg,image/png,image/webp" multiple custom-upload auto choose-label="Upload images" @uploader="uploadFiles" />
                                <div v-for="job in jobs" :key="job.key" class="image-upload-job" :aria-label="job.file.name">
                                    <span>{{ job.file.name }} · {{ job.error || job.status }}</span>
                                    <ProgressBar v-if="job.state === 'uploading'" :value="job.progress" />
                                    <Button v-if="['queued', 'uploading'].includes(job.state)" size="small" severity="secondary" @click="cancel(job)">Cancel</Button>
                                    <Button v-if="['error', 'cancelled'].includes(job.state)" size="small" severity="secondary" @click="retry(job)">Retry</Button>
                                </div>
                            </section>
                            <div v-if="error" role="alert" class="image-library-state"><p>{{ error }}</p><Button severity="secondary" @click="loadMore(true)">Try again</Button></div>
                            <p v-if="loading" role="status">Loading images…</p>
                            <p v-if="!cards.length && !loading && !error" class="image-library-state">No saved images yet. Upload an image to get started.</p>
                            <div class="image-card-grid">
                                <article v-for="image in cards" :key="image.id" class="image-card" :class="{ 'image-card-active': app.backgroundTextureSource?.kind === image.source.kind && app.backgroundTextureSource?.id === image.id }">
                                    <Button type="button" variant="text" severity="secondary" class="image-card-preview" :aria-label="`Preview ${image.name}`" @click="select(image, $event)">
                                        <ImageAssetPreview :source="image.source" :title="image.name" />
                                    </Button>
                                    <div class="image-card-body"><span class="image-card-name">{{ image.name }}</span><small v-if="image.width">{{ image.width }} × {{ image.height }}</small>
                                        <div class="image-card-actions">
                                            <Button type="button" size="small" :disabled="!canApply" @click="apply(image)">Apply as background</Button>
                                            <template v-if="image.source.kind === 'image'">
                                                <Button type="button" variant="text" severity="secondary" class="rivvon-icon-action" :aria-label="`Rename ${image.name}`" @click="edit(image)"><span class="material-symbols-outlined" aria-hidden="true">edit</span></Button>
                                                <Button type="button" variant="text" severity="secondary" class="rivvon-icon-action" :aria-label="`Delete ${image.name}`" @click="pendingDelete = image"><span class="material-symbols-outlined" aria-hidden="true">delete</span></Button>
                                            </template>
                                        </div>
                                    </div>
                                </article>
                            </div>
                            <Button v-if="collection === 'mine' && images.length < total" :loading="loading" severity="secondary" @click="loadMore()">Load more images</Button>
                        </template>
                    </div>
                </ScrollPanel>
                <section v-if="selected" class="image-library-preview" :aria-label="`Preview ${selected.name}`">
                    <ScrollPanel class="rivvon-scroll-panel"><div class="image-preview-content"><div class="image-large-preview"><ImageAssetPreview :source="selected.source" :title="selected.name" full /></div><p>{{ selected.name }}</p><p v-if="selected.width">{{ selected.width }} × {{ selected.height }}</p></div></ScrollPanel>
                    <PanelActionBar><Button ref="previewButton" type="button" :disabled="!canApply" @click="apply(selected)">Apply as background</Button><Button severity="secondary" @click="closePreview">Back to Images</Button></PanelActionBar>
                </section>
            </div>
            <PanelActionBar aria-label="Image library actions"><Button severity="secondary" @click="emit('close')">{{ busy ? 'Cancel uploads and close' : 'Done' }}</Button></PanelActionBar>
        </div>
        <Dialog :visible="!!pendingRename" modal header="Rename image" :closable="!renaming" @update:visible="value => { if (!value) pendingRename = null; }">
            <label for="image-name">Name</label><InputText id="image-name" v-model="newName" maxlength="120" autofocus @keydown.enter="saveName" /><p v-if="renameError" role="alert">{{ renameError }}</p>
            <template #footer><Button severity="secondary" :disabled="renaming" @click="pendingRename = null">Cancel</Button><Button :loading="renaming" :disabled="!newName.trim()" @click="saveName">Save</Button></template>
        </Dialog>
        <Dialog :visible="!!pendingDelete" modal header="Delete image" :closable="!deleting" @update:visible="value => { if (!value) pendingDelete = null; }">
            <p>Delete “{{ pendingDelete?.name }}” from your image library?</p><p v-if="checking" role="status">Checking linked presets…</p>
            <div v-if="linkedPresets.length"><p>This also deletes these {{ linkedPresets.length }} presets and disables their shared links:</p><ul><li v-for="preset in linkedPresets" :key="preset.id">{{ preset.name }}</li></ul></div>
            <p v-if="deletionError" role="alert">{{ deletionError }}</p>
            <template #footer><Button severity="secondary" :disabled="deleting" @click="pendingDelete = null">Cancel</Button><Button severity="danger" :loading="deleting" :disabled="checking || (!!deletionError && !linkedPresets.length)" @click="confirmDelete">{{ linkedPresets.length ? 'Delete Image and Presets' : 'Delete' }}</Button></template>
        </Dialog>
    </main>
</template>
<style scoped>
.image-library-panel { position: absolute; inset: 0; z-index: 8; color: var(--p-text-color); display: flex; background: var(--viewer-panel-background); }
.image-library-container { width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; }
.image-library-columns { display: flex; flex: 1; min-height: 0; }
.image-library-grid-scroll { flex: 1; min-width: 0; }
.image-library-content { padding: 1.25rem; max-width: 80rem; margin-inline: auto; }
.image-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr)); gap: 1rem; margin-block: 1rem; }
.image-card { min-width: 0; border: 1px solid var(--p-content-border-color); background: var(--p-content-background); }
.image-card-active { border-color: var(--p-primary-color); }
.image-card-preview { width: 100%; height: 10rem; padding: 0; border-radius: 0; }
.image-card-body { display: flex; flex-direction: column; gap: .5rem; padding: .75rem; }
.image-card-name { overflow-wrap: anywhere; font-weight: 600; }
.image-card-actions { display: flex; flex-wrap: wrap; gap: .25rem; align-items: center; }
.image-library-preview { display: flex; flex-direction: column; width: 45%; min-width: 0; border-left: 1px solid var(--p-content-border-color); }
.image-preview-content { padding: 1rem; }
.image-large-preview { height: min(55vh, 40rem); }
.image-library-state { text-align: center; padding: 2rem; }
.image-library-hint, .image-card small { color: var(--p-text-muted-color); font-size: .875rem; }
.image-upload-section { margin-bottom: 1rem; }
.image-upload-job { display: grid; gap: .5rem; margin-top: .75rem; overflow-wrap: anywhere; }
@media (max-width: 767px) {
    .has-preview .image-library-grid-scroll { display: none; }
    .image-library-preview { width: 100%; border-left: 0; }
    .has-preview :deep(.panel-action-bar-top) { display: none; }
}
</style>
