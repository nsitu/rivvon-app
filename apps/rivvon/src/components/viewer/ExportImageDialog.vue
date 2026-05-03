<script setup>
    import { computed, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import Select from 'primevue/select';
    import InputNumber from 'primevue/inputnumber';
    import ToggleSwitch from 'primevue/toggleswitch';
    import { EXPORT_LOGO_AREA_RATIO, getExportLogoOverlayLayout } from '../../modules/viewer/exportLogoOverlay';

    const props = defineProps({
        visible: { type: Boolean, default: false },
        imageDataUrl: { type: String, default: '' },
        filename: { type: String, default: 'rivvon-export.png' },
        imageWidth: { type: Number, default: 0 },
        imageHeight: { type: Number, default: 0 },
        canShare: { type: Boolean, default: false },
    });

    const emit = defineEmits(['update:visible', 'download', 'share', 'recapture-preview']);

    function handleClose() {
        emit('update:visible', false);
    }

    const aspectRatioPreset = ref('landscape');
    const resolutionPreset = ref('1080p');
    const customWidth = ref(1920);
    const customHeight = ref(1080);
    const quality = ref('high');
    const format = ref('png');
    const logoOverlayEnabled = ref(true);

    const aspectRatioOptions = [
        { label: 'Landscape', value: 'landscape', icon: 'panorama' },
        { label: 'Portrait', value: 'portrait', icon: 'person_book' },
        { label: 'Square', value: 'square', icon: 'crop_square' },
        { label: 'Instagram 5:4', value: 'instagram-5x4', icon: 'crop_5_4' },
        { label: 'Custom', value: 'custom', icon: 'crop_free' },
    ];

    const resolutionOptionsByAspect = {
        landscape: [
            { label: '1280 x 720', value: '720p' },
            { label: '1920 x 1080', value: '1080p' },
            { label: '3840 x 2160', value: '4k' }
        ],
        portrait: [
            { label: '1080 x 1920', value: '1080p-v' },
            { label: '2160 x 3840', value: '4k-v' },
        ],
        square: [
            { label: '1080 x 1080', value: 'square' },
            { label: '1920 x 1920', value: 'square-1920' },
            { label: '2160 x 2160', value: 'square-2160' },
            { label: '3840 x 3840', value: 'square-3840' },
        ],
        'instagram-5x4': [
            { label: '1080 x 1350', value: 'ig-5x4-1080' },
            { label: '1920 x 2400', value: 'ig-5x4-1920' },
        ],
        custom: [
            { label: 'Custom Dimensions', value: 'custom' },
        ],
    };

    const resolutionOptions = computed(() => (
        resolutionOptionsByAspect[aspectRatioPreset.value] || resolutionOptionsByAspect.landscape
    ));

    const qualityOptions = [
        { label: 'Very Low', value: 'very-low' },
        { label: 'Low', value: 'low' },
        { label: 'Medium', value: 'medium' },
        { label: 'High', value: 'high' },
        { label: 'Very High', value: 'very-high' },
    ];

    const formatOptions = [
        { label: 'PNG', value: 'png' },
        { label: 'JPEG', value: 'jpeg' },
        { label: 'WebP', value: 'webp' },
    ];

    const resolvedWidth = computed(() => {
        switch (resolutionPreset.value) {
            case '1080p': return 1920;
            case '720p': return 1280;
            case '4k': return 3840;
            case '1080p-v': return 1080;
            case 'square': return 1080;
            case '4k-v': return 2160;
            case 'square-1920': return 1920;
            case 'square-2160': return 2160;
            case 'square-3840': return 3840;
            case 'ig-5x4-1080': return 1080;
            case 'ig-5x4-1920': return 1920;
            case 'custom': return customWidth.value;
            default: return 1920;
        }
    });

    const resolvedHeight = computed(() => {
        switch (resolutionPreset.value) {
            case '1080p': return 1080;
            case '720p': return 720;
            case '4k': return 2160;
            case '1080p-v': return 1920;
            case 'square': return 1080;
            case '4k-v': return 3840;
            case 'square-1920': return 1920;
            case 'square-2160': return 2160;
            case 'square-3840': return 3840;
            case 'ig-5x4-1080': return 1350;
            case 'ig-5x4-1920': return 2400;
            case 'custom': return customHeight.value;
            default: return 1080;
        }
    });

    const outputSummary = computed(() => `${resolvedWidth.value} x ${resolvedHeight.value} ${format.value.toUpperCase()}`);

    const isTouchDevice = computed(() => {
        if (typeof window === 'undefined') return false;
        return window.matchMedia('(pointer: coarse)').matches;
    });

    const tip = (text) => isTouchDevice.value ? null : text;

    const logoOverlayLayout = computed(() => {
        return getExportLogoOverlayLayout(resolvedWidth.value, resolvedHeight.value);
    });

    const logoOverlaySummary = computed(() => {
        const { width, height } = logoOverlayLayout.value;
        return `${Math.round(width)}x${Math.round(height)} px · ${Math.round(EXPORT_LOGO_AREA_RATIO * 100)}% frame area`;
    });

    const logoOverlayTooltip = computed(() => (
        `Bottom-right Rivvon logo baked into the exported image. ${logoOverlaySummary.value}.`
    ));

    watch(aspectRatioPreset, () => {
        const availableValues = resolutionOptions.value.map((option) => option.value);
        if (!availableValues.includes(resolutionPreset.value)) {
            resolutionPreset.value = availableValues[0];
        }
    });

    watch([resolvedWidth, resolvedHeight, logoOverlayEnabled, () => props.visible], ([width, height, overlayEnabled, visible]) => {
        if (!visible) return;

        emit('recapture-preview', {
            width,
            height,
            logoOverlayEnabled: overlayEnabled,
        });
    });

    function handleDownload() {
        emit('download', {
            width: resolvedWidth.value,
            height: resolvedHeight.value,
            quality: quality.value,
            format: format.value,
            logoOverlayEnabled: logoOverlayEnabled.value,
        });
    }

    function handleShare() {
        emit('share', {
            width: resolvedWidth.value,
            height: resolvedHeight.value,
            quality: quality.value,
            format: format.value,
            logoOverlayEnabled: logoOverlayEnabled.value,
        });
    }

    function handleRefreshPreview() {
        emit('recapture-preview', {
            width: resolvedWidth.value,
            height: resolvedHeight.value,
            format: 'png',
            logoOverlayEnabled: logoOverlayEnabled.value,
        });
    }
</script>

<template>
    <div
        class="export-image-panel"
        :class="{ active: visible }"
        role="dialog"
        aria-modal="true"
        aria-label="Export Image"
    >
        <div class="export-image-panel-container">
            <div class="export-image-panel-content">
                <div class="export-image-panel-body">
                    <div class="form-grid">
                        <div class="form-field">
                            <label>Format</label>
                            <Select
                                v-model="format"
                                :options="formatOptions"
                                option-label="label"
                                option-value="value"
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
                                    :max="8192"
                                    :step="2"
                                    class="w-full"
                                />
                            </div>
                            <span class="dimension-x">x</span>
                            <div class="flex-1">
                                <label>Height</label>
                                <InputNumber
                                    v-model="customHeight"
                                    :min="240"
                                    :max="8192"
                                    :step="2"
                                    class="w-full"
                                />
                            </div>
                        </div>

                        <div
                            v-if="format !== 'png'"
                            class="form-field"
                        >
                            <label>Quality</label>
                            <Select
                                v-model="quality"
                                :options="qualityOptions"
                                option-label="label"
                                option-value="value"
                                class="w-full"
                            />
                        </div>

                        <div class="form-field toggle-field">
                            <div class="toggle-label-row">
                                <label for="imageLogoOverlayToggle">Logo Overlay</label>
                                <button
                                    type="button"
                                    class="tooltip-icon-button"
                                    :aria-label="logoOverlayTooltip"
                                    v-tooltip.bottom="tip(logoOverlayTooltip)"
                                >
                                    <span class="material-symbols-outlined">info</span>
                                </button>
                            </div>
                            <div class="toggle-control">
                                <ToggleSwitch
                                    inputId="imageLogoOverlayToggle"
                                    v-model="logoOverlayEnabled"
                                />
                                <span class="toggle-copy">{{ logoOverlayEnabled ? 'On' : 'Off' }}</span>
                            </div>
                        </div>
                    </div>

                    <div class="image-preview-stage">
                        <div class="image-preview-frame">
                            <Button
                                type="button"
                                class="preview-refresh-button"
                                variant="outlined"
                                @click="handleRefreshPreview"
                            >
                                <span class="material-symbols-outlined">restart_alt</span>
                                <span>Refresh</span>
                            </Button>

                            <img
                                v-if="imageDataUrl"
                                :src="imageDataUrl"
                                alt="Export preview"
                                class="image-preview"
                            />
                            <div
                                v-else
                                class="image-preview-empty"
                            >
                                Preview unavailable
                            </div>
                        </div>
                    </div>

                    <div class="image-meta-row">
                        <span class="image-meta-label">{{ filename }}</span>
                        <span class="image-meta-value">
                            {{ outputSummary }}
                        </span>
                    </div>
                </div>

                <div class="export-image-panel-footer">
                    <Button
                        severity="success"
                        :disabled="!imageDataUrl"
                        @click="handleDownload"
                    >
                        <span class="material-symbols-outlined">download_done</span>
                        <span>Download Image</span>
                    </Button>
                    <Button
                        v-if="canShare"
                        severity="info"
                        variant="outlined"
                        :disabled="!imageDataUrl"
                        @click="handleShare"
                    >
                        <span class="material-symbols-outlined">share</span>
                        <span>Share</span>
                    </Button>
                    <Button
                        severity="secondary"
                        variant="outlined"
                        @click="handleClose"
                    >
                        <span class="material-symbols-outlined">close</span>
                        <span>Close</span>
                    </Button>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .export-image-panel {
        position: absolute;
        inset: 0;
        z-index: 5;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease;
        display: flex;
        flex-direction: column;
        --viewer-header-chrome-height: 5.5rem;
        --viewer-bottom-chrome-height: 6.4rem;
    }

    .export-image-panel.active {
        pointer-events: auto;
        opacity: 1;
    }

    .export-image-panel-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        padding-top: var(--viewer-header-chrome-height);
        padding-bottom: var(--viewer-bottom-chrome-height);
        background: transparent;
    }

    .export-image-panel-content {
        display: flex;
        flex: 1;
        flex-direction: column;
        background: rgba(0, 0, 0, 0.72);
        overflow: hidden;
    }

    .export-image-panel-body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 1rem 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 0.8rem;
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
        flex: 1 1 10rem;
        min-width: 10rem;
        gap: 0.35rem;
    }

    .form-field label {
        font-size: 0.78rem;
        color: rgba(255, 255, 255, 0.8);
    }

    .form-row {
        display: flex;
        flex-direction: row;
        align-items: flex-end;
        gap: 0.6rem;
        flex: 2 1 18rem;
        min-width: 18rem;
    }

    .flex-1 {
        flex: 1;
        min-width: 0;
        overflow: hidden;
    }

    .flex-1 :deep(.p-inputnumber),
    .flex-1 :deep(.p-inputnumber-input) {
        width: 100%;
        min-width: 0;
    }

    .dimension-x {
        color: rgba(255, 255, 255, 0.55);
        font-size: 0.9rem;
        line-height: 1;
        padding-bottom: 0.45rem;
    }

    .aspect-ratio-option {
        display: flex;
        align-items: center;
        gap: 0.45rem;
    }

    .aspect-ratio-option .material-symbols-outlined {
        font-size: 1.1rem;
        line-height: 1;
        flex-shrink: 0;
    }

    .field-hint {
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.55);
        line-height: 1.35;
    }

    .toggle-field {
        align-items: flex-start;
    }

    .toggle-label-row {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
    }

    .tooltip-icon-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.35rem;
        height: 1.35rem;
        padding: 0;
        border: none;
        border-radius: 999px;
        background: transparent;
        color: rgba(255, 255, 255, 0.55);
        cursor: help;
    }

    .tooltip-icon-button:hover {
        color: rgba(255, 255, 255, 0.8);
        background: rgba(255, 255, 255, 0.08);
    }

    .tooltip-icon-button .material-symbols-outlined {
        font-size: 1rem;
        line-height: 1;
    }

    .toggle-control {
        display: flex;
        align-items: center;
        gap: 0.625rem;
    }

    .toggle-copy {
        min-width: 1.8rem;
        font-size: 0.78rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.6);
        text-align: right;
    }

    .image-preview-stage {
        flex: 0 0 auto;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        max-height: 50vh;
        overflow: auto;
    }

    .image-preview-frame {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        position: relative;
        width: fit-content;
        max-width: 100%;
        max-height: 50vh;
        min-height: 0;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(0, 0, 0, 0.2);
        overflow: hidden;
    }

    :deep(.preview-refresh-button) {
        position: absolute;
        top: 0.6rem;
        right: 0.6rem;
        z-index: 2;
        min-height: 2.1rem;
    }

    :deep(.preview-refresh-button .material-symbols-outlined) {
        font-size: 1rem;
    }

    .image-preview {
        width: auto;
        height: auto;
        max-width: 100%;
        max-height: 50vh;
        display: block;
        object-fit: contain;
    }

    .image-preview-empty {
        color: rgba(255, 255, 255, 0.7);
        font-size: 0.9rem;
    }

    .image-meta-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
        font-size: 0.85rem;
    }

    .image-meta-label {
        color: rgba(255, 255, 255, 0.9);
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .image-meta-value {
        color: rgba(255, 255, 255, 0.65);
        font-family: monospace;
        font-size: 0.78rem;
        white-space: nowrap;
    }

    .export-image-panel-footer {
        padding: 1rem 1.25rem;
        border-top: 1px solid rgba(255, 255, 255, 0.14);
        display: grid;
        gap: 0.65rem;
        grid-template-columns: 1fr;
    }

    .export-image-panel-footer :deep(.p-button) {
        width: 100%;
        min-height: 2.75rem;
    }

    .export-image-panel-footer :deep(.material-symbols-outlined) {
        font-size: 1.2rem;
    }

    @media (min-width: 769px) {

        .export-image-panel-body,
        .export-image-panel-footer {
            max-width: 54rem;
            width: 100%;
            margin: 0 auto;
        }

        .export-image-panel-footer {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }
    }
</style>
