<script setup>
    import { computed, ref, watch, getCurrentInstance, onBeforeUnmount } from 'vue';
    import ColorPickerPopover from '../color-picker/ColorPickerPopover.vue';
    import Select from 'primevue/select';
    import Slider from 'primevue/slider';
    import ToggleSwitch from 'primevue/toggleswitch';
    import { useViewerStore } from '../../stores/viewerStore';
    import {
        applyLiveContrast,
        applyLiveSaturation,
    } from '../../modules/viewer/rendererAdjustmentBus';
    import {
        createGradientMapLut,
        MAX_GRADIENT_MAP_STOPS,
    } from '../../modules/viewer/gradientMap';

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

    const gradientMapFilterModel = computed({
        get: () => app.renderFilterMode === 'gradientMap',
        set: (value) => {
            app.setRenderFilterMode(value ? 'gradientMap' : 'none');
        }
    });

    const transparentShadowsFilterModel = computed({
        get: () => app.transparentShadowsEnabled,
        set: (value) => {
            app.setTransparentShadowsEnabled(!!value);
        }
    });

    const transparencyMethodOptions = [
        { label: 'Brightness', value: 'brightness', icon: 'brightness_6' },
        { label: 'Reference Color', value: 'color', icon: 'colorize' },
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
            : (transparencyHighlightsModel.value ? 'Highlights' : 'Shadows')
    );

    const transparencyInversionLabel = computed(
        () => app.transparencyMethod === 'color' ? 'Invert Color Match' : 'Highlights',
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
        () => app.transparencyMethod === 'color' ? 'Color Match Range' : 'Transparency Range',
    );

    const gradientBarRef = ref(null);
    const selectedGradientStopId = ref(app.gradientMapStops[1]?.id ?? app.gradientMapStops[0]?.id ?? null);
    let draggedGradientStopId = null;

    const gradientMapStops = computed(() => app.gradientMapStops);
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
        app.setGradientMapStops(gradientMapStops.value.map((stop) => (
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
        app.setGradientMapStops([
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
        app.setGradientMapStops(gradientMapStops.value.filter((stop) => stop.id !== stopId));
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
        event.preventDefault();
        draggedGradientStopId = stopId;
        selectedGradientStopId.value = stopId;
        window.addEventListener('pointermove', onGradientStopPointerMove);
        window.addEventListener('pointerup', stopGradientStopDrag, { once: true });
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
            app.setGradientMapStops(gradientMapStops.value);
        }
        draggedGradientStopId = null;
        window.removeEventListener('pointermove', onGradientStopPointerMove);
        window.removeEventListener('pointerup', stopGradientStopDrag);
    }

    onBeforeUnmount(stopGradientStopDrag);

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

    const normalizeTextureOrientationModel = computed({
        get: () => app.normalizeTextureOrientation,
        set: (value) => {
            app.setNormalizeTextureOrientation(!!value);
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
                        :for="getInputId('normalize-texture-orientation')"
                    >
                        <span class="material-symbols-outlined">text_select_move_up</span>
                        <span>Normalize Orientation</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ normalizeTextureOrientationModel ? 'On' : 'Off'
                            }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('normalize-texture-orientation')"
                            v-model="normalizeTextureOrientationModel"
                        />
                    </div>
                </div>

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
                    class="tools-select-block"
                >
                    <label class="tools-select-label">Transparency Basis</label>
                    <div class="tools-select-wrap">
                        <Select
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
                    v-if="showTransparentShadowsFilter && transparentShadowsFilterModel && app.transparencyMethod === 'color'"
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
                        <input
                            :id="getInputId('transparency-reference-color-hex')"
                            type="text"
                            class="background-overlay-hex"
                            :value="transparencyReferenceColorInputModel"
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
                    v-if="showTransparentShadowsFilter && transparentShadowsFilterModel"
                    class="tools-toggle-row"
                >
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('transparency-highlights-mode')"
                    >
                        <span class="material-symbols-outlined">opacity</span>
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
                    v-if="showTransparentShadowsFilter && transparentShadowsFilterModel"
                    class="tools-slider-block"
                >
                    <div class="tools-slider-head">
                        <label class="tools-slider-label">{{ transparencyRangeLabel }}</label>
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
                    <div
                        v-if="app.transparencyMethod === 'color'"
                        class="tools-slider-note"
                    >
                        0% means no reference-color match; 100% means an exact match.
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

                <div
                    v-if="edgeDriftEnabledModel"
                    class="tools-slider-block"
                >
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

                <div
                    v-if="edgeDriftEnabledModel"
                    class="tools-slider-block"
                >
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
                        <span class="tools-hint tools-toggle-hint">{{ filmstripStyleEnabledModel ? 'On' : 'Off'
                            }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('filmstrip-style-enabled')"
                            v-model="filmstripStyleEnabledModel"
                        />
                    </div>
                </label>

                <div
                    v-if="filmstripStyleEnabledModel"
                    class="tools-slider-block"
                >
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

                <div
                    v-if="filmstripStyleEnabledModel"
                    class="tools-slider-block"
                >
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

                <div
                    v-if="filmstripStyleEnabledModel"
                    class="tools-slider-block"
                >
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

                <div
                    v-if="filmstripStyleEnabledModel"
                    class="tools-slider-block"
                >
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
                        :for="getInputId('gradient-map-filter')"
                    >
                        <span class="material-symbols-outlined">palette</span>
                        <span>Gradient Map</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ gradientMapFilterModel ? 'On' : 'Off' }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('gradient-map-filter')"
                            v-model="gradientMapFilterModel"
                        />
                    </div>
                </div>

                <div
                    v-if="showDuotoneFilter && gradientMapFilterModel"
                    class="gradient-map-editor"
                >
                    <div class="gradient-map-header">
                        <span>Color Stops</span>
                        <button
                            type="button"
                            class="gradient-map-add"
                            :disabled="gradientMapStops.length >= MAX_GRADIENT_MAP_STOPS"
                            title="Add color stop"
                            @click="addGradientStop"
                        >
                            <span class="material-symbols-outlined">add</span>
                            Add
                        </button>
                    </div>

                    <div class="gradient-map-track-wrap">
                        <div
                            ref="gradientBarRef"
                            class="gradient-map-track"
                            :style="gradientPreviewStyle"
                            title="Double-click to add a stop"
                            @dblclick="onGradientBarDoubleClick"
                        >
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
                            <input
                                type="text"
                                class="gradient-map-hex"
                                :value="stop.color.toUpperCase()"
                                maxlength="7"
                                aria-label="Stop color"
                                @change="onGradientStopColor(stop.id, $event.target.value)"
                            />
                            <div class="gradient-map-position-wrap">
                                <input
                                    type="number"
                                    class="gradient-map-position"
                                    :value="Math.round(stop.position * 100)"
                                    min="0"
                                    max="100"
                                    step="1"
                                    aria-label="Stop position percentage"
                                    @change="onGradientStopPosition(stop.id, $event.target.value)"
                                />
                                <span>%</span>
                            </div>
                            <button
                                type="button"
                                class="gradient-map-remove"
                                :disabled="gradientMapStops.length <= 2"
                                title="Remove color stop"
                                @click.stop="removeGradientStop(stop.id)"
                            >
                                <span class="material-symbols-outlined">close</span>
                            </button>
                        </div>
                    </div>

                    <p class="gradient-map-caption">
                        Maps scene luminance from shadows to highlights. Drag stops or double-click the ramp to add one.
                    </p>
                </div>

                <div class="tools-slider-block">
                    <div class="tools-slider-head">
                        <label class="tools-slider-label">
                            <span class="material-symbols-outlined">contrast</span>
                            <span>Contrast</span>
                        </label>
                        <span
                            ref="contrastLabelRef"
                            class="tools-hint tools-slider-hint"
                        >{{ initialContrast }}%</span>
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
                        <span
                            ref="saturationLabelRef"
                            class="tools-hint tools-slider-hint"
                        >{{ initialSaturation }}%</span>
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

    .gradient-map-editor {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 0 0.75rem 1rem;
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

    .gradient-map-add,
    .gradient-map-remove {
        appearance: none;
        border: 0;
        color: rgba(255, 255, 255, 0.72);
        background: rgba(255, 255, 255, 0.08);
        cursor: pointer;
    }

    .gradient-map-add {
        display: inline-flex;
        align-items: center;
        gap: 0.15rem;
        padding: 0.3rem 0.5rem;
        border-radius: 6px;
        font-size: 0.7rem;
    }

    .gradient-map-add .material-symbols-outlined,
    .gradient-map-remove .material-symbols-outlined {
        font-size: 1rem;
    }

    .gradient-map-add:disabled,
    .gradient-map-remove:disabled {
        opacity: 0.3;
        cursor: default;
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
        border-radius: 999px;
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
        border-radius: 9px;
        background: rgba(255, 255, 255, 0.035);
    }

    .gradient-map-stop-row.is-selected {
        border-color: rgba(255, 255, 255, 0.18);
        background: rgba(255, 255, 255, 0.1);
    }

    .gradient-map-hex,
    .gradient-map-position {
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.2);
        color: rgba(255, 255, 255, 0.9);
        font: 0.75rem/1.2 monospace;
        outline: none;
    }

    .gradient-map-hex {
        padding: 0.45rem 0.5rem;
        text-transform: uppercase;
    }

    .gradient-map-position-wrap {
        display: flex;
        align-items: center;
        gap: 0.2rem;
        color: rgba(255, 255, 255, 0.52);
        font-size: 0.72rem;
    }

    .gradient-map-position {
        padding: 0.45rem 0.25rem 0.45rem 0.45rem;
    }

    .gradient-map-remove {
        display: grid;
        width: 1.75rem;
        height: 1.75rem;
        place-items: center;
        padding: 0;
        border-radius: 50%;
    }

    .gradient-map-caption {
        margin: 0;
        color: rgba(255, 255, 255, 0.48);
        font-size: 0.68rem;
        line-height: 1.35;
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

    .tools-slider-note {
        color: rgba(255, 255, 255, 0.48);
        font-size: 0.7rem;
        line-height: 1.35;
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
