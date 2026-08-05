<script setup>
import { computed } from 'vue';
import {
    PopoverContent,
    PopoverPortal,
    PopoverRoot,
    PopoverTrigger,
} from 'reka-ui';
import ColorPickerPanel from './ColorPicker.vue';

const props = defineProps({
    inputId: { type: String, default: undefined },
    modelValue: { type: [String, Object, null], default: null },
    defaultValue: { type: String, default: undefined },
    format: { type: String, default: 'hex' },
    disabled: { type: Boolean, default: false },
    class: { type: String, default: undefined },
    ariaLabel: { type: String, default: 'Choose color' },
});

const emit = defineEmits(['update:modelValue', 'valueCommit']);

function resolveColor(value) {
    const candidate = typeof value === 'string'
        ? value
        : value?.hexa || value?.hex || '';
    const normalized = candidate.startsWith('#') ? candidate : `#${candidate}`;

    return /^#[\da-f]{6}([\da-f]{2})?$/i.test(normalized)
        ? normalized
        : '#ffffff';
}

function normalizePanelValue(value) {
    if (typeof value !== 'string' || !value) {
        return value;
    }

    return value.startsWith('#') ? value : `#${value}`;
}

const swatchColor = computed(() => resolveColor(props.modelValue || props.defaultValue));
const panelModelValue = computed(() => normalizePanelValue(props.modelValue));
</script>

<template>
    <PopoverRoot>
        <PopoverTrigger as-child>
            <button
                :id="props.inputId"
                type="button"
                :class="['color-picker-trigger', props.class]"
                :style="{ backgroundColor: swatchColor }"
                :disabled="props.disabled"
                :aria-label="props.ariaLabel"
                aria-haspopup="dialog"
                @click.stop
            />
        </PopoverTrigger>

        <PopoverPortal>
            <PopoverContent
                class="color-picker-popover-content"
                align="start"
                :side-offset="8"
                :collision-padding="8"
                :style="{ zIndex: 10000 }"
            >
                <ColorPickerPanel
                    :model-value="panelModelValue"
                    :default-value="props.defaultValue"
                    :format="props.format"
                    :disabled="props.disabled"
                    class="color-picker-panel"
                    @update:model-value="(value) => emit('update:modelValue', value)"
                    @value-commit="(value) => emit('valueCommit', value)"
                />
            </PopoverContent>
        </PopoverPortal>
    </PopoverRoot>
</template>

<style scoped>
.color-picker-trigger {
    display: inline-block;
    flex: 0 0 auto;
    pointer-events: auto;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: 1px solid var(--border-secondary, rgba(255, 255, 255, 0.2));
    border-radius: 999px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
    cursor: pointer;
}

.color-picker-trigger:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.color-picker-trigger:focus-visible {
    outline: 2px solid var(--accent-green, #10b981);
    outline-offset: 2px;
}

.color-picker-popover-content {
    z-index: 5000;
    pointer-events: auto;
    width: 17rem;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border-secondary, #4b5563);
    border-radius: 0.8125rem;
    background: var(--bg-card, #1f2937);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.3);
}

</style>
