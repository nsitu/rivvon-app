<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import Button from 'primevue/button';
import FileUpload from 'primevue/fileupload';
import InputNumber from 'primevue/inputnumber';
import Select from 'primevue/select';
import ScrollPanel from 'primevue/scrollpanel';
import ProgressBar from 'primevue/progressbar';
import PanelActionBar from '../shared/PanelActionBar.vue';
import { inspectBackgroundLoopSource, generateBackgroundLoop, assembleBackgroundLoop } from '../../modules/slyce/backgroundLoop.js';
import { planBackgroundLoop } from '../../modules/slyce/backgroundLoopPlan.js';
import { BACKGROUND_LOOP_BATCH_SIZE, BACKGROUND_LOOP_SURFACE_BUDGET_MIB } from '../../modules/slyce/backgroundLoopPlan.js';
import { listBackgroundLoopJobs, getBackgroundLoopBlob, discardBackgroundLoop } from '../../services/backgroundLoopStorage.js';
import { uploadClip } from '../../services/clipService.js';

const source = ref(null), size = ref(1920), duration = ref(8), batchSize = ref(BACKGROUND_LOOP_BATCH_SIZE), encodingMethod = ref('ffmpeg');
const samplingSide = ref('long');
const busy = ref(false), error = ref(''), status = ref('Choose a source video.'), progress = ref(0), preview = ref('');
const jobs = ref([]), activeJob = ref(null);
let controller;
const plan = computed(() => {
    if (!source.value) return null;
    try { return planBackgroundLoop(source.value, { size: size.value, duration: duration.value, batchSize: batchSize.value, samplingSide: samplingSide.value }); }
    catch { return null; }
});
const maximum = computed(() => source.value ? planBackgroundLoop(source.value, { samplingSide: samplingSide.value }) : null);
watch(samplingSide, () => {
    if (maximum.value) {
        size.value = Math.min(size.value, maximum.value.maxSize);
        duration.value = Math.min(duration.value, maximum.value.maxPhases / 30);
    }
});
const refresh = async () => { jobs.value = (await listBackgroundLoopJobs()).sort((a, b) => b.createdAt - a.createdAt); };
const clearPreview = () => { if (preview.value) URL.revokeObjectURL(preview.value); preview.value = ''; };
function update(event) {
    activeJob.value = event.jobId;
    progress.value = Math.round(event.offset / event.total * 100);
    status.value = `${event.phase}: phases ${event.offset + 1}–${Math.min(event.total, event.offset + (plan.value?.batchSize ?? 1))} of ${event.total}${event.sourceFrame ? `, source frame ${event.sourceFrame}` : ''}`;
}
async function work(action) {
    busy.value = true; error.value = ''; controller = new AbortController();
    try { await action(controller.signal); }
    catch (failure) { error.value = failure.name === 'AbortError' ? 'Cancelled. Discard partial work below when ready.' : failure.message; }
    finally { busy.value = false; await refresh(); }
}
async function choose(event) {
    await work(async signal => {
        source.value = null;
        const candidate = await inspectBackgroundLoopSource(event.files[0], { signal });
        const defaults = planBackgroundLoop(candidate, { samplingSide: samplingSide.value });
        source.value = candidate;
        size.value = Math.min(1920, defaults.maxSize); duration.value = defaults.duration;
        status.value = `${source.value.name}: ${source.value.width} × ${source.value.height}, ${source.value.frameCount} source frames`;
    });
}
async function show(id) {
    clearPreview(); preview.value = URL.createObjectURL(await getBackgroundLoopBlob(id)); activeJob.value = id;
}
async function generate() {
    await work(async signal => {
        const result = await generateBackgroundLoop(source.value, { size: size.value, duration: duration.value,
            batchSize: batchSize.value, samplingSide: samplingSide.value, encodingMethod: encodingMethod.value, signal, onProgress: update });
        await show(result.job.id); progress.value = 100;
        status.value = `Complete: ${(result.job.samplingMs / 1000).toFixed(1)} s sampling/encoding; ${(result.job.assemblyMs / 1000).toFixed(1)} s assembly.`;
    });
}
async function reassemble(id) {
    await work(async signal => { await assembleBackgroundLoop(id, { signal, onProgress: update }); await show(id); });
}
async function saveClip() {
    await work(async signal => {
        const blob = await getBackgroundLoopBlob(activeJob.value);
        const clip = await uploadClip(new File([blob], 'sampled-background.mp4', { type: 'video/mp4' }), {
            signal, onStatus: text => { status.value = text; }, onProgress: value => { progress.value = Math.round(value * 100); },
        });
        status.value = `Saved to Clips: ${clip.name}`;
    });
}
async function discard(id) {
    await work(async () => { await discardBackgroundLoop(id); if (activeJob.value === id) { clearPreview(); activeJob.value = null; } });
}
onMounted(() => { refresh().catch(failure => { error.value = failure.message; }); });
onBeforeUnmount(() => { controller?.abort(); clearPreview(); });
</script>

<template>
    <!-- Standalone development document: no viewer shell/header insets or navigation context. -->
    <main class="loop-lab">
        <header><h1>Background loop prototype</h1><p>Square wave sampling at 30 fps. Ribbon textures can use the same source independently.</p></header>
        <ScrollPanel class="rivvon-scroll-panel">
            <div class="loop-lab-content">
                <FileUpload mode="basic" accept="video/*,.mts,.m2ts" choose-label="Choose source video" :disabled="busy" @select="choose" />
                <div class="loop-lab-fields">
                    <label for="lab-sampling-side">Sample from <Select v-model="samplingSide" input-id="lab-sampling-side" :options="['long', 'short']" :disabled="busy" /></label>
                    <label for="loop-size">Square size <InputNumber v-model="size" input-id="loop-size" :min="2" :max="maximum?.maxSize ?? 3840" :step="2" :disabled="busy || !source" /></label>
                    <label for="loop-duration">Duration (seconds) <InputNumber v-model="duration" input-id="loop-duration" :min="1" :max="(maximum?.maxPhases ?? 240) / 30" :step="1 / 30" :max-fraction-digits="3" :disabled="busy || !source" /></label>
                    <label for="loop-batch">Phases per sampling pass <InputNumber v-model="batchSize" input-id="loop-batch" :min="1" :max="32" :disabled="busy" /></label>
                    <label for="loop-encoder">Encoder <Select v-model="encodingMethod" input-id="loop-encoder" :options="['ffmpeg', 'webcodecs']" :disabled="busy" /></label>
                </div>
                <p v-if="plan">{{ plan.size }} × {{ plan.size }} · {{ plan.phaseCount }} phases · {{ plan.duration.toFixed(3) }} seconds · {{ plan.passes }} passes · {{ (plan.phaseSurfaceBytes / 1048576).toFixed(1) }} MiB of phase surfaces. Decoder and encoder allocations are additional.</p>
                <p v-if="maximum">Maximum: {{ maximum.maxSize }} square, {{ maximum.maxPhases }} phases ({{ (maximum.maxPhases / 30).toFixed(2) }} seconds). Duration rounds to complete frames. The phase surface budget is {{ BACKGROUND_LOOP_SURFACE_BUDGET_MIB }} MiB.</p>
                <ProgressBar :value="progress" />
                <p role="status" aria-live="polite">{{ status }}</p><p v-if="error" role="alert">{{ error }}</p>
                <video v-if="preview" :src="preview" controls muted loop playsinline aria-label="Generated looping background preview" />
                <div v-if="preview" class="loop-lab-actions">
                    <a :href="preview" download="sampled-background.mp4">Download MP4</a>
                    <Button label="Save to Clips" :disabled="busy" @click="saveClip" />
                </div>
                <h2>Stored prototype work</h2><p>Encoded batches and assembled output remain in this browser until discarded.</p>
                <article v-for="job in jobs" :key="job.id">
                    <p>{{ job.sourceName }} · {{ job.plan.size }} square · {{ job.plan.duration }} s · {{ job.status }} · {{ job.batches.length }}/{{ job.plan.passes }} batches</p>
                    <div class="loop-lab-actions">
                        <Button v-if="job.status === 'complete'" label="Preview" :disabled="busy" @click="work(() => show(job.id))" />
                        <Button label="Assemble stored batches" :disabled="busy || job.batches.length !== job.plan.passes" @click="reassemble(job.id)" />
                        <Button label="Discard work files" severity="danger" :disabled="busy" @click="discard(job.id)" />
                    </div>
                </article>
            </div>
        </ScrollPanel>
        <PanelActionBar class="loop-lab-footer" aria-label="Background loop generation">
            <Button label="Generate loop" :disabled="busy || !plan" @click="generate" />
            <Button label="Cancel" severity="secondary" :disabled="!busy" @click="controller?.abort()" />
        </PanelActionBar>
    </main>
</template>

<style>
body { margin: 0; font-family: system-ui, sans-serif; color: var(--p-text-color); background: var(--p-content-background); }
.loop-lab { height: 100dvh; min-height: 0; display: flex; flex-direction: column; }
.loop-lab header, .loop-lab-content { padding: 1rem; }
.loop-lab .rivvon-scroll-panel { flex: 1; min-height: 0; }
.loop-lab-content { max-width: 72rem; margin: auto; }
.loop-lab-fields, .loop-lab-actions { display: flex; flex-wrap: wrap; gap: 1rem; margin-block: 1rem; align-items: center; }
.loop-lab-fields label { display: flex; flex-direction: column; gap: .5rem; max-width: 100%; }
.loop-lab-fields .p-inputnumber { max-width: 100%; }
.loop-lab video { display: block; width: min(100%, 40rem); aspect-ratio: 1; background: #000; }
.loop-lab article { border-top: 1px solid var(--p-content-border-color); padding-block: .5rem; }
.loop-lab-footer { padding: 1rem; }
</style>
