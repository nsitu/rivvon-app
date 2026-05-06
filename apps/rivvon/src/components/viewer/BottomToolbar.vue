<script setup>
    import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
    import Button from 'primevue/button';
    import CinematicCameraControls from './CinematicCameraControls.vue';
    import ScrollPanel from 'primevue/scrollpanel';
    import Select from 'primevue/select';
    import AnimationSettingsControls from './AnimationSettingsControls.vue';
    import GeometrySettingsControls from './GeometrySettingsControls.vue';
    import TextureSettingsControls from './TextureSettingsControls.vue';
    import ViewerSettingsControls from './ViewerSettingsControls.vue';
    import {
        EXPORT_ASPECT_RATIO_OPTIONS,
        getExportResolutionOptions,
        normalizeExportDimensionSettings,
    } from '../../modules/viewer/exportVideoDimensions.js';
    import { useViewerStore } from '../../stores/viewerStore';
    import { useSlyceStore } from '../../stores/slyceStore';
    import { useGoogleAuth } from '../../composables/shared/useGoogleAuth';

    const app = useViewerStore();
    const slyce = useSlyceStore();
    const { user, isAdmin, isAuthenticated, login, logout } = useGoogleAuth();

    const showInfoDialog = ref(false);

    function handleAbout() {
        app.hideToolsPanel();
        app.showAboutPanel();
    }

    function handleLoginClick() {
        app.hideToolsPanel();
        app.showBetaModal();
    }

    function handleLogout() {
        app.hideToolsPanel();
        logout();
    }

    // Detect touch device to disable tooltips on mobile
    // Uses pointer: coarse media query which is more reliable than touch event detection
    const isTouchDevice = computed(() => {
        if (typeof window === 'undefined') return false;
        return window.matchMedia('(pointer: coarse)').matches;
    });

    // Helper to conditionally return tooltip text (null disables tooltip)
    const tip = (text) => isTouchDevice.value ? null : text;

    function closeLaunchers() {
        emit('request-toolbar-overlay-change', null);
    }

    function toggleLauncher(name) {
        const nextLauncher = props.activeToolbarOverlay === name ? null : name;

        if (nextLauncher && !closeActiveContext()) {
            return;
        }

        emit('request-toolbar-overlay-change', nextLauncher);
    }

    const exportAspectRatioOptions = EXPORT_ASPECT_RATIO_OPTIONS;

    const exportDimensionSettings = computed(() => normalizeExportDimensionSettings({
        aspectRatioPreset: app.exportAspectRatioPreset,
        resolutionPreset: app.exportResolutionPreset,
        customWidth: app.exportCustomWidth,
        customHeight: app.exportCustomHeight,
    }));

    const exportAspectRatioPresetModel = computed({
        get: () => exportDimensionSettings.value.aspectRatioPreset,
        set: (value) => {
            app.setExportAspectRatioPreset(value);
        }
    });

    const exportResolutionPresetModel = computed({
        get: () => exportDimensionSettings.value.resolutionPreset,
        set: (value) => {
            app.setExportResolutionPreset(value);
        }
    });

    const exportResolutionOptions = computed(() => getExportResolutionOptions(exportAspectRatioPresetModel.value));

    const buildTimestampRaw = import.meta.env.VITE_BUILD_TIMESTAMP || '';

    function formatBuildTimestamp(value) {
        if (!value) return 'Unavailable';

        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return value;

        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'medium',
        }).format(parsed);
    }

    const buildTimestampDisplay = computed(() => formatBuildTimestamp(buildTimestampRaw));

    function handleImport(type) {
        closeLaunchers();
        app.hideToolsPanel();
        emit('request-import-file', type);
    }

    function handleExportImage() {
        closeLaunchers();
        app.hideToolsPanel();
        emit('request-export-image');
    }

    function handleExportVideo() {
        closeLaunchers();
        app.hideToolsPanel();
        emit('request-export-video');
    }

    // Cinematic camera props (reactive state from composable)
    const props = defineProps({
        cinematicPlaying: { type: Boolean, default: false },
        cinematicRoiCount: { type: Number, default: 0 },
        technicalOverlay: { type: Boolean, default: false },
        activeToolbarOverlay: { type: String, default: null },
        exportImageVisible: { type: Boolean, default: false },
        exportVideoVisible: { type: Boolean, default: false }
    });

    // Store-backed settings sections write directly to Pinia.
    // Any action that requires RibbonView-owned scene, camera, or panel orchestration
    // crosses this boundary as an explicit request event.
    const emit = defineEmits([
        'request-enter-draw-mode',
        'request-enter-walk-mode',
        'request-enter-contour-mode',
        'request-open-drawing-browser',
        'request-toggle-flow',
        'request-open-text-panel',
        'request-open-emoji-picker',
        'request-open-texture-file',
        'request-open-texture-camera',
        'request-open-texture-browser',
        'request-close-realtime-mode',
        'request-import-file',
        'request-export-image',
        'request-export-video',
        'request-finish-drawing',
        'request-finish-walk',
        'request-viewer-control-mode-change',
        'request-reset-viewer',
        'request-cinematic-capture',
        'request-cinematic-toggle',
        'request-cinematic-clear',
        'request-technical-overlay-toggle',
        'request-close-export-image',
        'request-close-export-video',
        'request-toolbar-overlay-change'
    ]);

    // Check if Slyce processing is active (has status messages)
    const isSlyceProcessing = computed(() => Object.keys(slyce.status).length > 0);

    /**
     * Handle the back button press.
     * If Slyce is visible and processing, confirm before cancelling and closing.
     */
    function handleBack() {
        closeLaunchers();

        if (app.isWalkMode) {
            app.setWalkMode(false);
        } else if (app.isDrawingMode) {
            app.setDrawingMode(false);
        } else if (app.drawingBrowserVisible) {
            app.hideDrawingBrowser();
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
        } else if (app.emojiPickerVisible) {
            app.hideEmojiPicker();
        } else if (app.contourPanelVisible) {
            app.hideContourPanel();
        } else if (app.realtimeSamplerVisible) {
            emit('request-close-realtime-mode');
        } else if (props.exportImageVisible) {
            emit('request-close-export-image');
        } else if (props.exportVideoVisible) {
            emit('request-close-export-video');
        } else if (props.activeToolbarOverlay) {
            closeLaunchers();
        } else if (app.toolsPanelVisible) {
            app.hideToolsPanel();
        } else if (app.aboutPanelVisible) {
            app.hideAboutPanel();
        }
    }

    // Computed: is any panel/mode currently active?
    const hasActiveContext = computed(() =>
        app.isDrawingMode || app.isWalkMode || app.drawingBrowserVisible || app.textureCreatorVisible || app.textureBrowserVisible || app.textPanelVisible || app.emojiPickerVisible || app.contourPanelVisible || !!props.activeToolbarOverlay || props.exportImageVisible || props.exportVideoVisible || app.toolsPanelVisible || app.aboutPanelVisible || app.realtimeSamplerVisible
    );

    const drawGroupActive = computed(() => (
        app.isDrawingMode
        || app.isWalkMode
        || app.drawingBrowserVisible
        || app.textPanelVisible
        || app.emojiPickerVisible
        || app.contourPanelVisible
    ));

    const textureGroupActive = computed(() => (
        app.textureCreatorVisible
        || app.textureBrowserVisible
        || app.realtimeSamplerVisible
    ));

    const showFinishCaptureButton = computed(() => {
        if (app.isWalkMode) {
            return app.hasActiveWalkPath;
        }

        return app.isDrawingMode && app.hasActiveStrokes;
    });

    const finishCaptureTooltip = computed(() => {
        if (app.isWalkMode) {
            return tip('Finish walk and create ribbon');
        }

        return tip('Finish drawing and create ribbons');
    });

    const showToolsPanelCheckmark = computed(() => app.toolsPanelHasChanges);



    function handleToolsPanelCheckmark() {
        app.hideToolsPanel();
    }

    function handleFinishCapture() {
        if (app.isWalkMode) {
            emit('request-finish-walk');
            return;
        }

        emit('request-finish-drawing');
    }

    /**
     * Close any active context before switching to a new one.
     * Returns false if the user cancelled (e.g., Slyce processing confirmation).
     */
    function closeActiveContext() {
        if (app.isWalkMode) {
            app.setWalkMode(false);
        }
        if (app.isDrawingMode) {
            app.setDrawingMode(false);
        }
        if (app.drawingBrowserVisible) {
            app.hideDrawingBrowser();
        }
        if (app.textureCreatorVisible) {
            if (isSlyceProcessing.value) {
                const confirmed = confirm(
                    'Video processing is in progress. Leaving will cancel the current process and discard any results. Continue?'
                );
                if (!confirmed) return false;
                slyce.resetProcessing();
            }
            app.hideSlyce();
        }
        if (app.textureBrowserVisible) {
            app.hideTextureBrowser();
        }
        if (app.textPanelVisible) {
            app.hideTextPanel();
        }
        if (app.emojiPickerVisible) {
            app.hideEmojiPicker();
        }
        if (app.contourPanelVisible) {
            app.hideContourPanel();
        }
        if (app.toolsPanelVisible) {
            app.hideToolsPanel();
        }
        if (app.aboutPanelVisible) {
            app.hideAboutPanel();
        }
        if (app.realtimeSamplerVisible) {
            emit('request-close-realtime-mode', { suppressCreateTextureReturn: true });
        }
        if (props.exportImageVisible) {
            emit('request-close-export-image');
        }
        if (props.exportVideoVisible) {
            emit('request-close-export-video');
        }
        if (props.activeToolbarOverlay) {
            closeLaunchers();
        }
        return true;
    }

    function activateContext(action) {
        if (!closeActiveContext()) return;
        closeLaunchers();
        action();
    }

    function isEditableTarget(target) {
        if (!(target instanceof Element)) {
            return false;
        }

        const tag = target.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
            return true;
        }

        return target.isContentEditable || Boolean(target.closest('[contenteditable="true"]'));
    }

    function handleGlobalKeydown(event) {
        if (event.key !== 'Escape') {
            return;
        }

        if (isEditableTarget(event.target)) {
            return;
        }

        if (!hasActiveContext.value) {
            return;
        }

        event.preventDefault();
        handleBack();
    }

    onMounted(() => {
        window.addEventListener('keydown', handleGlobalKeydown);
    });

    onBeforeUnmount(() => {
        window.removeEventListener('keydown', handleGlobalKeydown);
    });

    const activeLauncherItems = computed(() => {
        if (props.activeToolbarOverlay === 'draw') {
            return drawLauncherItems.value;
        }

        if (props.activeToolbarOverlay === 'texture') {
            return textureLauncherItems.value;
        }

        if (props.activeToolbarOverlay === 'share') {
            return shareLauncherItems.value;
        }

        return [];
    });

    const activeLauncherTitle = computed(() => {
        if (props.activeToolbarOverlay === 'draw') return 'Draw';
        if (props.activeToolbarOverlay === 'texture') return 'Texture';
        if (props.activeToolbarOverlay === 'share') return 'Share';
        return '';
    });

    const drawLauncherItems = computed(() => ([
        {
            label: 'Import SVG',
            icon: 'polyline',
            command: () => {
                handleImport('svg');
            }
        },
        {
            label: 'Walk',
            icon: 'directions_walk',
            active: app.isWalkMode,
            command: () => {
                if (app.isWalkMode) {
                    handleBack();
                    return;
                }

                activateContext(() => emit('request-enter-walk-mode'));
            }
        },
        {
            label: 'Write',
            icon: 'text_fields',
            active: app.textPanelVisible,
            command: () => {
                if (app.textPanelVisible) {
                    handleBack();
                    return;
                }

                activateContext(() => emit('request-open-text-panel'));
            }
        },
        {
            label: 'Emoji',
            icon: 'mood',
            active: app.emojiPickerVisible,
            command: () => {
                if (app.emojiPickerVisible) {
                    handleBack();
                    return;
                }

                activateContext(() => emit('request-open-emoji-picker'));
            }
        },
        {
            label: 'Gesture',
            icon: 'gesture',
            active: app.isDrawingMode,
            command: () => {
                if (app.isDrawingMode) {
                    handleBack();
                    return;
                }

                activateContext(() => emit('request-enter-draw-mode'));
            }
        },
        {
            label: 'Contour',
            icon: 'vr180_create2d',
            active: app.contourPanelVisible,
            command: () => {
                if (app.contourPanelVisible) {
                    handleBack();
                    return;
                }

                activateContext(() => emit('request-enter-contour-mode'));
            }
        },
        {
            label: 'Browse',
            icon: 'grid_view',
            active: app.drawingBrowserVisible,
            command: () => {
                if (app.drawingBrowserVisible) {
                    handleBack();
                    return;
                }

                activateContext(() => emit('request-open-drawing-browser'));
            }
        }
    ]));

    const textureLauncherItems = computed(() => ([
        {
            label: 'Import ZIP',
            icon: 'folder_zip',
            command: () => {
                handleImport('zip');
            }
        }, {
            label: 'From Camera',
            icon: 'camera_video',
            active: app.realtimeSamplerVisible,
            command: () => {
                activateContext(() => emit('request-open-texture-camera'));
            }
        }, {
            label: 'From Video',
            icon: 'video_file',
            active: app.textureCreatorVisible,
            command: () => {
                activateContext(() => emit('request-open-texture-file'));
            }
        },


        {
            label: 'Browse',
            icon: 'grid_view',
            active: app.textureBrowserVisible,
            command: () => {
                if (app.textureBrowserVisible) {
                    handleBack();
                    return;
                }

                activateContext(() => emit('request-open-texture-browser'));
            }
        }
    ]));

    const shareLauncherItems = computed(() => ([
        {
            label: 'Export Image',
            icon: 'image',
            command: () => {
                handleExportImage();
            }
        },
        {
            label: 'Export Video',
            icon: 'videocam',
            command: () => {
                handleExportVideo();
            }
        }
    ]));
</script>

<template>
    <div
        class="bottom-toolbar"
        :class="{ hidden: app.isFullscreen }"
    >
        <div class="toolbar-launcher">
            <button
                type="button"
                class="toolbar-main-button"
                :class="{ active: drawGroupActive || props.activeToolbarOverlay === 'draw' }"
                :aria-expanded="props.activeToolbarOverlay === 'draw'"
                aria-label="Draw actions"
                aria-haspopup="dialog"
                @click="toggleLauncher('draw')"
            >
                <span class="toolbar-button-content">
                    <span class="material-symbols-outlined toolbar-button-icon">draw</span>
                    <span class="toolbar-button-label">Draw</span>
                </span>
            </button>
        </div>

        <div class="toolbar-launcher">
            <button
                type="button"
                class="toolbar-main-button"
                :class="{ active: textureGroupActive || props.activeToolbarOverlay === 'texture' }"
                :aria-expanded="props.activeToolbarOverlay === 'texture'"
                aria-label="Texture actions"
                aria-haspopup="dialog"
                @click="toggleLauncher('texture')"
            >
                <span class="toolbar-button-content">
                    <span class="material-symbols-outlined toolbar-button-icon">texture</span>
                    <span class="toolbar-button-label">Texture</span>
                </span>
            </button>
        </div>

        <!-- Tools panel toggle -->
        <button
            class="toolbar-utility-button"
            :class="{ active: app.toolsPanelVisible }"
            @click="app.toolsPanelVisible ? handleBack() : activateContext(() => app.showToolsPanel())"
        >
            <span class="toolbar-button-content">
                <span class="material-symbols-outlined toolbar-button-icon">instant_mix</span>
                <span class="toolbar-button-label">Tools</span>
            </span>
        </button>

        <div class="toolbar-launcher">
            <button
                type="button"
                class="toolbar-main-button"
                :class="{ active: props.activeToolbarOverlay === 'share' || props.exportImageVisible || props.exportVideoVisible }"
                :aria-expanded="props.activeToolbarOverlay === 'share'"
                aria-label="Share actions"
                aria-haspopup="dialog"
                @click="toggleLauncher('share')"
            >
                <span class="toolbar-button-content">
                    <span class="material-symbols-outlined toolbar-button-icon">share</span>
                    <span class="toolbar-button-label">Share</span>
                </span>
            </button>
        </div>

        <!-- Finish capture button (draw or walk mode) -->
        <button
            v-if="showFinishCaptureButton"
            class="toolbar-utility-button finish-drawing-btn"
            v-tooltip.top="finishCaptureTooltip"
            @click="handleFinishCapture"
        >
            <span class="material-symbols-outlined">check</span>
        </button>
    </div>

    <div
        class="launcher-panel"
        :class="{ active: !!props.activeToolbarOverlay }"
        role="dialog"
        :aria-label="`${activeLauncherTitle} actions`"
    >
        <div class="launcher-panel-container">
            <div class="launcher-panel-content">
                <div class="tools-section">
                    <div class="tools-section-label">Actions</div>
                    <div class="tools-section-items">
                        <button
                            v-for="item in activeLauncherItems"
                            :key="`${props.activeToolbarOverlay}-${item.label}`"
                            type="button"
                            class="tools-option launcher-menu-action"
                            :class="{ selected: item.active }"
                            role="menuitem"
                            @click="item.command()"
                        >
                            <span class="material-symbols-outlined">{{ item.icon }}</span>
                            <span>{{ item.label }}</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Tools panel (full-screen overlay, like TextureBrowser) -->
    <div
        class="tools-panel"
        :class="{ active: app.toolsPanelVisible }"
    >
        <div class="tools-panel-container">
            <ScrollPanel class="tools-panel-scrollpanel">
                <div class="tools-panel-content">
                    <div class="tools-section-host">
                        <ViewerSettingsControls
                            :technical-overlay="props.technicalOverlay"
                            @request-viewer-control-mode-change="emit('request-viewer-control-mode-change', $event)"
                            @request-reset-viewer="emit('request-reset-viewer')"
                            @request-technical-overlay-toggle="emit('request-technical-overlay-toggle')"
                        />
                    </div>

                    <div class="tools-section-host">
                        <AnimationSettingsControls />
                    </div>

                    <div class="tools-section-host">
                        <TextureSettingsControls
                            :show-preferred-resolution="true"
                            :show-black-and-white-filter="true"
                        />
                    </div>

                    <div class="tools-section">
                        <div class="tools-section-label">Export Preferences</div>
                        <div class="tools-section-items">
                            <div class="tools-select-block">
                                <label class="tools-select-label">Aspect Ratio</label>
                                <div class="tools-select-wrap">
                                    <Select
                                        v-model="exportAspectRatioPresetModel"
                                        :options="exportAspectRatioOptions"
                                        option-label="label"
                                        option-value="value"
                                        class="tools-select"
                                    >
                                        <template #value="slotProps">
                                            <div
                                                v-if="slotProps.value"
                                                class="tools-select-row"
                                            >
                                                <span class="material-symbols-outlined tools-select-icon">{{
                                                    exportAspectRatioOptions.find((option) => option.value ===
                                                        slotProps.value)?.icon}}</span>
                                                <span>{{exportAspectRatioOptions.find((option) => option.value ===
                                                    slotProps.value)?.label}}</span>
                                            </div>
                                            <span v-else>{{ slotProps.placeholder }}</span>
                                        </template>
                                        <template #option="slotProps">
                                            <div class="tools-select-row">
                                                <span class="material-symbols-outlined tools-select-icon">{{
                                                    slotProps.option.icon }}</span>
                                                <span>{{ slotProps.option.label }}</span>
                                            </div>
                                        </template>
                                    </Select>
                                </div>
                            </div>

                            <div class="tools-select-block">
                                <label class="tools-select-label">Resolution</label>
                                <div class="tools-select-wrap">
                                    <Select
                                        v-model="exportResolutionPresetModel"
                                        :options="exportResolutionOptions"
                                        option-label="label"
                                        option-value="value"
                                        class="tools-select"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="tools-section-host">
                        <GeometrySettingsControls />
                    </div>

                    <div class="tools-section-host">
                        <CinematicCameraControls
                            :cinematic-playing="props.cinematicPlaying"
                            :cinematic-roi-count="props.cinematicRoiCount"
                            @request-cinematic-capture="emit('request-cinematic-capture')"
                            @request-cinematic-toggle="emit('request-cinematic-toggle')"
                            @request-cinematic-clear="emit('request-cinematic-clear')"
                        />
                    </div>

                    <!-- Display & Account section -->
                    <div class="tools-section">
                        <div class="tools-section-label">Display &amp; Account</div>
                        <div class="tools-section-items">
                            <button
                                class="tools-option"
                                @click="handleAbout"
                            >
                                <span class="material-symbols-outlined">info</span>
                                <span>About Rivvon</span>
                            </button>
                            <button
                                v-if="isAuthenticated"
                                class="tools-option tools-user"
                                disabled
                            >
                                <span class="material-symbols-outlined">account_circle</span>
                                <span>{{ user?.name || user?.email || 'User' }}</span>
                            </button>
                            <button
                                v-if="isAuthenticated"
                                class="tools-option"
                                @click="handleLogout"
                            >
                                <span class="material-symbols-outlined">logout</span>
                                <span>Sign Out</span>
                            </button>
                            <button
                                v-if="!isAuthenticated"
                                class="tools-option"
                                @click="handleLoginClick"
                            >
                                <span class="material-symbols-outlined">login</span>
                                <span>Sign In with Google</span>
                            </button>
                        </div>
                    </div>
                </div>
            </ScrollPanel>
            <!-- Apply changes footer -->
            <div
                v-if="showToolsPanelCheckmark"
                class="tools-panel-footer"
            >
                <Button
                    type="button"
                    class="tools-panel-apply-button"
                    @click="handleToolsPanelCheckmark"
                >
                    <span class="material-symbols-outlined">check</span>
                    <span>Done</span>
                </Button>
            </div>
        </div>
    </div>

    <!-- About Rivvon Panel (full-screen overlay) -->
    <div
        class="about-panel"
        :class="{ active: app.aboutPanelVisible }"
    >
        <div class="about-panel-container">
            <div class="about-panel-content">
                <div class="info-content">
                    <p>
                        Rivvon renders animated ribbons via GPU shaders using multi-layered KTX2 texture tiles.
                    </p>
                    <p>
                        Textures are created by extracting
                        <a
                            target="_blank"
                            href="https://en.wikipedia.org/wiki/Slit-scan_photography"
                        >cross sections</a>
                        from video files using
                        <a
                            target="_blank"
                            href="https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API"
                        >WebCodecs</a>,
                        <a
                            target="_blank"
                            href="https://github.com/Vanilagy/mediabunny"
                        >mediabunny</a>, and
                        <a
                            target="_blank"
                            href="https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API"
                        >Canvas</a>.
                        Textures are encoded using
                        <a
                            target="_blank"
                            href="https://github.com/BinomialLLC/basis_universal"
                        >Basis Encoder</a>.
                    </p>
                    <p>
                        Animations are achieved by taking multiple cross sections of the same video.
                        Each cross section samples pixels from each frame.
                        This can be done using one of two strategies: a linear sampling pattern that stays on the same
                        row
                        for each sample (planar cross section), or a periodic function that achieves a wave-based,
                        directly loopable animation.
                    </p>
                    <p class="info-build">
                        Build: {{ buildTimestampDisplay }}
                    </p>
                    <p class="info-credit">
                        Created by <a
                            target="_blank"
                            href="https://nsitu.ca"
                        >Harold Sikkema</a>
                    </p>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>

    .bottom-toolbar,
    .launcher-panel,
    .tools-panel,
    .about-panel {
        --viewer-header-chrome-height: 5.5rem;
        --viewer-bottom-chrome-height: 6.4rem;
    }

    .bottom-toolbar {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 10;
        display: flex;
        height: var(--viewer-bottom-chrome-height);
        min-height: var(--viewer-bottom-chrome-height);
        background: rgba(0, 0, 0, 0.5);
        justify-content: center;
        align-items: center;
        pointer-events: none;
        padding: 0;
        transition: opacity 0.3s ease, transform 0.3s ease;
    }

    .bottom-toolbar.hidden {
        opacity: 0;
        transform: translateY(100%);
        pointer-events: none;
    }

    .toolbar-launcher {
        position: relative;
        pointer-events: auto;
        display: flex;
        height: 100%;
        align-items: flex-end;
    }

    .toolbar-main-button,
    .toolbar-utility-button,
    .finish-drawing-btn {
        box-sizing: border-box;
        height: 100%;
        padding: 0 1rem;
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

    .toolbar-main-button:hover,
    .toolbar-utility-button:hover {
        background: rgba(0, 0, 0, 0.25);
    }

    .toolbar-main-button.active,
    .toolbar-utility-button.active {
        background: rgba(0, 0, 0, 0.25);

    }

    .launcher-panel {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 5;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease;
        display: flex;
        flex-direction: column;
    }

    .launcher-panel.active {
        pointer-events: auto;
        opacity: 1;
    }

    .launcher-panel-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        background: transparent;
        padding-top: var(--viewer-header-chrome-height);
        padding-bottom: var(--viewer-bottom-chrome-height);
    }

    .launcher-panel-content {
        flex: 1;
        overflow-y: auto;
        background: rgba(0, 0, 0, 0.6);
        padding: 1.5rem 1.25rem;
        width: 100%;
        /* max-width: 480px; */
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        justify-content: end;
        gap: 1.5rem;
    }

    @media (min-width: 769px) {
        .launcher-panel-content {
            max-width: none;
            flex-direction: column;
            flex-wrap: wrap;
            align-content: center;
            gap: 1.25rem 2rem;
        }
    }

    .toolbar-button-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.22rem;
        line-height: 1;
    }

    .toolbar-button-icon {
        font-size: 1.45rem;
        line-height: 1;
    }

    .launcher-menu-action {
        width: 100%;
        pointer-events: auto;
    }

    .toolbar-button-label {
        font-size: 0.68rem;
        line-height: 1.1;
        text-align: center;
    }

    /* Mobile: buttons expand to fill available space */
    @media (max-width: 768px) {

        .toolbar-launcher,
        .toolbar-utility-button,
        .finish-drawing-btn {
            flex-grow: 1;
        }

        .toolbar-launcher {
            justify-content: center;
        }

        .toolbar-main-button {
            width: 100%;
        }
    }

    .finish-drawing-btn {
        background: rgba(34, 197, 94, 1) !important;
        color: #ffffff !important;
        box-shadow: none !important;
    }

    .finish-drawing-btn:hover {
        background: rgba(34, 197, 94, 0.8) !important;
    }

    /* ─── Tools panel (full-screen overlay) ─────────────────────── */
    .tools-panel {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 5;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease;
        display: flex;
        flex-direction: column;
    }

    .tools-panel.active {
        pointer-events: auto;
        opacity: 1;
    }

    .tools-panel-container {
        display: flex;
        flex-direction: column;
        position: relative;
        height: 100%;
        min-height: 0;
        width: 100%;
        background: transparent;
        padding-top: var(--viewer-header-chrome-height);
        padding-bottom: var(--viewer-bottom-chrome-height);
    }

    :deep(.tools-panel-apply-button) {
        width: 100%;
    }

    .tools-panel-footer {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        border-top: 1px solid #374151;
        padding: 1rem 1.25rem;
        background: rgba(0, 0, 0, 0.6);
    }

    .tools-panel-scrollpanel {
        --p-scrollpanel-bar-size: 0.55rem;
        --p-scrollpanel-bar-background: rgba(255, 255, 255, 0.34);
        flex: 1;
        height: 100%;
        min-height: 0;
        width: 100%;
        /* max-width: 480px; */
        margin: 0 auto;
    }

    @media (min-width: 769px) {
        .tools-panel-scrollpanel {
            max-width: none;
        }
    }

    :deep(.tools-panel-scrollpanel .p-scrollpanel-content-container) {
        height: 100%;
        min-height: 0;
    }

    :deep(.tools-panel-scrollpanel .p-scrollpanel-content) {
        height: 100%;
        min-height: 100%;
        overflow-x: hidden;
        padding-bottom: 0px;
    }

    :deep(.tools-panel-scrollpanel .p-scrollpanel-bar) {
        opacity: 0.55;
    }

    :deep(.tools-panel-scrollpanel:hover .p-scrollpanel-bar),
    :deep(.tools-panel-scrollpanel:active .p-scrollpanel-bar),
    :deep(.tools-panel-scrollpanel .p-scrollpanel-bar:focus-visible) {
        opacity: 0.9;
    }

    .tools-panel-content {
        box-sizing: border-box;
        background: rgba(0, 0, 0, 0.6);
        padding: 1.5rem 1.25rem;
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        min-height: 100%;
    }

    /* Desktop: width-driven multi-column layout with vertical scrolling preserved */
    @media (min-width: 769px) {
        .tools-panel-content {
            display: block;
            column-width: 24rem;
            column-gap: 2rem;
            column-fill: balance;
        }

        .tools-section {
            break-inside: avoid;
            margin-bottom: 1.25rem;
            page-break-inside: avoid;
        }

        .tools-section:last-child {
            margin-bottom: 0;
        }

        .tools-section-host {
            break-inside: avoid;
            margin-bottom: 1.25rem;
            page-break-inside: avoid;
        }

        .tools-section-host:last-child {
            margin-bottom: 0;
        }
    }

    .tools-section {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .tools-section-label {
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(255, 255, 255, 0.4);
        padding: 0 0.5rem 0.25rem;
    }

    .tools-section-items {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        background: rgba(0, 0, 0, 0.25);
        border-radius: 10px;
        padding: 0.25rem;
    }

    .tools-select-block {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        padding: 0.5rem;
    }

    .tools-select-label {
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.6);
        padding: 0 0.1rem;
    }

    .tools-select-wrap {
        padding: 0;
    }

    .tools-select {
        width: 100%;
    }

    .tools-select-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .tools-select-icon {
        font-size: 1.2rem;
        opacity: 0.85;
    }

    .tools-text-icon {
        font-size: 1.4rem;
        font-weight: 700;
        opacity: 0.85;
        width: 1.2rem;
        text-align: center;
        line-height: 0.5rem;
    }

    :deep(.tools-select .p-select-label) {
        font-size: 0.95rem;
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

    .tools-option.selected {
        color: var(--p-primary-color, #10b981);
        border: 1px solid color-mix(in srgb, var(--p-primary-color, #10b981) 42%, transparent);
        background: color-mix(in srgb, var(--p-primary-color, #10b981) 12%, transparent);
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

    .tools-user {
        opacity: 0.55;
        cursor: default;
    }

    .tools-user:hover {
        background: transparent;
    }

    /* Info panel content */
    .about-panel {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 5;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease;
        display: flex;
        flex-direction: column;
    }

    .about-panel.active {
        pointer-events: auto;
        opacity: 1;
    }

    .about-panel-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        background: #1a1a1a;
        padding-top: var(--viewer-header-chrome-height);
        padding-bottom: var(--viewer-bottom-chrome-height);
    }

    .about-panel-content {
        flex: 1;
        overflow-y: auto;
        padding: 2rem 1.5rem;
        width: 100%;
        max-width: 600px;
        margin: 0 auto;
        display: flex;
        align-items: center;
    }

    .info-content {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        font-size: 0.9rem;
        line-height: 1.6;
        color: var(--text-secondary);
    }

    .info-build {
        margin-top: 0.5rem;
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.58);
    }

    .info-content a {
        color: var(--text-primary);
        text-decoration: underline;
        transition: opacity 0.2s;
    }

    .info-content a:hover {
        opacity: 0.8;
    }

    .info-credit {
        margin-top: 0.5rem;
        padding-top: 1rem;
        border-top: 1px solid var(--border-primary);
        font-size: 0.85rem;
    }
</style>
