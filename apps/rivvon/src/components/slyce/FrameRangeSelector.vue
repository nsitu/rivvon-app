<script setup>
    import { ref, computed, onUnmounted } from 'vue';
    import { useSlyceStore } from '../../stores/slyceStore';

    const app = useSlyceStore();

    const props = defineProps({
        videoRef: { type: Object, default: null },
    });

    const trackRef = ref(null);

    // --- Helpers ---
    const totalFrames = computed(() => app.frameCount || 1);
    const startFrac = computed(() => ((app.frameStart || 1) - 1) / totalFrames.value);
    const endFrac = computed(() => (app.frameEnd || totalFrames.value) / totalFrames.value);

    // Current playback position as fraction
    const getVideoPlayer = () => {
        const vRef = props.videoRef;
        if (!vRef) return null;
        if (vRef.__v_isRef || '_value' in vRef) return vRef.value || null;
        return vRef;
    };

    const playheadFrac = computed(() => {
        const vp = getVideoPlayer();
        if (!vp) return 0;
        const ct = vp.getCurrentTime?.() ?? 0;
        const dur = vp.getDuration?.() ?? 1;
        return dur > 0 ? ct / dur : 0;
    });

    // Poll playhead (piggyback on rAF for smooth updates)
    const playheadPos = ref(0);
    let rafId = null;
    function updatePlayhead() {
        playheadPos.value = playheadFrac.value;
        rafId = requestAnimationFrame(updatePlayhead);
    }
    updatePlayhead();
    onUnmounted(() => { if (rafId != null) cancelAnimationFrame(rafId); });

    // --- Drag logic ---
    const dragging = ref(null); // 'start' | 'end' | null

    function fracFromEvent(e) {
        const track = trackRef.value;
        if (!track) return 0;
        const rect = track.getBoundingClientRect();
        return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }

    function frameFromFrac(frac) {
        return Math.round(frac * totalFrames.value);
    }

    function onPointerDown(handle, e) {
        e.preventDefault();
        dragging.value = handle;
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
    }

    function onPointerMove(e) {
        const frac = fracFromEvent(e);
        const frame = frameFromFrac(frac);
        if (dragging.value === 'start') {
            app.frameStart = Math.max(1, Math.min(frame, (app.frameEnd || totalFrames.value) - 1));
        } else if (dragging.value === 'end') {
            app.frameEnd = Math.max((app.frameStart || 1) + 1, Math.min(frame, totalFrames.value));
        }
    }

    function onPointerUp() {
        dragging.value = null;
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
    }

    onUnmounted(() => {
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
    });
</script>

<template>
    <div
        v-if="app.frameCount > 0"
        class="frame-range-selector"
    >
        <!-- Track -->
        <div
            ref="trackRef"
            class="range-track"
        >
            <!-- Dimmed regions outside the range -->
            <div
                class="range-dim"
                :style="{ left: 0, width: `${startFrac * 100}%` }"
            />
            <div
                class="range-dim"
                :style="{ left: `${endFrac * 100}%`, width: `${(1 - endFrac) * 100}%` }"
            />

            <!-- Active range highlight -->
            <div
                class="range-active"
                :style="{ left: `${startFrac * 100}%`, width: `${(endFrac - startFrac) * 100}%` }"
            />

            <!-- Playhead -->
            <div
                class="range-playhead"
                :style="{ left: `${playheadPos * 100}%` }"
            />

            <!-- Start handle (triangle pointing right) -->
            <div
                class="range-handle range-handle-start"
                :style="{ left: `${startFrac * 100}%` }"
                @pointerdown="onPointerDown('start', $event)"
            >
                <svg
                    viewBox="0 0 10 14"
                    class="handle-triangle"
                >
                    <polygon points="0,0 10,7 0,14" />
                </svg>
            </div>

            <!-- End handle (triangle pointing left) -->
            <div
                class="range-handle range-handle-end"
                :style="{ left: `${endFrac * 100}%` }"
                @pointerdown="onPointerDown('end', $event)"
            >
                <svg
                    viewBox="0 0 10 14"
                    class="handle-triangle"
                >
                    <polygon points="10,0 0,7 10,14" />
                </svg>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .frame-range-selector {
        width: 100%;
        padding: 0 0.5rem;
        user-select: none;
    }

    .range-track {
        position: relative;
        width: 100%;
        height: 20px;
        background: #2a2a2a;
        border-radius: 2px;
        overflow: visible;
    }

    .range-dim {
        position: absolute;
        top: 0;
        height: 100%;
        background: rgba(0, 0, 0, 0.6);
        pointer-events: none;
    }

    .range-active {
        position: absolute;
        top: 0;
        height: 100%;
        background: rgba(16, 185, 129, 0.15);
        border-top: 2px solid #10b981;
        border-bottom: 2px solid #10b981;
        box-sizing: border-box;
        pointer-events: none;
    }

    .range-playhead {
        position: absolute;
        top: 0;
        width: 1px;
        height: 100%;
        background: #fff;
        pointer-events: none;
        z-index: 2;
    }

    .range-handle {
        position: absolute;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 14px;
        height: 20px;
        cursor: ew-resize;
        z-index: 3;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .range-handle-start {
        transform: translate(-100%, -50%);
    }

    .range-handle-end {
        transform: translate(0%, -50%);
    }

    .handle-triangle {
        width: 10px;
        height: 14px;
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
    }

    .handle-triangle polygon {
        fill: #10b981;
    }

    .range-handle:hover .handle-triangle polygon,
    .range-handle:active .handle-triangle polygon {
        fill: #34d399;
    }
</style>
