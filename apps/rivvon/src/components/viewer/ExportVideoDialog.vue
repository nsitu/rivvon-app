<script setup>
    import { ref, computed, watch } from 'vue';
    import Accordion from 'primevue/accordion';
    import AccordionPanel from 'primevue/accordionpanel';
    import AccordionHeader from 'primevue/accordionheader';
    import AccordionContent from 'primevue/accordioncontent';
    import Button from 'primevue/button';
    import Select from 'primevue/select';
    import InputNumber from 'primevue/inputnumber';
    import ToggleSwitch from 'primevue/toggleswitch';
    import PanelActionBar from '../shared/PanelActionBar.vue';
    import AnimationSettingsControls from './AnimationSettingsControls.vue';
    import TextureSettingsControls from './TextureSettingsControls.vue';
    import { useViewerStore } from '../../stores/viewerStore';
    import { EXPORT_LOGO_SRC, EXPORT_LOGO_AREA_RATIO, getExportLogoOverlayLayout } from '../../modules/viewer/exportLogoOverlay';
    import {
        EXPORT_ASPECT_RATIO_OPTIONS,
        getExportResolutionOptions,
        normalizeExportDimensionSettings,
    } from '../../modules/viewer/exportVideoDimensions';

    const app = useViewerStore();

    const props = defineProps({
        visible: { type: Boolean, default: false },
        exportInfo: { type: Object, default: () => ({}) },
        initialSettings: { type: Object, default: null },
        isEncoding: { type: Boolean, default: false },
        exportStatus: { type: String, default: '' },
        encodedFilename: { type: String, default: '' },
        encodedSize: { type: Number, default: 0 },
        canShare: { type: Boolean, default: false },
    });

    const emit = defineEmits(['update:visible', 'request-export', 'request-download', 'request-share', 'request-cancel', 'settings-change']);

    // --- Form state ---
    const format = ref('mp4');
    const exportMode = ref('ribbons');
    const durationMode = ref('loop');
    const customDuration = ref(5);
    const cycleCount = ref(1);

    const cycleCountOptions = [
        { label: '1 loop', value: 1 },
        { label: '2 loops', value: 2 },
        { label: '3 loops', value: 3 },
        { label: '4 loops', value: 4 },
    ];
    const fps = ref(30);
    const cameraMovement = ref('circularTilt');
    const quality = ref('high');
    const logoOverlayEnabled = ref(true);

    const exportModeOptions = computed(() => {
        const options = [];
        const modes = props.exportInfo?.modes || {};

        if (props.exportInfo?.supportsRibbonExport !== false && modes.ribbons) {
            options.push({ label: 'Ribbon Geometry', value: 'ribbons' });
        }

        if (modes.textureOnly) {
            options.push({ label: 'Texture Only', value: 'textureOnly' });
        }

        return options;
    });

    const activeModeInfo = computed(() => {
        const modes = props.exportInfo?.modes || {};
        if (exportMode.value === 'textureOnly' && modes.textureOnly) {
            return modes.textureOnly;
        }

        return modes.ribbons || modes.textureOnly || {};
    });

    const textureOnlyMode = computed(() => exportMode.value === 'textureOnly');

    const cameraMovementOptions = computed(() => {
        const hasROIs = activeModeInfo.value?.hasROIs ?? false;
        return [
            { label: 'None', value: 'none', description: 'Camera stays fixed' },
            { label: 'Cinematic', value: 'cinematic', description: hasROIs ? 'Smooth motion through authored camera regions' : 'Auto-generated from ribbon geometry (press C to author custom ROIs)' },
            { label: 'Circular Tilt', value: 'circularTilt', description: 'Artwork tilts through one full 360° rotation over the export duration' },
        ];
    });

    const cameraMovementDescription = computed(() => {
        const option = cameraMovementOptions.value.find((entry) => entry.value === cameraMovement.value);
        return option?.description ?? '';
    });

    // --- Preset options ---
    const aspectRatioOptions = EXPORT_ASPECT_RATIO_OPTIONS;

    const exportDimensionSettings = computed(() => normalizeExportDimensionSettings({
        aspectRatioPreset: app.exportAspectRatioPreset,
        resolutionPreset: app.exportResolutionPreset,
        customWidth: app.exportCustomWidth,
        customHeight: app.exportCustomHeight,
    }));
    const aspectRatioPreset = computed({
        get: () => exportDimensionSettings.value.aspectRatioPreset,
        set: (value) => {
            app.setExportAspectRatioPreset(value);
        },
    });
    const resolutionPreset = computed({
        get: () => exportDimensionSettings.value.resolutionPreset,
        set: (value) => {
            app.setExportResolutionPreset(value);
        },
    });
    const customWidth = computed({
        get: () => exportDimensionSettings.value.customWidth,
        set: (value) => {
            app.setExportCustomWidth(value);
        },
    });
    const customHeight = computed({
        get: () => exportDimensionSettings.value.customHeight,
        set: (value) => {
            app.setExportCustomHeight(value);
        },
    });
    const resolutionOptions = computed(() => getExportResolutionOptions(aspectRatioPreset.value));

    const formatOptions = [
        { label: 'MP4 (H.264)', value: 'mp4' },
        { label: 'WebM (VP9)', value: 'webm' }
    ];

    const durationOptions = [
        { label: 'Looping Cycle', value: 'loop', icon: 'all_inclusive' },
        { label: 'Custom', value: 'custom', icon: 'schedule' }
    ];

    const qualityOptions = [
        { label: 'Very Low', value: 'very-low', description: 'Smallest file size, lower fidelity' },
        { label: 'Low', value: 'low', description: 'Small file, acceptable quality' },
        { label: 'Medium', value: 'medium', description: 'Balanced file size and quality' },
        { label: 'High', value: 'high', description: 'Recommended — sharp detail, reasonable size' },
        { label: 'Very High', value: 'very-high', description: 'Maximum quality, larger file' },
    ];

    const qualityDescription = computed(() => {
        const option = qualityOptions.find((entry) => entry.value === quality.value);
        return option?.description ?? '';
    });

    function applyInitialDimensionSettings(settings = null) {
        if (!settings) {
            return;
        }

        app.setExportDimensionSettings(settings);
    }

    // --- Computed ---
    const resolvedWidth = computed(() => exportDimensionSettings.value.width);

    const resolvedHeight = computed(() => exportDimensionSettings.value.height);

    const seamlessLoopDuration = computed(() => {
        return activeModeInfo.value?.seamlessLoopDuration ?? 3.0;
    });

    const cinematicAutoDuration = computed(() => {
        return activeModeInfo.value?.cinematicAutoDuration ?? seamlessLoopDuration.value;
    });

    const cycleDetails = computed(() => {
        return activeModeInfo.value?.cycleDetails ?? [];
    });

    const loopSummaryLabel = computed(() => {
        return activeModeInfo.value?.loopLabel || 'Seamless Material Loop';
    });

    const logoOverlayLayout = computed(() => {
        return getExportLogoOverlayLayout(resolvedWidth.value, resolvedHeight.value);
    });

    const logoOverlaySummary = computed(() => {
        const { width, height } = logoOverlayLayout.value;
        return `${Math.round(width)}×${Math.round(height)} px · ${Math.round(EXPORT_LOGO_AREA_RATIO * 100)}% frame area`;
    });

    const resolvedDuration = computed(() => {
        if (durationMode.value === 'loop') {
            if (!textureOnlyMode.value && cameraMovement.value === 'cinematic') {
                return cinematicAutoDuration.value * cycleCount.value;
            }
            return seamlessLoopDuration.value * cycleCount.value;
        }
        return customDuration.value;
    });

    const durationSummaryLabel = computed(() => {
        if (durationMode.value === 'custom') {
            return textureOnlyMode.value
                ? `Custom export length overrides the ${formatDuration(seamlessLoopDuration.value)} texture-loop target.`
                : `Custom export length overrides the ${formatDuration(seamlessLoopDuration.value)} seamless-loop target.`;
        }
        if (textureOnlyMode.value) {
            return `Texture overview returns to its starting tile, layer, and flow state after ${formatDuration(seamlessLoopDuration.value)}.`;
        }
        if (cameraMovement.value === 'cinematic') {
            if (activeModeInfo.value?.hasROIs) {
                return `Camera path auto-aligns from ${formatDuration(activeModeInfo.value?.cinematicDuration || 0)} to ${formatDuration(cinematicAutoDuration.value)} for a cleaner seam.`;
            }
            return `No saved cinematic views yet, so auto mode falls back to the ${formatDuration(seamlessLoopDuration.value)} material loop.`;
        }
        if (cameraMovement.value === 'circularTilt') {
            return `One full 360° artwork tilt rotation over ${formatDuration(resolvedDuration.value)}.`;
        }
        return `Seamless loop — enabled cycles return to start after ${formatDuration(seamlessLoopDuration.value)}.`;
    });

    const loopDetailsSummary = computed(() => {
        if (durationMode.value === 'custom') {
            return textureOnlyMode.value
                ? `Base texture-only loop is ${formatDuration(seamlessLoopDuration.value)}, but the export will run for ${formatDuration(resolvedDuration.value)}. Active cycles may be cut mid-loop.`
                : `Base seamless loop is ${formatDuration(seamlessLoopDuration.value)}, but the export will run for ${formatDuration(resolvedDuration.value)}. Active cycles may be cut mid-loop.`;
        }

        if (textureOnlyMode.value) {
            return `Auto mode uses the ${formatDuration(seamlessLoopDuration.value)} seamless texture loop so tile placement, layer cycling, and conveyor flow land back on frame zero together.`;
        }

        if (cameraMovement.value === 'cinematic') {
            if (activeModeInfo.value?.hasROIs) {
                return `The authored camera loop is ${formatDuration(activeModeInfo.value?.cinematicDuration || 0)}. Auto mode aligns it to ${formatDuration(cinematicAutoDuration.value)} so camera and material cycles land together.`;
            }

            return `No authored camera loop is available, so auto mode uses the ${formatDuration(seamlessLoopDuration.value)} seamless material loop.`;
        }

        if (cameraMovement.value === 'circularTilt') {
            return `Circular Tilt completes one full 360° rotation over the export duration. In auto mode that is ${formatDuration(resolvedDuration.value)}.`;
        }

        return `Auto mode uses the ${formatDuration(seamlessLoopDuration.value)} seamless material loop so enabled cycles return to frame zero together.`;
    });

    const totalFrames = computed(() => {
        return Math.ceil(resolvedDuration.value * fps.value);
    });

    const qualityBitrateEstimate = computed(() => {
        const map = {
            'very-low': 1_500_000,
            'low': 3_000_000,
            'medium': 5_000_000,
            'high': 8_000_000,
            'very-high': 14_000_000,
        };
        return map[quality.value] ?? 8_000_000;
    });

    const estimatedSize = computed(() => {
        const bytes = (qualityBitrateEstimate.value * resolvedDuration.value) / 8;
        if (bytes > 1024 * 1024) return `~${(bytes / 1024 / 1024).toFixed(1)} MB`;
        return `~${(bytes / 1024).toFixed(0)} KB`;
    });

    const hasWebCodecs = computed(() => {
        return props.exportInfo?.hasWebCodecs ?? false;
    });

    const hasEncodedVideo = computed(() => Boolean(props.encodedFilename));

    const encodedSizeLabel = computed(() => {
        const bytes = Number(props.encodedSize) || 0;
        if (bytes <= 0) return '';
        if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
        return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    });

    watch(
        () => [
            props.visible,
            props.initialSettings?.aspectRatioPreset,
            props.initialSettings?.resolutionPreset,
            props.initialSettings?.customWidth,
            props.initialSettings?.customHeight,
        ],
        ([visible]) => {
            if (!visible || !props.initialSettings) {
                return;
            }

            applyInitialDimensionSettings(props.initialSettings);
        },
        { immediate: true }
    );

    watch(
        () => [props.visible, props.exportInfo?.defaultExportMode, exportModeOptions.value.map((option) => option.value).join(',')],
        ([visible]) => {
            if (!visible) {
                return;
            }

            const availableModes = exportModeOptions.value.map((option) => option.value);
            const preferredMode = props.exportInfo?.defaultExportMode;
            exportMode.value = availableModes.includes(preferredMode)
                ? preferredMode
                : (availableModes[0] || 'ribbons');

            if (exportMode.value === 'textureOnly') {
                cameraMovement.value = 'none';
            }
        },
        { immediate: true }
    );

    watch(exportMode, (mode) => {
        if (mode === 'textureOnly') {
            cameraMovement.value = 'none';
        }
    });

    watch([
        aspectRatioPreset,
        resolutionPreset,
        customWidth,
        customHeight,
        format,
        exportMode,
        durationMode,
        customDuration,
        cycleCount,
        fps,
        cameraMovement,
        quality,
        logoOverlayEnabled,
        () => app.flowState,
        () => app.flowSpeed,
        () => app.undulationEnabled,
        () => app.flowCycleAlignmentEnabled,
        () => app.textureAnimationEnabled,
        () => app.textureAnimationReversed,
        () => app.preferredTextureMaxResolution,
        () => app.renderFilterMode,
        () => app.transparentShadowsEnabled,
        () => app.duotoneColor,
        () => app.textureRepeatMode,
        () => app.textureOverviewFlipVertical,
    ], () => {
        emit('settings-change');
    });

    function formatDuration(value) {
        const numeric = Number(value);

        if (!Number.isFinite(numeric) || numeric <= 0) {
            return 'Off';
        }

        return `${numeric.toFixed(numeric >= 10 ? 1 : 2)}s`;
    }

    // --- Methods ---
    function handleExport() {
        emit('request-export', {
            exportMode: exportMode.value,
            width: resolvedWidth.value,
            height: resolvedHeight.value,
            fps: fps.value,
            format: format.value,
            duration: durationMode.value === 'custom' ? resolvedDuration.value : null,
            loopCount: durationMode.value === 'loop' ? cycleCount.value : 1,
            cameraMovement: textureOnlyMode.value ? 'none' : cameraMovement.value,
            quality: quality.value,
            logoOverlayEnabled: logoOverlayEnabled.value,
        });
    }

    function handleDownload() {
        emit('request-download');
    }

    function handleShare() {
        emit('request-share');
    }

    function handleCancel() {
        emit('request-cancel');
    }

    function handleClose() {
        emit('update:visible', false);
    }
</script>

<template>
    <div
        class="export-video-panel"
        :class="{ active: visible }"
        role="dialog"
        aria-modal="true"
        aria-label="Export Video"
    >
        <div class="export-video-panel-container">
            <div class="export-video-panel-content">
                <div class="export-video-panel-body">
                    <div
                        v-if="!hasWebCodecs"
                        class="warning-banner"
                    >
                        <span class="material-symbols-outlined">warning</span>
                        <span>WebCodecs API not available. Use Chrome 94+ or Edge 94+.</span>
                    </div>

                    <div class="form-grid">
                        <div
                            v-if="exportModeOptions.length > 1"
                            class="form-field"
                        >
                            <label>Export Mode</label>
                            <Select
                                v-model="exportMode"
                                :options="exportModeOptions"
                                option-label="label"
                                option-value="value"
                                :disabled="isEncoding"
                                class="w-full"
                            />
                        </div>

                        <div class="form-field">
                            <label>Format</label>
                            <Select
                                v-model="format"
                                :options="formatOptions"
                                option-label="label"
                                option-value="value"
                                :disabled="isEncoding"
                                class="w-full"
                            />
                        </div>

                        <div class="form-field">
                            <label>Aspect Ratio</label>
                            <Select
                                v-model="aspectRatioPreset"
                                :options="aspectRatioOptions"
                                option-label="label"
                                option-value="value"
                                :disabled="isEncoding"
                                class="w-full"
                            >
                                <template #value="{ value }">
                                    <div class="aspect-ratio-option">
                                        <span class="material-symbols-outlined">{{aspectRatioOptions.find(o => o.value
                                            === value)?.icon}}</span>
                                        <span>{{aspectRatioOptions.find(o => o.value === value)?.label}}</span>
                                    </div>
                                </template>
                                <template #option="{ option }">
                                    <div class="aspect-ratio-option">
                                        <span class="material-symbols-outlined">{{ option.icon }}</span>
                                        <span>{{ option.label }}</span>
                                    </div>
                                </template>
                            </Select>
                        </div>

                        <div
                            v-if="aspectRatioPreset !== 'custom'"
                            class="form-field"
                        >
                            <label>Resolution</label>
                            <Select
                                v-model="resolutionPreset"
                                :options="resolutionOptions"
                                option-label="label"
                                option-value="value"
                                :disabled="isEncoding"
                                class="w-full"
                            />
                        </div>

                        <div
                            v-if="aspectRatioPreset === 'custom' || resolutionPreset === 'custom'"
                            class="form-field form-row"
                        >
                            <div class="flex-1">
                                <label>Width</label>
                                <InputNumber
                                    v-model="customWidth"
                                    :min="320"
                                    :max="7680"
                                    :step="2"
                                    :disabled="isEncoding"
                                    class="w-full"
                                />
                            </div>
                            <span class="dimension-x">×</span>
                            <div class="flex-1">
                                <label>Height</label>
                                <InputNumber
                                    v-model="customHeight"
                                    :min="240"
                                    :max="4320"
                                    :step="2"
                                    :disabled="isEncoding"
                                    class="w-full"
                                />
                            </div>
                        </div>

                        <div class="logo-overlay-group">
                            <div class="form-field">
                                <label for="logoOverlayToggle">Logo Overlay</label>
                                <div class="toggle-control">
                                    <ToggleSwitch
                                        inputId="logoOverlayToggle"
                                        v-model="logoOverlayEnabled"
                                        :disabled="isEncoding"
                                    />
                                    <span class="toggle-copy">{{ logoOverlayEnabled ? 'On' : 'Off' }}</span>
                                </div>
                                <div class="field-description">
                                    Bottom-right Rivvon logo baked into each frame.
                                </div>
                            </div>

                            <div
                                v-if="logoOverlayEnabled"
                                class="logo-preview-frame"
                            >
                                <img
                                    :src="EXPORT_LOGO_SRC"
                                    alt="Rivvon export logo preview"
                                    class="logo-preview-image"
                                    decoding="async"
                                >
                            </div>
                        </div>

                        <div class="form-field quality-field">
                            <label>Quality</label>
                            <Select
                                v-model="quality"
                                :options="qualityOptions"
                                optionLabel="label"
                                optionValue="value"
                                :disabled="isEncoding"
                                class="w-full"
                            />
                            <div
                                v-if="qualityDescription"
                                class="field-description"
                            >
                                {{ qualityDescription }}
                            </div>
                        </div>

                        <div
                            v-if="!textureOnlyMode"
                            class="form-field camera-movement-field"
                        >
                            <label>Camera Movement</label>
                            <Select
                                v-model="cameraMovement"
                                :options="cameraMovementOptions"
                                optionLabel="label"
                                optionValue="value"
                                :disabled="isEncoding"
                                class="w-full"
                            />
                            <div
                                v-if="cameraMovementDescription"
                                class="field-description"
                            >
                                {{ cameraMovementDescription }}
                            </div>
                        </div>

                        <AnimationSettingsControls
                            class="export-animation-settings"
                            :show-undulation="!textureOnlyMode"
                        />

                        <TextureSettingsControls
                            class="export-texture-settings"
                            :show-overview-vertical-flip="textureOnlyMode"
                        />

                        <div
                            class="form-line-break"
                            aria-hidden="true"
                        ></div>

                        <div class="form-field duration-field">
                            <label>Duration</label>
                            <div class="duration-row">
                                <Select
                                    v-model="durationMode"
                                    :options="durationOptions"
                                    option-label="label"
                                    option-value="value"
                                    :disabled="isEncoding"
                                    class="duration-mode-select"
                                >
                                    <template #value="{ value }">
                                        <div class="duration-option">
                                            <span class="material-symbols-outlined">{{durationOptions.find(o => o.value
                                                === value)?.icon}}</span>
                                            <span>{{durationOptions.find(o => o.value === value)?.label}}</span>
                                        </div>
                                    </template>
                                    <template #option="{ option }">
                                        <div class="duration-option">
                                            <span class="material-symbols-outlined">{{ option.icon }}</span>
                                            <span>{{ option.label }}</span>
                                        </div>
                                    </template>
                                </Select>
                            </div>
                            <div
                                v-if="durationMode === 'custom'"
                                class="field-description warning-inline"
                            >
                                <span class="material-symbols-outlined">warning</span> Custom durations may not loop
                                cleanly.
                            </div>
                        </div>

                        <div
                            v-if="durationMode === 'loop'"
                            class="form-field loop-count-field"
                        >
                            <label>Loop Count</label>
                            <Select
                                v-model="cycleCount"
                                :options="cycleCountOptions"
                                option-label="label"
                                option-value="value"
                                :disabled="isEncoding"
                                class="w-full"
                            />
                        </div>

                        <div
                            v-if="durationMode === 'custom'"
                            class="form-field seconds-field"
                        >
                            <label>Seconds</label>
                            <InputNumber
                                v-model="customDuration"
                                :min="0.5"
                                :max="120"
                                :step="0.5"
                                :min-fraction-digits="1"
                                :max-fraction-digits="1"
                                suffix=" s"
                                :disabled="isEncoding"
                                class="w-full"
                            />
                        </div>

                        <Accordion class="loop-details-accordion">
                            <AccordionPanel value="0">
                                <AccordionHeader>
                                    <span class="accordion-header-text">
                                        <span class="material-symbols-outlined">schedule</span>
                                        Loop Details
                                    </span>
                                </AccordionHeader>
                                <AccordionContent>
                                    <div class="loop-summary-card">
                                        <div class="loop-summary-label">{{ loopSummaryLabel }}</div>
                                        <div class="loop-summary-value">{{ formatDuration(seamlessLoopDuration) }}</div>
                                        <div class="loop-summary-copy">{{ loopDetailsSummary }}</div>
                                    </div>

                                    <div class="loop-cycle-list">
                                        <div
                                            v-for="cycle in cycleDetails"
                                            :key="cycle.key"
                                            class="loop-cycle-row"
                                        >
                                            <div class="loop-cycle-top">
                                                <span class="loop-cycle-label">{{ cycle.label }}</span>
                                                <span class="loop-cycle-duration">{{ cycle.active ?
                                                    formatDuration(cycle.duration) : cycle.statusLabel }}</span>
                                            </div>
                                            <div class="loop-cycle-detail">{{ cycle.detail }}</div>
                                            <div class="loop-cycle-implication">{{ cycle.implication }}</div>
                                        </div>
                                    </div>
                                </AccordionContent>
                            </AccordionPanel>
                        </Accordion>

                    </div>
                </div>

                <div
                    v-if="exportStatus"
                    class="export-status-card"
                    :class="{ ready: hasEncodedVideo, busy: isEncoding }"
                >
                    <span class="material-symbols-outlined">{{ hasEncodedVideo ? 'task_alt' : (isEncoding ?
                        'progress_activity' : 'info') }}</span>
                    <div class="export-status-copy">
                        <div class="export-status-text">{{ exportStatus }}</div>
                        <div
                            v-if="hasEncodedVideo"
                            class="export-status-meta"
                        >
                            {{ encodedFilename }}<span v-if="encodedSizeLabel"> · {{ encodedSizeLabel }}</span>
                        </div>
                    </div>
                </div>

                <div class="summary-row">
                    <div class="summary-item">
                        <span class="summary-label">Frames</span>
                        <span class="summary-value">{{ totalFrames }}</span>
                    </div>
                    <div class="summary-item">
                        <span class="summary-label">Duration</span>
                        <span class="summary-value">{{ resolvedDuration.toFixed(2) }}s</span>
                    </div>
                    <div class="summary-item">
                        <span class="summary-label">Size</span>
                        <span class="summary-value">{{ estimatedSize }}</span>
                    </div>
                </div>

                <PanelActionBar class="export-video-panel-footer">
                    <template v-if="isEncoding">
                        <Button
                            type="button"
                            severity="secondary"
                            variant="outlined"
                            @click="handleCancel"
                        >
                            <span class="material-symbols-outlined">cancel</span>
                            Cancel Encode
                        </Button>
                    </template>
                    <template v-else-if="hasEncodedVideo">
                        <Button
                            type="button"
                            severity="secondary"
                            variant="outlined"
                            @click="handleClose"
                        >
                            <span class="material-symbols-outlined">close</span>
                            Close
                        </Button>
                        <Button
                            v-if="canShare"
                            type="button"
                            severity="secondary"
                            variant="outlined"
                            @click="handleShare"
                        >
                            <span class="material-symbols-outlined">share</span>
                            Share
                        </Button>
                        <Button
                            type="button"
                            @click="handleDownload"
                        >
                            <span class="material-symbols-outlined">download_done</span>
                            Download
                        </Button>
                    </template>
                    <template v-else>
                        <Button
                            type="button"
                            severity="secondary"
                            variant="outlined"
                            @click="handleClose"
                        >
                            <span class="material-symbols-outlined">close</span>
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            :disabled="!hasWebCodecs"
                            @click="handleExport"
                        >
                            <span class="material-symbols-outlined">videocam</span>
                            Encode Video
                        </Button>
                    </template>
                </PanelActionBar>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .export-video-panel {
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

    .export-video-panel.active {
        pointer-events: auto;
        opacity: 1;
    }

    .export-video-panel-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        background: rgba(0, 0, 0, 0.8);
        padding-top: 5.5rem;
        padding-bottom: 5.5rem;
    }

    .export-video-panel-content {
        flex: 1;
        width: 100%;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        padding: 1.5rem 1.25rem;
        gap: 1rem;
    }

    .export-video-panel-body {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .export-video-panel-footer {
        --panel-action-bar-padding: 0.85rem 0 0;
    }

    .form-grid {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: 0.7rem;
        padding: 0.25rem 0.1rem 0.35rem;
    }

    .form-field {
        display: flex;
        flex-direction: column;
        flex: 1 1 13rem;
        min-width: 13rem;
        gap: 0.375rem;
    }

    .form-line-break {
        flex: 0 0 100%;
        height: 0;
    }

    .export-animation-settings {
        flex: 1 1 100%;
        width: 100%;
        padding-top: 0.6rem;
        border-top: 1px solid var(--p-content-border-color, rgba(255, 255, 255, 0.1));
    }

    .export-texture-settings {
        flex: 1 1 100%;
        width: 100%;
    }

    .aspect-ratio-option {
        display: flex;
        align-items: center;
        gap: 0.45rem;
    }

    .duration-option {
        display: flex;
        align-items: center;
        gap: 0.45rem;
    }

    .aspect-ratio-option .material-symbols-outlined {
        font-size: 1.1rem;
        line-height: 1;
        flex-shrink: 0;
    }

    .duration-option .material-symbols-outlined {
        font-size: 1.1rem;
        line-height: 1;
        flex-shrink: 0;
    }

    .form-field label {
        font-size: 0.8rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.6));
    }

    .form-row {
        display: flex;
        flex-direction: row;
        align-items: flex-end;
        gap: 0.5rem;
        flex: 2 1 20rem;
        min-width: 20rem;
    }

    .dimension-x {
        padding-bottom: 0.5rem;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.5));
        font-size: 1.1rem;
    }

    .flex-1 {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        min-width: 0;
        overflow: hidden;
    }

    .flex-1 :deep(.p-inputnumber),
    .flex-1 :deep(.p-inputnumber-input) {
        width: 100%;
        min-width: 0;
    }

    .field-description {
        font-size: 0.78rem;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.5));
        margin-top: 0.375rem;
    }

    .warning-inline {
        display: flex;
        align-items: center;
        gap: 0.35rem;
    }

    .warning-inline .material-symbols-outlined {
        font-size: 1rem;
        line-height: 1;
        flex-shrink: 0;
    }

    .loop-details-accordion {
        width: 100%;
        flex: 1 1 100%;
    }

    .accordion-header-text {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-weight: 600;
        font-size: 0.9rem;
    }

    .accordion-header-text .material-symbols-outlined {
        font-size: 1.25rem;
    }

    .loop-summary-card {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        padding: 0.85rem 1rem;
        border-radius: 0.85rem;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .loop-summary-label {
        font-size: 0.7rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.55));
    }

    .loop-summary-value {
        font-size: 1.1rem;
        font-weight: 600;
    }

    .loop-summary-copy {
        font-size: 0.8rem;
        line-height: 1.5;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.68));
    }

    .loop-cycle-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin-top: 0.85rem;
    }

    .loop-cycle-row {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding: 0.75rem 0 0;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
    }

    .loop-cycle-row:first-child {
        border-top: none;
        padding-top: 0;
    }

    .loop-cycle-top {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 1rem;
    }

    .loop-cycle-label {
        font-size: 0.86rem;
        font-weight: 600;
    }

    .loop-cycle-duration {
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--p-primary-color, #6366f1);
    }

    .loop-cycle-detail,
    .loop-cycle-implication {
        font-size: 0.78rem;
        line-height: 1.45;
    }

    .loop-cycle-detail {
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.58));
    }

    .loop-cycle-implication {
        color: var(--p-text-color, rgba(255, 255, 255, 0.86));
    }

    .toggle-row {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1rem;
    }

    .toggle-text {
        flex: 1;
        min-width: 0;
    }

    .toggle-control {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        padding-top: 0.1rem;
    }

    .toggle-copy {
        min-width: 1.8rem;
        font-size: 0.78rem;
        font-weight: 500;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.6));
        text-align: right;
    }

    .logo-overlay-group {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        align-items: stretch;
        gap: 0.7rem;
        flex: 1 1 100%;
    }

    .logo-overlay-group .form-field {
        flex: 1 1 13rem;
    }

    .logo-overlay-group .logo-preview-frame {
        flex: 1 1 13rem;
        min-height: unset;
    }

    .logo-preview-frame {
        display: flex;
        justify-content: flex-end;
        align-items: flex-end;
        min-height: 6.5rem;
        padding: 0.9rem;
        border-radius: 0.75rem;
        background:
            radial-gradient(circle at top left, rgba(255, 255, 255, 0.08), transparent 45%),
            linear-gradient(135deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02));
        border: 1px solid rgba(255, 255, 255, 0.06);
        overflow: hidden;
    }

    .logo-preview-image {
        display: block;
        width: min(12rem, 60%);
        height: auto;
        max-width: 100%;
        filter: drop-shadow(0 0.35rem 0.75rem rgba(0, 0, 0, 0.35));
    }

    .duration-row {
        display: flex;
        flex-direction: row;
        align-items: flex-start;
        gap: 0.5rem;
    }

    .duration-mode-select {
        flex: 2;
        min-width: 0;
    }

    .seconds-field {
        flex: 0.9 1 11rem;
        min-width: 11rem;
    }

    .summary-row {
        display: flex;
        justify-content: space-between;
        padding: 0.7rem 0 0.85rem;
        border-bottom: 1px solid var(--p-content-border-color, rgba(255, 255, 255, 0.1));
        flex-shrink: 0;
    }

    .summary-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
    }

    .summary-label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.5));
    }

    .summary-value {
        font-size: 0.95rem;
        font-weight: 600;
    }

    .warning-banner {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1rem;
        border-radius: 8px;
        background: rgba(239, 68, 68, 0.15);
        border: 1px solid rgba(239, 68, 68, 0.3);
        color: #fca5a5;
        font-size: 0.85rem;
    }

    .warning-banner .material-symbols-outlined {
        font-size: 1.25rem;
        color: #ef4444;
    }

    .export-status-card {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 0.85rem 1rem;
        border-radius: 0.85rem;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .export-status-card.busy {
        background: rgba(59, 130, 246, 0.12);
        border-color: rgba(59, 130, 246, 0.28);
    }

    .export-status-card.ready {
        background: rgba(34, 197, 94, 0.12);
        border-color: rgba(34, 197, 94, 0.26);
    }

    .export-status-card .material-symbols-outlined {
        font-size: 1.25rem;
        line-height: 1.2;
        color: rgba(255, 255, 255, 0.9);
    }

    .export-status-copy {
        min-width: 0;
    }

    .export-status-text {
        font-size: 0.86rem;
        line-height: 1.45;
        color: rgba(255, 255, 255, 0.92);
    }

    .export-status-meta {
        margin-top: 0.2rem;
        font-size: 0.76rem;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.62));
        word-break: break-word;
    }

    @media (min-width: 769px) {
        .export-video-panel-content {
            max-width: 54rem;
        }
    }
</style>