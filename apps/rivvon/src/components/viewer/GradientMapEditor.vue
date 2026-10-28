<script setup>
    import { computed, ref, watch, getCurrentInstance, onBeforeUnmount } from 'vue';
    import Button from 'primevue/button';
    import InputText from 'primevue/inputtext';
    import InputNumber from 'primevue/inputnumber';
    import Slider from 'primevue/slider';
    import ColorPickerPopover from '../color-picker/ColorPickerPopover.vue';
    import { createGradientMapLut, MAX_GRADIENT_MAP_STOPS } from '../../modules/viewer/gradientMap.js';

    const props = defineProps({
        modelValue: { type: Array, required: true },
        subject: { type: String, default: 'scene' },
        mix: { type: Number, default: 1 },
    });
    const emit = defineEmits(['update:modelValue', 'update:mix']);
    const emitStops = (stops, options = {}) => emit('update:modelValue', stops, options);
    const inputIdPrefix = 'gradient-map-' + getCurrentInstance().uid;
    const getInputId = name => inputIdPrefix + '-' + name;

    const gradientBarRef = ref(null);
    const selectedGradientStopId = ref(props.modelValue[1]?.id ?? props.modelValue[0]?.id ?? null);
    let draggedGradientStopId = null;

    const gradientMapStops = computed(() => props.modelValue);
    const gradientPreviewStyle = computed(() => ({
        background: `linear-gradient(to right, ${gradientMapStops.value
            .map((stop) => `${stop.color} ${Math.round(stop.position * 10000) / 100}%`)
            .join(', ')})`,
    }));

    watch(gradientMapStops, (stops) => {
        if (!stops.some((stop) => stop.id === selectedGradientStopId.value)) {
            selectedGradientStopId.value = stops[0]?.id ?? null;
        }
    });

    function updateGradientStop(stopId, patch, persist = true) {
        emitStops(gradientMapStops.value.map((stop) => (
            stop.id === stopId ? { ...stop, ...patch } : stop
        )), { persist });
        selectedGradientStopId.value = stopId;
    }

    function onGradientStopColor(stopId, value) {
        const color = typeof value === 'string' ? `#${value.replace(/^#/, '')}` : value;
        updateGradientStop(stopId, { color });
    }

    function onGradientStopPosition(stopId, value) {
        const percentage = Number(value);
        if (!Number.isFinite(percentage)) return;
        updateGradientStop(stopId, { position: percentage / 100 });
    }

    function sampleGradientColor(position) {
        const lut = createGradientMapLut(gradientMapStops.value);
        const index = Math.round(Math.min(1, Math.max(0, position)) * ((lut.length / 4) - 1)) * 4;
        return `#${[lut[index], lut[index + 1], lut[index + 2]]
            .map((channel) => channel.toString(16).padStart(2, '0'))
            .join('')}`;
    }

    function addGradientStopAtPosition(position) {
        if (gradientMapStops.value.length >= MAX_GRADIENT_MAP_STOPS) return;
        const normalizedPosition = Math.min(1, Math.max(0, position));
        const id = `stop-${Date.now().toString(36)}-${Math.round(normalizedPosition * 1000)}`;
        emitStops([
            ...gradientMapStops.value,
            { id, position: normalizedPosition, color: sampleGradientColor(normalizedPosition) },
        ]);
        selectedGradientStopId.value = id;
    }

    function addGradientStop() {
        const stops = gradientMapStops.value;
        let largestGap = -1;
        let position = 0.5;
        for (let index = 1; index < stops.length; index += 1) {
            const gap = stops[index].position - stops[index - 1].position;
            if (gap > largestGap) {
                largestGap = gap;
                position = stops[index - 1].position + gap / 2;
            }
        }
        addGradientStopAtPosition(position);
    }

    function removeGradientStop(stopId) {
        if (gradientMapStops.value.length <= 2) return;
        emitStops(gradientMapStops.value.filter((stop) => stop.id !== stopId));
    }

    function positionFromPointer(event) {
        const bounds = gradientBarRef.value?.getBoundingClientRect?.();
        if (!bounds?.width) return null;
        return Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    }

    function onGradientBarDoubleClick(event) {
        const position = positionFromPointer(event);
        if (position != null) addGradientStopAtPosition(position);
    }

    function onGradientStopPointerDown(event, stopId) {
        if (event.button !== 0) return;
        event.preventDefault();
        draggedGradientStopId = stopId;
        selectedGradientStopId.value = stopId;
        window.addEventListener('pointermove', onGradientStopPointerMove);
        window.addEventListener('pointerup', stopGradientStopDrag, { once: true });
        window.addEventListener('pointercancel', stopGradientStopDrag, { once: true });
    }

    function onGradientStopPointerMove(event) {
        if (!draggedGradientStopId) return;
        const position = positionFromPointer(event);
        if (position != null) {
            updateGradientStop(draggedGradientStopId, { position }, false);
        }
    }

    function stopGradientStopDrag() {
        if (draggedGradientStopId) {
            emitStops(gradientMapStops.value);
        }
        draggedGradientStopId = null;
        window.removeEventListener('pointermove', onGradientStopPointerMove);
        window.removeEventListener('pointerup', stopGradientStopDrag);
        window.removeEventListener('pointercancel', stopGradientStopDrag);
    }

    function onGradientStopKeydown(event, stop) {
        let position = stop.position;
        const step = event.shiftKey ? 0.1 : 0.01;
        if (event.key === 'ArrowLeft') position -= step;
        else if (event.key === 'ArrowRight') position += step;
        else if (event.key === 'Home') position = 0;
        else if (event.key === 'End') position = 1;
        else return;
        event.preventDefault();
        updateGradientStop(stop.id, { position: Math.max(0, Math.min(1, position)) });
    }

    onBeforeUnmount(stopGradientStopDrag);

</script>

<template>
    <div class="gradient-map-editor">
        <div class="gradient-map-mix">
            <div class="gradient-map-header">
                <label :for="getInputId('mix')">Mix</label>
                <output :for="getInputId('mix')">{{ Math.round(mix * 100) }}%</output>
            </div>
            <Slider
                :id="getInputId('mix')"
                :modelValue="Math.round(mix * 100)"
                :min="0" :max="100" :step="1"
                :aria-label="`${subject} gradient map mix`"
                @update:modelValue="emit('update:mix', $event / 100)"
            />
            <div class="gradient-map-caption gradient-map-mix-caption">
                <span>Original</span><span>Gradient Map</span>
            </div>
        </div>
        <div class="gradient-map-header">
            <span>Color Stops</span>
            <Button
                type="button"
                variant="text"
                class="gradient-map-add"
                :disabled="gradientMapStops.length >= MAX_GRADIENT_MAP_STOPS"
                title="Add color stop"
                @click="addGradientStop"
            >
                <span class="material-symbols-outlined" aria-hidden="true">add</span>
                Add
            </Button>
        </div>

        <div class="gradient-map-track-wrap">
            <div
                ref="gradientBarRef"
                class="gradient-map-track"
                :style="gradientPreviewStyle"
                title="Double-click to add a stop"
                @dblclick="onGradientBarDoubleClick"
            >
                <!-- Native buttons act as draggable ramp handles; row controls provide precise keyboard editing. -->
                <button
                    v-for="stop in gradientMapStops"
                    :key="stop.id"
                    type="button"
                    class="gradient-map-handle"
                    :class="{ 'is-selected': stop.id === selectedGradientStopId }"
                    :style="{
                        left: `${stop.position * 100}%`,
                        '--stop-color': stop.color,
                    }"
                    :aria-label="`Gradient stop at ${Math.round(stop.position * 100)} percent`"
                    @pointerdown="onGradientStopPointerDown($event, stop.id)"
                    @click="selectedGradientStopId = stop.id"
                    @keydown="onGradientStopKeydown($event, stop)"
                ></button>
            </div>
        </div>

        <div class="gradient-map-stop-list">
            <div
                v-for="stop in gradientMapStops"
                :key="`row-${stop.id}`"
                class="gradient-map-stop-row"
                :class="{ 'is-selected': stop.id === selectedGradientStopId }"
                @click="selectedGradientStopId = stop.id"
            >
                <ColorPickerPopover
                    :inputId="getInputId(`gradient-color-${stop.id}`)"
                    :modelValue="stop.color.replace('#', '')"
                    format="hex"
                    class="tools-color-picker gradient-map-picker"
                    @update:modelValue="onGradientStopColor(stop.id, $event)"
                />
                <InputText
                    class="gradient-map-hex"
                    :modelValue="stop.color.toUpperCase()"
                    maxlength="7"
                    aria-label="Stop color"
                    @change="onGradientStopColor(stop.id, $event.target.value)"
                />
                <InputNumber
                    class="gradient-map-position-wrap"
                    inputClass="gradient-map-position"
                    :modelValue="Math.round(stop.position * 100)"
                    :min="0" :max="100" :step="1"
                    suffix="%"
                    fluid
                    aria-label="Stop position percentage"
                    @update:modelValue="onGradientStopPosition(stop.id, $event)"
                />
                <Button
                    type="button"
                    variant="text"
                    class="rivvon-icon-action gradient-map-remove"
                    aria-label="Remove color stop"
                    :disabled="gradientMapStops.length <= 2"
                    title="Remove color stop"
                    @click.stop="removeGradientStop(stop.id)"
                >
                    <span class="material-symbols-outlined" aria-hidden="true">close</span>
                </Button>
            </div>
        </div>

        <p class="gradient-map-caption">
            Maps {{ subject }} luminance from shadows to highlights. Drag stops or double-click the ramp to add one.
        </p>
    </div>
</template>

<style scoped>
    .gradient-map-editor {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 0 0.75rem 1rem;
    }

    .gradient-map-mix {
        display: grid;
        gap: 0.75rem;
        padding-block: 0.5rem;
    }

    .gradient-map-mix-caption {
        display: flex;
        justify-content: space-between;
    }

    .gradient-map-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: rgba(255, 255, 255, 0.68);
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }

    .gradient-map-add {
        display: inline-flex;
        align-items: center;
        gap: 0.15rem;
        padding: 0.3rem 0.5rem;
        border-radius: var(--rivvon-button-radius);
        font-size: 0.7rem;
    }

    .gradient-map-add .material-symbols-outlined,
    .gradient-map-remove .material-symbols-outlined {
        font-size: 1rem;
    }

    .gradient-map-add:disabled,
    .gradient-map-remove:disabled {
        opacity: var(--rivvon-button-disabled-opacity);
        cursor: default;
    }

    .gradient-map-add:focus-visible,
    .gradient-map-remove:focus-visible,
    .gradient-map-handle:focus-visible {
        box-shadow: var(--rivvon-button-focus-ring);
    }

    .gradient-map-track-wrap {
        padding: 0.65rem 0.55rem 0.8rem;
    }

    .gradient-map-track {
        position: relative;
        height: 2rem;
        border: 2px solid rgba(255, 255, 255, 0.76);
        border-radius: 7px;
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.42);
        cursor: crosshair;
    }

    .gradient-map-handle {
        position: absolute;
        top: 50%;
        width: 1rem;
        height: 2.8rem;
        padding: 0;
        transform: translate(-50%, -50%);
        border: 3px solid rgba(255, 255, 255, 0.95);
        border-radius: var(--rivvon-button-inline-radius);
        background: var(--stop-color);
        box-shadow: 0 0 0 2px rgba(11, 34, 46, 0.95);
        cursor: grab;
        touch-action: none;
        z-index: 1;
    }

    .gradient-map-handle.is-selected {
        box-shadow:
            0 0 0 2px rgba(11, 34, 46, 1),
            0 0 0 6px rgba(255, 255, 255, 0.25);
        z-index: 2;
    }

    .gradient-map-handle:active {
        cursor: grabbing;
    }

    .gradient-map-stop-list {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }

    .gradient-map-stop-row {
        display: grid;
        grid-template-columns: 2rem minmax(5.5rem, 1fr) 4.5rem 1.75rem;
        align-items: center;
        gap: 0.45rem;
        padding: 0.45rem;
        border: 1px solid transparent;
        border-radius: var(--rivvon-button-tool-radius);
        background: rgba(255, 255, 255, 0.035);
    }

    .gradient-map-stop-row.is-selected {
        border-color: rgba(255, 255, 255, 0.18);
        background: rgba(255, 255, 255, 0.1);
    }

    .gradient-map-hex,
    :deep(.gradient-map-position) {
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: var(--rivvon-button-radius);
        background: rgba(0, 0, 0, 0.2);
        color: rgba(255, 255, 255, 0.9);
        font: 0.75rem/1.2 monospace;
    }

    .gradient-map-hex {
        padding: 0.45rem 0.5rem;
        text-transform: uppercase;
    }

    .gradient-map-position-wrap {
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 0.2rem;
        color: rgba(255, 255, 255, 0.52);
        font-size: 0.72rem;
    }

    :deep(.gradient-map-position) {
        padding: 0.45rem 0.25rem 0.45rem 0.45rem;
    }

    .gradient-map-remove {
        display: grid;
        width: 1.75rem;
        height: 1.75rem;
        place-items: center;
        padding: 0;
        border-radius: var(--rivvon-button-inline-radius);
    }

    .gradient-map-caption {
        margin: 0;
        color: rgba(255, 255, 255, 0.48);
        font-size: 0.68rem;
        line-height: 1.35;
    }

    :deep(.gradient-map-picker.color-picker-trigger) {
        width: 2rem;
        height: 2rem;
    }

    .gradient-map-hex:focus-visible,
    :deep(.gradient-map-position:focus-visible) {
        outline: 2px solid var(--p-primary-color);
        outline-offset: 2px;
    }

    @media (max-width: 400px) {
        .gradient-map-stop-row {
            grid-template-columns: 2rem minmax(0, 1fr) minmax(3.5rem, 4.5rem) 1.75rem;
            gap: 0.25rem;
        }
    }
</style>
