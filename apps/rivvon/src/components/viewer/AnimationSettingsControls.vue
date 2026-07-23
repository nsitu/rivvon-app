<script setup>
    import { computed, getCurrentInstance, ref, watch } from 'vue';
    import ColorPicker from 'primevue/colorpicker';
    import Select from 'primevue/select';
    import Slider from 'primevue/slider';
    import ToggleSwitch from 'primevue/toggleswitch';
    import { useViewerStore } from '../../stores/viewerStore';

    defineProps({
        showUndulation: { type: Boolean, default: true },
    });

    const app = useViewerStore();
    const instanceUid = getCurrentInstance()?.uid ?? Math.round(Math.random() * 1e9);
    const inputIdPrefix = `animation-settings-${instanceUid}`;

    const lastFlowDirection = ref(app.flowState === 'backward' ? 'backward' : 'forward');

    const flowSpeedDisplay = computed(() => `${app.flowSpeed.toFixed(2)} tiles/s`);

    watch(
        () => app.flowState,
        (state) => {
            if (state === 'forward' || state === 'backward') {
                lastFlowDirection.value = state;
            }
        },
        { immediate: true }
    );

    const flowEnabledModel = computed({
        get: () => app.flowState !== 'off',
        set: (enabled) => {
            app.setFlowState(enabled ? lastFlowDirection.value : 'off');
        },
    });

    const reverseFlowModel = computed({
        get: () => lastFlowDirection.value === 'backward',
        set: (value) => {
            const nextDirection = value ? 'backward' : 'forward';
            lastFlowDirection.value = nextDirection;
            app.setFlowState(nextDirection);
        },
    });

    const undulationModel = computed({
        get: () => app.undulationEnabled,
        set: (value) => {
            app.setUndulationEnabled(!!value);
        },
    });

    const flowCycleAlignmentModel = computed({
        get: () => app.flowCycleAlignmentEnabled,
        set: (value) => {
            app.setFlowCycleAlignmentEnabled(!!value);
        },
    });

    const textureAnimationModel = computed({
        get: () => app.textureAnimationEnabled,
        set: (value) => {
            app.setTextureAnimationEnabled(!!value);
        },
    });

    const animatedBackgroundModel = computed({
        get: () => app.animatedBackgroundEnabled,
        set: (value) => {
            app.setAnimatedBackgroundEnabled(!!value);
        },
    });

    const backgroundFlipVerticalModel = computed({
        get: () => app.backgroundFlipVertical,
        set: (value) => app.setBackgroundFlipVertical(!!value),
    });

    const backgroundFlowModel = computed({
        get: () => app.backgroundFlowEnabled,
        set: (value) => {
            app.setBackgroundFlowEnabled(!!value);
        },
    });

    const backgroundBlurModel = computed({
        get: () => app.backgroundBlurEnabled,
        set: (value) => {
            app.setBackgroundBlurEnabled(!!value);
        },
    });

    const backgroundBlurDisplay = computed(() => `${app.backgroundBlurAmount.toFixed(1)}x`);

    const backgroundOverlayModel = computed({
        get: () => app.backgroundOverlayEnabled,
        set: (value) => {
            app.setBackgroundOverlayEnabled(!!value);
        }
    });

    const backgroundOverlayColorModel = computed({
        get: () => app.backgroundOverlayColor,
        set: (value) => {
            app.setBackgroundOverlayColor(value);
        }
    });

    const backgroundOverlayColorPickerModel = computed({
        get: () => backgroundOverlayColorModel.value.replace('#', ''),
        set: (value) => {
            app.setBackgroundOverlayColor(typeof value === 'string' ? `#${value}` : value);
        }
    });

    const backgroundOverlayColorLabel = computed(() => backgroundOverlayColorModel.value.toUpperCase());

    const backgroundOverlayOpacityModel = computed({
        get: () => Math.round(app.backgroundOverlayOpacity * 100),
        set: (value) => {
            app.setBackgroundOverlayOpacity(Number(value) / 100);
        }
    });

    const backgroundOverlayOpacityDisplay = computed(() => `${Math.round(app.backgroundOverlayOpacity * 100)}%`);

    const backgroundFlowSpeedDisplay = computed(() => `${app.backgroundFlowSpeed.toFixed(2)} tiles/s`);

    const reverseLayerCycleModel = computed({
        get: () => app.textureAnimationReversed,
        set: (value) => {
            app.setTextureAnimationReversed(!!value);
        },
    });

    const peakTroughEffectAvailable = computed(
        () => app.activeTextureCrossSectionType === 'waves'
    );

    const peakTroughEffectOptions = [
        { label: 'Transparency', value: 'transparency', icon: 'opacity' },
        { label: 'Blur', value: 'blur', icon: 'blur_on' },
    ];

    const peakTroughEffectEnabled = computed({
        get: () => peakTroughEffectAvailable.value
            && (app.peakTroughTransparencyEnabled || app.peakTroughBlurEnabled),
        set: (value) => app.setPeakTroughEffectEnabled(!!value),
    });

    const peakTroughEffectModel = computed({
        get: () => app.peakTroughEffectType,
        set: (value) => app.setPeakTroughEffectType(value),
    });

    const peakTroughBlurModel = computed(
        () => peakTroughEffectEnabled.value && app.peakTroughEffectType === 'blur'
    );

    const peakTroughBlurDisplay = computed(
        () => `${app.peakTroughBlurAmount.toFixed(1)}x`
    );

    const peakTroughGradientRangeModel = computed({
        get: () => [
            Math.round(app.peakTroughGradientStart * 100),
            Math.round(app.peakTroughGradientEnd * 100),
        ],
        set: (value) => {
            if (!Array.isArray(value) || value.length !== 2) return;
            app.setPeakTroughGradientRange([
                Number(value[0]) / 100,
                Number(value[1]) / 100,
            ]);
        },
    });

    const peakTroughGradientLabel = computed(
        () => `${Math.round(app.peakTroughGradientStart * 100)}% - ${Math.round(app.peakTroughGradientEnd * 100)}%`
    );

    function handleFlowSpeedInput(event) {
        app.setFlowSpeed(parseFloat(event.target.value));
    }

    function handleBackgroundBlurInput(event) {
        app.setBackgroundBlurAmount(parseFloat(event.target.value));
    }

    function handleBackgroundFlowSpeedInput(event) {
        app.setBackgroundFlowSpeed(parseFloat(event.target.value));
    }

    function handlePeakTroughBlurInput(event) {
        app.setPeakTroughBlurAmount(parseFloat(event.target.value));
    }

    function getInputId(name) {
        return `${inputIdPrefix}-${name}`;
    }
</script>

<template>
    <div class="animation-settings-controls">
        <div class="tools-section">
            <div class="tools-section-label">Animation</div>
            <div class="tools-section-items">
                <div class="tools-toggle-row">
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('flow-mode')"
                    >
                        <span class="material-symbols-outlined">text_select_move_forward_word</span>
                        <span>Conveyor Belt (Flow)</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ flowEnabledModel ? 'On' : 'Off' }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('flow-mode')"
                            v-model="flowEnabledModel"
                        />
                    </div>
                </div>

                <div
                    v-if="flowEnabledModel"
                    class="tools-toggle-row"
                >
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('reverse-flow')"
                    >
                        <span class="material-symbols-outlined">arrow_back</span>
                        <span>Reverse Flow</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ reverseFlowModel ? 'On' : 'Off' }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('reverse-flow')"
                            v-model="reverseFlowModel"
                        />
                    </div>
                </div>

                <div
                    v-if="app.flowState !== 'off'"
                    class="tools-slider"
                >
                    <label><span class="material-symbols-outlined tools-slider-icon">speed</span>Flow Speed <span
                            class="tools-slider-value"
                        >{{ flowSpeedDisplay }}</span></label>
                    <input
                        type="range"
                        min="0.05"
                        max="2"
                        step="0.05"
                        :value="app.flowSpeed"
                        @input="handleFlowSpeedInput"
                    />
                </div>

                <div
                    v-if="showUndulation"
                    class="tools-toggle-row"
                >
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('undulation')"
                    >
                        <span class="material-symbols-outlined">airwave</span>
                        <span>Ribbon Undulation</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ app.undulationEnabled ? 'On' : 'Off' }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('undulation')"
                            v-model="undulationModel"
                        />
                    </div>
                </div>

                <div class="tools-toggle-row">
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('layer-cycling')"
                    >
                        <span class="material-symbols-outlined">layers</span>
                        <span>Layer Cycling</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ app.textureAnimationEnabled ? 'On' : 'Off'
                        }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('layer-cycling')"
                            v-model="textureAnimationModel"
                        />
                    </div>
                </div>

                <div
                    v-if="textureAnimationModel"
                    class="tools-toggle-row"
                >
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('reverse-layer-cycle')"
                    >
                        <span class="material-symbols-outlined">fast_rewind</span>
                        <span>Reverse Layer Cycle</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ reverseLayerCycleModel ? 'On' : 'Off' }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('reverse-layer-cycle')"
                            v-model="reverseLayerCycleModel"
                        />
                    </div>
                </div>

                <div
                    class="tools-toggle-row"
                    v-if="flowEnabledModel && textureAnimationModel"
                >
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('auto-align-cycles')"
                    >
                        <span class="material-symbols-outlined">horizontal_align_center</span>
                        <span>Auto-Align Cycles</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ app.flowCycleAlignmentEnabled ? 'On' : 'Off'
                            }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('auto-align-cycles')"
                            v-model="flowCycleAlignmentModel"
                        />
                    </div>
                </div>
            </div>
        </div>

        <div class="tools-section">
            <div class="tools-section-label">Peak and Trough Effects</div>
            <div class="tools-section-items">
                <div class="tools-toggle-row">
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('peak-trough-enabled')"
                    >
                        <span class="material-symbols-outlined">vital_signs</span>
                        <span>Peak/Trough Effects</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">
                            {{ peakTroughEffectAvailable
                                ? (peakTroughEffectEnabled ? 'On' : 'Off')
                                : 'Waves only' }}
                        </span>
                        <ToggleSwitch
                            :inputId="getInputId('peak-trough-enabled')"
                            v-model="peakTroughEffectEnabled"
                            :disabled="!peakTroughEffectAvailable"
                        />
                    </div>
                </div>
                <div
                    v-if="peakTroughEffectEnabled"
                    class="tools-select-block"
                >
                    <div class="tools-select-head">
                        <label
                            class="tools-select-label"
                            :for="getInputId('peak-trough-effect-type')"
                        >
                            Effect Type
                        </label>
                    </div>
                    <div class="tools-select-wrap">
                        <Select
                            :inputId="getInputId('peak-trough-effect-type')"
                            v-model="peakTroughEffectModel"
                            :options="peakTroughEffectOptions"
                            option-label="label"
                            option-value="value"
                            class="tools-select"
                        >
                            <template #value="slotProps">
                                <div class="tools-select-row">
                                    <span class="material-symbols-outlined tools-select-icon">
                                        {{ peakTroughEffectOptions.find((option) => option.value === slotProps.value)?.icon }}
                                    </span>
                                    <span>{{ peakTroughEffectOptions.find((option) => option.value === slotProps.value)?.label }}</span>
                                </div>
                            </template>
                            <template #option="slotProps">
                                <div class="tools-select-row">
                                    <span class="material-symbols-outlined tools-select-icon">{{ slotProps.option.icon }}</span>
                                    <span>{{ slotProps.option.label }}</span>
                                </div>
                            </template>
                        </Select>
                    </div>
                </div>
                <div
                    v-if="peakTroughEffectEnabled"
                    class="tools-slider-block"
                >
                    <div class="tools-slider-head">
                        <label class="tools-slider-label">Effect Gradient</label>
                        <span class="tools-hint tools-slider-hint">{{ peakTroughGradientLabel }}</span>
                    </div>
                    <Slider
                        v-model="peakTroughGradientRangeModel"
                        range
                        :min="0"
                        :max="100"
                        :step="1"
                        class="tools-range-slider"
                    />
                    <div class="tools-slider-caption">
                        <span>Fade starts</span>
                        <span>{{ peakTroughBlurModel ? 'Maximum blur' : 'Maximum transparency' }}</span>
                    </div>
                </div>
                <div
                    v-if="peakTroughBlurModel"
                    class="tools-slider-block"
                >
                    <div class="tools-slider-head">
                        <label
                            class="tools-slider-label"
                            :for="getInputId('peak-trough-blur-amount')"
                        >
                            <span class="material-symbols-outlined">blur_linear</span>
                            <span>Blur Strength</span>
                        </label>
                        <span class="tools-hint tools-slider-hint">{{ peakTroughBlurDisplay }}</span>
                    </div>
                    <input
                        :id="getInputId('peak-trough-blur-amount')"
                        type="range"
                        min="1"
                        max="16"
                        step="0.5"
                        :value="app.peakTroughBlurAmount"
                        @input="handlePeakTroughBlurInput"
                        class="tools-native-range"
                    />
                    <div class="tools-slider-caption">
                        <span>Subtle</span>
                        <span>Obliterate detail</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="tools-section">
            <div class="tools-section-label">Background</div>
            <div class="tools-section-items">
                <div
                    v-if="textureAnimationModel"
                    class="tools-toggle-row"
                >
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('animated-background')"
                    >
                        <span class="material-symbols-outlined">wallpaper</span>
                        <span>Animated Background</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ animatedBackgroundModel ? 'On' : 'Off' }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('animated-background')"
                            v-model="animatedBackgroundModel"
                        />
                    </div>
                </div>

                <div class="tools-toggle-row">
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('background-flip-vertical')"
                    >
                        <span class="material-symbols-outlined">swap_vert</span>
                        <span>Flip Background Vertically</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ backgroundFlipVerticalModel ? 'On' : 'Off'
                            }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('background-flip-vertical')"
                            v-model="backgroundFlipVerticalModel"
                        />
                    </div>
                </div>

                <div class="tools-toggle-row">
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('background-flow')"
                    >
                        <span class="material-symbols-outlined">text_select_move_forward_word</span>
                        <span>Background Flow</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ backgroundFlowModel ? 'On' : 'Off' }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('background-flow')"
                            v-model="backgroundFlowModel"
                        />
                    </div>
                </div>

                <div
                    v-if="backgroundFlowModel"
                    class="tools-slider"
                >
                    <label>
                        <span class="material-symbols-outlined tools-slider-icon">speed</span>
                        Background Flow Speed
                        <span class="tools-slider-value">{{ backgroundFlowSpeedDisplay }}</span>
                    </label>
                    <input
                        :id="getInputId('background-flow-speed')"
                        type="range"
                        min="0.05"
                        max="2"
                        step="0.05"
                        :value="app.backgroundFlowSpeed"
                        @input="handleBackgroundFlowSpeedInput"
                    />
                </div>

                <div class="tools-toggle-row">
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('background-blur')"
                    >
                        <span class="material-symbols-outlined">blur_on</span>
                        <span>Background Blur</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ backgroundBlurModel ? 'On' : 'Off' }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('background-blur')"
                            v-model="backgroundBlurModel"
                        />
                    </div>
                </div>

                <div
                    v-if="backgroundBlurModel"
                    class="tools-slider-block"
                >
                    <div class="tools-slider-head">
                        <label class="tools-slider-label">
                            <span class="material-symbols-outlined">blur_linear</span>
                            <span>Blur Amount</span>
                        </label>
                        <span class="tools-hint tools-slider-hint">{{ backgroundBlurDisplay }}</span>
                    </div>
                    <input
                        :id="getInputId('background-blur-amount')"
                        type="range"
                        min="1"
                        max="50"
                        step="0.5"
                        :value="app.backgroundBlurAmount"
                        @input="handleBackgroundBlurInput"
                        class="tools-native-range"
                    />
                    <div class="tools-slider-caption">
                        <span>Soft</span>
                        <span>Strong</span>
                    </div>
                </div>

                <div class="tools-toggle-row">
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('background-overlay')"
                    >
                        <span class="material-symbols-outlined">palette</span>
                        <span>Background Color Overlay</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ backgroundOverlayModel ? 'On' : 'Off' }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('background-overlay')"
                            v-model="backgroundOverlayModel"
                        />
                    </div>
                </div>

                <div
                    v-if="backgroundOverlayModel"
                    class="tools-color-row"
                >
                    <label
                        class="tools-color-main"
                        :for="getInputId('background-overlay-color')"
                    >
                        <span
                            class="tools-color-swatch"
                            :style="{ backgroundColor: backgroundOverlayColorModel }"
                        ></span>
                        <span>Overlay Color</span>
                    </label>
                    <div class="tools-color-control">
                        <span class="tools-hint tools-color-hint">{{ backgroundOverlayColorLabel }}</span>
                        <ColorPicker
                            :inputId="getInputId('background-overlay-color')"
                            v-model="backgroundOverlayColorPickerModel"
                            format="hex"
                            class="tools-color-picker"
                        />
                    </div>
                </div>

                <div
                    v-if="backgroundOverlayModel"
                    class="tools-slider-block"
                >
                    <div class="tools-slider-head">
                        <label class="tools-slider-label">
                            <span class="material-symbols-outlined">opacity</span>
                            <span>Overlay Opacity</span>
                        </label>
                        <span class="tools-hint tools-slider-hint">{{ backgroundOverlayOpacityDisplay }}</span>
                    </div>
                    <input
                        :id="getInputId('background-overlay-opacity')"
                        v-model="backgroundOverlayOpacityModel"
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        class="tools-native-range"
                        aria-label="Overlay Opacity"
                    />
                    <div class="tools-slider-caption">
                        <span>Transparent</span>
                        <span>Opaque</span>
                    </div>
                </div>
            </div>
        </div>

    </div>
</template>

<style scoped>
    .animation-settings-controls {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        width: 100%;
    }

    .tools-select-block {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        padding: 0.5rem;
    }

    .tools-select-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
    }

    .tools-select-label {
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.6);
        padding: 0 0.1rem;
    }

    .tools-select {
        width: 100%;
    }

    .tools-select-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .tools-select-icon {
        font-size: 1.2rem;
        opacity: 0.85;
    }

    :deep(.tools-select .p-select-label) {
        font-size: 0.95rem;
    }

    .tools-toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.875rem 1rem;
        color: var(--p-text-color, #fff);
    }

    .tools-toggle-main {
        display: flex;
        align-items: center;
        gap: 0.875rem;
        min-width: 0;
        color: inherit;
        cursor: pointer;
    }

    .tools-toggle-main .material-symbols-outlined {
        font-size: 1.35rem;
        opacity: 0.85;
        flex-shrink: 0;
    }

    .tools-toggle-control {
        display: inline-flex;
        align-items: center;
        gap: 0.65rem;
        flex-shrink: 0;
    }

    .tools-hint {
        margin-left: auto;
        font-size: 0.65rem;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.5);
        background: rgba(255, 255, 255, 0.08);
        padding: 0.2rem 0.45rem;
        border-radius: 4px;
        font-family: monospace;
        letter-spacing: 0.02em;
    }

    .tools-toggle-hint {
        margin-left: 0;
    }

    .tools-slider-block {
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
        padding: 0 1rem 0.875rem;
        color: var(--p-text-color, #fff);
    }

    .tools-slider-head,
    .tools-slider-caption {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
    }

    .tools-slider-label {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.78);
    }

    .tools-slider-label .material-symbols-outlined {
        font-size: 1.1rem;
        line-height: 1;
        opacity: 0.85;
    }

    .tools-slider-hint {
        margin-left: 0;
    }

    .tools-range-slider {
        width: calc(100% - 1rem);
        margin: 0 0.5rem;
    }

    .tools-slider-caption {
        color: rgba(255, 255, 255, 0.56);
        font-size: 0.72rem;
    }

    .tools-native-range {
        -webkit-appearance: none;
        appearance: none;
        width: calc(100% - 1rem);
        margin: 0 0.5rem;
        height: 4px;
        background: rgba(255, 255, 255, 0.16);
        border-radius: 999px;
        outline: none;
        cursor: pointer;
    }

    .tools-native-range::-webkit-slider-runnable-track {
        height: 4px;
        background: rgba(255, 255, 255, 0.16);
        border-radius: 999px;
    }

    .tools-native-range::-moz-range-track {
        height: 4px;
        background: rgba(255, 255, 255, 0.16);
        border-radius: 999px;
        border: none;
    }

    .tools-native-range::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 18px;
        height: 18px;
        margin-top: -7px;
        border-radius: 999px;
        background: var(--p-primary-color, #10b981);
        border: 2px solid var(--p-primary-color, #10b981);
        box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
    }

    .tools-native-range::-moz-range-thumb {
        width: 18px;
        height: 18px;
        border-radius: 999px;
        background: var(--p-primary-color, #10b981);
        border: 2px solid var(--p-primary-color, #10b981);
        box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
    }

    .tools-color-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 0 1rem 0.875rem;
        color: var(--p-text-color, #fff);
    }

    .tools-color-main {
        display: inline-flex;
        align-items: center;
        gap: 0.875rem;
        min-width: 0;
        color: inherit;
        font-size: 0.9rem;
    }

    .tools-color-swatch {
        width: 1rem;
        height: 1rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.28);
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.22) inset;
        flex-shrink: 0;
    }

    .tools-color-control {
        display: inline-flex;
        align-items: center;
        gap: 0.65rem;
        flex-shrink: 0;
    }

    .tools-color-hint {
        margin-left: 0;
        text-transform: uppercase;
    }

    :deep(.tools-color-picker .p-colorpicker-preview) {
        width: 1.75rem;
        height: 1.75rem;
        border-radius: 999px;
    }

    :deep(.tools-color-picker .p-colorpicker-panel) {
        z-index: 5000;
    }

</style>
