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
            app.setFullscreen(true);
        } else {
            document.exitFullscreen();
            app.setFullscreen(false);
        }
        emit('toggle-fullscreen');
    }

    // Listen for fullscreen changes (e.g., Escape key)
    if (typeof document !== 'undefined') {
        document.addEventListener('fullscreenchange', () => {
            app.setFullscreen(!!document.fullscreenElement);
        });
    }
</script>

<template>
    <div
        class="bottom-toolbar"
        :class="{ hidden: app.isFullscreen }"
    >
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
    /* .bottom-toolbar {
        position: fixed;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        z-index: 10;
        display: flex;
        flex-direction: row;
    } */

    .bottom-toolbar {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 10;
        display: flex;
        background: rgba(0, 0, 0, 0.5);
        justify-content: center;
        align-items: flex-start;
        pointer-events: none;
        padding: 0 1rem;
        transition: opacity 0.3s ease, transform 0.3s ease;
    }

    .bottom-toolbar.hidden {
        opacity: 0;
        transform: translateY(100%);
        pointer-events: none;
    }


    .bottom-toolbar button {
        padding: 2rem 1rem;
        font-size: 1.1em;
        color: #fff;
        border: none;
        cursor: pointer;
        opacity: 0.92;
        min-width: 44px;
        min-height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: transparent;
    }

    .bottom-toolbar button:hover {
        background: rgba(0, 0, 0, 0.25);
    }

    .bottom-toolbar button.active {
        background: rgba(0, 255, 55, 0.5);
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
</style>
