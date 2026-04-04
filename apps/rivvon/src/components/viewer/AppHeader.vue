<script setup>
    import { computed } from 'vue';
    import { useViewerStore } from '../../stores/viewerStore';
    import { useSlyceStore } from '../../stores/slyceStore';

    const emit = defineEmits(['close-realtime-mode']);

    const app = useViewerStore();
    const slyce = useSlyceStore();

    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
            app.setFullscreen(true);
        } else {
            document.exitFullscreen();
            app.setFullscreen(false);
        }
    }

    // Listen for fullscreen changes (e.g., Escape key)
    if (typeof document !== 'undefined') {
        document.addEventListener('fullscreenchange', () => {
            app.setFullscreen(!!document.fullscreenElement);
        });
    }

    // Compute which context is active (for header title + close button)
    const activeContext = computed(() => {
        if (app.isWalkMode) return 'Walk';
        if (app.isDrawingMode) return 'Draw';
        if (app.textureCreatorVisible || app.realtimeSamplerVisible) return 'Create Texture';
        if (app.textureBrowserVisible) return 'Textures';
        if (app.emojiPickerVisible) return 'Emoji';
        if (app.textPanelVisible) return 'Text';
        if (app.toolsPanelVisible) return 'Tools';
        if (app.aboutPanelVisible) return 'About';
        return null;
    });

    const isSlyceProcessing = computed(() => Object.keys(slyce.status).length > 0);

    function closeContext() {
        if (app.isWalkMode) {
            app.setWalkMode(false);
        } else if (app.isDrawingMode) {
            app.setDrawingMode(false);
        } else if (app.realtimeSamplerVisible) {
            emit('close-realtime-mode');
        } else if (app.textureCreatorVisible) {
            if (isSlyceProcessing.value) {
                const confirmed = confirm(
                    'Video processing is in progress. Leaving will cancel the current process and discard any results. Continue?'
                );
                if (!confirmed) return;
                slyce.resetProcessing();
            }
            app.hideSlyce();
        } else if (app.textureBrowserVisible) {
            app.hideTextureBrowser();
        } else if (app.emojiPickerVisible) {
            app.hideEmojiPicker();
        } else if (app.textPanelVisible) {
            app.hideTextPanel();
        } else if (app.toolsPanelVisible) {
            app.hideToolsPanel();
        } else if (app.aboutPanelVisible) {
            app.hideAboutPanel();
        }
    }
</script>

<template>
    <header
        class="app-header"
        :class="{ hidden: app.isFullscreen }"
    >
        <!-- Logo -->
        <a
            href="/"
            class="app-logo"
        >
            <img
                src="/rivvon.svg"
                alt="Rivvon"
            />
        </a>

        <!-- Context title -->
        <Transition name="fade">
            <span
                v-if="activeContext"
                class="context-title"
            >{{ activeContext }}</span>
        </Transition>

        <!-- Close button (context active) -->
        <button
            v-if="activeContext"
            class="header-action"
            @click="closeContext"
        >
            <span class="material-symbols-outlined">close</span>
        </button>

        <!-- Fullscreen button (no context active) -->
        <button
            v-else
            class="header-action"
            @click="toggleFullscreen"
        >
            <span class="material-symbols-outlined">{{ app.isFullscreen ? 'fullscreen_exit' : 'fullscreen' }}</span>
        </button>
    </header>
</template>

<style scoped>
    .app-header {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 10;
        display: flex;
        background: rgba(0, 0, 0, 0.5);
        justify-content: space-between;
        align-items: center;
        pointer-events: none;
        transition: opacity 0.3s ease, transform 0.3s ease;
    }

    .app-header.hidden {
        opacity: 0;
        transform: translateY(-100%);
        pointer-events: none;
    }

    .app-header>* {
        pointer-events: auto;
    }

    .app-logo {
        display: block;
        text-decoration: none;
        padding: 2rem 3rem;
        flex-shrink: 0;
    }

    .app-logo img {
        height: 1.5rem;
        width: auto;
    }

    .app-logo:hover {
        background: rgba(0, 0, 0, 0.25);
    }

    .context-title {
        margin-left: auto;
        font-size: 0.85rem;
        font-weight: 500;
        letter-spacing: 0.04em;
        color: rgba(255, 255, 255, 0.7);
        text-transform: uppercase;
        pointer-events: none;
        white-space: nowrap;
    }

    .header-action {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem 2.5rem;
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.7);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
        flex-shrink: 0;
    }

    .header-action:hover {
        background: rgba(0, 0, 0, 0.25);
        color: #fff;
    }

    .header-action .material-symbols-outlined {
        font-size: 1.5rem;
    }

    /* Transition */
    .fade-enter-active,
    .fade-leave-active {
        transition: opacity 0.2s ease;
    }

    .fade-enter-from,
    .fade-leave-to {
        opacity: 0;
    }

    /* Mobile adjustments */
    @media (max-width: 768px) {
        .app-logo {
            padding-left: 2rem;
            padding-right: 2rem;
        }

        .header-action {
            padding: 2rem 1.5rem;
        }
    }
</style>
