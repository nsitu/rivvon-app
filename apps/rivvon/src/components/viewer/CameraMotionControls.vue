<script setup>
    import { computed } from 'vue';

    const props = defineProps({
        recording: { type: Boolean, default: false },
        playing: { type: Boolean, default: false },
        previewing: { type: Boolean, default: false },
        hasRecording: { type: Boolean, default: false },
        duration: { type: Number, default: 0 },
        currentTime: { type: Number, default: 0 },
        sampleCount: { type: Number, default: 0 },
        closureDuration: { type: Number, default: 0 },
        disabled: { type: Boolean, default: false },
    });

    const emit = defineEmits([
        'request-motion-record',
        'request-motion-playback',
        'request-motion-clear',
        'request-motion-seek',
    ]);

    const timelineValue = computed(() => {
        if (!props.duration) return 0;
        return Math.min(props.duration, Math.max(0, props.currentTime));
    });

    function formatDuration(seconds) {
        const value = Math.max(0, Number(seconds) || 0);
        return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
    }

    function handleSeek(event) {
        emit('request-motion-seek', Number(event.target.value));
    }
</script>

<template>
    <div class="camera-motion-controls">
        <div class="tools-section">
            <div class="tools-section-label">Recorded Camera Motion</div>
            <div class="tools-section-items">
                <button
                    class="tools-option"
                    :class="{ 'motion-recording': props.recording }"
                    :disabled="props.disabled || props.playing || props.previewing"
                    @click="emit('request-motion-record')"
                >
                    <span class="material-symbols-outlined">{{ props.recording ? 'stop' : 'motion_photos_on' }}</span>
                    <span>{{ props.recording ? 'Stop Recording' : 'Record Orbit Motion' }}</span>
                    <span class="tools-hint">R</span>
                </button>

                <div
                    v-if="props.recording"
                    class="motion-status"
                >
                    <span class="motion-recording-dot"></span>
                    <span>Recording {{ formatDuration(props.currentTime) }}</span>
                    <span class="tools-hint">{{ props.sampleCount }} samples</span>
                </div>

                <template v-else>
                    <button
                        class="tools-option"
                        :disabled="props.disabled || !props.hasRecording"
                        @click="emit('request-motion-playback')"
                    >
                        <span class="material-symbols-outlined">{{ props.playing || props.previewing ? 'stop' : 'play_arrow' }}</span>
                        <span>{{ props.playing || props.previewing ? 'Stop Playback' : 'Play Recorded Motion' }}</span>
                    </button>

                    <div
                        v-if="props.hasRecording"
                        class="motion-timeline"
                    >
                        <div class="motion-timeline-labels">
                            <span>{{ formatDuration(props.currentTime) }}</span>
                            <span>{{ formatDuration(props.duration) }}</span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            :max="props.duration || 0.1"
                            step="0.01"
                            :value="timelineValue"
                            aria-label="Recorded camera motion timeline"
                            @input="handleSeek"
                        />
                        <div class="motion-timeline-detail">
                            <span>{{ props.sampleCount }} samples</span>
                            <span v-if="props.closureDuration > 0">Return path {{ props.closureDuration.toFixed(1) }}s</span>
                            <span v-else>Seam already aligned</span>
                        </div>
                    </div>

                    <button
                        class="tools-option"
                        :disabled="props.disabled || !props.hasRecording"
                        @click="emit('request-motion-clear')"
                    >
                        <span class="material-symbols-outlined">delete_sweep</span>
                        <span>Clear Recording</span>
                    </button>
                </template>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .camera-motion-controls {
        width: 100%;
    }

    .tools-section-items {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }

    .tools-option {
        display: flex;
        align-items: center;
        gap: 0.875rem;
        width: 100%;
        padding: 0.875rem 1rem;
        background: transparent;
        border: none;
        border-radius: 8px;
        color: var(--p-text-color, #fff);
        cursor: pointer;
        font-size: 0.95rem;
        text-align: left;
        transition: background 0.15s ease;
    }

    .tools-option:hover {
        background: rgba(255, 255, 255, 0.08);
    }

    .tools-option .material-symbols-outlined {
        font-size: 1.35rem;
        opacity: 0.85;
    }

    .tools-option:disabled {
        opacity: 0.35;
        cursor: not-allowed;
    }

    .tools-option:disabled:hover {
        background: transparent;
    }

    .motion-recording {
        color: #ff8f8f;
    }

    .tools-hint {
        margin-left: auto;
        font-size: 0.65rem;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.5);
        background: rgba(255, 255, 255, 0.08);
        padding: 0.2rem 0.45rem;
        border-radius: 4px;
        font-family: monospace;
        letter-spacing: 0.02em;
    }

    .motion-status,
    .motion-timeline-detail,
    .motion-timeline-labels {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: rgba(255, 255, 255, 0.7);
        font-size: 0.75rem;
    }

    .motion-status {
        padding: 0.2rem 1rem 0.45rem;
    }

    .motion-recording-dot {
        width: 0.55rem;
        height: 0.55rem;
        border-radius: 50%;
        background: #ff5d5d;
        box-shadow: 0 0 0 4px rgba(255, 93, 93, 0.16);
    }

    .motion-timeline {
        padding: 0.35rem 1rem 0.75rem;
    }

    .motion-timeline-labels,
    .motion-timeline-detail {
        justify-content: space-between;
    }

    .motion-timeline input[type='range'] {
        display: block;
        width: 100%;
        margin: 0.4rem 0 0.35rem;
        accent-color: var(--p-primary-color, #6366f1);
    }

    .motion-timeline-detail {
        color: rgba(255, 255, 255, 0.48);
        font-size: 0.68rem;
    }
</style>
