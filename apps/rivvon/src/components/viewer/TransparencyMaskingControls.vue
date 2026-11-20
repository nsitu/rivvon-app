<script setup>
    import { computed, useId } from 'vue';
    import InputText from 'primevue/inputtext';
    import Select from 'primevue/select';
    import Slider from 'primevue/slider';
    import ToggleSwitch from 'primevue/toggleswitch';
    import ColorPickerPopover from '../color-picker/ColorPickerPopover.vue';
    import { useViewerStore } from '../../stores/viewerStore';

    const app = useViewerStore();
    const inputIdPrefix = 'transparency-masking-' + useId();

    const transparentShadowsFilterModel = computed({
        get: () => app.transparentShadowsEnabled,
        set: (value) => {
            app.setTransparentShadowsEnabled(!!value);
        }
    });

    const overlapOnlyTransparencyModel = computed({
        get: () => app.overlapOnlyTransparencyEnabled,
        set: (value) => {
            app.setOverlapOnlyTransparencyEnabled(!!value);
        },
    });

    const overlapMaskDebugModel = computed({
        get: () => app.overlapMaskDebugEnabled,
        set: (value) => {
            app.setOverlapMaskDebugEnabled(!!value);
        },
    });

    const transparencyMethodOptions = [
        { label: 'Brightness', value: 'brightness', icon: 'brightness_6' },
        { label: 'Reference Color', value: 'color', icon: 'colorize' },
        { label: 'Saturation', value: 'saturation', icon: 'palette' },
    ];

    const selectedTransparencyMethodOption = computed({
        get: () => transparencyMethodOptions.find(
            (option) => option.value === app.transparencyMethod,
        ) ?? transparencyMethodOptions[0],
        set: (option) => {
            if (!option?.value) return;
            app.setTransparencyMethod(option.value);
        },
    });

    const transparencyReferenceColorModel = computed({
        get: () => app.transparencyReferenceColor,
        set: (value) => {
            app.setTransparencyReferenceColor(value);
        },
    });

    const transparencyReferenceColorPickerModel = computed({
        get: () => transparencyReferenceColorModel.value.replace('#', ''),
        set: (value) => {
            app.setTransparencyReferenceColor(
                typeof value === 'string' ? `#${value.replace(/^#/, '')}` : value,
            );
        },
    });

    const transparencyReferenceColorInputModel = computed(
        () => transparencyReferenceColorModel.value.toUpperCase(),
    );

    function onTransparencyReferenceColorInput(event) {
        app.setTransparencyReferenceColor(event.target.value);
    }

    const transparencyHighlightsModel = computed({
        get: () => app.transparencyMode === 'highlights',
        set: (value) => {
            app.setTransparencyMode(value ? 'highlights' : 'shadows');
        }
    });

    const transparencyModeLabel = computed(
        () => app.transparencyMethod === 'color'
            ? (transparencyHighlightsModel.value ? 'Inverted' : 'Match')
            : app.transparencyMethod === 'saturation'
                ? (transparencyHighlightsModel.value ? 'High saturation' : 'Low saturation')
                : (transparencyHighlightsModel.value ? 'Highlights' : 'Shadows')
    );

    const transparencyInversionLabel = computed(
        () => app.transparencyMethod === 'color'
            ? 'Invert Color Match'
            : app.transparencyMethod === 'saturation' ? 'Reverse' : 'Highlights',
    );

    const transparentShadowsThresholdRangeModel = computed({
        get: () => [
            Math.round(app.transparentShadowsThresholdMin * 100),
            Math.round(app.transparentShadowsThresholdMax * 100)
        ],
        set: (value) => {
            if (!Array.isArray(value) || value.length !== 2) return;

            app.setTransparentShadowsThresholdRange([
                Number(value[0]) / 100,
                Number(value[1]) / 100,
            ]);
        }
    });

    const transparentShadowsThresholdMinLabel = computed(
        () => `${Math.round(app.transparentShadowsThresholdMin * 100)}%`
    );

    const transparentShadowsThresholdMaxLabel = computed(
        () => `${Math.round(app.transparentShadowsThresholdMax * 100)}%`
    );

    const edgeNoiseTransparencyModel = computed({
        get: () => Math.round(app.edgeNoiseTransparencyMax * 100),
        set: (value) => {
            app.setEdgeNoiseTransparencyMax(Number(value) / 100);
        }
    });

    const edgeNoiseTransparencyLabel = computed(
        () => `${Math.round(app.edgeNoiseTransparencyMax * 100)}%`
    );

    const edgeDriftEnabledModel = computed({
        get: () => app.edgeDriftEnabled,
        set: (value) => {
            app.setEdgeDriftEnabled(!!value);
        }
    });

    const edgeNoisePatternLengthModel = computed({
        get: () => Number(app.edgeNoisePatternLength.toFixed(2)),
        set: (value) => {
            app.setEdgeNoisePatternLength(Number(value));
        }
    });

    const edgeNoisePatternLengthLabel = computed(() => {
        const value = app.edgeNoisePatternLength;
        const formatted = value < 1 ? value.toFixed(2) : value.toFixed(1);
        return `${formatted} seg`;
    });

    const edgeNoiseMirroredModel = computed({
        get: () => app.edgeNoiseMirrored,
        set: (value) => {
            app.setEdgeNoiseMirrored(!!value);
        }
    });

    const filmstripStyleEnabledModel = computed({
        get: () => app.filmstripStyleEnabled,
        set: (value) => {
            app.setFilmstripStyleEnabled(!!value);
        }
    });

    const filmstripMotionEnabledModel = computed({
        get: () => app.filmstripMotionEnabled,
        set: value => app.setFilmstripMotionEnabled(value),
    });
    const filmstripMotionSpeedModel = computed({
        get: () => Math.round(app.filmstripMotionSpeed * 100),
        set: value => app.setFilmstripMotionSpeed(Number(value) / 100),
    });

    const filmstripGapLengthModel = computed({
        get: () => Math.round(app.filmstripGapLength * 100),
        set: (value) => {
            app.setFilmstripGapLength(Number(value) / 100);
        }
    });

    const filmstripGapLengthLabel = computed(() => {
        const value = app.filmstripGapLength;
        const formatted = value < 1 ? value.toFixed(2) : value.toFixed(1);
        return `${formatted} seg`;
    });

    const filmstripHoleLengthModel = computed({
        get: () => Math.round(app.filmstripHoleLength * 100),
        set: (value) => {
            app.setFilmstripHoleLength(Number(value) / 100);
        }
    });

    const filmstripHoleLengthLabel = computed(() => {
        const value = app.filmstripHoleLength;
        const formatted = value < 1 ? value.toFixed(2) : value.toFixed(1);
        return `${formatted} seg`;
    });

    const filmstripApertureModel = computed({
        get: () => Math.round(app.filmstripAperture * 100),
        set: (value) => {
            app.setFilmstripAperture(Number(value) / 100);
        }
    });

    const filmstripApertureLabel = computed(
        () => `${Math.round(app.filmstripAperture * 100)}%`
    );

    const filmstripHoleRoundednessModel = computed({
        get: () => Math.round(app.filmstripHoleRoundedness * 100),
        set: (value) => {
            app.setFilmstripHoleRoundedness(Number(value) / 100);
        }
    });

    const filmstripHoleRoundednessLabel = computed(
        () => `${Math.round(app.filmstripHoleRoundedness * 100)}%`
    );

    const transparencyThresholdMinCaption = computed(
        () => app.transparencyMethod === 'color'
            ? (transparencyHighlightsModel.value
                ? `Opaque below ${transparentShadowsThresholdMinLabel.value}`
                : `Transparent below ${transparentShadowsThresholdMinLabel.value}`)
            : (transparencyHighlightsModel.value
                ? `Opaque at ${transparentShadowsThresholdMinLabel.value}`
                : `Transparent at ${transparentShadowsThresholdMinLabel.value}`)
    );

    const transparencyThresholdMaxCaption = computed(
        () => app.transparencyMethod === 'color'
            ? (transparencyHighlightsModel.value
                ? `Transparent at ${transparentShadowsThresholdMaxLabel.value}`
                : `Opaque at ${transparentShadowsThresholdMaxLabel.value}`)
            : (transparencyHighlightsModel.value
                ? `Transparent at ${transparentShadowsThresholdMaxLabel.value}`
                : `Opaque at ${transparentShadowsThresholdMaxLabel.value}`)
    );

    const transparencyRangeLabel = computed(
        () => app.transparencyMethod === 'color'
            ? 'Color Match Range'
            : app.transparencyMethod === 'saturation' ? 'Saturation Range' : 'Transparency Range',
    );

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

    const capOptions = [
        { label: 'Rounded Caps', value: 'rounded', icon: 'rounded_corner' },
        { label: 'Pointed Caps', value: 'pointed', icon: 'change_history' },
        { label: 'Swallowtail Caps', value: 'swallowtail', icon: 'content_cut' },
        { label: 'Square Caps', value: 'square', icon: 'crop' }
    ];

    const selectedCapOption = computed({
        get: () => capOptions.find((option) => option.value === app.capStyle) ?? capOptions[0],
        set: (option) => {
            if (!option?.value) return;
            app.setCapStyle(option.value);
        }
    });

    function getInputId(name) {
        return inputIdPrefix + '-' + name;
    }
</script>

<template>
    <section class="tools-section" :aria-labelledby="getInputId('heading')">
        <div :id="getInputId('heading')" class="tools-section-label">Transparency and Masking</div>
        <div class="tools-section-items">
            <div class="tools-toggle-row">
                <label
                    class="tools-toggle-main"
                    :for="getInputId('transparent-shadows-filter')"
                >
                    <span class="material-symbols-outlined" aria-hidden="true">opacity</span>
                    <span>Transparency</span>
                </label>
                <div class="tools-toggle-control">
                    <span class="tools-hint tools-toggle-hint">{{ transparentShadowsFilterModel ? 'On' : 'Off'
                    }}</span>
                    <ToggleSwitch
                        :inputId="getInputId('transparent-shadows-filter')"
                        v-model="transparentShadowsFilterModel"
                    />
                </div>
            </div>

            <div
                v-if="transparentShadowsFilterModel"
                class="tools-select-block"
            >
                <label class="tools-select-label" :for="getInputId('transparency-basis')">Transparency Basis</label>
                <div class="tools-select-wrap">
                    <Select
                        :input-id="getInputId('transparency-basis')"
                        aria-label="Transparency Basis"
                        v-model="selectedTransparencyMethodOption"
                        :options="transparencyMethodOptions"
                        option-label="label"
                        class="tools-select"
                    >
                        <template #value="slotProps">
                            <div
                                v-if="slotProps.value"
                                class="tools-select-row"
                            >
                                <span class="material-symbols-outlined tools-select-icon" aria-hidden="true">{{ slotProps.value.icon
                                    }}</span>
                                <span>{{ slotProps.value.label }}</span>
                            </div>
                            <span v-else>{{ slotProps.placeholder }}</span>
                        </template>
                        <template #option="slotProps">
                            <div class="tools-select-row">
                                <span class="material-symbols-outlined tools-select-icon" aria-hidden="true">{{ slotProps.option.icon
                                    }}</span>
                                <span>{{ slotProps.option.label }}</span>
                            </div>
                        </template>
                    </Select>
                </div>
            </div>

            <div
                v-if="transparentShadowsFilterModel"
                class="tools-toggle-row"
            >
                <label
                    class="tools-toggle-main"
                    :for="getInputId('overlap-only-transparency')"
                >
                    <span class="material-symbols-outlined" aria-hidden="true">layers</span>
                    <span>Overlap-only transparency</span>
                </label>
                <div class="tools-toggle-control">
                    <span class="tools-hint tools-toggle-hint">{{ overlapOnlyTransparencyModel ? 'On' : 'Off' }}</span>
                    <ToggleSwitch
                        :inputId="getInputId('overlap-only-transparency')"
                        v-model="overlapOnlyTransparencyModel"
                    />
                </div>
            </div>

            <div
                v-if="transparentShadowsFilterModel && overlapOnlyTransparencyModel"
                class="tools-toggle-row"
            >
                <label
                    class="tools-toggle-main"
                    :for="getInputId('overlap-mask-debug')"
                >
                    <span class="material-symbols-outlined" aria-hidden="true">layers</span>
                    <span>Show overlap mask (debug)</span>
                </label>
                <div class="tools-toggle-control">
                    <span class="tools-hint tools-toggle-hint">{{ overlapMaskDebugModel ? 'On' : 'Off' }}</span>
                    <ToggleSwitch
                        :inputId="getInputId('overlap-mask-debug')"
                        v-model="overlapMaskDebugModel"
                    />
                </div>
            </div>

            <div
                v-if="transparentShadowsFilterModel && app.transparencyMethod === 'color'"
                class="tools-color-row"
            >
                <label
                    class="tools-color-main"
                    :for="getInputId('transparency-reference-color')"
                >
                    <span
                        class="tools-color-swatch"
                        :style="{ backgroundColor: transparencyReferenceColorModel }"
                    ></span>
                    <span>Reference Color</span>
                </label>
                <div class="tools-color-control">
                    <InputText
                        unstyled
                        class="background-overlay-hex"
                        :model-value="transparencyReferenceColorInputModel"
                        maxlength="7"
                        spellcheck="false"
                        autocomplete="off"
                        aria-label="Transparency reference color hex code"
                        @change="onTransparencyReferenceColorInput"
                    />
                    <ColorPickerPopover
                        :inputId="getInputId('transparency-reference-color')"
                        v-model="transparencyReferenceColorPickerModel"
                        format="hex"
                        class="tools-color-picker"
                    />
                </div>
            </div>

            <div
                v-if="transparentShadowsFilterModel"
                class="tools-toggle-row"
            >
                <label
                    class="tools-toggle-main"
                    :for="getInputId('transparency-highlights-mode')"
                >
                    <span class="material-symbols-outlined" aria-hidden="true">opacity</span>
                    <span>{{ transparencyInversionLabel }}</span>
                </label>
                <div class="tools-toggle-control">
                    <span class="tools-hint tools-toggle-hint">{{ transparencyModeLabel }}</span>
                    <ToggleSwitch
                        :inputId="getInputId('transparency-highlights-mode')"
                        v-model="transparencyHighlightsModel"
                    />
                </div>
            </div>

            <div
                v-if="transparentShadowsFilterModel"
                class="tools-slider-block"
            >
                <div class="tools-slider-head">
                    <span class="tools-slider-label">{{ transparencyRangeLabel }}</span>
                    <span class="tools-hint tools-slider-hint">
                        {{ transparentShadowsThresholdMinLabel }} - {{ transparentShadowsThresholdMaxLabel }}
                    </span>
                </div>
                <Slider
                    v-model="transparentShadowsThresholdRangeModel"
                    :aria-label="transparencyRangeLabel"
                    range
                    :min="0"
                    :max="100"
                    :step="1"
                    class="tools-range-slider"
                />
                <div class="tools-slider-caption">
                    <span>{{ transparencyThresholdMinCaption }}</span>
                    <span>{{ transparencyThresholdMaxCaption }}</span>
                </div>
                <div
                    v-if="app.transparencyMethod === 'color'"
                    class="tools-slider-note"
                >
                    0% means no reference-color match; 100% means an exact match.
                </div>
                <div
                    v-else-if="app.transparencyMethod === 'saturation'"
                    class="tools-slider-note"
                >
                    0% means grayscale; 100% means fully saturated. Measured before color adjustments.
                </div>
            </div>

            <div class="tools-toggle-row">
                <label
                    class="tools-toggle-main"
                    :for="getInputId('peak-trough-enabled')"
                >
                    <span class="material-symbols-outlined" aria-hidden="true">vital_signs</span>
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
                <label class="tools-select-label" :for="getInputId('peak-trough-effect-type')">Effect Type</label>
                <div class="tools-select-wrap">
                    <Select
                        :input-id="getInputId('peak-trough-effect-type')"
                        aria-label="Effect Type"
                        v-model="peakTroughEffectModel"
                        :options="peakTroughEffectOptions"
                        option-label="label"
                        option-value="value"
                        class="tools-select"
                    >
                        <template #value="slotProps">
                            <div class="tools-select-row">
                                <span class="material-symbols-outlined tools-select-icon" aria-hidden="true">
                                    {{ peakTroughEffectOptions.find((option) => option.value === slotProps.value)?.icon }}
                                </span>
                                <span>{{ peakTroughEffectOptions.find((option) => option.value === slotProps.value)?.label }}</span>
                            </div>
                        </template>
                        <template #option="slotProps">
                            <div class="tools-select-row">
                                <span class="material-symbols-outlined tools-select-icon" aria-hidden="true">{{ slotProps.option.icon }}</span>
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
                    <span class="tools-slider-label">Effect Gradient</span>
                    <span class="tools-hint tools-slider-hint">{{ peakTroughGradientLabel }}</span>
                </div>
                <Slider
                    v-model="peakTroughGradientRangeModel"
                    aria-label="Effect Gradient"
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
                    <span class="tools-slider-label">
                        <span class="material-symbols-outlined" aria-hidden="true">blur_linear</span>
                        <span>Blur Strength</span>
                    </span>
                    <span class="tools-hint tools-slider-hint">{{ peakTroughBlurDisplay }}</span>
                </div>
                <Slider
                    :model-value="app.peakTroughBlurAmount"
                    :min="1"
                    :max="16"
                    :step="0.5"
                    aria-label="Blur Strength"
                    class="tools-range-slider"
                    @update:model-value="app.setPeakTroughBlurAmount"
                />
                <div class="tools-slider-caption">
                    <span>Subtle</span>
                    <span>Obliterate detail</span>
                </div>
            </div>

            <div
                v-if="app.surfaceMode !== 'tube' && app.proceduralPathMode !== 'mobius'"
                class="tools-select-block"
            >
                <label class="tools-select-label" :for="getInputId('cap-style')">Cap Style</label>
                <div class="tools-select-wrap">
                    <Select
                        :input-id="getInputId('cap-style')"
                        aria-label="Cap Style"
                        v-model="selectedCapOption"
                        :options="capOptions"
                        option-label="label"
                        class="tools-select"
                    >
                        <template #value="slotProps">
                            <div
                                v-if="slotProps.value"
                                class="tools-select-row"
                            >
                                <span class="material-symbols-outlined tools-select-icon" aria-hidden="true">{{ slotProps.value.icon
                                }}</span>
                                <span>{{ slotProps.value.label }}</span>
                            </div>
                            <span v-else>{{ slotProps.placeholder }}</span>
                        </template>
                        <template #option="slotProps">
                            <div class="tools-select-row">
                                <span class="material-symbols-outlined tools-select-icon" aria-hidden="true">{{ slotProps.option.icon
                                }}</span>
                                <span>{{ slotProps.option.label }}</span>
                            </div>
                        </template>
                    </Select>
                </div>
            </div>

            <div class="tools-toggle-row">
                <label class="tools-toggle-main" :for="getInputId('edge-drift-enabled')">
                    <span class="material-symbols-outlined" aria-hidden="true">vital_signs</span>
                    <span>Edge Drift</span>
                </label>
                <div class="tools-toggle-control">
                    <span class="tools-hint tools-toggle-hint">{{ edgeDriftEnabledModel ? 'On' : 'Off' }}</span>
                    <ToggleSwitch
                        :inputId="getInputId('edge-drift-enabled')"
                        v-model="edgeDriftEnabledModel"
                    />
                </div>
            </div>

            <div
                v-if="edgeDriftEnabledModel"
                class="tools-slider-block"
            >
                <div class="tools-slider-head">
                    <span class="tools-slider-label">Edge Variation</span>
                    <span class="tools-hint tools-slider-hint">{{ edgeNoiseTransparencyLabel }}</span>
                </div>
                <Slider
                    v-model="edgeNoiseTransparencyModel"
                    aria-label="Edge Variation"
                    :min="0"
                    :max="50"
                    :step="1"
                    class="tools-range-slider"
                />
                <div class="tools-slider-caption">
                    <span>No cut-in</span>
                    <span>Half width</span>
                </div>
            </div>

            <div
                v-if="edgeDriftEnabledModel"
                class="tools-slider-block"
            >
                <div class="tools-slider-head">
                    <span class="tools-slider-label">Pattern Length</span>
                    <span class="tools-hint tools-slider-hint">{{ edgeNoisePatternLengthLabel }}</span>
                </div>
                <Slider
                    v-model="edgeNoisePatternLengthModel"
                    aria-label="Pattern Length"
                    :min="0.1"
                    :max="2"
                    :step="0.1"
                    class="tools-range-slider"
                />
                <div class="tools-slider-caption">
                    <span>Short repeat</span>
                    <span>Long repeat</span>
                </div>
            </div>

            <div v-if="edgeDriftEnabledModel" class="tools-toggle-row">
                <label class="tools-toggle-main" :for="getInputId('edge-noise-mirrored')">
                    <span>Mirror Shape</span>
                </label>
                <div class="tools-toggle-control">
                    <span class="tools-hint tools-toggle-hint">{{ edgeNoiseMirroredModel ? 'On' : 'Off' }}</span>
                    <ToggleSwitch
                        :inputId="getInputId('edge-noise-mirrored')"
                        v-model="edgeNoiseMirroredModel"
                    />
                </div>
            </div>

            <div class="tools-toggle-row">
                <label class="tools-toggle-main" :for="getInputId('filmstrip-style-enabled')">
                    <span class="material-symbols-outlined" aria-hidden="true">theaters</span>
                    <span>Filmstrip Style</span>
                </label>
                <div class="tools-toggle-control">
                    <span class="tools-hint tools-toggle-hint">{{ filmstripStyleEnabledModel ? 'On' : 'Off'
                        }}</span>
                    <ToggleSwitch
                        :inputId="getInputId('filmstrip-style-enabled')"
                        v-model="filmstripStyleEnabledModel"
                    />
                </div>
            </div>

            <div v-if="filmstripStyleEnabledModel" class="tools-toggle-row">
                <label class="tools-toggle-main" :for="getInputId('filmstrip-motion-enabled')">
                    <span>Animate Filmstrip</span>
                </label>
                <div class="tools-toggle-control">
                    <span class="tools-hint tools-toggle-hint">{{ filmstripMotionEnabledModel ? 'On' : 'Off' }}</span>
                    <ToggleSwitch
                        :inputId="getInputId('filmstrip-motion-enabled')"
                        v-model="filmstripMotionEnabledModel"
                    />
                </div>
            </div>

            <div v-if="filmstripStyleEnabledModel && filmstripMotionEnabledModel" class="tools-slider-block">
                <div class="tools-slider-head">
                    <span class="tools-slider-label">Motion Speed</span>
                    <span class="tools-hint tools-slider-hint">{{ filmstripMotionSpeedModel }}%</span>
                </div>
                <Slider
                    v-model="filmstripMotionSpeedModel"
                    :min="10"
                    :max="300"
                    :step="10"
                    aria-label="Filmstrip Motion Speed"
                    class="tools-range-slider"
                />
                <div class="tools-slider-caption">
                    <span>Slower</span>
                    <span>Faster</span>
                </div>
                <p class="tools-hint">100% matches conveyor flow. With flow off, motion uses the selected conveyor speed.</p>
            </div>

            <div
                v-if="filmstripStyleEnabledModel"
                class="tools-slider-block"
            >
                <div class="tools-slider-head">
                    <span class="tools-slider-label">Gap Length</span>
                    <span class="tools-hint tools-slider-hint">{{ filmstripGapLengthLabel }}</span>
                </div>
                <Slider
                    v-model="filmstripGapLengthModel"
                    aria-label="Gap Length"
                    :min="5"
                    :max="200"
                    :step="1"
                    class="tools-range-slider"
                />
                <div class="tools-slider-caption">
                    <span>Tight gap</span>
                    <span>Wide gap</span>
                </div>
            </div>

            <div
                v-if="filmstripStyleEnabledModel"
                class="tools-slider-block"
            >
                <div class="tools-slider-head">
                    <span class="tools-slider-label">Hole Length</span>
                    <span class="tools-hint tools-slider-hint">{{ filmstripHoleLengthLabel }}</span>
                </div>
                <Slider
                    v-model="filmstripHoleLengthModel"
                    aria-label="Hole Length"
                    :min="5"
                    :max="100"
                    :step="1"
                    class="tools-range-slider"
                />
                <div class="tools-slider-caption">
                    <span>Short hole</span>
                    <span>Long hole</span>
                </div>
            </div>

            <div
                v-if="filmstripStyleEnabledModel"
                class="tools-slider-block"
            >
                <div class="tools-slider-head">
                    <span class="tools-slider-label">Aperture</span>
                    <span class="tools-hint tools-slider-hint">{{ filmstripApertureLabel }}</span>
                </div>
                <Slider
                    v-model="filmstripApertureModel"
                    aria-label="Aperture"
                    :min="10"
                    :max="95"
                    :step="1"
                    class="tools-range-slider"
                />
                <div class="tools-slider-caption">
                    <span>Narrow opening</span>
                    <span>Wide opening</span>
                </div>
            </div>

            <div
                v-if="filmstripStyleEnabledModel"
                class="tools-slider-block"
            >
                <div class="tools-slider-head">
                    <span class="tools-slider-label">Hole Roundedness</span>
                    <span class="tools-hint tools-slider-hint">{{ filmstripHoleRoundednessLabel }}</span>
                </div>
                <Slider
                    v-model="filmstripHoleRoundednessModel"
                    aria-label="Hole Roundedness"
                    :min="0"
                    :max="100"
                    :step="1"
                    class="tools-range-slider"
                />
                <div class="tools-slider-caption">
                    <span>Square</span>
                    <span>Rounded</span>
                </div>
            </div>
        </div>
    </section>
</template>

<style scoped src="./textureSettingsControls.css"></style>

<style scoped>
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

    .tools-range-slider {
        width: calc(100% - 1rem);
        margin: 0 0.5rem;
    }

    :deep(.tools-color-picker.color-picker-trigger) {
        width: 2rem;
        height: 2rem;
    }

    :deep(.tools-range-slider .p-slider-handle) {
        background: var(--p-primary-color, #10b981) !important;
        border-color: var(--p-primary-color, #10b981) !important;
    }

    :deep(.tools-range-slider .p-slider-handle::before) {
        background: var(--p-primary-color, #10b981) !important;
    }
</style>
