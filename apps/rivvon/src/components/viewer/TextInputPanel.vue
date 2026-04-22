<script setup>
    import { computed, onMounted, ref, watch } from 'vue';
    import Button from 'primevue/button';
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
        setFont
    } = useTextToSvg();

    const canGenerate = computed(() => textInput.value.trim().length > 0);

    function collapseLineBreaks(value) {
        return String(value ?? '')
            .replace(/\r\n?/g, '\n')
            .replace(/\n+/g, ' ');
    }

    watch(isMultiline, (multiline, previousValue) => {
        if (!multiline && previousValue) {
            textInput.value = collapseLineBreaks(textInput.value);
        }
    });

    onMounted(async () => {
        await init();
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

    function handleFontChange(event) {
        setFont(event.target.value);
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
                        <select
                            id="fontSelector"
                            :value="selectedFont"
                            :disabled="isLoading || fonts.length === 0"
                            class="font-select"
                            @change="handleFontChange"
                        >
                            <option
                                v-if="isLoading"
                                value=""
                            >Loading fonts...</option>
                            <option
                                v-for="font in fonts"
                                :key="font"
                                :value="font"
                            >
                                {{ font }}
                            </option>
                        </select>
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

    .text-field,
    .font-select {
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

    .text-field:focus,
    .font-select:focus {
        outline: none;
        border-color: #4caf50;
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
