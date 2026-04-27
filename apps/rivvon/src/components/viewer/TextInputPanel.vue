<script setup>
    import { computed, onMounted, ref, watch } from 'vue';
    import Accordion from 'primevue/accordion';
    import AccordionContent from 'primevue/accordioncontent';
    import AccordionHeader from 'primevue/accordionheader';
    import AccordionPanel from 'primevue/accordionpanel';
    import Button from 'primevue/button';
    import RadioButton from 'primevue/radiobutton';
    import Slider from 'primevue/slider';
    import Textarea from 'primevue/textarea';
    import ToggleSwitch from 'primevue/toggleswitch';
    import { useTextToSvg } from '../../composables/viewer/useTextToSvg';

    defineProps({
        visible: {
            type: Boolean,
            default: false
        }
    });

    const emit = defineEmits(['update:visible', 'generate']);

    const FONT_OPTION_PREVIEW_STROKE_WIDTH = 2;
    const LIVE_TEXT_PREVIEW_STROKE_WIDTH = 2;

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
    const fontOptions = computed(() => fonts.value.map(font => ({
        fontName: font.fontName,
        value: font.id,
        previewSvg: fontPreviewSvgByName.value[font.id] || ''
    })));
    const selectedFontModel = computed({
        get: () => selectedFont.value,
        set: (value) => {
            if (value && value !== selectedFont.value) {
                setFont(value);
            }
        }
    });
    const selectedFontMeta = computed(() => fonts.value.find(font => font.id === selectedFont.value) || null);
    const selectedFontName = computed(() => selectedFontMeta.value?.fontName || 'No font selected');
    const selectedFontAboutRows = computed(() => {
        const font = selectedFontMeta.value;
        if (!font) {
            return [];
        }

        return [
            { label: 'Name', value: font.fontName },
            { label: 'ID', value: font.id },
            { label: 'File', value: font.fileName },
            { label: 'Format', value: formatFontFormat(font.format) },
            font.creator ? { label: 'Creator', value: font.creator } : null,
            font.foundry ? { label: 'Foundry', value: font.foundry } : null,
            font.license ? { label: 'License', value: font.license } : null,
            { label: 'Derived work', value: font.isDerived ? 'Yes' : 'No' },
            font.url ? { label: 'Source', value: font.url, href: font.url } : null,
        ].filter(Boolean);
    });
    const selectedFontOriginRows = computed(() => {
        const basedOn = selectedFontMeta.value?.basedOn;
        if (!basedOn) {
            return [];
        }

        return [
            basedOn.fontName ? { label: 'Name', value: basedOn.fontName } : null,
            basedOn.creator ? { label: 'Creator', value: basedOn.creator } : null,
            basedOn.foundry ? { label: 'Foundry', value: basedOn.foundry } : null,
            basedOn.license ? { label: 'License', value: basedOn.license } : null,
            basedOn.url ? { label: 'Source', value: basedOn.url, href: basedOn.url } : null,
        ].filter(Boolean);
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

    function formatFontFormat(format) {
        if (format === 'opentype') {
            return 'OpenType (OTF-SVG)';
        }

        if (format === 'svg-font') {
            return 'SVG font';
        }

        return format || 'Unknown';
    }

    async function buildFontPreviews() {
        const nextPreviewMap = {};

        for (const font of fonts.value) {
            try {
                const previewSvg = await textToSvgMarkup(font.fontName, {
                    font: font.id,
                    strokeColor: '#f8fafc',
                    strokeWidth: FONT_OPTION_PREVIEW_STROKE_WIDTH,
                    padding: 14,
                });

                if (previewSvg) {
                    nextPreviewMap[font.id] = previewSvg;
                }
            } catch (previewError) {
                console.warn('[TextInputPanel] Font preview generation failed:', font.id, previewError);
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
                strokeWidth: LIVE_TEXT_PREVIEW_STROKE_WIDTH,
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
            <div class="text-input-panel-content">
                <div class="text-input-panel-body">
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
                                <label>Live preview</label>
                                <span class="field-mode">{{ selectedFontName }}</span>
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
                            <label>Font:</label>
                            <div
                                class="font-radio-list"
                                role="radiogroup"
                                aria-label="Font"
                            >
                                <label
                                    v-for="option in fontOptions"
                                    :key="option.value"
                                    class="font-radio-option"
                                    :class="{
                                        'font-radio-option--selected': selectedFont === option.value,
                                        'font-radio-option--disabled': isLoading || fonts.length === 0,
                                    }"
                                >
                                    <RadioButton
                                        v-model="selectedFontModel"
                                        name="fontSelector"
                                        :inputId="`fontSelector-${option.value}`"
                                        :value="option.value"
                                        :disabled="isLoading || fonts.length === 0"
                                        class="font-radio-control"
                                    />
                                    <div
                                        v-if="option.previewSvg"
                                        class="font-select-preview font-select-preview--compact font-select-preview--radio"
                                        v-html="option.previewSvg"
                                    />
                                    <span
                                        v-else
                                        class="font-select-name"
                                    >{{ option.fontName }}</span>
                                </label>
                            </div>
                            <p class="input-hint">Each option previews only the font name. Open About for file,
                                attribution, and source details.</p>
                        </div>

                        <div class="form-group">
                            <Accordion class="font-about-accordion">
                                <AccordionPanel value="0">
                                    <AccordionHeader>
                                        <span class="accordion-header-text">
                                            <span class="material-symbols-outlined">info</span>
                                            About
                                        </span>
                                    </AccordionHeader>
                                    <AccordionContent>
                                        <div
                                            v-if="selectedFontMeta"
                                            class="font-about-stack"
                                        >
                                            <div class="font-about-grid">
                                                <div
                                                    v-for="item in selectedFontAboutRows"
                                                    :key="item.label"
                                                    class="font-about-row"
                                                >
                                                    <span class="font-about-label">{{ item.label }}</span>
                                                    <a
                                                        v-if="item.href"
                                                        :href="item.href"
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        class="font-about-value font-about-link"
                                                    >{{ item.value }}</a>
                                                    <span
                                                        v-else
                                                        class="font-about-value"
                                                    >{{ item.value }}</span>
                                                </div>
                                            </div>

                                            <div
                                                v-if="selectedFontOriginRows.length"
                                                class="font-about-subsection"
                                            >
                                                <div class="font-about-subtitle">Based on</div>
                                                <div class="font-about-grid">
                                                    <div
                                                        v-for="item in selectedFontOriginRows"
                                                        :key="`based-on-${item.label}`"
                                                        class="font-about-row"
                                                    >
                                                        <span class="font-about-label">{{ item.label }}</span>
                                                        <a
                                                            v-if="item.href"
                                                            :href="item.href"
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            class="font-about-value font-about-link"
                                                        >{{ item.value }}</a>
                                                        <span
                                                            v-else
                                                            class="font-about-value"
                                                        >{{ item.value }}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <p
                                            v-else
                                            class="font-about-empty"
                                        >Select a font to view its indexed details.</p>
                                    </AccordionContent>
                                </AccordionPanel>
                            </Accordion>
                        </div>

                    </div>
                </div>

                <div class="text-input-panel-footer">
                    <p
                        v-if="error"
                        class="error-message"
                    >{{ error }}</p>

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

    .text-input-panel-content {
        flex: 1;
        width: 100%;
        max-width: 500px;
        margin: 0 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        padding: 20px;
        gap: 1rem;
    }

    .text-input-panel-body {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        min-height: 0;
    }

    .text-form {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    .text-input-panel-footer {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        border-top: 1px solid #374151;
        padding-top: 1rem;
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

    .font-radio-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        width: 100%;
    }

    .font-radio-option {
        display: flex;
        align-items: center;
        gap: 0.875rem;
        width: 100%;
        padding: 0.75rem;
        border: 1px solid #374151;
        border-radius: 12px;
        background: #252525;
        cursor: pointer;
        transition: border-color 0.2s ease, background-color 0.2s ease;
    }

    .font-radio-option:hover {
        border-color: rgba(76, 175, 80, 0.38);
        background: rgba(76, 175, 80, 0.08);
    }

    .font-radio-option--selected {
        border-color: rgba(76, 175, 80, 0.7);
        background: rgba(76, 175, 80, 0.12);
    }

    .font-radio-option--disabled {
        opacity: 0.6;
        cursor: default;
    }

    .font-radio-option--disabled:hover {
        border-color: #374151;
        background: #252525;
    }

    .font-radio-control {
        flex-shrink: 0;
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

    .font-select-preview--radio {
        flex: 1;
        min-width: 0;
    }

    .font-select-name {
        color: #d1d5db;
        font-size: 0.875rem;
        line-height: 1.3;
    }

    .accordion-header-text {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
    }

    .font-about-stack {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .font-about-grid {
        display: grid;
        gap: 0.75rem;
    }

    .font-about-row {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .font-about-label,
    .font-about-subtitle {
        color: #9ca3af;
        font-size: 0.75rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
    }

    .font-about-value {
        color: #e5e7eb;
        font-size: 0.875rem;
        line-height: 1.5;
        word-break: break-word;
    }

    .font-about-link {
        text-decoration: underline;
        text-decoration-color: rgba(229, 231, 235, 0.35);
        text-underline-offset: 0.18em;
    }

    .font-about-link:hover {
        text-decoration-color: currentColor;
    }

    .font-about-subsection {
        padding-top: 1rem;
        border: 1px solid #374151;
        border-width: 1px 0 0;
    }

    .font-about-empty {
        margin: 0;
        color: #9ca3af;
        font-size: 0.875rem;
        line-height: 1.5;
    }

    .font-select-preview :deep(svg),
    .text-preview-svg :deep(svg) {
        display: block;
        max-height: 3rem;
        width: auto;
        max-width: 100%;
        height: auto;
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
