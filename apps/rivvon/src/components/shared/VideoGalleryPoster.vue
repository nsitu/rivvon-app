<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';

const props = defineProps({
    to: { type: Object, required: true },
    name: { type: String, required: true },
    poster: { type: String, default: '' },
    src: { type: String, default: '' },
    duration: { type: String, default: '' },
});
const hovered = ref(false);
const focused = ref(false);
const reducedMotion = ref(true);
const hidden = ref(false);
const failed = ref(false);
const playing = ref(false);
const player = ref(null);
const active = computed(() => !!props.src && !failed.value && !reducedMotion.value && !hidden.value && (hovered.value || focused.value));
let motionQuery;
const updateMotion = () => { reducedMotion.value = motionQuery.matches; };
const updateVisibility = () => { hidden.value = document.hidden; };
function releasePlayer() {
    playing.value = false;
    if (!player.value) return;
    player.value.pause();
    player.value.removeAttribute('src');
    player.value.load();
}
watch(active, enabled => { if (!enabled) releasePlayer(); });
watch(() => props.src, () => { failed.value = false; playing.value = false; });
onMounted(() => {
    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    updateMotion(); updateVisibility();
    motionQuery.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
});
onBeforeUnmount(() => {
    releasePlayer();
    motionQuery?.removeEventListener('change', updateMotion);
    document.removeEventListener('visibilitychange', updateVisibility);
});
</script>

<template>
    <RouterLink :to="to" class="video-card-poster" :aria-label="`Play ${name}`"
        @pointerenter="event => { if (event.pointerType !== 'touch') hovered = true; }"
        @pointerleave="hovered = false" @focus="focused = true" @blur="focused = false">
        <img v-if="poster" :src="poster" alt="" loading="lazy">
        <span v-else class="video-card-placeholder material-symbols-outlined" aria-hidden="true">movie</span>
        <!-- Only mount the muted preview on interaction; still posters remain the fallback. -->
        <video v-if="active" ref="player" :src="src" :class="{ playing }" muted autoplay loop playsinline
            preload="none" aria-hidden="true" @playing="playing = true" @error="failed = true" />
        <span v-if="!playing" class="video-card-play material-symbols-outlined" aria-hidden="true">play_circle</span>
        <span class="video-card-duration">{{ duration }}</span>
    </RouterLink>
</template>

<style scoped>
.video-card-poster { position: relative; display: grid; aspect-ratio: 16 / 9; overflow: hidden; background: #080910; place-items: center; }
img, video { width: 100%; height: 100%; object-fit: contain; }
video { position: absolute; inset: 0; opacity: 0; pointer-events: none; }
video.playing { opacity: 1; }
.video-card-placeholder { color: var(--p-text-muted-color); font-size: 4rem; }
.video-card-play { position: absolute; font-size: 3rem; color: rgba(255,255,255,.9); filter: drop-shadow(0 .25rem .5rem #000); }
.video-card-duration { position: absolute; right: .6rem; bottom: .6rem; padding: .15rem .4rem; background: rgba(0,0,0,.7); color: #fff; font-size: .75rem; }
</style>
