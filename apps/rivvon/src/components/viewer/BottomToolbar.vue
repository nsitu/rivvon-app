<script setup>
    import { useViewerStore } from '../../stores/viewerStore';

    const app = useViewerStore();

    const emit = defineEmits([
        'toggle-draw-mode',
        'toggle-flow',
        'open-text-panel',
        'open-texture-browser',
        'import-file',
        'toggle-fullscreen',
        'finish-drawing'
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
        <!-- Back button (only in drawing, slyce, or texture browser mode) -->
        <button
            v-if="app.isDrawingMode || app.textureCreatorVisible || app.textureBrowserVisible"
            class="back-button"
            v-tooltip.top="'Back'"
            @click="app.isDrawingMode ? emit('toggle-draw-mode') : app.textureCreatorVisible ? app.toggleSlyce() : app.hideTextureBrowser()"
        >
            <span class="material-symbols-outlined">arrow_back_ios</span>
        </button>


        <div
            v-if="app.isDrawingMode || app.textureCreatorVisible || app.textureBrowserVisible"
            class="separator"
        ></div>


        <!-- Draw mode toggle -->
        <button
            v-if="!app.textureCreatorVisible && !app.textureBrowserVisible"
            v-tooltip.top="'Draw'"
            :class="{ active: app.isDrawingMode }"
            @click="emit('toggle-draw-mode')"
        >
            <span class="material-symbols-outlined">draw</span>
            <span
                v-if="app.isDrawingMode"
                class="mode-label"
            >Draw</span>
        </button>

        <!-- Slyce texture tool -->
        <button
            v-if="!app.isDrawingMode && !app.textureBrowserVisible"
            v-tooltip.top="'Create Texture'"
            :class="{ active: app.textureCreatorVisible }"
            @click="app.toggleSlyce()"
        >
            <span class="material-symbols-outlined">video_camera_back_add</span>

            <span
                v-if="app.textureCreatorVisible"
                class="mode-label"
            >Create Texture</span>
        </button>
        <!-- Finish drawing button (only in draw mode with strokes) -->
        <button
            v-if="app.isDrawingMode && app.hasActiveStrokes"
            class="finish-drawing-btn"
            v-tooltip.top="'Finish drawing and create ribbons'"
            @click="emit('finish-drawing')"
        >
            <span class="material-symbols-outlined">check</span>
        </button>

        <!-- Text to SVG -->
        <button
            v-if="!app.isDrawingMode && !app.textureCreatorVisible && !app.textureBrowserVisible"
            v-tooltip.top="'Text'"
            @click="emit('open-text-panel')"
        >
            <span class="material-symbols-outlined">text_fields</span>
        </button>

        <!-- Browse textures -->
        <button
            v-if="!app.isDrawingMode && !app.textureCreatorVisible"
            v-tooltip.top="'Textures'"
            :class="{ active: app.textureBrowserVisible }"
            @click="emit('open-texture-browser')"
        >
            <span class="material-symbols-outlined">grid_view</span>
            <span
                v-if="app.textureBrowserVisible"
                class="mode-label"
            >Textures</span>
        </button>

        <!-- Import SVG/ZIP -->
        <button
            v-if="!app.isDrawingMode && !app.textureCreatorVisible && !app.textureBrowserVisible"
            v-tooltip.top="'Import SVG or ZIP texture pack'"
            @click="emit('import-file')"
        >
            <span class="material-symbols-outlined">upload</span>
        </button>


        <!-- Flow animation toggle -->
        <button
            v-if="!app.isDrawingMode && !app.textureCreatorVisible && !app.textureBrowserVisible"
            v-tooltip.top="'Toggle texture flow animation'"
            :class="{ active: app.flowEnabled }"
            @click="emit('toggle-flow')"
        >
            <span class="material-symbols-outlined">sprint</span>
        </button>

        <!-- Fullscreen toggle -->
        <button
            v-if="!app.isDrawingMode && !app.textureCreatorVisible && !app.textureBrowserVisible"
            v-tooltip.top="'Toggle fullscreen'"
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
        align-items: center;
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
        pointer-events: auto;
    }

    .bottom-toolbar button:hover {
        background: rgba(0, 0, 0, 0.25);
    }

    .bottom-toolbar button.active {
        background: rgba(0, 0, 0, 0.5);
    }

    .back-button {
        pointer-events: auto;
    }

    .back-button .material-symbols-outlined {
        font-size: 1.25rem;
    }

    .mode-label {
        margin-left: 0.5rem;
        font-size: 0.85rem;
        font-weight: 400;
        letter-spacing: 0.03em;
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

    /* Mobile: buttons expand to fill available space */
    @media (max-width: 768px) {

        .bottom-toolbar button {
            flex-grow: 1;
        }
    }

    .separator {

        margin: 0 2rem;

        width: 3px;
        height: 3rem;
        background: var(--bg-muted-alt);
        padding: 0px;
    }

    .finish-drawing-btn {
        color: #22c55e !important;
    }

    .finish-drawing-btn:hover {
        background: rgba(34, 197, 94, 0.2) !important;
    }

</style>
