<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import VideoPlayer from './VideoPlayer.vue';
import VideoControls from './VideoControls.vue';
import SamplingOverlay from './SamplingOverlay.vue';

const props = defineProps({ source: { type: Object, required: true }, plan: { type: Object, default: null } });
const player = ref(null), surface = ref(null), url = ref('');
const dimensions = ref({ displayWidth: 0, displayHeight: 0, offsetX: 0, offsetY: 0 });
let observer;
const samplingPlan = computed(() => props.plan ? { ...props.plan, sourceFps: props.source.fps } : null);
function measure() {
    const video = player.value?.getVideoDimensions();
    const box = surface.value?.getBoundingClientRect();
    if (video && box) dimensions.value = { ...video, offsetX: Math.max(0, video.left - box.left), offsetY: Math.max(0, video.top - box.top) };
}
async function ready() {
    await nextTick(); measure();
    seekToStart();
}
function seekToStart() {
    if (player.value?.isReady && props.plan) player.value.seek((props.plan.sourceStartFrame - 1) / (props.source.fps || 30));
}
watch(() => props.source.file, file => {
    if (url.value) URL.revokeObjectURL(url.value);
    dimensions.value = { displayWidth: 0, displayHeight: 0, offsetX: 0, offsetY: 0 };
    url.value = URL.createObjectURL(file);
}, { immediate: true });
watch(() => props.plan?.sourceStartFrame, seekToStart);
onMounted(() => { observer = new ResizeObserver(measure); observer.observe(surface.value); });
onBeforeUnmount(() => {
    observer?.disconnect(); player.value?.videoElement?.pause();
    if (url.value) URL.revokeObjectURL(url.value);
});
</script>

<template>
    <section class="background-source-preview" aria-label="Source video preview">
        <div ref="surface" class="background-source-surface">
            <VideoPlayer ref="player" :url="url" :source-file="source.file" :has-controls="false" @ready="ready" />
            <SamplingOverlay v-if="samplingPlan && dimensions.displayWidth > 0" :container-width="dimensions.displayWidth" :container-height="dimensions.displayHeight"
                :offset-x="dimensions.offsetX" :offset-y="dimensions.offsetY" :video-player="player" :sampling-plan="samplingPlan" />
        </div>
        <VideoControls :video-ref="player" />
    </section>
</template>

<style scoped>
.background-source-preview { min-width: 0; width: 100%; --video-preview-max-height: 24rem; }
.background-source-surface { position: relative; width: 100%; }
</style>
