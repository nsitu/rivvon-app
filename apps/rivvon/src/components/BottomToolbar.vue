<script setup>
    import { useAppStore } from '../stores/appStore';

    const app = useAppStore();

    const emit = defineEmits([
        'toggle-draw-mode',
        'toggle-flow',
        'open-text-panel',
        'open-texture-browser',
        'import-file',
        'toggle-fullscreen'
    ]);

    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
        emit('toggle-fullscreen');
    }
</script>

<template>
    <div class="bottom-toolbar">
        <!-- Draw mode toggle -->
        <button
            :class="{ active: app.isDrawingMode }"
            title="Toggle drawing mode"
            @click="emit('toggle-draw-mode')"
        >
            <span class="material-symbols-outlined">
                draw
            </span>
        </button>

        <!-- Text to SVG -->
        <button
            title="Create ribbon from text"
            @click="emit('open-text-panel')"
        >
            <span class="material-symbols-outlined">text_fields</span>
        </button>

        <!-- Browse textures -->
        <button
            title="Browse texture library"
            @click="emit('open-texture-browser')"
        >
            <span class="material-symbols-outlined">grid_view</span>
        </button>

        <!-- Import SVG/ZIP -->
        <button
            title="Import SVG or ZIP texture pack"
            @click="emit('import-file')"
        >
            <span class="material-symbols-outlined">upload</span>
        </button>

        <!-- Flow animation toggle -->
        <button
            :class="{ active: app.flowEnabled }"
            title="Toggle texture flow animation"
            @click="emit('toggle-flow')"
        >
            <span class="material-symbols-outlined">sprint</span>
        </button>

        <!-- Fullscreen toggle -->
        <button
            title="Toggle fullscreen"
            @click="toggleFullscreen"
        >
            <span class="material-symbols-outlined">fullscreen</span>
        </button>
    </div>
</template>

<style scoped>
    .bottom-toolbar {
        position: fixed;
        bottom: 0;
        right: 0;
        z-index: 10;
        display: flex;
        flex-direction: row;
    }

    .bottom-toolbar button {
        padding: 0.7em 1.3em;
        font-size: 1.1em;
        background: rgba(0, 0, 0, 0.5);
        color: #fff;
        border: none;
        cursor: pointer;
        opacity: 0.92;
        min-width: 44px;
        min-height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .bottom-toolbar button:hover {
        background: rgba(0, 0, 0, 0.7);
    }

    .bottom-toolbar button.active {
        background: rgba(50, 50, 50, 0.8);
    }

    .toggle-icon {
        width: 24px;
        height: 24px;
        filter: invert(1);
    }

    .draw-icon {
        opacity: 0.9;
    }

    button.active .draw-icon {
        opacity: 1;
    }

    /* Mobile: stack vertically */
    @media (max-width: 480px) {
        .bottom-toolbar {
            flex-direction: column-reverse;
        }
    }
</style>
