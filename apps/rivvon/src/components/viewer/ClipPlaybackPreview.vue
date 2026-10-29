<script setup>
import { ref, watch, onBeforeUnmount, nextTick } from 'vue';
import Button from 'primevue/button';
import { useAuthStore } from '../../stores/authStore.js';
import { acquireBackgroundClip } from '../../services/backgroundClip.js';

const props = defineProps({ source: { type: Object, required: true }, presetId: { type: String, default: '' }, title: String });
const auth = useAuthStore(), host = ref(null), loading = ref(true), error = ref(''), paused = ref(false), ready = ref(false);
let generation = 0, lease = null, animation = 0, origin = 0;
function cleanup() {
    generation++; cancelAnimationFrame(animation); animation = 0;
    lease?.release(); lease = null; ready.value = false; host.value?.replaceChildren();
}
function tick(now) {
    if (!lease) return;
    lease.update({ timeSeconds: (now - origin) / 1000, targetDuration: lease.duration, playbackMode: 'native', paused: paused.value });
    animation = requestAnimationFrame(tick);
}
function toggle() {
    if (paused.value || error.value) { paused.value = false; lease?.resume(); }
    else { paused.value = true; lease?.pause(); }
}
watch(() => [props.source.id, props.presetId, auth.user?.id], async () => {
    cleanup(); const token = generation; loading.value = true; error.value = '';
    paused.value = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let prepared;
    try {
        prepared = await acquireBackgroundClip(props.source, { presetId: props.presetId,
            onError: message => { if (token === generation) error.value = message; } });
        if (token !== generation) { prepared.release(); return; }
        await nextTick();
        if (token !== generation || !host.value) { prepared.release(); return; }
        lease = prepared; host.value.replaceChildren(lease.texture.image);
        lease.texture.image.setAttribute('aria-label', props.title || 'Clip preview');
        lease.texture.image.setAttribute('role', 'img');
        ready.value = true; origin = performance.now(); animation = requestAnimationFrame(tick);
    } catch (failure) { prepared?.release(); if (token === generation) error.value = failure.message; }
    finally { if (token === generation) loading.value = false; }
}, { immediate: true });
onBeforeUnmount(cleanup);
</script>
<template>
    <div class="clip-playback-preview" :aria-busy="loading">
        <div ref="host" class="clip-playback-surface"></div>
        <p v-if="loading" role="status">Loading clip…</p>
        <p v-if="error" role="status">{{ error }}</p>
        <div v-if="ready" class="clip-playback-controls">
            <Button type="button" severity="secondary" :aria-label="paused || error ? 'Play clip preview' : 'Pause clip preview'" @click="toggle">{{ paused || error ? 'Play' : 'Pause' }}</Button>
            <small>Muted · Loops automatically</small>
        </div>
    </div>
</template>
<style scoped>
.clip-playback-preview { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; }
.clip-playback-surface { flex: 1; min-height: 0; width: 100%; }
.clip-playback-surface :deep(canvas) { display: block; width: 100%; height: 100%; object-fit: contain; }
.clip-playback-controls { display: flex; align-items: center; gap: .75rem; padding-top: .5rem; }
.clip-playback-controls small { color: var(--p-text-muted-color); }
</style>
