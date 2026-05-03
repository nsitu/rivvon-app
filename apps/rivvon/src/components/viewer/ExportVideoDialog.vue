<script setup>
    import { ref, computed, watch } from 'vue';
    import Accordion from 'primevue/accordion';
    import AccordionPanel from 'primevue/accordionpanel';
    import AccordionHeader from 'primevue/accordionheader';
    import AccordionContent from 'primevue/accordioncontent';
    import Select from 'primevue/select';
    import InputNumber from 'primevue/inputnumber';
    import ToggleSwitch from 'primevue/toggleswitch';
    import { EXPORT_LOGO_SRC, EXPORT_LOGO_AREA_RATIO, getExportLogoOverlayLayout } from '../../modules/viewer/exportLogoOverlay';

    const props = defineProps({
        visible: { type: Boolean, default: false },
        exportInfo: { type: Object, default: () => ({}) },
        isEncoding: { type: Boolean, default: false },
        exportStatus: { type: String, default: '' },
        encodedFilename: { type: String, default: '' },
        encodedSize: { type: Number, default: 0 },
        canShare: { type: Boolean, default: false },
    });

    const emit = defineEmits(['update:visible', 'export', 'download', 'share', 'cancel', 'settings-change']);

    // --- Form state ---
    const aspectRatioPreset = ref('landscape');
    const resolutionPreset = ref('1080p');
    const customWidth = ref(1920);
    const customHeight = ref(1080);
    const format = ref('mp4');
    const durationMode = ref('auto');
    const customDuration = ref(5);
    const fps = ref(30);
    const cameraMovement = ref('none');
    const quality = ref('high');
    const logoOverlayEnabled = ref(true);

    const cameraMovementOptions = computed(() => {
        const hasROIs = props.exportInfo?.hasROIs ?? false;
        return [
            { label: 'None', value: 'none', description: 'Camera stays fixed' },
            { label: 'Cinematic', value: 'cinematic', description: hasROIs ? 'Smooth motion through authored camera regions' : 'Auto-generated from ribbon geometry (press C to author custom ROIs)' },
            { label: 'Circular Tilt', value: 'circularTilt', description: 'Mouse Tilt-style artwork motion that completes one full 360° cycle over the export' },
        ];
    });

    const cameraMovementDescription = computed(() => {
        const option = cameraMovementOptions.value.find((entry) => entry.value === cameraMovement.value);
        return option?.description ?? '';
    });

    // --- Preset options ---
    const aspectRatioOptions = [
        { label: 'Landscape', value: 'landscape' },
        { label: 'Portrait', value: 'portrait' },
        { label: 'Square', value: 'square' },
        { label: 'Instagram 5:4', value: 'instagram-5x4' },
        { label: 'Custom', value: 'custom' },
    ];

    const resolutionOptionsByAspect = {
        landscape: [
            { label: '720p (1280×720)', value: '720p' },
            { label: '1080p (1920×1080)', value: '1080p' },
            { label: '4K (3840×2160)', value: '4k' },
        ],
        portrait: [
            { label: '1080p (1080×1920)', value: '1080p-v' },
            { label: '4K (2160×3840)', value: '4k-v' },
        ],
        square: [
            { label: '1080 (1080×1080)', value: 'square' },
        ],
        'instagram-5x4': [
            { label: 'Post (1080×1350)', value: 'ig-5x4-1080' },
            { label: 'Post HD (1920×2400)', value: 'ig-5x4-1920' },
        ],
        custom: [
            { label: 'Custom Dimensions', value: 'custom' },
        ],
    };

    const resolutionOptions = computed(() => (
        resolutionOptionsByAspect[aspectRatioPreset.value] || resolutionOptionsByAspect.landscape
    ));

    const formatOptions = [
        { label: 'MP4 (H.264)', value: 'mp4' },
        { label: 'WebM (VP9)', value: 'webm' }
    ];

    const durationOptions = [
        { label: 'One full cycle (seamless loop)', value: 'auto' },
        { label: 'Custom duration', value: 'custom' }
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

    // --- Computed ---
    const resolvedWidth = computed(() => {
        switch (resolutionPreset.value) {
            case '1080p': return 1920;
            case '720p': return 1280;
            case '480p': return 854;
            case '4k': return 3840;
            case 'ig-5x4-1080': return 1080;
            case 'ig-5x4-1920': return 1920;
            case '1080p-v': return 1080;
            case '4k-v': return 2160;
            case 'square': return 1080;
            case 'custom': return customWidth.value;
            default: return 1920;
        }
    });

    const resolvedHeight = computed(() => {
        switch (resolutionPreset.value) {
            case '1080p': return 1080;
            case '720p': return 720;
            case '480p': return 480;
            case '4k': return 2160;
            case 'ig-5x4-1080': return 1350;
            case 'ig-5x4-1920': return 2400;
            case '1080p-v': return 1920;
            case '4k-v': return 3840;
            case 'square': return 1080;
            case 'custom': return customHeight.value;
            default: return 1080;
        }
    });

    const seamlessLoopDuration = computed(() => {
        return props.exportInfo?.seamlessLoopDuration ?? 3.0;
    });

    const cinematicAutoDuration = computed(() => {
        return props.exportInfo?.cinematicAutoDuration ?? seamlessLoopDuration.value;
    });

    const cycleDetails = computed(() => {
        return props.exportInfo?.cycleDetails ?? [];
    });

    const logoOverlayLayout = computed(() => {
        return getExportLogoOverlayLayout(resolvedWidth.value, resolvedHeight.value);
    });

    const logoOverlaySummary = computed(() => {
        const { width, height } = logoOverlayLayout.value;
        return `${Math.round(width)}×${Math.round(height)} px · ${Math.round(EXPORT_LOGO_AREA_RATIO * 100)}% frame area`;
    });

    const resolvedDuration = computed(() => {
        if (durationMode.value === 'auto') {
            if (cameraMovement.value === 'cinematic') {
                return cinematicAutoDuration.value;
            }
            return seamlessLoopDuration.value;
        }
        return customDuration.value;
    });

    const durationSummaryLabel = computed(() => {
        if (durationMode.value === 'custom') {
            return `Custom export length overrides the ${formatDuration(seamlessLoopDuration.value)} seamless-loop target.`;
        }
        if (cameraMovement.value === 'cinematic') {
            if (props.exportInfo?.hasROIs) {
                return `Camera path auto-aligns from ${formatDuration(props.exportInfo?.cinematicDuration || 0)} to ${formatDuration(cinematicAutoDuration.value)} for a cleaner seam.`;
            }
            return `No saved cinematic views yet, so auto mode falls back to the ${formatDuration(seamlessLoopDuration.value)} material loop.`;
        }
        if (cameraMovement.value === 'circularTilt') {
            return `One full 360° Mouse Tilt-style artwork rotation over ${formatDuration(resolvedDuration.value)}.`;
        }
        return `Seamless loop — enabled cycles return to start after ${formatDuration(seamlessLoopDuration.value)}.`;
    });

    const loopDetailsSummary = computed(() => {
        if (durationMode.value === 'custom') {
            return `Base seamless loop is ${formatDuration(seamlessLoopDuration.value)}, but the export will run for ${formatDuration(resolvedDuration.value)}. Active cycles may be cut mid-loop.`;
        }

        if (cameraMovement.value === 'cinematic') {
            if (props.exportInfo?.hasROIs) {
                return `The authored camera loop is ${formatDuration(props.exportInfo?.cinematicDuration || 0)}. Auto mode aligns it to ${formatDuration(cinematicAutoDuration.value)} so camera and material cycles land together.`;
            }

            return `No authored camera loop is available, so auto mode uses the ${formatDuration(seamlessLoopDuration.value)} seamless material loop.`;
        }

        if (cameraMovement.value === 'circularTilt') {
            return `Circular Tilt completes exactly one rotation over the selected export duration. In auto mode that is ${formatDuration(resolvedDuration.value)}.`;
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

    watch(aspectRatioPreset, () => {
        const availableValues = resolutionOptions.value.map((option) => option.value);
        if (!availableValues.includes(resolutionPreset.value)) {
            resolutionPreset.value = availableValues[0];
        }
    });

    watch([
        aspectRatioPreset,
        resolutionPreset,
        customWidth,
        customHeight,
        format,
        durationMode,
        customDuration,
        fps,
        cameraMovement,
        quality,
        logoOverlayEnabled,
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
        emit('export', {
            width: resolvedWidth.value,
            height: resolvedHeight.value,
            fps: fps.value,
            format: format.value,
            duration: durationMode.value === 'auto' ? null : resolvedDuration.value,
            cameraMovement: cameraMovement.value,
            quality: quality.value,
            logoOverlayEnabled: logoOverlayEnabled.value,
        });
    }

    function handleDownload() {
        emit('download');
    }

    function handleShare() {
        emit('share');
    }

    function handleCancel() {
        emit('cancel');
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
                        <div class="form-field">
                            <label>Aspect Ratio</label>
                            <Select
                                v-model="aspectRatioPreset"
                                :options="aspectRatioOptions"
                                option-label="label"
                                option-value="value"
                                :disabled="isEncoding"
                                class="w-full"
                            />
                        </div>

                        <div class="form-field">
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
                            <label>Duration</label>
                            <Select
                                v-model="durationMode"
                                :options="durationOptions"
                                option-label="label"
                                option-value="value"
                                :disabled="isEncoding"
                                class="w-full"
                            />
                        </div>

                        <div
                            v-if="durationMode === 'auto'"
                            class="info-box"
                        >
                            <span class="material-symbols-outlined">animation</span>
                            <div>
                                <div class="info-value">{{ resolvedDuration.toFixed(2) }}s</div>
                                <div class="info-label">
                                    {{ durationSummaryLabel }}
                                </div>
                            </div>
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
                                        <div class="loop-summary-label">Seamless Material Loop</div>
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

                        <div
                            v-if="durationMode === 'custom'"
                            class="form-field"
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
                            <div class="field-description">
                                Custom durations are not guaranteed to loop cleanly. Use One full cycle for loopable
                                exports.
                            </div>
                        </div>

                        <div class="form-field">
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

                        <div class="form-field">
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

                        <div class="form-field">
                            <div class="toggle-row">
                                <div class="toggle-text">
                                    <label for="logoOverlayToggle">Logo Overlay</label>
                                    <div class="field-description">
                                        Bottom-right Rivvon logo baked into each frame. {{ logoOverlaySummary }}.
                                    </div>
                                </div>
                                <div class="toggle-control">
                                    <ToggleSwitch
                                        inputId="logoOverlayToggle"
                                        v-model="logoOverlayEnabled"
                                        :disabled="isEncoding"
                                    />
                                    <span class="toggle-copy">{{ logoOverlayEnabled ? 'On' : 'Off' }}</span>
                                </div>
                            </div>

                            <div
                                v-if="logoOverlayEnabled"
                                class="logo-preview-card"
                            >
                                <div class="logo-preview-label">Overlay Preview</div>
                                <div class="logo-preview-frame">
                                    <img
                                        :src="EXPORT_LOGO_SRC"
                                        alt="Rivvon export logo preview"
                                        class="logo-preview-image"
                                        decoding="async"
                                    >
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

                <div class="export-video-panel-footer dialog-footer">
                    <template v-if="isEncoding">
                        <button
                            class="btn btn-secondary"
                            @click="handleCancel"
                        >
                            <span class="material-symbols-outlined">cancel</span>
                            Cancel Encode
                        </button>
                    </template>
                    <template v-else-if="hasEncodedVideo">
                        <button
                            class="btn btn-secondary"
                            @click="handleClose"
                        >
                            Close
                        </button>
                        <button
                            v-if="canShare"
                            class="btn btn-secondary"
                            @click="handleShare"
                        >
                            <span class="material-symbols-outlined">share</span>
                            Share
                        </button>
                        <button
                            class="btn btn-primary"
                            @click="handleDownload"
                        >
                            <span class="material-symbols-outlined">download_done</span>
                            Download
                        </button>
                    </template>
                    <template v-else>
                        <button
                            class="btn btn-secondary"
                            @click="handleClose"
                        >
                            Cancel
                        </button>
                        <button
                            class="btn btn-primary"
                            :disabled="!hasWebCodecs"
                            @click="handleExport"
                        >
                            <span class="material-symbols-outlined">videocam</span>
                            Encode Video
                        </button>
                    </template>
                </div>
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
        max-width: 32rem;
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
        border-top: 1px solid var(--p-content-border-color, rgba(255, 255, 255, 0.1));
        padding-top: 1rem;
    }

    .form-grid {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .form-field {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .form-field label {
        font-size: 0.8rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.6));
    }

    .form-row {
        flex-direction: row;
        align-items: flex-end;
        gap: 0.5rem;
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
    }

    .info-box {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        border-radius: 8px;
        background: rgba(99, 102, 241, 0.12);
        border: 1px solid rgba(99, 102, 241, 0.25);
    }

    .info-box .material-symbols-outlined {
        font-size: 1.5rem;
        color: var(--p-primary-color, #6366f1);
    }

    .info-value {
        font-size: 1.1rem;
        font-weight: 600;
    }

    .info-label {
        font-size: 0.78rem;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.6));
        margin-top: 0.125rem;
    }

    .field-description {
        font-size: 0.78rem;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.5));
        margin-top: 0.375rem;
    }

    .loop-details-accordion {
        width: 100%;
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

    .logo-preview-card {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-top: 0.75rem;
        padding: 0.85rem;
        border-radius: 0.85rem;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .logo-preview-label {
        font-size: 0.7rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.55));
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

    .summary-row {
        display: flex;
        justify-content: space-between;
        padding: 0.75rem 0;
        border-top: 1px solid var(--p-content-border-color, rgba(255, 255, 255, 0.1));
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

    .dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: 0.75rem;
        flex-wrap: wrap;
    }

    .btn {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.625rem 1.25rem;
        border-radius: 8px;
        font-size: 0.9rem;
        font-weight: 500;
        border: none;
        cursor: pointer;
        transition: background 0.15s ease;
    }

    .btn .material-symbols-outlined {
        font-size: 1.1rem;
    }

    .btn-secondary {
        background: var(--p-content-hover-background, rgba(255, 255, 255, 0.08));
        color: var(--p-text-color, #fff);
    }

    .btn-secondary:hover {
        background: rgba(255, 255, 255, 0.15);
    }

    .btn-primary {
        background: var(--p-primary-color, #6366f1);
        color: var(--p-primary-contrast-color, #fff);
    }

    .btn-primary:hover {
        filter: brightness(1.1);
    }

    .btn-primary:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
</style>