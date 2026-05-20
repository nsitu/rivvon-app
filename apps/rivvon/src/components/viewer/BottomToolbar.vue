<script setup>
    import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
    import Button from 'primevue/button';
    import PanelActionBar from '../shared/PanelActionBar.vue';
    import CinematicCameraControls from './CinematicCameraControls.vue';
    import ScrollPanel from 'primevue/scrollpanel';
    import Select from 'primevue/select';
    import ToggleSwitch from 'primevue/toggleswitch';
    import AnimationSettingsControls from './AnimationSettingsControls.vue';
    import AboutPanel from './AboutPanel.vue';
    import GeometrySettingsControls from './GeometrySettingsControls.vue';
    import TextureSettingsControls from './TextureSettingsControls.vue';
    import ViewerSettingsControls from './ViewerSettingsControls.vue';
    import { EXPORT_LOGO_CORNER_OPTIONS } from '../../modules/viewer/exportLogoOverlay.js';
    import {
        EXPORT_ASPECT_RATIO_OPTIONS,
        getExportResolutionOptions,
        normalizeExportDimensionSettings,
    } from '../../modules/viewer/exportVideoDimensions.js';
    import { createViewerContexts, resolveOrderedContext } from '../../modules/viewer/viewerHeaderContext.js';
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

    function hideAboutIfActive() {
        if (isToolbarContextActive('about')) {
            app.hideAboutPanel();
        }
    }

    function toggleLauncher(name) {
        const nextLauncher = props.activeToolbarOverlay === name ? null : name;

        if (!nextLauncher) {
            closeLaunchers();
            return;
        }

        if (props.exportImageVisible || props.exportVideoVisible) {
            return;
        }

        hideAboutIfActive();
        app.hideToolsPanel();
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
    const exportLogoCornerOptions = EXPORT_LOGO_CORNER_OPTIONS;

    const exportLogoOverlayEnabledModel = computed({
        get: () => app.exportLogoOverlayEnabled,
        set: (value) => {
            app.setExportLogoOverlayEnabled(value);
        }
    });

    const exportLogoOverlayCornerModel = computed({
        get: () => app.exportLogoOverlayCorner,
        set: (value) => {
            app.setExportLogoOverlayCorner(value);
        }
    });

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
        exportVideoVisible: { type: Boolean, default: false },
        navigationCanGoBack: { type: Boolean, default: false },
        navigationCanExitWorkflow: { type: Boolean, default: false },
        navigationHasActiveWorkflow: { type: Boolean, default: false },
        navigationWorkflowGroup: { type: String, default: null },
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
        'request-navigation-back',
        'request-navigation-exit',
        'request-toolbar-overlay-change'
    ]);

    // Check if Slyce processing is active (has status messages)
    const isSlyceProcessing = computed(() => Object.keys(slyce.status).length > 0);
    const hasExistingTextureFileFlow = computed(() => (
        !!slyce.file
        || Object.keys(slyce.ktx2BlobURLs).length > 0
        || slyce.currentStep !== '1'
    ));

    const viewerToolbarContextMap = computed(() => Object.fromEntries(createViewerContexts(app, {
        order: ['walk', 'draw', 'drawings', 'textureCreator', 'textureBrowser', 'text', 'emoji', 'contour', 'tools', 'about', 'realtimeSampler'],
        onCloseRealtimeMode: (payload) => emit('request-close-realtime-mode', payload),
        onResetSlyceProcessing: () => slyce.resetProcessing(),
        isSlyceProcessing: isSlyceProcessing.value,
    }).map((context) => [context.id, context])));

    const toolbarBackContexts = computed(() => ([
        {
            id: 'exportImage',
            title: 'Export Image',
            isActive: () => props.exportImageVisible,
            close: () => {
                emit('request-close-export-image');
                return true;
            }
        },
        {
            id: 'exportVideo',
            title: 'Export Video',
            isActive: () => props.exportVideoVisible,
            close: () => {
                emit('request-close-export-video');
                return true;
            }
        },
        {
            id: 'toolbarOverlay',
            title: null,
            isActive: () => Boolean(props.activeToolbarOverlay),
            close: () => {
                closeLaunchers();
                return true;
            }
        },
        viewerToolbarContextMap.value.tools,
        {
            id: 'navigationBack',
            title: null,
            isActive: () => props.navigationCanGoBack,
            close: () => {
                emit('request-navigation-back');
                return true;
            }
        },
        viewerToolbarContextMap.value.walk,
        viewerToolbarContextMap.value.draw,
        viewerToolbarContextMap.value.drawings,
        viewerToolbarContextMap.value.textureCreator,
        viewerToolbarContextMap.value.textureBrowser,
        viewerToolbarContextMap.value.text,
        viewerToolbarContextMap.value.emoji,
        viewerToolbarContextMap.value.contour,
        viewerToolbarContextMap.value.realtimeSampler,
        viewerToolbarContextMap.value.about,
    ].filter(Boolean)));

    const toolbarCloseAllContexts = computed(() => ([
        ...toolbarBackContexts.value.filter((context) => ['exportImage', 'exportVideo', 'toolbarOverlay', 'tools'].includes(context.id)),
        {
            id: 'navigationExit',
            title: null,
            isActive: () => props.navigationHasActiveWorkflow && props.navigationCanExitWorkflow,
            close: () => {
                emit('request-navigation-exit');
                return true;
            }
        },
        viewerToolbarContextMap.value.walk,
        viewerToolbarContextMap.value.draw,
        viewerToolbarContextMap.value.drawings,
        viewerToolbarContextMap.value.textureCreator,
        viewerToolbarContextMap.value.textureBrowser,
        viewerToolbarContextMap.value.text,
        viewerToolbarContextMap.value.emoji,
        viewerToolbarContextMap.value.contour,
        viewerToolbarContextMap.value.about,
        viewerToolbarContextMap.value.realtimeSampler,
    ]));

    function runActiveContexts(contexts, { firstOnly = false } = {}) {
        if (firstOnly) {
            const activeContext = resolveOrderedContext(contexts);
            return activeContext ? activeContext.close() !== false : true;
        }

        for (const context of contexts) {
            if (!context?.isActive?.()) {
                continue;
            }

            if (context.close?.() === false) {
                return false;
            }
        }

        return true;
    }

    /**
     * Handle the back button press.
     * If Slyce is visible and processing, confirm before cancelling and closing.
     */
    function handleBack() {
        runActiveContexts(toolbarBackContexts.value, { firstOnly: true });
    }

    // Computed: is any panel/mode currently active?
    const hasActiveContext = computed(() => Boolean(resolveOrderedContext(toolbarBackContexts.value)));

    function isToolbarContextActive(contextId) {
        return viewerToolbarContextMap.value[contextId]?.isActive?.() ?? false;
    }

    const drawGroupActive = computed(() => (
        props.navigationWorkflowGroup === 'draw'
        || props.navigationWorkflowGroup === 'drawings'
        || isToolbarContextActive('draw')
        || isToolbarContextActive('walk')
        || isToolbarContextActive('drawings')
        || isToolbarContextActive('text')
        || isToolbarContextActive('emoji')
        || isToolbarContextActive('contour')
    ));

    const textureGroupActive = computed(() => (
        props.navigationWorkflowGroup === 'texture'
        || isToolbarContextActive('textureCreator')
        || isToolbarContextActive('textureBrowser')
        || isToolbarContextActive('realtimeSampler')
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
        return runActiveContexts(toolbarCloseAllContexts.value);
    }

    function activateContext(action) {
        if (!closeActiveContext()) return;
        closeLaunchers();
        action();
    }

    function openToolsOverlay() {
        if (props.exportImageVisible || props.exportVideoVisible) {
            return;
        }

        closeLaunchers();
        hideAboutIfActive();
        app.showToolsPanel();
    }

    function toggleContextItem(contextId, openAction) {
        if (isToolbarContextActive(contextId)) {
            handleBack();
            return;
        }

        activateContext(openAction);
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
            active: isToolbarContextActive('walk'),
            command: () => toggleContextItem('walk', () => emit('request-enter-walk-mode'))
        },
        {
            label: 'Write',
            icon: 'text_fields',
            active: isToolbarContextActive('text'),
            command: () => toggleContextItem('text', () => emit('request-open-text-panel'))
        },
        {
            label: 'Emoji',
            icon: 'mood',
            active: isToolbarContextActive('emoji'),
            command: () => toggleContextItem('emoji', () => emit('request-open-emoji-picker'))
        },
        {
            label: 'Gesture',
            icon: 'gesture',
            active: isToolbarContextActive('draw'),
            command: () => toggleContextItem('draw', () => emit('request-enter-draw-mode'))
        },
        {
            label: 'Contour',
            icon: 'vr180_create2d',
            active: isToolbarContextActive('contour'),
            command: () => toggleContextItem('contour', () => emit('request-enter-contour-mode'))
        },
        {
            label: 'Shape Library',
            icon: 'grid_view',
            active: isToolbarContextActive('drawings'),
            command: () => toggleContextItem('drawings', () => emit('request-open-drawing-browser'))
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
            label: 'Create From Camera',
            icon: 'camera_video',
            active: isToolbarContextActive('realtimeSampler'),
            command: () => activateContext(() => emit('request-open-texture-camera'))
        }, {
            contextLabel: 'Video File',
            label: hasExistingTextureFileFlow.value ? 'Continue...' : 'Browse...',
            description: hasExistingTextureFileFlow.value
                ? 'Return to the current video workflow.'
                : 'Create texture from video file.',
            icon: 'video_file',
            active: isToolbarContextActive('textureCreator'),
            command: () => activateContext(() => emit('request-open-texture-file', {
                directBrowse: !hasExistingTextureFileFlow.value,
            }))
        },


        {
            label: 'Texture Library',
            icon: 'grid_view',
            active: isToolbarContextActive('textureBrowser'),
            command: () => toggleContextItem('textureBrowser', () => emit('request-open-texture-browser'))
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
            :class="{ active: isToolbarContextActive('tools') }"
            @click="isToolbarContextActive('tools') ? handleBack() : openToolsOverlay()"
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
        <div class="launcher-panel-container viewer-chrome-panel-container">
            <div class="launcher-panel-content">
                <div class="tools-section">
                    <div class="tools-section-label">Actions</div>
                    <div class="tools-section-items">
                        <button
                            v-for="item in activeLauncherItems"
                            :key="`${props.activeToolbarOverlay}-${item.label}`"
                            type="button"
                            class="tools-option launcher-menu-action"
                            :class="{
                                selected: item.active,
                                'launcher-menu-action-rich': item.contextLabel || item.description,
                            }"
                            role="menuitem"
                            @click="item.command()"
                        >
                            <span class="material-symbols-outlined">{{ item.icon }}</span>
                            <span class="launcher-menu-copy">
                                <span
                                    v-if="item.contextLabel"
                                    class="launcher-menu-context-label"
                                >{{ item.contextLabel }}</span>
                                <span class="launcher-menu-primary-label">{{ item.label }}</span>
                                <span
                                    v-if="item.description"
                                    class="launcher-menu-description"
                                >{{ item.description }}</span>
                            </span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Tools panel (full-screen overlay, like TextureBrowser) -->
    <div
        class="tools-panel"
        :class="{ active: isToolbarContextActive('tools') }"
    >
        <div class="tools-panel-container viewer-chrome-panel-container">
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
                            :show-duotone-filter="true"
                            :show-transparent-shadows-filter="true"
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

                            <div class="tools-select-block">
                                <label
                                    for="exportLogoOverlayToggle"
                                    class="tools-select-label"
                                >Logo Overlay</label>
                                <div class="tools-toggle-row">
                                    <ToggleSwitch
                                        inputId="exportLogoOverlayToggle"
                                        v-model="exportLogoOverlayEnabledModel"
                                    />
                                    <span class="tools-toggle-copy">{{ exportLogoOverlayEnabledModel ? 'On' : 'Off'
                                        }}</span>
                                </div>
                            </div>

                            <div
                                v-if="exportLogoOverlayEnabledModel"
                                class="tools-select-block"
                            >
                                <label class="tools-select-label">Logo Corner</label>
                                <div class="tools-select-wrap">
                                    <Select
                                        v-model="exportLogoOverlayCornerModel"
                                        :options="exportLogoCornerOptions"
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
            <PanelActionBar
                v-if="showToolsPanelCheckmark"
                class="tools-panel-footer"
            >
                <Button
                    type="button"
                    @click="handleToolsPanelCheckmark"
                >
                    <span class="material-symbols-outlined">check</span>
                    <span>Done</span>
                </Button>
            </PanelActionBar>
        </div>
    </div>

    <AboutPanel
        :active="isToolbarContextActive('about')"
        :build-timestamp-display="buildTimestampDisplay"
    />
</template>

<style scoped>
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
        z-index: 8;
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
    }

    .launcher-panel-content {
        flex: 1;
        overflow-y: auto;
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

    .launcher-menu-action-rich {
        align-items: flex-start;
    }

    .launcher-menu-copy {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.12rem;
        min-width: 0;
        text-align: left;
    }

    .launcher-menu-context-label {
        font-size: 0.68rem;
        line-height: 1.15;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.54);
    }

    .launcher-menu-primary-label {
        font-size: 0.95rem;
        line-height: 1.25;
    }

    .launcher-menu-description {
        font-size: 0.78rem;
        line-height: 1.35;
        color: rgba(255, 255, 255, 0.66);
        text-wrap: balance;
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
        z-index: 8;
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
    }

    .tools-panel-footer {
        --panel-action-bar-background: var(--viewer-toolbar-panel-background);
        --panel-action-bar-border-color: #374151;
        --panel-action-bar-padding: 1rem 1.25rem;
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

    .tools-toggle-row {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        padding: 0.25rem 0.1rem 0.1rem;
    }

    .tools-toggle-copy {
        min-width: 1.8rem;
        font-size: 0.78rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.6);
        text-align: right;
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

</style>