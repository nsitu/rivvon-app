<script setup>
    import { computed } from 'vue';
    import Select from 'primevue/select';
    import ToggleSwitch from 'primevue/toggleswitch';
    import { useViewerStore } from '../../stores/viewerStore';

    const props = defineProps({
        technicalOverlay: { type: Boolean, default: false },
    });

    // Store-backed settings mutate the viewer store directly.
    // Imperative scene/display actions stay parent-owned and are exposed as request events.
    const emit = defineEmits([
        'request-viewer-control-mode-change',
        'request-reset-viewer',
        'request-technical-overlay-toggle',
    ]);

    const app = useViewerStore();

    const viewerControlOptions = [
        { label: 'Orbit Controls', value: 'orbit', icon: '3d_rotation' },
        { label: 'Mouse Tilt', value: 'mouseTilt', icon: 'open_with' },
        { label: 'Head Tracking', value: 'headTracking', icon: 'face' },
        { label: 'Scroll Driven', value: 'scrollTilt', icon: '360' }
    ];

    const selectedViewerControlOption = computed({
        get: () => viewerControlOptions.find((option) => option.value === app.viewerControlMode) ?? viewerControlOptions[0],
        set: (option) => {
            if (!option?.value) return;
            emit('request-viewer-control-mode-change', option.value);
        }
    });

    const showHeadTrackingTools = computed(() => (
        app.viewerControlMode === 'headTracking'
        || (
            app.viewerControlMode !== 'scrollTilt'
            && (
                !!app.headTrackingMessage
                || app.headTrackingSupported === false
            )
        )
    ));

    const showScrollDrivenTools = computed(() => app.viewerControlMode === 'scrollTilt');

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

    const scrollDrivenDisplayMessage = computed(() => (
        'Use wheel, trackpad, or touch drag to drive the enabled responses below.'
    ));

    const screenWakeLockHint = computed(() => {
        if (app.screenWakeLockSupported === false) return 'N/A';
        if (!app.screenWakeLockEnabled) return 'Off';
        return app.screenWakeLockActive ? 'Active' : 'Auto';
    });

    const scrollDrivenTiltModel = computed({
        get: () => app.scrollDrivenTiltEnabled,
        set: (value) => {
            app.setScrollDrivenTiltEnabled(!!value);
        }
    });

    const scrollDrivenLayerCycleModel = computed({
        get: () => app.scrollDrivenLayerCycleEnabled,
        set: (value) => {
            app.setScrollDrivenLayerCycleEnabled(!!value);
        }
    });

    const scrollDrivenFlowModel = computed({
        get: () => app.scrollDrivenFlowEnabled,
        set: (value) => {
            app.setScrollDrivenFlowEnabled(!!value);
        }
    });

    const textureMetadataOverlayModel = computed({
        get: () => app.showTextureMetadataOverlay,
        set: (value) => {
            app.setShowTextureMetadataOverlay(!!value);
        }
    });

    const technicalOverlayModel = computed({
        get: () => props.technicalOverlay,
        set: (value) => {
            if (value === props.technicalOverlay) return;
            emit('request-technical-overlay-toggle');
        }
    });

    const screenWakeLockModel = computed({
        get: () => (app.screenWakeLockSupported === false ? false : app.screenWakeLockEnabled),
        set: (value) => {
            if (app.screenWakeLockSupported === false) return;
            app.setScreenWakeLockEnabled(!!value);
        }
    });
</script>

<template>
    <div class="viewer-settings-controls">
        <div class="tools-section">
            <div class="tools-section-label">Viewer</div>
            <div class="tools-section-items">
                <div class="tools-select-block">
                    <label class="tools-select-label">Controls</label>
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
                                    <span class="material-symbols-outlined tools-select-icon">{{ slotProps.value.icon
                                    }}</span>
                                    <span>{{ slotProps.value.label }}</span>
                                </div>
                                <span v-else>{{ slotProps.placeholder }}</span>
                            </template>
                            <template #option="slotProps">
                                <div class="tools-select-row">
                                    <span class="material-symbols-outlined tools-select-icon">{{ slotProps.option.icon
                                    }}</span>
                                    <span>{{ slotProps.option.label }}</span>
                                </div>
                            </template>
                        </Select>
                    </div>
                </div>

                <button
                    type="button"
                    class="tools-option"
                    @click="emit('request-reset-viewer')"
                >
                    <span class="material-symbols-outlined">restart_alt</span>
                    <span>Reset View</span>
                </button>

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
                                    @click="app.requestHeadTrackingRecenter()"
                                >
                                    <span class="material-symbols-outlined">center_focus_strong</span>
                                    <span>Re-center</span>
                                </button>
                            </div>
                            <div class="tools-status-message">{{ headTrackingDisplayMessage }}</div>
                        </div>
                    </div>
                </div>

                <div
                    v-if="showScrollDrivenTools"
                    class="tools-status-card"
                >
                    <div class="tools-status-row">
                        <span class="material-symbols-outlined tools-status-icon">360</span>
                        <div class="tools-status-copy">
                            <div class="tools-status-label-row">
                                <span class="tools-status-label-text">Scroll Driven</span>
                            </div>
                            <div class="tools-status-message">{{ scrollDrivenDisplayMessage }}</div>
                        </div>
                    </div>
                </div>

                <div
                    v-if="showScrollDrivenTools"
                    class="tools-toggle-row"
                >
                    <label
                        class="tools-toggle-main"
                        for="scrollDrivenTiltToggle"
                    >
                        <span class="material-symbols-outlined">open_with</span>
                        <span>Camera Tilt</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ app.scrollDrivenTiltEnabled ? 'On' : 'Off'
                        }}</span>
                        <ToggleSwitch
                            inputId="scrollDrivenTiltToggle"
                            v-model="scrollDrivenTiltModel"
                        />
                    </div>
                </div>

                <div
                    v-if="showScrollDrivenTools"
                    class="tools-toggle-row"
                >
                    <label
                        class="tools-toggle-main"
                        for="scrollDrivenLayerCycleToggle"
                    >
                        <span class="material-symbols-outlined">layers</span>
                        <span>Layer Cycle</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ app.scrollDrivenLayerCycleEnabled ? 'On' : 'Off'
                        }}</span>
                        <ToggleSwitch
                            inputId="scrollDrivenLayerCycleToggle"
                            v-model="scrollDrivenLayerCycleModel"
                        />
                    </div>
                </div>

                <div
                    v-if="showScrollDrivenTools"
                    class="tools-toggle-row"
                >
                    <label
                        class="tools-toggle-main"
                        for="scrollDrivenFlowToggle"
                    >
                        <span class="material-symbols-outlined">repeat</span>
                        <span>Conveyor Flow</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ app.scrollDrivenFlowEnabled ? 'On' : 'Off'
                        }}</span>
                        <ToggleSwitch
                            inputId="scrollDrivenFlowToggle"
                            v-model="scrollDrivenFlowModel"
                        />
                    </div>
                </div>

                <div class="tools-toggle-row">
                    <label
                        class="tools-toggle-main"
                        for="textureMetadataToggle"
                    >
                        <span class="material-symbols-outlined">subtitles</span>
                        <span>Texture Metadata</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">M</span>
                        <ToggleSwitch
                            inputId="textureMetadataToggle"
                            v-model="textureMetadataOverlayModel"
                        />
                    </div>
                </div>

                <div class="tools-toggle-row">
                    <label
                        class="tools-toggle-main"
                        for="technicalOverlayToggle"
                    >
                        <span class="material-symbols-outlined">monitoring</span>
                        <span>Technical Overlay</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">D</span>
                        <ToggleSwitch
                            inputId="technicalOverlayToggle"
                            v-model="technicalOverlayModel"
                        />
                    </div>
                </div>

                <div
                    class="tools-toggle-row"
                    :class="{ 'is-disabled': app.screenWakeLockSupported === false }"
                >
                    <label
                        class="tools-toggle-main"
                        for="screenWakeLockToggle"
                    >
                        <span class="material-symbols-outlined">schedule</span>
                        <span>Keep Screen Awake</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ screenWakeLockHint }}</span>
                        <ToggleSwitch
                            inputId="screenWakeLockToggle"
                            v-model="screenWakeLockModel"
                            :disabled="app.screenWakeLockSupported === false"
                        />
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .viewer-settings-controls {
        width: 100%;
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

    .tools-option .material-symbols-outlined {
        font-size: 1.35rem;
        opacity: 0.85;
    }

    .tools-toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.875rem 1rem;
        color: var(--p-text-color, #fff);
    }

    .tools-toggle-row.is-disabled {
        opacity: 0.35;
    }

    .tools-toggle-main {
        display: flex;
        align-items: center;
        gap: 0.875rem;
        min-width: 0;
        color: inherit;
        cursor: pointer;
    }

    .tools-toggle-main .material-symbols-outlined {
        font-size: 1.35rem;
        opacity: 0.85;
        flex-shrink: 0;
    }

    .tools-toggle-row.is-disabled .tools-toggle-main {
        cursor: default;
    }

    .tools-toggle-control {
        display: inline-flex;
        align-items: center;
        gap: 0.65rem;
        flex-shrink: 0;
    }

    .tools-toggle-hint {
        margin-left: 0;
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
</style>