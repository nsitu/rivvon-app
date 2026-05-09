<script setup>
    import { useViewerStore } from '../../stores/viewerStore';

    const props = defineProps({
        cinematicPlaying: { type: Boolean, default: false },
        cinematicRoiCount: { type: Number, default: 0 },
    });

    // These actions target the live scene/camera owner, so they remain explicit requests.
    const emit = defineEmits([
        'request-cinematic-capture',
        'request-cinematic-toggle',
        'request-cinematic-clear',
    ]);

    const app = useViewerStore();

    function handleCapture() {
        app.hideToolsPanel();
        emit('request-cinematic-capture');
    }

    function handleToggle() {
        app.hideToolsPanel();
        emit('request-cinematic-toggle');
    }

    function handleClear() {
        app.hideToolsPanel();
        emit('request-cinematic-clear');
    }
</script>

<template>
    <div class="cinematic-camera-controls">
        <div class="tools-section">
            <div class="tools-section-label">Cinematic Camera</div>
            <div class="tools-section-items">
                <button
                    class="tools-option"
                    :disabled="props.cinematicPlaying"
                    @click="handleCapture"
                >
                    <span class="material-symbols-outlined">center_focus_strong</span>
                    <span>Capture View</span>
                    <span class="tools-hint">C</span>
                </button>

                <button
                    class="tools-option"
                    @click="handleToggle"
                >
                    <span class="material-symbols-outlined">{{ props.cinematicPlaying ? 'stop' : 'theaters' }}</span>
                    <span>{{ props.cinematicPlaying ? 'Stop Cinematic' : 'Play Cinematic' }}</span>
                    <span class="tools-hint">P</span>
                </button>

                <button
                    class="tools-option"
                    :disabled="props.cinematicPlaying || props.cinematicRoiCount === 0"
                    @click="handleClear"
                >
                    <span class="material-symbols-outlined">delete_sweep</span>
                    <span>Clear Views</span>
                    <span
                        v-if="props.cinematicRoiCount > 0"
                        class="tools-badge"
                    >{{ props.cinematicRoiCount }}</span>
                    <span class="tools-hint">X</span>
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .cinematic-camera-controls {
        width: 100%;
    }

    .tools-option {
        display: flex;
        align-items: center;
        gap: 0.875rem;
        padding: 0.875rem 1rem;
        background: transparent;
        border: none;
        border-radius: 8px;
        color: var(--p-text-color, #fff);
        cursor: pointer;
        font-size: 0.95rem;
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

    .tools-badge {
        margin-left: auto;
        font-size: 0.7rem;
        font-weight: 700;
        color: var(--p-primary-contrast-color, #fff);
        background: var(--p-primary-color, #6366f1);
        padding: 0.1rem 0.5rem;
        border-radius: 10px;
        min-width: 1.2rem;
        text-align: center;
    }
</style>