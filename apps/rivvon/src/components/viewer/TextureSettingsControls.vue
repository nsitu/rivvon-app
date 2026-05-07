<script setup>
    import { computed, getCurrentInstance } from 'vue';
    import ColorPicker from 'primevue/colorpicker';
    import Select from 'primevue/select';
    import Slider from 'primevue/slider';
    import ToggleSwitch from 'primevue/toggleswitch';
    import { useViewerStore } from '../../stores/viewerStore';

    defineProps({
        showPreferredResolution: { type: Boolean, default: false },
        showBlackAndWhiteFilter: { type: Boolean, default: false },
        showDuotoneFilter: { type: Boolean, default: false },
        showTransparentShadowsFilter: { type: Boolean, default: false },
        showOverviewVerticalFlip: { type: Boolean, default: true },
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

    const blackAndWhiteFilterModel = computed({
        get: () => app.renderFilterMode === 'blackAndWhite',
        set: (value) => {
            app.setRenderFilterMode(value ? 'blackAndWhite' : 'none');
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

    const mirrorTilesModel = computed({
        get: () => app.textureRepeatMode === 'mirrorTile',
        set: (value) => {
            app.setTextureRepeatMode(value ? 'mirrorTile' : 'wrap');
        }
    });

    const overviewVerticalFlipModel = computed({
        get: () => app.textureOverviewFlipVertical,
        set: (value) => {
            app.setTextureOverviewFlipVertical(!!value);
        }
    });

    function getInputId(name) {
        return `${inputIdPrefix}-${name}`;
    }
</script>

<template>
    <div class="texture-settings-controls">
        <div class="tools-section">
            <div class="tools-section-label">Texture</div>

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
                    v-if="showOverviewVerticalFlip"
                    class="tools-toggle-row"
                >
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('overview-vertical-flip')"
                    >
                        <span class="material-symbols-outlined">swap_vert</span>
                        <span>Flip Overview Vertically</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ overviewVerticalFlipModel ? 'On' : 'Off' }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('overview-vertical-flip')"
                            v-model="overviewVerticalFlipModel"
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
                    v-if="showBlackAndWhiteFilter"
                    class="tools-toggle-row"
                >
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('black-and-white-filter')"
                    >
                        <span class="material-symbols-outlined">filter_b_and_w</span>
                        <span>Black and White</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ blackAndWhiteFilterModel ? 'On' : 'Off' }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('black-and-white-filter')"
                            v-model="blackAndWhiteFilterModel"
                        />
                    </div>
                </div>

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
                    v-if="showTransparentShadowsFilter"
                    class="tools-toggle-row"
                >
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('transparent-shadows-filter')"
                    >
                        <span class="material-symbols-outlined">filter_alt</span>
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
                        <span class="material-symbols-outlined">filter_alt</span>
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
            </div>
        </div>
    </div>
</template>

<style scoped>
    .texture-settings-controls {
        width: 100%;
    }

    .tools-section {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .tools-section-label {
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(255, 255, 255, 0.4);
        padding: 0 0.5rem 0.25rem;
    }

    .tools-section-items {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        background: rgba(0, 0, 0, 0.25);
        border-radius: 10px;
        padding: 0.25rem;
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
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.78);
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
</style>