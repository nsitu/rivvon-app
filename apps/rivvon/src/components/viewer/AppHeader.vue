<script setup>
    import { computed } from 'vue';
    import { useViewerStore } from '../../stores/viewerStore';
    import { useSlyceStore } from '../../stores/slyceStore';

    const app = useViewerStore();
    const slyce = useSlyceStore();

    // Compute which context is active (for header title + close button)
    const activeContext = computed(() => {
        if (app.isDrawingMode) return 'Draw';
        if (app.textureCreatorVisible) return 'Create Texture';
        if (app.textureBrowserVisible) return 'Textures';
        if (app.textPanelVisible) return 'Text';
        if (app.toolsPanelVisible) return 'Tools';
        return null;
    });

    const isSlyceProcessing = computed(() => Object.keys(slyce.status).length > 0);

    function closeContext() {
        if (app.isDrawingMode) {
            app.setDrawingMode(false);
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
        } else if (app.textPanelVisible) {
            app.hideTextPanel();
        } else if (app.toolsPanelVisible) {
            app.hideToolsPanel();
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

        <!-- Close button -->
        <button
            v-if="activeContext"
            class="close-button"
            @click="closeContext"
        >
            <span class="material-symbols-outlined">close</span>
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

    .close-button {
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

    .close-button:hover {
        background: rgba(0, 0, 0, 0.25);
        color: #fff;
    }

    .close-button .material-symbols-outlined {
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

        .close-button {
            padding: 2rem 1.5rem;
        }
    }
</style>
