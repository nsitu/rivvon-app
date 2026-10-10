<script setup>
import { ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import ScrollPanel from 'primevue/scrollpanel';
import ChromeButton from '../shared/ChromeButton.vue';
import PanelActionBar from '../shared/PanelActionBar.vue';
import { useGoogleAuth } from '../../composables/shared/useGoogleAuth.js';
import { deletePreset, fetchPresets, presetAssetUrl, presetShareUrl, updatePreset } from '../../services/presetService.js';

const props = defineProps({ busy: Boolean, revision: Number });
const emit = defineEmits(['request-close', 'request-open', 'request-save', 'request-copy']);
const { user, isAuthenticated, login } = useGoogleAuth();
const scope = ref('mine'), presets = ref([]), loading = ref(false), error = ref(''), total = ref(0);
const edit = ref(null), deletion = ref(null), link = ref(''), actionBusy = ref(false);
let generation = 0;
const visibilityOptions = [{ label: 'Private', value: 'private' }, { label: 'Unlisted', value: 'unlisted' }, { label: 'Public', value: 'public' }];

async function load(more = false) {
    const request = ++generation;
    if (scope.value === 'mine' && !isAuthenticated.value) { presets.value = []; total.value = 0; loading.value = false; return; }
    loading.value = true; error.value = '';
    try {
        const data = await fetchPresets({ scope: scope.value, offset: more ? presets.value.length : 0 });
        if (request !== generation) return;
        presets.value = more ? [...presets.value, ...data.presets] : data.presets;
        total.value = data.pagination.total;
    } catch (failure) { if (request === generation) error.value = failure.message; }
    finally { if (request === generation) loading.value = false; }
}
watch([scope, isAuthenticated, () => props.revision], () => load(), { immediate: true });

async function action(task) {
    actionBusy.value = true; error.value = '';
    try { await task(); }
    catch (failure) { error.value = failure.message; }
    finally { actionBusy.value = false; }
}
function share(preset) {
    action(async () => {
        if (preset.visibility === 'private') {
            await updatePreset(preset.id, { visibility: 'unlisted' });
            preset.visibility = 'unlisted';
        }
        link.value = presetShareUrl(preset.id);
    });
}
function saveMetadata() {
    action(async () => {
        await updatePreset(edit.value.id, { name: edit.value.name, visibility: edit.value.visibility });
        edit.value = null;
        await load();
    });
}
function remove() {
    action(async () => {
        await deletePreset(deletion.value.id);
        deletion.value = null;
        await load();
    });
}
</script>

<template>
    <section class="preset-browser" aria-label="Preset library" :aria-busy="loading || busy">
        <div class="viewer-chrome-panel-container preset-browser-container">
            <PanelActionBar appearance="chrome" placement="top" aria-label="Preset collections">
                <ChromeButton :active="scope === 'mine'" :aria-pressed="scope === 'mine'" :disabled="busy" @click="scope = 'mine'">My Presets</ChromeButton>
                <ChromeButton :active="scope === 'public'" :aria-pressed="scope === 'public'" :disabled="busy" @click="scope = 'public'">Public Presets</ChromeButton>
            </PanelActionBar>
            <ScrollPanel class="rivvon-scroll-panel">
                <div class="preset-browser-content">
                    <p v-if="error" role="alert">{{ error }} <Button label="Retry" severity="secondary" @click="load()" /></p>
                    <div v-if="scope === 'mine' && !isAuthenticated">
                        <p>Sign in to save and browse your presets.</p><Button label="Sign In" @click="login" />
                    </div>
                    <p v-else-if="!loading && !presets.length">{{ scope === 'mine' ? 'Save a preset to return to this ribbon later.' : 'No public presets yet.' }}</p>
                    <div class="preset-grid">
                        <article v-for="preset in presets" :key="preset.id" class="preset-card">
                            <img :src="presetAssetUrl(preset.id, 'thumbnail')" crossorigin="use-credentials" loading="lazy" :alt="`Preview of ${preset.name}`" />
                            <div class="preset-card-content">
                                <strong>{{ preset.name }}</strong>
                                <span>{{ new Date(preset.created_at * 1000).toLocaleDateString() }} · {{ preset.visibility }}</span>
                                <Button label="Open" :disabled="busy || actionBusy" @click="emit('request-open', preset)" />
                                <div class="preset-card-actions">
                                    <Button label="Share" variant="text" :disabled="actionBusy || busy" @click="share(preset)" />
                                    <template v-if="scope === 'mine' || preset.owner_id === user?.id">
                                        <Button label="Edit" variant="text" :disabled="actionBusy || busy" @click="edit = { ...preset }" />
                                        <Button label="Delete" variant="text" :disabled="actionBusy || busy" @click="deletion = preset" />
                                    </template>
                                </div>
                            </div>
                        </article>
                    </div>
                    <p v-if="loading" role="status">Loading presets…</p>
                    <Button v-if="presets.length < total" label="Load More" :loading="loading" :disabled="busy" @click="load(true)" />
                </div>
            </ScrollPanel>
            <PanelActionBar appearance="chrome">
                <ChromeButton :disabled="busy" @click="emit('request-save')"><span class="material-symbols-outlined" aria-hidden="true">bookmark_add</span>Save Current Ribbon</ChromeButton>
                <ChromeButton :disabled="busy" @click="emit('request-close')">Done</ChromeButton>
            </PanelActionBar>
        </div>
        <Dialog :visible="Boolean(edit)" @update:visible="!actionBusy && (edit = null)" header="Edit Preset" modal :closable="!actionBusy" :close-on-escape="!actionBusy">
            <form v-if="edit" class="preset-edit" @submit.prevent="saveMetadata">
                <label for="edit-preset-name">Name</label><InputText id="edit-preset-name" v-model="edit.name" maxlength="200" required :disabled="actionBusy" />
                <label for="edit-preset-visibility">Visibility</label><Select input-id="edit-preset-visibility" v-model="edit.visibility" :options="visibilityOptions" option-label="label" option-value="value" :disabled="actionBusy" />
                <p v-if="error" role="alert">{{ error }}</p>
                <PanelActionBar><Button type="submit" label="Save" :loading="actionBusy" /></PanelActionBar>
            </form>
        </Dialog>
        <Dialog :visible="Boolean(deletion)" @update:visible="!actionBusy && (deletion = null)" header="Delete Preset" modal :closable="!actionBusy" :close-on-escape="!actionBusy">
            <p>Delete “{{ deletion?.name }}”? Its shared links will stop working.</p>
            <p v-if="error" role="alert">{{ error }}</p>
            <PanelActionBar><Button label="Cancel" severity="secondary" :disabled="actionBusy" @click="deletion = null" /><Button label="Delete" severity="danger" :loading="actionBusy" @click="remove" /></PanelActionBar>
        </Dialog>
        <Dialog :visible="Boolean(link)" @update:visible="link = ''" header="Share Preset" modal>
            <label for="library-preset-link">Anyone with this link can open the saved ribbon.</label>
            <InputText id="library-preset-link" :model-value="link" readonly fluid @focus="$event.target.select()" />
            <PanelActionBar><Button label="Copy Link" @click="emit('request-copy', link)" /><Button label="Done" severity="secondary" @click="link = ''" /></PanelActionBar>
        </Dialog>
    </section>
</template>

<style scoped>
.preset-browser { position: fixed; inset: 0; z-index: 8; background: var(--p-content-background); }
.preset-browser-container { height: 100%; min-height: 0; display: flex; flex-direction: column; box-sizing: border-box; }
.preset-browser-content { padding: 1.25rem; }
.preset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr)); gap: 1rem; }
.preset-card { min-width: 0; border: 1px solid var(--p-content-border-color); border-radius: var(--p-content-border-radius); overflow: hidden; }
.preset-card img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; }
.preset-card-content, .preset-edit { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; }
.preset-card-content strong { overflow-wrap: anywhere; }
.preset-card-content > span { font-size: 0.85rem; color: var(--p-text-muted-color); }
.preset-card-actions { display: flex; flex-wrap: wrap; }
</style>
