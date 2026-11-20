<script setup>
    import { computed, ref, watch, getCurrentInstance } from 'vue';
    import Select from 'primevue/select';
    import Slider from 'primevue/slider';
    import ToggleSwitch from 'primevue/toggleswitch';
    import { useViewerStore } from '../../stores/viewerStore';
    import {
        applyLiveContrast,
        applyLiveSaturation,
    } from '../../modules/viewer/rendererAdjustmentBus';
    import { BLEND_MODE_OPTIONS } from '../../../../../packages/shared-types/src/blendModes.js';
    import GradientMapEditor from './GradientMapEditor.vue';

    defineProps({
        showPreferredResolution: { type: Boolean, default: false },
        showDuotoneFilter: { type: Boolean, default: false },
        showVerticalFlip: { type: Boolean, default: true },
        disabled: Boolean,
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

            </div>
        </div>

        <div class="tools-section">
            <div class="tools-section-label">Scene</div>

            <div class="tools-section-items">
                <div class="tools-select-block">
                    <label class="tools-select-label" :for="getInputId('artwork-blend-mode')">Artwork Blend</label>
                    <Select :input-id="getInputId('artwork-blend-mode')" aria-label="Artwork Blend" :aria-describedby="getInputId('artwork-blend-hint')" :model-value="app.artworkBlendMode"
                        :options="BLEND_MODE_OPTIONS" option-label="label" option-value="value" class="tools-select"
                        :disabled="disabled" @update:model-value="app.setArtworkBlendMode" />
                    <div :id="getInputId('artwork-blend-hint')" class="tools-slider-note">Blends the completed artwork with the scene background.</div>
                </div>
                <div v-if="app.artworkBlendMode !== 'normal'" class="tools-slider-block">
                    <div class="tools-slider-head">
                        <label class="tools-slider-label" :for="getInputId('artwork-blend-strength')">Blend Strength</label>
                        <span class="tools-hint tools-slider-hint">{{ Math.round(app.artworkBlendStrength * 100) }}%</span>
                    </div>
                    <Slider :id="getInputId('artwork-blend-strength')" :model-value="Math.round(app.artworkBlendStrength * 100)"
                        :min="0" :max="100" :step="1" aria-label="Artwork blend strength" :disabled="disabled"
                        @update:model-value="app.setArtworkBlendStrength($event / 100)" />
                    <div class="tools-slider-note">0% uses Normal; 100% applies the selected blend fully.</div>
                </div>
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

                <GradientMapEditor
                    v-if="showDuotoneFilter && gradientMapFilterModel"
                    :modelValue="app.gradientMapStops"
                    :mix="app.gradientMapMix"
                    @update:mix="app.setGradientMapMix"
                    @update:modelValue="app.setGradientMapStops"
                />

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

<style scoped src="./textureSettingsControls.css"></style>

<style scoped>
    .texture-settings-controls {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
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
