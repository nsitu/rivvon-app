<script setup>
    import { computed, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import Select from 'primevue/select';
    import InputNumber from 'primevue/inputnumber';

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

    const aspectRatioOptions = [
        { label: 'Landscape', value: 'landscape', icon: 'panorama' },
        { label: 'Portrait', value: 'portrait', icon: 'person_book' },
        { label: 'Square', value: 'square', icon: 'crop_square' },
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
            case 'custom': return customHeight.value;
            default: return 1080;
        }
    });

    const outputSummary = computed(() => `${resolvedWidth.value} x ${resolvedHeight.value} ${format.value.toUpperCase()}`);

    watch(aspectRatioPreset, () => {
        const availableValues = resolutionOptions.value.map((option) => option.value);
        if (!availableValues.includes(resolutionPreset.value)) {
            resolutionPreset.value = availableValues[0];
        }
    });

    watch([resolvedWidth, resolvedHeight, () => props.visible], ([width, height, visible]) => {
        if (!visible) return;

        emit('recapture-preview', {
            width,
            height,
        });
    });

    function handleDownload() {
        emit('download', {
            width: resolvedWidth.value,
            height: resolvedHeight.value,
            quality: quality.value,
            format: format.value,
        });
    }

    function handleShare() {
        emit('share', {
            width: resolvedWidth.value,
            height: resolvedHeight.value,
            quality: quality.value,
            format: format.value,
        });
    }

    function handleRefreshPreview() {
        emit('recapture-preview', {
            width: resolvedWidth.value,
            height: resolvedHeight.value,
            format: 'png',
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
                    </div>

                    <div class="image-preview-stage">
                        <div class="image-preview-frame">
                            <Button
                                type="button"
                                class="preview-refresh-button"
                                severity="contrast"
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
                        class="export-image-download-button"
                        :disabled="!imageDataUrl"
                        @click="handleDownload"
                    >
                        <span class="material-symbols-outlined">download_done</span>
                        <span>Download Image</span>
                    </Button>
                    <Button
                        v-if="canShare"
                        class="export-image-share-button"
                        :disabled="!imageDataUrl"
                        @click="handleShare"
                    >
                        <span class="material-symbols-outlined">share</span>
                        <span>Share</span>
                    </Button>
                    <Button
                        class="export-image-close-button"
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
        min-height: 2rem;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.62) !important;
        border: 1px solid rgba(255, 255, 255, 0.28) !important;
        color: rgba(255, 255, 255, 0.96) !important;
        backdrop-filter: blur(6px);
        padding: 0 0.65rem !important;
        gap: 0.35rem;
    }

    :deep(.preview-refresh-button:hover) {
        background: rgba(0, 0, 0, 0.78) !important;
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

    :deep(.export-image-download-button),
    :deep(.export-image-share-button),
    :deep(.export-image-close-button) {
        width: 100%;
        min-height: 2.75rem;
        border-radius: 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        font-size: 0.92rem;
        font-weight: 600;
        transition: background 0.2s ease, border-color 0.2s ease;
    }

    :deep(.export-image-download-button) {
        color: #0f172a;
        background: #22c55e !important;
        border: 1px solid transparent !important;
    }

    :deep(.export-image-download-button:hover) {
        background: #16a34a;
    }

    :deep(.export-image-download-button:disabled) {
        opacity: 0.4;
    }

    :deep(.export-image-share-button) {
        color: rgba(255, 255, 255, 0.95);
        border: 1px solid rgba(59, 130, 246, 0.7) !important;
        background: rgba(59, 130, 246, 0.25) !important;
    }

    :deep(.export-image-share-button:hover) {
        background: rgba(59, 130, 246, 0.4) !important;
    }

    :deep(.export-image-share-button:disabled) {
        opacity: 0.4;
    }

    :deep(.export-image-close-button) {
        color: rgba(255, 255, 255, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.18) !important;
        background: rgba(255, 255, 255, 0.08) !important;
    }

    :deep(.export-image-close-button:hover) {
        background: rgba(255, 255, 255, 0.14);
    }

    :deep(.export-image-download-button .material-symbols-outlined),
    :deep(.export-image-share-button .material-symbols-outlined),
    :deep(.export-image-close-button .material-symbols-outlined) {
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
            grid-template-columns: 1fr auto;
        }

        :deep(.export-image-share-button) {
            width: auto;
            padding: 0 1.2rem;
        }

        :deep(.export-image-close-button) {
            width: auto;
            padding: 0 1.2rem;
        }
    }
</style>
