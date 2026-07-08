<script setup>
    import { computed, ref, watch, getCurrentInstance } from 'vue';
    import ColorPicker from 'primevue/colorpicker';
    import Select from 'primevue/select';
    import Slider from 'primevue/slider';
    import ToggleSwitch from 'primevue/toggleswitch';
    import { useViewerStore } from '../../stores/viewerStore';
    import {
        applyLiveContrast,
        applyLiveSaturation,
    } from '../../modules/viewer/rendererAdjustmentBus';

    defineProps({
        showPreferredResolution: { type: Boolean, default: false },
        showDuotoneFilter: { type: Boolean, default: false },
        showTransparentShadowsFilter: { type: Boolean, default: false },
        showVerticalFlip: { type: Boolean, default: true },
    });

    const app = useViewerStore();
    const instanceUid = getCurrentInstance()?.uid ?? Math.round(Math.random() * 1e9);
    const inputIdPrefix = `texture-settings-${instanceUid}`;

    const preferredTextureResolutionOptions = [
        { label: '256 px', value: 256, icon: 'aspect_ratio' },
        { label: '512 px', value: 512, icon: 'aspect_ratio' },
        { label: '1024 px', value: 1024, icon: 'aspect_ratio' }
    ];

    const selectedPreferredTextureResolutionOption = computed({
        get: () => preferredTextureResolutionOptions.find((option) => option.value === app.preferredTextureMaxResolution)
            ?? preferredTextureResolutionOptions[0],
        set: (option) => {
            if (!option?.value) return;
            app.setPreferredTextureMaxResolution(option.value);
        }
    });

    const duotoneFilterModel = computed({
        get: () => app.renderFilterMode === 'duotone',
        set: (value) => {
            app.setRenderFilterMode(value ? 'duotone' : 'none');
        }
    });

    const transparentShadowsFilterModel = computed({
        get: () => app.transparentShadowsEnabled,
        set: (value) => {
            app.setTransparentShadowsEnabled(!!value);
        }
    });

    const transparencyHighlightsModel = computed({
        get: () => app.transparencyMode === 'highlights',
        set: (value) => {
            app.setTransparencyMode(value ? 'highlights' : 'shadows');
        }
    });

    const transparencyModeLabel = computed(
        () => transparencyHighlightsModel.value ? 'Highlights' : 'Shadows'
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
        () => transparencyHighlightsModel.value
            ? `Opaque at ${transparentShadowsThresholdMinLabel.value}`
            : `Transparent at ${transparentShadowsThresholdMinLabel.value}`
    );

    const transparencyThresholdMaxCaption = computed(
        () => transparencyHighlightsModel.value
            ? `Transparent at ${transparentShadowsThresholdMaxLabel.value}`
            : `Opaque at ${transparentShadowsThresholdMaxLabel.value}`
    );

    const duotoneColorModel = computed({
        get: () => app.duotoneColor,
        set: (value) => {
            app.setDuotoneColor(value);
        }
    });

    const duotoneColorPickerModel = computed({
        get: () => duotoneColorModel.value.replace('#', ''),
        set: (value) => {
            app.setDuotoneColor(typeof value === 'string' ? `#${value}` : value);
        }
    });

    const duotoneColorLabel = computed(() => duotoneColorModel.value.toUpperCase());

    // Contrast / saturation use native <input type="range"> + imperative DOM updates
    // during drag, bypassing Vue reactivity entirely on @input. We only touch
    // reactive state on @change (commit), so PrimeVue / TextureSettingsControls
    // do not re-render at 60Hz during the drag.
    const contrastInputRef = ref(null);
    const contrastLabelRef = ref(null);
    const saturationInputRef = ref(null);
    const saturationLabelRef = ref(null);

    const initialContrast = Math.round(app.contrast * 100);
    const initialSaturation = Math.round(app.saturation * 100);

    // Keep DOM in sync with external Pinia changes (reset, restore, etc.).
    watch(() => app.contrast, (value) => {
        const next = Math.round(value * 100);
        if (contrastInputRef.value && Number(contrastInputRef.value.value) !== next) {
            contrastInputRef.value.value = String(next);
        }
        if (contrastLabelRef.value) {
            contrastLabelRef.value.textContent = `${next}%`;
        }
    });

    watch(() => app.saturation, (value) => {
        const next = Math.round(value * 100);
        if (saturationInputRef.value && Number(saturationInputRef.value.value) !== next) {
            saturationInputRef.value.value = String(next);
        }
        if (saturationLabelRef.value) {
            saturationLabelRef.value.textContent = `${next}%`;
        }
    });

    function onContrastInput(event) {
        const numeric = Number(event?.target?.value);
        if (!Number.isFinite(numeric)) return;
        // Imperative label update — no Vue re-render.
        if (contrastLabelRef.value) {
            contrastLabelRef.value.textContent = `${Math.round(numeric)}%`;
        }
        // Bypass Pinia/Vue reactivity during drag — hit the renderer directly.
        applyLiveContrast(numeric / 100);
    }

    function onContrastCommit(event) {
        const numeric = Number(event?.target?.value);
        if (!Number.isFinite(numeric)) return;
        // Commit to Pinia (persists to localStorage, updates "has changes", etc.).
        app.setContrast(numeric / 100);
    }

    function onSaturationInput(event) {
        const numeric = Number(event?.target?.value);
        if (!Number.isFinite(numeric)) return;
        if (saturationLabelRef.value) {
            saturationLabelRef.value.textContent = `${Math.round(numeric)}%`;
        }
        applyLiveSaturation(numeric / 100);
    }

    function onSaturationCommit(event) {
        const numeric = Number(event?.target?.value);
        if (!Number.isFinite(numeric)) return;
        app.setSaturation(numeric / 100);
    }

    const mirrorTilesModel = computed({
        get: () => app.textureRepeatMode === 'mirrorTile',
        set: (value) => {
            app.setTextureRepeatMode(value ? 'mirrorTile' : 'wrap');
        }
    });

    const verticalFlipModel = computed({
        get: () => app.textureFlipVertical,
        set: (value) => {
            app.setTextureFlipVertical(!!value);
        }
    });

    function getInputId(name) {
        return `${inputIdPrefix}-${name}`;
    }
</script>

<template>
    <div class="texture-settings-controls">
        <div class="tools-section">
            <div class="tools-section-label">Texture and Materials</div>

            <div class="tools-section-items">
                <div class="tools-toggle-row">
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('mirror-tiles')"
                    >
                        <span class="material-symbols-outlined">swap_horiz</span>
                        <span>Mirror Tiles</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ mirrorTilesModel ? 'On' : 'Off' }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('mirror-tiles')"
                            v-model="mirrorTilesModel"
                        />
                    </div>
                </div>

                <div
                    v-if="showVerticalFlip"
                    class="tools-toggle-row"
                >
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('vertical-flip')"
                    >
                        <span class="material-symbols-outlined">swap_vert</span>
                        <span>Flip Vertically</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ verticalFlipModel ? 'On' : 'Off' }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('vertical-flip')"
                            v-model="verticalFlipModel"
                        />
                    </div>
                </div>

                <div
                    v-if="showPreferredResolution"
                    class="tools-select-block"
                >
                    <label class="tools-select-label">Preferred Resolution</label>
                    <div class="tools-select-wrap">
                        <Select
                            v-model="selectedPreferredTextureResolutionOption"
                            :options="preferredTextureResolutionOptions"
                            option-label="label"
                            class="tools-select"
                        >
                            <template #value="slotProps">
                                <div
                                    v-if="slotProps.value"
                                    class="tools-select-row"
                                >
                                    <span class="material-symbols-outlined tools-select-icon">{{ slotProps.value.icon
                                    }}</span>
                                    <span>{{ slotProps.value.label }}</span>
                                </div>
                                <span v-else>{{ slotProps.placeholder }}</span>
                            </template>
                            <template #option="slotProps">
                                <div class="tools-select-row">
                                    <span class="material-symbols-outlined tools-select-icon">{{ slotProps.option.icon
                                    }}</span>
                                    <span>{{ slotProps.option.label }}</span>
                                </div>
                            </template>
                        </Select>
                    </div>
                </div>

                <div
                    v-if="showTransparentShadowsFilter"
                    class="tools-toggle-row"
                >
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('transparent-shadows-filter')"
                    >
                        <span class="material-symbols-outlined">opacity</span>
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
                    v-if="showTransparentShadowsFilter && transparentShadowsFilterModel"
                    class="tools-toggle-row"
                >
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('transparency-highlights-mode')"
                    >
                        <span class="material-symbols-outlined">opacity</span>
                        <span>Highlights</span>
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
                    v-if="showTransparentShadowsFilter && transparentShadowsFilterModel"
                    class="tools-slider-block"
                >
                    <div class="tools-slider-head">
                        <label class="tools-slider-label">Transparency Range</label>
                        <span class="tools-hint tools-slider-hint">
                            {{ transparentShadowsThresholdMinLabel }} - {{ transparentShadowsThresholdMaxLabel }}
                        </span>
                    </div>
                    <Slider
                        v-model="transparentShadowsThresholdRangeModel"
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
                </div>

                <label
                    class="tools-toggle-row"
                    :for="getInputId('edge-drift-enabled')"
                >
                    <span class="tools-toggle-main">
                        <span class="material-symbols-outlined">vital_signs</span>
                        <span class="tools-toggle-title">Edge Drift</span>
                    </span>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ edgeDriftEnabledModel ? 'On' : 'Off' }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('edge-drift-enabled')"
                            v-model="edgeDriftEnabledModel"
                        />
                    </div>
                </label>

                <div v-if="edgeDriftEnabledModel" class="tools-slider-block">
                    <div class="tools-slider-head">
                        <label class="tools-slider-label">Edge Variation</label>
                        <span class="tools-hint tools-slider-hint">{{ edgeNoiseTransparencyLabel }}</span>
                    </div>
                    <Slider
                        v-model="edgeNoiseTransparencyModel"
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

                <div v-if="edgeDriftEnabledModel" class="tools-slider-block">
                    <div class="tools-slider-head">
                        <label class="tools-slider-label">Pattern Length</label>
                        <span class="tools-hint tools-slider-hint">{{ edgeNoisePatternLengthLabel }}</span>
                    </div>
                    <Slider
                        v-model="edgeNoisePatternLengthModel"
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

                <label
                    v-if="edgeDriftEnabledModel"
                    class="tools-toggle-row"
                    :for="getInputId('edge-noise-mirrored')"
                >
                    <span class="tools-toggle-copy">
                        <span class="tools-toggle-title">Mirror Shape</span>
                    </span>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ edgeNoiseMirroredModel ? 'On' : 'Off' }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('edge-noise-mirrored')"
                            v-model="edgeNoiseMirroredModel"
                        />
                    </div>
                </label>

                <label
                    class="tools-toggle-row"
                    :for="getInputId('filmstrip-style-enabled')"
                >
                    <span class="tools-toggle-main">
                        <span class="material-symbols-outlined">theaters</span>
                        <span class="tools-toggle-title">Filmstrip Style</span>
                    </span>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ filmstripStyleEnabledModel ? 'On' : 'Off' }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('filmstrip-style-enabled')"
                            v-model="filmstripStyleEnabledModel"
                        />
                    </div>
                </label>

                <div v-if="filmstripStyleEnabledModel" class="tools-slider-block">
                    <div class="tools-slider-head">
                        <label class="tools-slider-label">Gap Length</label>
                        <span class="tools-hint tools-slider-hint">{{ filmstripGapLengthLabel }}</span>
                    </div>
                    <Slider
                        v-model="filmstripGapLengthModel"
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

                <div v-if="filmstripStyleEnabledModel" class="tools-slider-block">
                    <div class="tools-slider-head">
                        <label class="tools-slider-label">Hole Length</label>
                        <span class="tools-hint tools-slider-hint">{{ filmstripHoleLengthLabel }}</span>
                    </div>
                    <Slider
                        v-model="filmstripHoleLengthModel"
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

                <div v-if="filmstripStyleEnabledModel" class="tools-slider-block">
                    <div class="tools-slider-head">
                        <label class="tools-slider-label">Aperture</label>
                        <span class="tools-hint tools-slider-hint">{{ filmstripApertureLabel }}</span>
                    </div>
                    <Slider
                        v-model="filmstripApertureModel"
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

                <div v-if="filmstripStyleEnabledModel" class="tools-slider-block">
                    <div class="tools-slider-head">
                        <label class="tools-slider-label">Hole Roundedness</label>
                        <span class="tools-hint tools-slider-hint">{{ filmstripHoleRoundednessLabel }}</span>
                    </div>
                    <Slider
                        v-model="filmstripHoleRoundednessModel"
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
        </div>

        <div class="tools-section">
            <div class="tools-section-label">Scene</div>

            <div class="tools-section-items">
                <div
                    v-if="showDuotoneFilter"
                    class="tools-toggle-row"
                >
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('duotone-filter')"
                    >
                        <span class="material-symbols-outlined">palette</span>
                        <span>Duotone</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ duotoneFilterModel ? 'On' : 'Off' }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('duotone-filter')"
                            v-model="duotoneFilterModel"
                        />
                    </div>
                </div>

                <div
                    v-if="showDuotoneFilter && duotoneFilterModel"
                    class="tools-color-row"
                >
                    <label
                        class="tools-color-main"
                        :for="getInputId('duotone-color')"
                    >
                        <span
                            class="tools-color-swatch"
                            :style="{ backgroundColor: duotoneColorModel }"
                        ></span>
                        <span>Duotone Color</span>
                    </label>
                    <div class="tools-color-control">
                        <span class="tools-hint tools-color-hint">{{ duotoneColorLabel }}</span>
                        <ColorPicker
                            :inputId="getInputId('duotone-color')"
                            v-model="duotoneColorPickerModel"
                            format="hex"
                            class="tools-color-picker"
                        />
                    </div>
                </div>

                <div class="tools-slider-block">
                    <div class="tools-slider-head">
                        <label class="tools-slider-label">
                            <span class="material-symbols-outlined">contrast</span>
                            <span>Contrast</span>
                        </label>
                        <span ref="contrastLabelRef" class="tools-hint tools-slider-hint">{{ initialContrast }}%</span>
                    </div>
                    <input
                        ref="contrastInputRef"
                        type="range"
                        :value="initialContrast"
                        @input="onContrastInput"
                        @change="onContrastCommit"
                        min="0"
                        max="200"
                        step="1"
                        class="tools-native-range"
                        aria-label="Contrast"
                    />
                    <div class="tools-slider-caption">
                        <span>Low</span>
                        <span>High</span>
                    </div>
                </div>

                <div class="tools-slider-block">
                    <div class="tools-slider-head">
                        <label class="tools-slider-label">
                            <span class="material-symbols-outlined">colors</span>
                            <span>Saturation</span>
                        </label>
                        <span ref="saturationLabelRef" class="tools-hint tools-slider-hint">{{ initialSaturation }}%</span>
                    </div>
                    <input
                        ref="saturationInputRef"
                        type="range"
                        :value="initialSaturation"
                        @input="onSaturationInput"
                        @change="onSaturationCommit"
                        min="0"
                        max="200"
                        step="1"
                        class="tools-native-range"
                        aria-label="Saturation"
                    />
                    <div class="tools-slider-caption">
                        <span>Grayscale</span>
                        <span>Vivid</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .texture-settings-controls {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
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

    .tools-color-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 0 1rem 0.875rem;
        color: var(--p-text-color, #fff);
    }

    .tools-color-row.is-disabled {
        opacity: 0.6;
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

    .tools-slider-block {
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
        padding: 0 1rem 0.875rem;
        color: var(--p-text-color, #fff);
    }

    .tools-slider-head {
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
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        color: rgba(255, 255, 255, 0.56);
        font-size: 0.72rem;
    }

    .tools-select-block {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        padding: 0.5rem;
    }

    .tools-select-label {
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.6);
        padding: 0 0.1rem;
    }

    .tools-select-wrap {
        padding: 0;
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

    :deep(.tools-color-picker .p-colorpicker-preview) {
        width: 2rem;
        height: 2rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        box-shadow: none;
        background-image:
            linear-gradient(45deg, rgba(255, 255, 255, 0.08) 25%, transparent 25%),
            linear-gradient(-45deg, rgba(255, 255, 255, 0.08) 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.08) 75%),
            linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, 0.08) 75%);
        background-size: 10px 10px;
        background-position: 0 0, 0 5px, 5px -5px, -5px 0;
    }

    :deep(.tools-range-slider .p-slider-handle) {
        background: var(--p-primary-color, #10b981) !important;
        border-color: var(--p-primary-color, #10b981) !important;
    }

    :deep(.tools-range-slider .p-slider-handle::before) {
        background: var(--p-primary-color, #10b981) !important;
    }

    /* Native range input used for contrast/saturation — bypasses Vue/PrimeVue
       re-renders during drag for smooth 60fps interaction. */
    .tools-native-range {
        -webkit-appearance: none;
        appearance: none;
        width: calc(100% - 1rem);
        margin: 0.5rem;
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
        background: var(--p-primary-color, #10b981);
        border: 2px solid var(--p-primary-color, #10b981);
        border-radius: 50%;
        cursor: grab;
        box-shadow: 0 0 0 6px transparent;
        transition: box-shadow 0.15s ease;
    }

    .tools-native-range:hover::-webkit-slider-thumb,
    .tools-native-range:focus::-webkit-slider-thumb {
        box-shadow: 0 0 0 6px rgba(16, 185, 129, 0.18);
    }

    .tools-native-range:active::-webkit-slider-thumb {
        cursor: grabbing;
    }

    .tools-native-range::-moz-range-thumb {
        width: 18px;
        height: 18px;
        background: var(--p-primary-color, #10b981);
        border: 2px solid var(--p-primary-color, #10b981);
        border-radius: 50%;
        cursor: grab;
        box-shadow: 0 0 0 6px transparent;
        transition: box-shadow 0.15s ease;
    }

    .tools-native-range:hover::-moz-range-thumb,
    .tools-native-range:focus::-moz-range-thumb {
        box-shadow: 0 0 0 6px rgba(16, 185, 129, 0.18);
    }
</style>