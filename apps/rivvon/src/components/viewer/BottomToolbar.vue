<script setup>
    import { ref, computed } from 'vue';
    import Select from 'primevue/select';
    import { useViewerStore } from '../../stores/viewerStore';
    import { useSlyceStore } from '../../stores/slyceStore';
    import { useGoogleAuth } from '../../composables/shared/useGoogleAuth';

    const app = useViewerStore();
    const slyce = useSlyceStore();
    const { user, isAuthenticated, login, logout } = useGoogleAuth();

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

    const flowOptions = [
        { label: 'Oscillate', value: 'off', icon: 'airwave' },
        { label: 'Forward', value: 'forward', icon: 'arrow_forward' },
        { label: 'Backward', value: 'backward', icon: 'arrow_back' }
    ];

    const geometryOptions = [
        { label: 'Ribbon', value: 'flat', icon: '~', textIcon: true },
        { label: 'Double Helix', value: 'helix', icon: 'genetics' }
    ];

    const capOptions = [
        { label: 'Rounded Caps', value: 'rounded', icon: 'rounded_corner' },
        { label: 'Square Caps', value: 'square', icon: 'crop' }
    ];

    const viewerControlOptions = [
        { label: 'OrbitControls', value: 'orbit', icon: '3d_rotation' },
        { label: 'Mouse Tilt', value: 'mouseTilt', icon: 'open_with' },
        { label: 'Head Tracking', value: 'headTracking', icon: 'face' }
    ];

    function setFlowState(state) {
        app.setFlowState(state);
        app.hideToolsPanel();
    }

    const selectedFlowOption = computed({
        get: () => flowOptions.find((option) => option.value === app.flowState) ?? flowOptions[0],
        set: (option) => {
            if (!option?.value) return;
            setFlowState(option.value);
        }
    });

    const selectedGeometryOption = computed({
        get: () => geometryOptions.find((option) => option.value === (app.helixEnabled ? 'helix' : 'flat')) ?? geometryOptions[0],
        set: (option) => {
            if (!option?.value) return;
            app.setHelixMode(option.value === 'helix');
        }
    });

    const selectedCapOption = computed({
        get: () => capOptions.find((option) => option.value === (app.roundedCaps ? 'rounded' : 'square')) ?? capOptions[0],
        set: (option) => {
            if (!option?.value) return;
            app.setRoundedCaps(option.value === 'rounded');
        }
    });

    const selectedViewerControlOption = computed({
        get: () => viewerControlOptions.find((option) => option.value === app.viewerControlMode) ?? viewerControlOptions[0],
        set: (option) => {
            if (!option?.value) return;
            emit('viewer-control-mode-change', option.value);
        }
    });

    const showHeadTrackingTools = computed(() => (
        app.viewerControlMode === 'headTracking'
        || !!app.headTrackingMessage
        || app.headTrackingSupported === false
    ));

    const headTrackingStatusLabel = computed(() => {
        if (app.headTrackingErrorMessage) return 'Unavailable';
        if (app.headTrackingCalibrating) return 'Calibrating';
        if (app.headTrackingActive) return 'Active';
        if (app.headTrackingSuspendedReason) return 'Paused';
        if (app.viewerControlMode === 'headTracking') return 'Starting';
        return 'Viewer Controls';
    });

    const headTrackingDisplayMessage = computed(() => (
        app.headTrackingMessage
        || (app.viewerControlMode === 'headTracking'
            ? 'Center your face and hold still to start head tracking.'
            : 'Choose how the viewer camera should respond to input.')
    ));

    const headTrackingStatusClass = computed(() => ({
        'is-error': !!app.headTrackingErrorMessage,
        'is-success': app.headTrackingActive && !app.headTrackingCalibrating,
    }));

    function handleImport(type) {
        app.hideToolsPanel();
        emit('import-file', type);
    }

    function handleExportImage() {
        app.hideToolsPanel();
        emit('export-image');
    }

    function handleExportVideo() {
        app.hideToolsPanel();
        emit('export-video');
    }

    // Cinematic camera props (reactive state from composable)
    const props = defineProps({
        cinematicPlaying: { type: Boolean, default: false },
        cinematicRoiCount: { type: Number, default: 0 },
        technicalOverlay: { type: Boolean, default: false }
    });

    const emit = defineEmits([
        'enter-draw-mode',
        'enter-walk-mode',
        'toggle-flow',
        'open-text-panel',
        'open-emoji-picker',
        'open-texture-browser',
        'enter-slyce-mode',
        'close-realtime-mode',
        'import-file',
        'export-image',
        'export-video',
        'finish-drawing',
        'finish-walk',
        'viewer-control-mode-change',
        'recenter-head-tracking',
        'cinematic-capture',
        'cinematic-toggle',
        'cinematic-clear',
        'technical-overlay-toggle'
    ]);

    function handleCinematicCapture() {
        app.hideToolsPanel();
        emit('cinematic-capture');
    }

    function handleCinematicToggle() {
        app.hideToolsPanel();
        emit('cinematic-toggle');
    }

    function handleCinematicClear() {
        app.hideToolsPanel();
        emit('cinematic-clear');
    }

    // Check if Slyce processing is active (has status messages)
    const isSlyceProcessing = computed(() => Object.keys(slyce.status).length > 0);

    /**
     * Handle the back button press.
     * If Slyce is visible and processing, confirm before cancelling and closing.
     */
    function handleBack() {
        if (app.isWalkMode) {
            app.setWalkMode(false);
        } else if (app.isDrawingMode) {
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
        } else if (app.emojiPickerVisible) {
            app.hideEmojiPicker();
        } else if (app.realtimeSamplerVisible) {
            emit('close-realtime-mode');
        } else if (app.toolsPanelVisible) {
            app.hideToolsPanel();
        } else if (app.aboutPanelVisible) {
            app.hideAboutPanel();
        }
    }

    // Computed: is any panel/mode currently active?
    const hasActiveContext = computed(() =>
        app.isDrawingMode || app.isWalkMode || app.textureCreatorVisible || app.textureBrowserVisible || app.textPanelVisible || app.emojiPickerVisible || app.toolsPanelVisible || app.aboutPanelVisible || app.realtimeSamplerVisible
    );

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

    function handleFinishCapture() {
        if (app.isWalkMode) {
            emit('finish-walk');
            return;
        }

        emit('finish-drawing');
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
        if (app.toolsPanelVisible) {
            app.hideToolsPanel();
        }
        if (app.aboutPanelVisible) {
            app.hideAboutPanel();
        }
        if (app.realtimeSamplerVisible) {
            emit('close-realtime-mode', { suppressCreateTextureReturn: true });
        }
        return true;
    }

    function activateContext(action) {
        if (!closeActiveContext()) return;
        action();
    }
</script>

<template>
    <div
        class="bottom-toolbar"
        :class="{ hidden: app.isFullscreen }"
    >
        <!-- Draw mode button -->
        <button
            v-tooltip.top="tip('Draw')"
            :class="{ active: app.isDrawingMode }"
            @click="app.isDrawingMode ? handleBack() : activateContext(() => emit('enter-draw-mode'))"
        >
            <span class="material-symbols-outlined">draw</span>
        </button>

        <button
            v-tooltip.top="tip('Walk')"
            :class="{ active: app.isWalkMode }"
            @click="app.isWalkMode ? handleBack() : activateContext(() => emit('enter-walk-mode'))"
        >
            <span class="material-symbols-outlined">directions_walk</span>
        </button>

        <!-- Create texture tool -->
        <button
            v-tooltip.top="tip('Create Texture')"
            :class="{ active: app.textureCreatorVisible || app.realtimeSamplerVisible }"
            @click="(app.textureCreatorVisible || app.realtimeSamplerVisible) ? handleBack() : activateContext(() => emit('enter-slyce-mode'))"
        >
            <span class="material-symbols-outlined">video_camera_back_add</span>
        </button>

        <!-- Text to SVG -->
        <button
            v-tooltip.top="tip('Text')"
            :class="{ active: app.textPanelVisible }"
            @click="app.textPanelVisible ? handleBack() : activateContext(() => emit('open-text-panel'))"
        >
            <span class="material-symbols-outlined">text_fields</span>
        </button>

        <!-- Emoji picker -->
        <button
            v-tooltip.top="tip('Emoji')"
            :class="{ active: app.emojiPickerVisible }"
            @click="app.emojiPickerVisible ? handleBack() : activateContext(() => emit('open-emoji-picker'))"
        >
            <span class="material-symbols-outlined">mood</span>
        </button>

        <!-- Browse textures -->
        <button
            v-tooltip.top="tip('Textures')"
            :class="{ active: app.textureBrowserVisible }"
            @click="app.textureBrowserVisible ? handleBack() : activateContext(() => emit('open-texture-browser'))"
        >
            <span class="material-symbols-outlined">grid_view</span>
        </button>

        <!-- Tools panel toggle -->
        <button
            v-tooltip.top="tip('Tools')"
            :class="{ active: app.toolsPanelVisible || (!hasActiveContext && app.flowState !== 'off') }"
            @click="app.toolsPanelVisible ? handleBack() : activateContext(() => app.showToolsPanel())"
        >
            <span class="material-symbols-outlined">instant_mix</span>
        </button>

        <!-- Finish capture button (draw or walk mode) -->
        <button
            v-if="showFinishCaptureButton"
            class="finish-drawing-btn"
            v-tooltip.top="finishCaptureTooltip"
            @click="handleFinishCapture"
        >
            <span class="material-symbols-outlined">check</span>
        </button>
    </div>

    <!-- Tools panel (full-screen overlay, like TextureBrowser) -->
    <div
        class="tools-panel"
        :class="{ active: app.toolsPanelVisible }"
    >
        <div class="tools-panel-container">
            <div class="tools-panel-content">
                <!-- Animation section -->
                <div class="tools-section">
                    <div class="tools-section-label">Viewer Controls</div>
                    <div class="tools-section-items">
                        <div class="tools-select-wrap">
                            <Select
                                v-model="selectedViewerControlOption"
                                :options="viewerControlOptions"
                                option-label="label"
                                class="tools-select"
                            >
                                <template #value="slotProps">
                                    <div
                                        v-if="slotProps.value"
                                        class="tools-select-row"
                                    >
                                        <span class="material-symbols-outlined tools-select-icon">{{
                                            slotProps.value.icon }}</span>
                                        <span>{{ slotProps.value.label }}</span>
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

                        <div
                            v-if="showHeadTrackingTools"
                            class="tools-status-card"
                            :class="headTrackingStatusClass"
                        >
                            <div class="tools-status-row">
                                <span class="material-symbols-outlined tools-status-icon">face</span>
                                <div class="tools-status-copy">
                                    <div class="tools-status-label-row">
                                        <span class="tools-status-label-text">{{ headTrackingStatusLabel }}</span>
                                        <button
                                            v-if="app.viewerControlMode === 'headTracking'"
                                            type="button"
                                            class="tools-inline-action"
                                            @click="emit('recenter-head-tracking')"
                                        >
                                            <span class="material-symbols-outlined">center_focus_strong</span>
                                            <span>Re-center</span>
                                        </button>
                                    </div>
                                    <div class="tools-status-message">{{ headTrackingDisplayMessage }}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Animation section -->
                <div class="tools-section">
                    <div class="tools-section-label">Animation</div>
                    <div class="tools-section-items">
                        <div class="tools-select-wrap">
                            <Select
                                v-model="selectedFlowOption"
                                :options="flowOptions"
                                option-label="label"
                                class="tools-select"
                            >
                                <template #value="slotProps">
                                    <div
                                        v-if="slotProps.value"
                                        class="tools-select-row"
                                    >
                                        <span class="material-symbols-outlined tools-select-icon">{{
                                            slotProps.value.icon }}</span>
                                        <span>{{ slotProps.value.label }}</span>
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
                </div>

                <!-- Geometry section -->
                <div class="tools-section">
                    <div class="tools-section-label">Geometry</div>
                    <div class="tools-section-items">
                        <div class="tools-select-wrap">
                            <Select
                                v-model="selectedGeometryOption"
                                :options="geometryOptions"
                                option-label="label"
                                class="tools-select"
                            >
                                <template #value="slotProps">
                                    <div
                                        v-if="slotProps.value"
                                        class="tools-select-row"
                                    >
                                        <span
                                            :class="slotProps.value.textIcon ? 'tools-text-icon' : 'material-symbols-outlined tools-select-icon'"
                                        >{{
                                            slotProps.value.icon }}</span>
                                        <span>{{ slotProps.value.label }}</span>
                                    </div>
                                    <span v-else>{{ slotProps.placeholder }}</span>
                                </template>
                                <template #option="slotProps">
                                    <div class="tools-select-row">
                                        <span
                                            :class="slotProps.option.textIcon ? 'tools-text-icon' : 'material-symbols-outlined tools-select-icon'"
                                        >{{
                                            slotProps.option.icon }}</span>
                                        <span>{{ slotProps.option.label }}</span>
                                    </div>
                                </template>
                            </Select>
                        </div>
                        <!-- Helix parameter sliders (visible when helix is active) -->
                        <template v-if="app.helixEnabled">
                            <div class="tools-slider">
                                <label>Radius <span class="tools-slider-value">{{ app.helixRadius.toFixed(2)
                                        }}</span></label>
                                <input
                                    type="range"
                                    min="0.1"
                                    max="1.5"
                                    step="0.05"
                                    :value="app.helixRadius"
                                    @input="app.setHelixOption('helixRadius', parseFloat($event.target.value))"
                                />
                            </div>
                            <div class="tools-slider">
                                <label>Pitch <span class="tools-slider-value">{{ app.helixPitch.toFixed(1)
                                        }}</span></label>
                                <input
                                    type="range"
                                    min="1"
                                    max="12"
                                    step="0.5"
                                    :value="app.helixPitch"
                                    @input="app.setHelixOption('helixPitch', parseFloat($event.target.value))"
                                />
                            </div>
                            <div class="tools-slider">
                                <label>Strand Width <span class="tools-slider-value">{{ app.helixStrandWidth.toFixed(2)
                                        }}</span></label>
                                <input
                                    type="range"
                                    min="0.05"
                                    max="0.8"
                                    step="0.05"
                                    :value="app.helixStrandWidth"
                                    @input="app.setHelixOption('helixStrandWidth', parseFloat($event.target.value))"
                                />
                            </div>
                        </template>
                        <!-- Cap style (works for both Standard Ribbon and helix strands) -->
                        <div class="tools-select-wrap">
                            <Select
                                v-model="selectedCapOption"
                                :options="capOptions"
                                option-label="label"
                                class="tools-select"
                            >
                                <template #value="slotProps">
                                    <div
                                        v-if="slotProps.value"
                                        class="tools-select-row"
                                    >
                                        <span class="material-symbols-outlined tools-select-icon">{{
                                            slotProps.value.icon }}</span>
                                        <span>{{ slotProps.value.label }}</span>
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
                </div>

                <!-- Import / Export section -->
                <div class="tools-section">
                    <div class="tools-section-label">Import / Export</div>
                    <div class="tools-section-items">
                        <button
                            class="tools-option"
                            @click="handleImport('svg')"
                        >
                            <span class="material-symbols-outlined">polyline</span>
                            <span>Import Shapes</span>
                            <span class="tools-hint">.SVG</span>
                        </button>
                        <button
                            class="tools-option"
                            @click="handleImport('zip')"
                        >
                            <span class="material-symbols-outlined">folder_zip</span>
                            <span>Import Texture</span>
                            <span class="tools-hint">.ZIP</span>
                        </button>
                        <button
                            class="tools-option"
                            @click="handleExportImage"
                        >
                            <span class="material-symbols-outlined">image</span>
                            <span>Export Image</span>
                            <span class="tools-hint">.PNG</span>
                        </button>
                        <button
                            class="tools-option"
                            @click="handleExportVideo"
                        >
                            <span class="material-symbols-outlined">videocam</span>
                            <span>Export Video</span>
                            <span class="tools-hint">.MP4</span>
                        </button>
                    </div>
                </div>

                <!-- Cinematic Camera section -->
                <div class="tools-section">
                    <div class="tools-section-label">Cinematic Camera</div>
                    <div class="tools-section-items">
                        <button
                            class="tools-option"
                            :disabled="props.cinematicPlaying"
                            @click="handleCinematicCapture"
                        >
                            <span class="material-symbols-outlined">center_focus_strong</span>
                            <span>Capture View</span>
                            <span class="tools-hint">C</span>
                        </button>
                        <button
                            class="tools-option"
                            @click="handleCinematicToggle"
                        >
                            <span class="material-symbols-outlined">{{ props.cinematicPlaying ? 'stop' : 'theaters'
                                }}</span>
                            <span>{{ props.cinematicPlaying ? 'Stop Cinematic' : 'Play Cinematic' }}</span>
                            <span class="tools-hint">P</span>
                        </button>
                        <button
                            class="tools-option"
                            :disabled="props.cinematicPlaying || props.cinematicRoiCount === 0"
                            @click="handleCinematicClear"
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

                <div class="tools-section">
                    <div class="tools-section-label">Diagnostics</div>
                    <div class="tools-section-items">
                        <button
                            class="tools-option"
                            :class="{ selected: props.technicalOverlay }"
                            @click="emit('technical-overlay-toggle')"
                        >
                            <span class="material-symbols-outlined">monitoring</span>
                            <span>Technical Overlay</span>
                            <span class="tools-hint">D</span>
                        </button>
                    </div>
                </div>

                <!-- Display & Account section -->
                <div class="tools-section">
                    <div class="tools-section-label">Account</div>
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
        padding: 0;
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
        background: rgba(255, 255, 255, 0.08);
        box-shadow: inset 0 -3px 0 0 rgba(255, 255, 255, 0.7);
    }

    /* Mobile: buttons expand to fill available space */
    @media (max-width: 768px) {
        .bottom-toolbar button {
            flex-grow: 1;
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
        height: 100%;
        width: 100%;
        background: #1a1a1a;
        padding-top: 5.5rem;
        /* Space for AppHeader */
        padding-bottom: 5.5rem;
        /* Space for BottomToolbar */
    }

    .tools-panel-content {
        flex: 1;
        overflow-y: auto;
        padding: 1.5rem 1.25rem;
        width: 100%;
        max-width: 480px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    /* Desktop: two-column flex wrap so sections flow without row-height mismatch */
    @media (min-width: 769px) {
        .tools-panel-content {
            max-width: none;
            flex-direction: column;
            flex-wrap: wrap;
            align-content: center;
            gap: 1.25rem 2rem;
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
        background: rgba(255, 255, 255, 0.04);
        border-radius: 10px;
        padding: 0.25rem;
    }

    .tools-select-wrap {
        padding: 0.5rem;
    }

    .tools-status-card {
        margin: 0 0.5rem 0.5rem;
        padding: 0.85rem 0.95rem;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .tools-status-card.is-error {
        background: rgba(239, 68, 68, 0.12);
        border-color: rgba(239, 68, 68, 0.28);
    }

    .tools-status-card.is-success {
        background: rgba(16, 185, 129, 0.12);
        border-color: rgba(16, 185, 129, 0.28);
    }

    .tools-status-row {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
    }

    .tools-status-icon {
        font-size: 1.2rem;
        opacity: 0.85;
        padding-top: 0.15rem;
    }

    .tools-status-copy {
        flex: 1;
        min-width: 0;
    }

    .tools-status-label-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
    }

    .tools-status-label-text {
        font-size: 0.78rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.72);
    }

    .tools-status-message {
        margin-top: 0.4rem;
        font-size: 0.86rem;
        line-height: 1.45;
        color: rgba(255, 255, 255, 0.7);
    }

    .tools-inline-action {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.35rem 0.55rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.9);
        cursor: pointer;
        font-size: 0.74rem;
        font-weight: 600;
    }

    .tools-inline-action .material-symbols-outlined {
        font-size: 1rem;
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

    .tools-user {
        opacity: 0.55;
        cursor: default;
    }

    .tools-user:hover {
        background: transparent;
    }

    /* Helix parameter sliders */
    .tools-slider {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        padding: 0.5rem 1rem 0.625rem;
    }

    .tools-slider label {
        display: flex;
        justify-content: space-between;
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.6);
    }

    .tools-slider-value {
        color: rgba(255, 255, 255, 0.85);
        font-family: monospace;
        font-size: 0.75rem;
    }

    .tools-slider input[type="range"] {
        width: 100%;
        height: 4px;
        background: rgba(255, 255, 255, 0.15);
        border-radius: 2px;
        outline: none;
        -webkit-appearance: none;
        appearance: none;
        cursor: pointer;
    }

    .tools-slider input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--p-primary-color, #10b981);
        cursor: pointer;
    }

    .tools-slider input[type="range"]::-moz-range-thumb {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--p-primary-color, #10b981);
        border: none;
        cursor: pointer;
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
        padding-top: 5.5rem;
        padding-bottom: 5.5rem;
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
