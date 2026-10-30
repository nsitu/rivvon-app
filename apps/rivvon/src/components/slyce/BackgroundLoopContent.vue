<script setup>
import { computed, ref } from 'vue';
import Button from 'primevue/button';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import SelectButton from 'primevue/selectbutton';
import ProgressBar from 'primevue/progressbar';
import Dialog from 'primevue/dialog';
import PanelActionBar from '../shared/PanelActionBar.vue';
import BackgroundSourcePreview from './BackgroundSourcePreview.vue';
import { useBackgroundLoopStore } from '../../stores/backgroundLoopStore.js';
const props = defineProps({ phase: { type: String, default: 'settings' } });
const emit = defineEmits(['show-result']);
const loop = useBackgroundLoopStore();
const pendingDiscard = ref(null);
const previewPlan = computed(() => loop.plan ?? loop.limits);
const samplingOptions = computed(() => loop.source ? [
    { label: `Long side (${Math.max(loop.source.width, loop.source.height)} px)`, value: 'long' },
    { label: `Short side (${Math.min(loop.source.width, loop.source.height)} px)`, value: 'short' },
] : []);
async function show(id) { if (await loop.showJob(id)) emit('show-result'); }
async function assemble(id) { if (await loop.reassemble(id)) emit('show-result'); }
async function discard() { if (await loop.discard(pendingDiscard.value)) pendingDiscard.value = null; }
</script>

<template>
    <div class="background-loop-content">
        <ProgressBar v-if="loop.operation === 'preparing'" mode="indeterminate" aria-label="Reading video source" />
        <template v-if="props.phase === 'settings' && loop.source">
            <!-- On narrow screens the source preview sits above the settings in the shared scroll region. -->
            <div class="background-source-settings">
                <BackgroundSourcePreview :source="loop.source" :plan="previewPlan" />
                <div class="background-source-controls">
                    <p>{{ loop.source.name }} · {{ loop.source.width }} × {{ loop.source.height }} · {{ loop.source.frameCount.toLocaleString() }} source frames</p>
                    <div class="background-sampling-side">
                        <span id="background-side-label">Sample from</span>
                        <SelectButton v-model="loop.samplingSide" :options="samplingOptions" option-label="label" option-value="value" :allow-empty="false"
                            :disabled="loop.busy" aria-labelledby="background-side-label" />
                    </div>
                    <div class="background-loop-fields">
                        <label for="background-size">Square size
                            <InputNumber v-model="loop.size" input-id="background-size" :min="2" :max="loop.limits?.maxSize ?? 3840" :step="2" :disabled="loop.busy" />
                        </label>
                        <label for="background-duration">Loop duration (seconds)
                            <InputNumber v-model="loop.duration" input-id="background-duration" :min="1" :max="(loop.limits?.maxPhases ?? 240) / 30" :step="1 / 30" :max-fraction-digits="3" :disabled="loop.busy" />
                        </label>
                        <label for="background-start">Start at source frame
                            <InputNumber v-model="loop.sourceStartFrame" input-id="background-start" :min="1" :max="loop.source.frameCount - 1" :disabled="loop.busy" />
                        </label>
                    </div>
                    <p v-if="loop.plan">{{ loop.plan.size }} × {{ loop.plan.size }} pixels · {{ loop.plan.phaseCount }} frames at 30 fps · {{ loop.plan.duration.toFixed(3) }} seconds</p>
                    <p v-if="loop.limits" class="background-loop-note">Up to {{ loop.limits.maxSize }} square and {{ (loop.limits.maxPhases / 30).toFixed(2) }} seconds from this source. Each square uses {{ loop.size }} successive source frames. Ribbon textures have their own settings.</p>
                    <p v-if="loop.planError" role="status">{{ loop.planError }}</p>
                </div>
            </div>
        </template>
        <template v-if="props.phase === 'results'">
            <ProgressBar v-if="loop.busy" :value="loop.progress" />
            <video v-if="loop.previewUrl" :src="loop.previewUrl" controls muted loop playsinline aria-label="Looping background preview" class="background-loop-preview" />
            <p v-if="loop.resultReady">{{ loop.job.plan.size }} × {{ loop.job.plan.size }} pixels · {{ loop.job.plan.duration.toFixed(3) }} seconds</p>
        </template>
        <label v-if="loop.source || loop.resultReady" for="background-name" class="background-loop-name">Clip name
            <InputText id="background-name" v-model="loop.name" :maxlength="120" :disabled="loop.busy || (props.phase === 'results' && Boolean(loop.savedClip))" />
        </label>
        <p v-if="loop.status" role="status" aria-live="polite">{{ loop.status }}</p>
        <p v-if="loop.error" role="alert">{{ loop.error }}</p>
        <p v-if="loop.resultReady && !loop.savedClip" class="background-loop-note">This video is stored on this device. Save to Clips uploads it to your private clips library.</p>
        <p v-if="loop.savedClip" role="status">Saved to Clips: {{ loop.savedClip.name }}</p>
        <section v-if="loop.jobs.length" aria-label="Background videos on this device" class="background-loop-work">
            <h3>On this device</h3>
            <article v-for="stored in loop.jobs" :key="stored.id">
                <p>{{ stored.clipName || stored.sourceName }} · {{ stored.plan.size }} square · {{ stored.plan.duration.toFixed(3) }} seconds<span v-if="stored.status !== 'complete'"> · {{ stored.batches.length === stored.plan.passes ? 'Ready to finish' : 'Incomplete' }}</span></p>
                <div class="rivvon-action-row background-loop-work-actions">
                    <Button v-if="stored.status === 'complete'" label="Preview" severity="secondary" variant="outlined" :disabled="loop.busy" @click="show(stored.id)" />
                    <Button v-else-if="stored.batches.length === stored.plan.passes" label="Finish video" severity="secondary" variant="outlined" :disabled="loop.busy" @click="assemble(stored.id)" />
                    <Button label="Discard local video" severity="danger" variant="text" :disabled="loop.busy" @click="pendingDiscard = stored.id" />
                </div>
            </article>
        </section>
        <Dialog :visible="Boolean(pendingDiscard)" modal header="Discard local video?" :closable="!loop.busy" :style="{ width: 'min(30rem, calc(100vw - 2rem))' }" @update:visible="value => { if (!value && !loop.busy) pendingDiscard = null; }">
            <p>This removes the video and its saved batches from this device. A copy saved to Clips is kept.</p>
            <template #footer>
                <PanelActionBar>
                    <Button label="Cancel" severity="secondary" :disabled="loop.busy" @click="pendingDiscard = null" />
                    <Button label="Discard local video" severity="danger" :loading="loop.busy" @click="discard" />
                </PanelActionBar>
            </template>
        </Dialog>
    </div>
</template>

<style scoped>
.background-loop-content { max-width: 64rem; margin-inline: auto; min-width: 0; }
.background-source-settings { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.background-source-controls { min-width: 0; }
.background-sampling-side { display: flex; flex-direction: column; gap: .5rem; }
.background-sampling-side :deep(.p-selectbutton) { flex-wrap: wrap; }
@media (min-width: 960px) { .background-source-settings { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
.background-loop-fields { display: flex; flex-wrap: wrap; gap: 1rem; margin-block: 1rem; }
.background-loop-fields label, .background-loop-name { display: flex; flex-direction: column; gap: .5rem; max-width: 100%; }
.background-loop-name { max-width: 32rem; margin-block: 1rem; }
.background-loop-fields :deep(.p-inputnumber), .background-loop-fields :deep(input) { max-width: 100%; min-width: 0; }
.background-loop-note { color: var(--p-text-muted-color); line-height: 1.5; }
.background-loop-preview { display: block; width: min(100%, 36rem); aspect-ratio: 1; background: #000; }
.background-loop-work { margin-block-start: 1.5rem; }
.background-loop-work article { border-top: 1px solid var(--p-content-border-color); padding-block: .5rem; }
.background-loop-work-actions { flex-wrap: wrap; }
</style>
