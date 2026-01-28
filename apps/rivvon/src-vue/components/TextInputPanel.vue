<script setup>
    import { ref, watch, onMounted } from 'vue';
    import { useTextToSvg } from '../composables/useTextToSvg';

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
    <Teleport to="body">
        <div
            v-if="visible"
            class="panel-overlay"
            @click.self="close"
        >
            <div class="text-input-panel">
                <div class="text-panel-header">
                    <h3>rivvon from text</h3>
                    <button
                        class="close-btn"
                        @click="close"
                    >&times;</button>
                </div>

                <div class="text-panel-content">
                    <label for="textInputField">Enter text:</label>
                    <input
                        id="textInputField"
                        v-model="textInput"
                        type="text"
                        placeholder="Type your text here..."
                        @keyup.enter="generate"
                    />

                    <label for="fontSelector">Font:</label>
                    <select
                        id="fontSelector"
                        :value="selectedFont"
                        :disabled="isLoading || fonts.length === 0"
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

                    <button
                        class="generate-btn"
                        :disabled="!textInput.trim() || isLoading"
                        @click="generate"
                    >
                        Go
                    </button>

                    <p
                        v-if="error"
                        class="error-message"
                    >{{ error }}</p>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
    .panel-overlay {
        position: fixed;
        inset: 0;
        z-index: 50;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .text-input-panel {
        background: rgba(17, 24, 39, 0.95);
        border-radius: 0.5rem;
        padding: 1.5rem;
        min-width: 300px;
        max-width: 90vw;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }

    .text-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
    }

    .text-panel-header h3 {
        color: white;
        font-size: 1.125rem;
        font-weight: 600;
        margin: 0;
    }

    .close-btn {
        background: transparent;
        color: white;
        font-size: 1.5rem;
        padding: 0;
        min-width: auto;
        min-height: auto;
        line-height: 1;
    }

    .close-btn:hover {
        color: #f87171;
        background: transparent;
    }

    .text-panel-content {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .text-panel-content label {
        color: #d1d5db;
        font-size: 0.875rem;
    }

    .text-panel-content input,
    .text-panel-content select {
        width: 100%;
        padding: 0.5rem 0.75rem;
        border-radius: 0.25rem;
        background: #1f2937;
        color: white;
        border: 1px solid #374151;
    }

    .text-panel-content input:focus,
    .text-panel-content select:focus {
        outline: none;
        border-color: #3b82f6;
    }

    .generate-btn {
        background: #2563eb;
        margin-top: 0.5rem;
    }

    .generate-btn:hover:not(:disabled) {
        background: #3b82f6;
    }

    .generate-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .error-message {
        color: #f87171;
        font-size: 0.875rem;
        margin: 0;
    }
</style>
