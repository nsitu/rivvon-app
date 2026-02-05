<script setup>
    import { ref } from 'vue';
    import { useViewerStore } from '../../stores/viewerStore';
    import Popover from 'primevue/popover';

    const app = useViewerStore();
    const toolsPopover = ref();

    function toggleToolsPopover(event) {
        toolsPopover.value.toggle(event);
    }

    function setFlowState(state) {
        app.setFlowState(state);
        toolsPopover.value.hide();
    }

    function handleImport(type) {
        toolsPopover.value.hide();
        emit('import-file', type);
    }

    function handleExportImage() {
        toolsPopover.value.hide();
        emit('export-image');
    }

    function handleExportVideo() {
        toolsPopover.value.hide();
        emit('export-video');
    }

    const emit = defineEmits([
        'enter-draw-mode',
        'toggle-flow',
        'open-text-panel',
        'open-texture-browser',
        'enter-slyce-mode',
        'import-file',
        'export-image',
        'export-video',
        'toggle-fullscreen',
        'finish-drawing'
    ]);

    function toggleFullscreen() {
        toolsPopover.value.hide();
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
        <!-- Back button (only in drawing, slyce, texture browser, or text panel mode) -->
        <button
            v-if="app.isDrawingMode || app.textureCreatorVisible || app.textureBrowserVisible || app.textPanelVisible"
            class="back-button"
            v-tooltip.top="'Back'"
            @click="app.isDrawingMode ? app.setDrawingMode(false) : app.textureCreatorVisible ? app.hideSlyce() : app.textureBrowserVisible ? app.hideTextureBrowser() : app.hideTextPanel()"
        >
            <span class="material-symbols-outlined">arrow_back_ios</span>
        </button>


        <div
            v-if="app.isDrawingMode || app.textureCreatorVisible || app.textureBrowserVisible || app.textPanelVisible"
            class="separator"
        ></div>


        <!-- Draw mode button -->
        <button
            v-if="!app.textureCreatorVisible && !app.textureBrowserVisible && !app.textPanelVisible"
            v-tooltip.top="'Draw'"
            :class="{ active: app.isDrawingMode }"
            @click="emit('enter-draw-mode')"
        >
            <span class="material-symbols-outlined">draw</span>
            <span
                v-if="app.isDrawingMode"
                class="mode-label"
            >Draw</span>
        </button>

        <!-- Slyce texture tool -->
        <button
            v-if="!app.isDrawingMode && !app.textureBrowserVisible && !app.textPanelVisible"
            v-tooltip.top="'Create Texture'"
            :class="{ active: app.textureCreatorVisible }"
            @click="emit('enter-slyce-mode')"
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
            <span>OK</span>
        </button>

        <!-- Text to SVG -->
        <button
            v-if="!app.isDrawingMode && !app.textureCreatorVisible && !app.textureBrowserVisible"
            v-tooltip.top="'Text'"
            :class="{ active: app.textPanelVisible }"
            @click="emit('open-text-panel')"
        >
            <span class="material-symbols-outlined">text_fields</span>
            <span
                v-if="app.textPanelVisible"
                class="mode-label"
            >Text</span>
        </button>

        <!-- Browse textures -->
        <button
            v-if="!app.isDrawingMode && !app.textureCreatorVisible && !app.textPanelVisible"
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

        <!-- Tools menu (Import/Export + Animation) -->
        <button
            v-if="!app.isDrawingMode && !app.textureCreatorVisible && !app.textureBrowserVisible && !app.textPanelVisible"
            v-tooltip.top="'Tools'"
            :class="{ active: app.flowState !== 'off' }"
            @click="toggleToolsPopover"
        >
            <span class="material-symbols-outlined">instant_mix</span>
        </button>

        <Popover
            ref="toolsPopover"
            class="tools-popover"
        >
            <div class="tools-menu">
                <!-- Animation section -->
                <div class="menu-section-label">Animation</div>
                <button
                    class="menu-option"
                    :class="{ selected: app.flowState === 'off' }"
                    @click="setFlowState('off')"
                >
                    <span class="material-symbols-outlined">airwave</span>
                    <span>Oscillate</span>
                </button>
                <button
                    class="menu-option"
                    :class="{ selected: app.flowState === 'forward' }"
                    @click="setFlowState('forward')"
                >
                    <span class="material-symbols-outlined">arrow_forward</span>
                    <span>Forward</span>
                </button>
                <button
                    class="menu-option"
                    :class="{ selected: app.flowState === 'backward' }"
                    @click="setFlowState('backward')"
                >
                    <span class="material-symbols-outlined">arrow_back</span>
                    <span>Backward</span>
                </button>

                <div class="menu-divider"></div>

                <!-- Import / Export section -->
                <div class="menu-section-label">Import / Export</div>
                <button
                    class="menu-option"
                    @click="handleImport('svg')"
                >
                    <span class="material-symbols-outlined">polyline</span>
                    <span>Import SVG</span>
                </button>
                <button
                    class="menu-option"
                    @click="handleImport('zip')"
                >
                    <span class="material-symbols-outlined">folder_zip</span>
                    <span>Import ZIP Texture</span>
                </button>
                <button
                    class="menu-option"
                    @click="handleExportImage"
                >
                    <span class="material-symbols-outlined">image</span>
                    <span>Export Image</span>
                </button>
                <button
                    class="menu-option"
                    @click="handleExportVideo"
                >
                    <span class="material-symbols-outlined">videocam</span>
                    <span>Export Video (5s)</span>
                </button>

                <div class="menu-divider"></div>

                <!-- Fullscreen section -->
                <div class="menu-section-label">Display</div>
                <button
                    class="menu-option"
                    @click="toggleFullscreen"
                >
                    <span class="material-symbols-outlined">{{ app.isFullscreen ? 'fullscreen_exit' : 'fullscreen'
                        }}</span>
                    <span>{{ app.isFullscreen ? 'Exit Fullscreen' : 'Fullscreen' }}</span>
                </button>
            </div>
        </Popover>
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
        background: rgba(34, 197, 94, 1) !important;
        color: #ffffff !important;
    }

    .finish-drawing-btn:hover {
        background: rgba(34, 197, 94, 0.8) !important;
    }

    /* Tools popover menu styles */
    .tools-menu {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        min-width: 180px;
    }

    .menu-section-label {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.5));
        padding: 0.5rem 0.875rem 0.25rem;
    }

    .menu-option {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.625rem 0.875rem;
        background: transparent;
        border: none;
        border-radius: 6px;
        color: var(--p-text-color, #fff);
        cursor: pointer;
        font-size: 0.9rem;
        transition: background 0.15s ease;
    }

    .menu-option:hover {
        background: var(--p-content-hover-background, rgba(255, 255, 255, 0.1));
    }

    .menu-option.selected {
        background: var(--p-primary-color, #6366f1);
        color: var(--p-primary-contrast-color, #fff);
    }

    .menu-option .material-symbols-outlined {
        font-size: 1.25rem;
    }

    .menu-divider {
        height: 1px;
        background: var(--p-content-border-color, rgba(255, 255, 255, 0.15));
        margin: 0.5rem 0;
    }

</style>
