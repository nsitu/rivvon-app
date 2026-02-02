<script setup>
    import { ref, watch, onMounted } from 'vue';
    import { useTextToSvg } from '../../composables/viewer/useTextToSvg';

    const props = defineProps({
        visible: {
            type: Boolean,
            default: false
        }
    });

    const emit = defineEmits(['update:visible', 'generate']);

    const textInput = ref('');
    const {
        fonts,
        selectedFont,
        isLoading,
        error,
        init,
        textToPoints,
        setFont
    } = useTextToSvg();

    onMounted(async () => {
        await init();
    });

    function close() {
        emit('update:visible', false);
    }

    async function generate() {
        if (!textInput.value.trim()) {
            return;
        }

        try {
            const points = await textToPoints(textInput.value);
            emit('generate', points);
            close();
        } catch (e) {
            console.error('[TextInputPanel] Generation failed:', e);
        }
    }

    function handleFontChange(event) {
        setFont(event.target.value);
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
                        <label for="textInputField">Enter text:</label>
                        <input
                            id="textInputField"
                            v-model="textInput"
                            type="text"
                            placeholder="Type your text here..."
                            class="text-field"
                            @keyup.enter="generate"
                        />
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

                    <button
                        class="generate-btn"
                        :disabled="!textInput.trim() || isLoading"
                        @click="generate"
                    >
                        <span class="material-symbols-outlined">check</span>
                        Go
                    </button>

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

    .text-field:focus,
    .font-select:focus {
        outline: none;
        border-color: #4caf50;
    }

    .generate-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        background: #4caf50;
        color: #fff;
        border: none;
        padding: 0.875rem 1.5rem;
        font-size: 1rem;
        font-weight: 500;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.2s ease;
        margin-top: 0.5rem;
    }

    .generate-btn:hover:not(:disabled) {
        background: #43a047;
    }

    .generate-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .generate-btn .material-symbols-outlined {
        font-size: 1.25rem;
    }

    .error-message {
        color: #f87171;
        font-size: 0.875rem;
        margin: 0;
    }
</style>
