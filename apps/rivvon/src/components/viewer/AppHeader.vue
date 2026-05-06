<script setup>
    import { computed } from 'vue';
    import { resolveViewerHeaderContext } from '../../modules/viewer/viewerHeaderContext.js';
    import { useViewerStore } from '../../stores/viewerStore';
    import { useSlyceStore } from '../../stores/slyceStore';

    const props = defineProps({
        cameraActive: {
            type: Boolean,
            default: false,
        },
        cameraDismissLabel: {
            type: String,
            default: 'Turn off camera',
        },
        panelTitle: {
            type: String,
            default: null,
        },
        toolbarOverlayTitle: {
            type: String,
            default: null,
        },
    });

    const emit = defineEmits([
        'request-close-realtime-mode',
        'request-close-panel',
        'request-close-toolbar-overlay',
        'request-turn-off-camera'
    ]);

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

    const isSlyceProcessing = computed(() => Object.keys(slyce.status).length > 0);
    const headerContext = computed(() => resolveViewerHeaderContext(app, {
        panelTitle: props.panelTitle,
        toolbarOverlayTitle: props.toolbarOverlayTitle,
        isSlyceProcessing: isSlyceProcessing.value,
        onClosePanel: () => emit('request-close-panel'),
        onCloseToolbarOverlay: () => emit('request-close-toolbar-overlay'),
        onCloseRealtimeMode: () => emit('request-close-realtime-mode'),
        onResetSlyceProcessing: () => slyce.resetProcessing(),
    }));
    const activeContext = computed(() => headerContext.value?.title ?? null);

    function closeContext() {
        headerContext.value?.close?.();
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

    <Transition name="fade">
        <div
            v-if="props.cameraActive"
            class="camera-indicator"
            :class="{ hidden: app.isFullscreen }"
            role="status"
            aria-live="polite"
        >
            <span
                class="camera-indicator-icon material-symbols-outlined"
                aria-hidden="true"
            >videocam</span>
            <span class="camera-indicator-label">Camera on</span>
            <button
                type="button"
                class="camera-indicator-dismiss"
                :aria-label="props.cameraDismissLabel"
                @click="emit('request-turn-off-camera')"
            >
                <span class="material-symbols-outlined">close</span>
            </button>
        </div>
    </Transition>
</template>

<style scoped>
    .app-header {
        --app-header-side-padding: 3rem;
        --app-header-top-padding: 2rem;
        --app-logo-height: 1.5rem;
    }

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

    .app-header.hidden,
    .camera-indicator.hidden {
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
        padding: var(--app-header-top-padding) var(--app-header-side-padding);
        flex-shrink: 0;
    }

    .app-logo img {
        height: var(--app-logo-height);
        width: auto;
    }

    .app-logo:hover {
        background: rgba(0, 0, 0, 0.25);
    }

    .camera-indicator {
        --camera-indicator-left-offset: 2rem;
        --camera-indicator-top-offset: 6.6rem;
        position: absolute;
        top: var(--camera-indicator-top-offset);
        left: var(--camera-indicator-left-offset);
        z-index: 11;
        display: inline-flex;
        align-items: center;
        gap: 0.55rem;
        padding: 0.45rem 0.5rem 0.45rem 0.7rem;
        border-radius: 999px;
        background: #a82020;
        color: #fff;
        pointer-events: auto;
        transition: opacity 0.3s ease, transform 0.3s ease;
    }

    .camera-indicator-icon {
        font-size: 1rem;
        color: #fff;
        flex-shrink: 0;
    }

    .camera-indicator-label {
        font-size: 0.74rem;
        font-weight: 600;
        letter-spacing: 0.05em;
        line-height: 1;
        font-variant-caps: normal;
        white-space: nowrap;
    }

    .camera-indicator-dismiss {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.6rem;
        height: 1.6rem;
        padding: 0;
        border: none;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.82);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
        flex-shrink: 0;
    }

    .camera-indicator-dismiss:hover {
        background: rgba(255, 255, 255, 0.18);
        color: #fff;
    }

    .camera-indicator-dismiss .material-symbols-outlined {
        font-size: 1rem;
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
        .app-header {
            --app-header-side-padding: 2rem;
        }

        .camera-indicator {
            --camera-indicator-left-offset: 2rem;
            --camera-indicator-top-offset: 6.45rem;
        }

        .app-logo {
            padding-right: 2rem;
        }

        .header-action {
            padding: 2rem 1.5rem;
        }
    }
</style>
