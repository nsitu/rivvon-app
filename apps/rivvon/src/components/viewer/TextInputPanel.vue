<script setup>
    import { computed, onMounted, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import Select from 'primevue/select';
    import Slider from 'primevue/slider';
    import Textarea from 'primevue/textarea';
    import ToggleSwitch from 'primevue/toggleswitch';
    import { useTextToSvg } from '../../composables/viewer/useTextToSvg';

    const props = defineProps({
        visible: {
            type: Boolean,
            default: false
        }
    });

    const emit = defineEmits(['update:visible', 'generate']);

    const textInput = ref('');
    const isMultiline = ref(false);
    const lineHeightPercent = ref(110);
    const {
        fonts,
        selectedFont,
        isLoading,
        error,
        init,
        textToPoints,
        textToSvgMarkup,
        setFont
    } = useTextToSvg();
    const fontPreviewSvgByName = ref({});
    const enteredTextPreviewSvg = ref('');
    const isPreviewLoading = ref(false);
    let textPreviewRequestId = 0;

    const canGenerate = computed(() => textInput.value.trim().length > 0);
    const fontOptions = computed(() => fonts.value.map(fontName => ({
        label: fontName,
        value: fontName,
        previewSvg: fontPreviewSvgByName.value[fontName] || ''
    })));
    const selectedFontModel = computed({
        get: () => selectedFont.value,
        set: (value) => {
            if (value && value !== selectedFont.value) {
                setFont(value);
            }
        }
    });
    const previewHelperText = computed(() => {
        if (isPreviewLoading.value) {
            return 'Rendering preview…';
        }

        if (!selectedFont.value) {
            return 'Choose a font to preview your text.';
        }

        if (!canGenerate.value) {
            return 'Enter text to preview it in the selected font.';
        }

        return isMultiline.value
            ? 'Preview reflects the selected font, multiline layout, and line height.'
            : 'Preview reflects the selected font.';
    });

    function collapseLineBreaks(value) {
        return String(value ?? '')
            .replace(/\r\n?/g, '\n')
            .replace(/\n+/g, ' ');
    }

    function getFontOption(fontName) {
        return fontOptions.value.find(option => option.value === fontName) || null;
    }

    async function buildFontPreviews() {
        const nextPreviewMap = {};

        for (const fontName of fonts.value) {
            try {
                const previewSvg = await textToSvgMarkup(fontName, {
                    font: fontName,
                    strokeColor: '#f8fafc',
                    strokeWidth: 1.15,
                    padding: 14,
                });

                if (previewSvg) {
                    nextPreviewMap[fontName] = previewSvg;
                }
            } catch (previewError) {
                console.warn('[TextInputPanel] Font preview generation failed:', fontName, previewError);
            }
        }

        fontPreviewSvgByName.value = nextPreviewMap;

        if (selectedFont.value) {
            await setFont(selectedFont.value);
        }
    }

    async function updateEnteredTextPreview() {
        const requestId = ++textPreviewRequestId;

        if (!canGenerate.value || !selectedFont.value) {
            enteredTextPreviewSvg.value = '';
            isPreviewLoading.value = false;
            return;
        }

        isPreviewLoading.value = true;

        try {
            const previewSvg = await textToSvgMarkup(textInput.value, {
                font: selectedFont.value,
                multiline: isMultiline.value,
                lineHeight: lineHeightPercent.value / 100,
                strokeColor: '#f8fafc',
                strokeWidth: 1.1,
                padding: 18,
            });

            if (requestId === textPreviewRequestId) {
                enteredTextPreviewSvg.value = previewSvg || '';
            }
        } catch (previewError) {
            console.warn('[TextInputPanel] Text preview generation failed:', previewError);
            if (requestId === textPreviewRequestId) {
                enteredTextPreviewSvg.value = '';
            }
        } finally {
            if (requestId === textPreviewRequestId) {
                isPreviewLoading.value = false;
            }
        }
    }

    watch(isMultiline, (multiline, previousValue) => {
        if (!multiline && previousValue) {
            textInput.value = collapseLineBreaks(textInput.value);
        }
    });

    watch(
        [textInput, selectedFont, isMultiline, lineHeightPercent],
        () => {
            updateEnteredTextPreview();
        }
    );

    onMounted(async () => {
        await init();
        await buildFontPreviews();
        await updateEnteredTextPreview();
    });

    function close() {
        emit('update:visible', false);
    }

    async function generate() {
        if (!canGenerate.value) {
            return;
        }

        try {
            const sourceText = textInput.value;
            const selectedLineHeight = lineHeightPercent.value / 100;
            const points = await textToPoints(textInput.value, {
                multiline: isMultiline.value,
                lineHeight: selectedLineHeight
            });
            emit('generate', {
                points,
                source: {
                    text: sourceText,
                    font: selectedFont.value,
                    multiline: isMultiline.value,
                    lineHeight: selectedLineHeight,
                }
            });
            close();
        } catch (e) {
            console.error('[TextInputPanel] Generation failed:', e);
        }
    }

    function handleTextareaKeydown(event) {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            generate();
        }
    }
</script>

<template>
    <div
        class="text-input-panel"
        :class="{ active: visible }"
    >
        <div class="text-input-container">
            <div class="text-input-content">

                <div class="text-form">
                    <div class="form-group">
                        <div class="toggle-row">
                            <label for="multilineToggle">Multiline layout</label>
                            <div class="toggle-control">
                                <ToggleSwitch
                                    inputId="multilineToggle"
                                    v-model="isMultiline"
                                />
                                <span class="toggle-copy">{{ isMultiline ? 'On' : 'Off' }}</span>
                            </div>
                        </div>
                    </div>

                    <div class="form-group">
                        <div class="field-label-row">
                            <label for="textInputField">Enter text:</label>
                            <span class="field-mode">{{ isMultiline ? 'Multiline' : 'Single line' }}</span>
                        </div>
                        <input
                            v-if="!isMultiline"
                            id="textInputField"
                            v-model="textInput"
                            type="text"
                            placeholder="Type your text here..."
                            class="text-field"
                            @keyup.enter="generate"
                        />
                        <Textarea
                            v-else
                            id="textInputField"
                            v-model="textInput"
                            rows="5"
                            cols="30"
                            autoResize
                            placeholder="Type multiple lines here..."
                            class="text-field text-area-field"
                            @keydown="handleTextareaKeydown"
                        />
                        <p class="input-hint">
                            {{ isMultiline ?
                                'Line breaks are preserved. Use Ctrl+Enter or Cmd+Enter to generate.' :
                                'Press Enter to generate.'
                            }}
                        </p>
                    </div>

                    <div
                        v-if="isMultiline"
                        class="form-group"
                    >
                        <div class="field-label-row">
                            <label for="lineHeightSlider">Line height</label>
                            <span class="field-mode">{{ lineHeightPercent }}%</span>
                        </div>
                        <Slider
                            id="lineHeightSlider"
                            v-model="lineHeightPercent"
                            :min="30"
                            :max="160"
                            :step="5"
                            class="line-height-slider"
                        />
                        <p class="input-hint">100% uses the font's base line height.</p>
                    </div>

                    <div class="form-group">
                        <label for="fontSelector">Font:</label>
                        <Select
                            inputId="fontSelector"
                            v-model="selectedFontModel"
                            :options="fontOptions"
                            optionLabel="label"
                            optionValue="value"
                            :disabled="isLoading || fonts.length === 0"
                            class="font-select"
                        >
                            <template #value="slotProps">
                                <div
                                    v-if="slotProps.value"
                                    class="font-select-value"
                                >
                                    <div
                                        v-if="getFontOption(slotProps.value)?.previewSvg"
                                        class="font-select-preview font-select-preview--compact"
                                        v-html="getFontOption(slotProps.value)?.previewSvg"
                                    />
                                    <span class="font-select-name">{{ getFontOption(slotProps.value)?.label }}</span>
                                </div>
                                <span v-else>{{ isLoading ? 'Loading fonts…' : 'Choose a font' }}</span>
                            </template>
                            <template #option="slotProps">
                                <div class="font-select-option">
                                    <div
                                        v-if="slotProps.option.previewSvg"
                                        class="font-select-preview"
                                        v-html="slotProps.option.previewSvg"
                                    />
                                    <span class="font-select-name">{{ slotProps.option.label }}</span>
                                </div>
                            </template>
                        </Select>
                        <p class="input-hint">Each option previews the font name rendered as SVG with that font.</p>
                    </div>

                    <div class="form-group">
                        <div class="field-label-row">
                            <label>Live preview</label>
                            <span class="field-mode">{{ selectedFont || 'No font selected' }}</span>
                        </div>
                        <div
                            class="text-preview-card"
                            :class="{ empty: !enteredTextPreviewSvg }"
                        >
                            <div
                                v-if="enteredTextPreviewSvg"
                                class="text-preview-svg"
                                v-html="enteredTextPreviewSvg"
                            />
                            <p
                                v-else
                                class="text-preview-placeholder"
                            >{{ previewHelperText }}</p>
                        </div>
                        <p class="input-hint">{{ previewHelperText }}</p>
                    </div>

                    <Button
                        type="button"
                        class="text-submit-btn"
                        size="large"
                        :disabled="!canGenerate || isLoading"
                        @click="generate"
                    >
                        <span class="material-symbols-outlined">check</span>
                        Go
                    </Button>

                    <p
                        v-if="error"
                        class="error-message"
                    >{{ error }}</p>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .text-input-panel {
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

    .text-input-panel.active {
        pointer-events: auto;
        opacity: 1;
    }

    .text-input-container {
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

    .text-input-content {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        width: 100%;
        max-width: 500px;
        margin: 0 auto;
    }

    .text-form {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    .form-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .form-group label {
        color: #d1d5db;
        font-size: 0.875rem;
    }

    .field-label-row,
    .toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
    }

    .field-mode,
    .toggle-copy,
    .input-hint {
        color: #9ca3af;
        font-size: 0.8125rem;
    }

    .toggle-control {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .line-height-slider {
        margin: 0.5rem 0 0.25rem;
    }

    .text-field {
        width: 100%;
        padding: 0.75rem 1rem;
        border-radius: 6px;
        background: #252525;
        color: white;
        border: 1px solid #374151;
        font-size: 1rem;
    }

    .text-area-field {
        min-height: 7.5rem;
        resize: vertical;
    }

    .text-field:focus {
        outline: none;
        border-color: #4caf50;
    }

    .font-select {
        width: 100%;
    }

    .font-select:deep(.p-select-label) {
        padding: 0.5rem 0.75rem;
        min-height: 5.75rem;
        background: #252525;
        color: white;
        border: 1px solid #374151;
        border-right: 0;
        border-radius: 6px 0 0 6px;
        display: flex;
        align-items: center;
    }

    .font-select:deep(.p-select-dropdown) {
        background: #252525;
        color: white;
        border: 1px solid #374151;
        border-left: 0;
        border-radius: 0 6px 6px 0;
    }

    .font-select:deep(.p-select-label.p-placeholder) {
        color: #9ca3af;
    }

    .font-select:deep(.p-select-overlay) {
        background: #18181b;
        border: 1px solid #374151;
        color: white;
    }

    .font-select:deep(.p-select-option) {
        padding: 0.5rem 0.75rem;
    }

    .font-select:deep(.p-select-option:not(.p-select-option-selected):hover) {
        background: rgba(76, 175, 80, 0.12);
    }

    .font-select:deep(.p-select-option.p-select-option-selected) {
        background: rgba(76, 175, 80, 0.18);
        color: white;
    }

    .font-select-value,
    .font-select-option {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        width: 100%;
    }

    .font-select-preview,
    .text-preview-card {
        width: 100%;
        padding: 0.75rem 0.875rem;
        border-radius: 10px;
        border: 1px solid #374151;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.01));
        overflow: hidden;
    }

    .font-select-preview--compact {
        padding: 0.5rem 0.75rem;
        min-height: 3rem;
    }

    .font-select-name {
        color: #d1d5db;
        font-size: 0.875rem;
        line-height: 1.3;
    }

    .font-select-preview :deep(svg),
    .text-preview-svg :deep(svg) {
        display: block;
        width: 100%;
        height: auto;
        max-height: 8rem;
    }

    .text-preview-card {
        min-height: 8rem;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .text-preview-card.empty {
        border-style: dashed;
    }

    .text-preview-svg {
        width: 100%;
    }

    .text-preview-svg :deep(svg) {
        max-height: 12rem;
    }

    .text-preview-placeholder {
        margin: 0;
        color: #9ca3af;
        font-size: 0.875rem;
        text-align: center;
        line-height: 1.5;
    }

    .text-submit-btn {
        gap: 0.5rem;
        justify-content: center;
        min-height: 48px;
        font-size: 1rem;
        font-weight: 500;
        margin-top: 0.5rem;
    }

    .text-submit-btn:disabled {
        opacity: 0.5;
    }

    .text-submit-btn .material-symbols-outlined {
        font-size: 1.25rem;
    }

    .error-message {
        color: #f87171;
        font-size: 0.875rem;
        margin: 0;
    }
</style>
