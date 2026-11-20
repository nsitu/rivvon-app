<script setup>
    import { computed, getCurrentInstance, ref, watch } from 'vue';
    import ColorPickerPopover from '../color-picker/ColorPickerPopover.vue';
    import Select from 'primevue/select';
    import Slider from 'primevue/slider';
    import { BLEND_MODE_OPTIONS } from '../../../../../packages/shared-types/src/blendModes.js';
    import ToggleSwitch from 'primevue/toggleswitch';
    import GradientMapEditor from './GradientMapEditor.vue';
    import { useViewerStore } from '../../stores/viewerStore';
    import ArtworkTiltControls from './ArtworkTiltControls.vue';
    import BackgroundImageSelection from './BackgroundImageSelection.vue';
    import { MIN_BACKGROUND_CYCLE_DURATION, MAX_BACKGROUND_CYCLE_DURATION } from '../../modules/viewer/backgroundAnimation.js';

    import {
        ARTWORK_MOTION_OPTIONS,
        ARTWORK_MOTION_LOOP_COUNT_OPTIONS,
    } from '../../modules/viewer/viewerMotion.js';

    defineProps({
        showUndulation: { type: Boolean, default: true },
        disabled: Boolean,
    });

    const emit = defineEmits(['request-viewer-control-mode-change']);

    const app = useViewerStore();
    const instanceUid = getCurrentInstance()?.uid ?? Math.round(Math.random() * 1e9);
    const inputIdPrefix = `animation-settings-${instanceUid}`;

    const artworkMotionOptions = ARTWORK_MOTION_OPTIONS;

    const selectedArtworkMotionOption = computed({
        get: () => artworkMotionOptions.find((option) => option.value === app.artworkMotionMode)
            ?? artworkMotionOptions[0],
        set: (option) => {
            if (!option?.value) return;

            if (option.value !== 'none' && app.viewerControlMode !== 'orbit') {
                emit('request-viewer-control-mode-change', 'orbit');
            }

            app.setArtworkMotionMode(option.value);
        }
    });

    const artworkMotionDescription = computed(() => {
        const option = artworkMotionOptions.find((entry) => entry.value === app.artworkMotionMode);
        return option?.description ?? artworkMotionOptions[0].description;
    });

    // The stored value is a duration multiplier, so descending values run slow to fast.
    const viewerMotionLoopCountOptions = [...ARTWORK_MOTION_LOOP_COUNT_OPTIONS].sort((a, b) => b.value - a.value);
    const motionRateId = getInputId('motion-rate');

    const viewerMotionRateIndex = computed({
        get: () => {
            const index = viewerMotionLoopCountOptions.findIndex(option => option.value === app.viewerMotionLoopCount);
            return index >= 0 ? index : viewerMotionLoopCountOptions.findIndex(option => option.value === 1);
        },
        set: (index) => {
            const option = viewerMotionLoopCountOptions[index];
            if (option) app.setViewerMotionLoopCount(option.value);
        }
    });
    const selectedViewerMotionLoopCountOption = computed(() => viewerMotionLoopCountOptions[viewerMotionRateIndex.value]);
    const viewerMotionRateRatio = computed(() => {
        const option = selectedViewerMotionLoopCountOption.value;
        return `${option.pathCount}:${option.materialLoopCount}`;
    });

    const viewerMotionLoopDescription = computed(() => {
        const motionLabel = app.artworkMotionMode === 'tumbleOrbit' ? 'tumble path'
            : app.artworkMotionMode === 'circularTilt' ? 'tilt loop' : 'artwork turn';
        const option = selectedViewerMotionLoopCountOption.value;
        const materialLoopLabel = option.materialLoopCount === 1 ? 'loop' : 'loops';

        if (option.pathCount === 1) {
            return `One full ${motionLabel} spans ${option.materialLoopCount} seamless material ${materialLoopLabel}.`;
        }

        return `${option.pathCount} full ${motionLabel}s span 1 seamless material loop.`;
    });

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
        get: () => app.proceduralPathMode !== 'mobius' && app.undulationEnabled,
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

    const backgroundSyncModel = computed({
        get: () => app.backgroundAnimationSyncEnabled,
        set: (value) => app.setBackgroundAnimationSyncEnabled(value),
    });
    // Equal slider travel changes duration by an equal ratio, making both short
    // and slow cycles practical to adjust with the same control.
    const backgroundDurationSlider = computed({
        get: () => Math.log(app.backgroundCycleDuration / MIN_BACKGROUND_CYCLE_DURATION)
            / Math.log(MAX_BACKGROUND_CYCLE_DURATION / MIN_BACKGROUND_CYCLE_DURATION) * 100,
        set: (value) => app.setBackgroundCycleDuration(Math.round(
            MIN_BACKGROUND_CYCLE_DURATION * (MAX_BACKGROUND_CYCLE_DURATION / MIN_BACKGROUND_CYCLE_DURATION) ** (value / 100) * 100,
        ) / 100),
    });
    const backgroundDurationDisplay = computed(() => `${(
        backgroundSyncModel.value ? app.backgroundSceneLoopDuration : app.backgroundCycleDuration
    ).toFixed(2)} s per cycle`);

    const backgroundLayerCount = computed(() => Math.max(
        1,
        Math.floor(Number(app.backgroundLayerCount) || 1),
    ));

    const backgroundLayerIndexModel = computed({
        get: () => Math.max(
            0,
            Math.min(
                backgroundLayerCount.value - 1,
                Math.round(Number(app.backgroundLayerIndex) || 0),
            ),
        ),
        set: (value) => {
            app.setBackgroundLayerIndex(value);
        },
    });

    const backgroundLayerDisplay = computed(
        () => `Layer ${backgroundLayerIndexModel.value + 1}/${backgroundLayerCount.value}`,
    );

    const backgroundFlipVerticalModel = computed({
        get: () => app.backgroundFlipVertical,
        set: (value) => app.setBackgroundFlipVertical(!!value),
    });

    const backgroundFlipHorizontalModel = computed({
        get: () => app.backgroundFlipHorizontal,
        set: (value) => app.setBackgroundFlipHorizontal(!!value),
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

    const backgroundModeOptions = [
        { label: 'Texture', value: 'texture' },
        { label: 'Gradient', value: 'gradient' },
    ];
    const backgroundModeModel = computed({
        get: () => app.backgroundMode,
        set: value => app.setBackgroundMode(value),
    });
    const backgroundGradientInfluenceModel = computed({
        get: () => app.backgroundGradientInfluence,
        set: value => app.setBackgroundGradientInfluence(value),
    });
    const backgroundGradientFalloffModel = computed({
        get: () => app.backgroundGradientFalloff,
        set: value => app.setBackgroundGradientFalloff(value),
    });

    const backgroundBlurDisplay = computed(() => `${app.backgroundBlurAmount.toFixed(1)}x`);

    const backgroundTextureModel = computed({
        get: () => app.backgroundTextureEnabled,
        set: (value) => app.setBackgroundTextureEnabled(!!value),
    });

    const backgroundTextureGradientMapModel = computed({
        get: () => app.backgroundTextureGradientMapEnabled,
        set: value => app.setBackgroundTextureGradientMapEnabled(value),
    });



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
            app.setBackgroundOverlayColor(
                typeof value === 'string' ? `#${value.replace(/^#/, '')}` : value
            );
        }
    });

    const backgroundBaseModel = computed({
        get: () => app.backgroundBaseEnabled,
        set: (value) => app.setBackgroundBaseEnabled(!!value),
    });

    const backgroundSphericalLayersModel = computed({
        get: () => app.backgroundSphericalLayersEnabled,
        set: (value) => app.setBackgroundSphericalLayersEnabled(!!value),
    });

    const backgroundCurvatureModel = computed({
        get: () => Math.round(app.backgroundCurvature * 100),
        set: (value) => app.setBackgroundCurvature(Number(value) / 100),
    });

    const backgroundWaterModel = computed({
        get: () => app.backgroundWaterEnabled,
        set: (value) => app.setBackgroundWaterEnabled(!!value),
    });

    const backgroundWaterColorModel = computed({
        get: () => app.backgroundWaterColor,
        set: (value) => app.setBackgroundWaterColor(value),
    });

    const backgroundWaterColorPickerModel = computed({
        get: () => backgroundWaterColorModel.value.replace('#', ''),
        set: (value) => {
            app.setBackgroundWaterColor(
                typeof value === 'string' ? `#${value.replace(/^#/, '')}` : value
            );
        }
    });

    const backgroundWaterColorInputModel = computed(
        () => backgroundWaterColorModel.value.toUpperCase()
    );

    const backgroundWaterFlowDisplay = computed(
        () => `${Math.round(app.backgroundWaterFlow)}°`,
    );

    const backgroundWaterScaleDisplay = computed(
        () => `${app.backgroundWaterScale.toFixed(1)}x`,
    );

    const backgroundWaterSpeedDisplay = computed(
        () => `${app.backgroundWaterSpeed.toFixed(2)}x`,
    );

    const backgroundWaterStrengthDisplay = computed(
        () => `${Math.round(app.backgroundWaterStrength * 100)}%`,
    );

    const backgroundOverlayColorInputModel = computed(
        () => backgroundOverlayColorModel.value.toUpperCase()
    );

    function onBackgroundOverlayColorInput(event) {
        app.setBackgroundOverlayColor(event.target.value);
    }

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

    function handleFlowSpeedInput(event) {
        app.setFlowSpeed(parseFloat(event.target.value));
    }

    function handleBackgroundFlowSpeedInput(event) {
        app.setBackgroundFlowSpeed(parseFloat(event.target.value));
    }

    function handleBackgroundWaterScaleInput(event) {
        app.setBackgroundWaterScale(parseFloat(event.target.value));
    }

    function onBackgroundWaterColorInput(event) {
        app.setBackgroundWaterColor(event.target.value);
    }

    function handleBackgroundWaterFlowInput(event) {
        app.setBackgroundWaterFlow(parseFloat(event.target.value));
    }

    function handleBackgroundWaterSpeedInput(event) {
        app.setBackgroundWaterSpeed(parseFloat(event.target.value));
    }

    function handleBackgroundWaterStrengthInput(event) {
        app.setBackgroundWaterStrength(parseFloat(event.target.value));
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
                <div class="tools-select-block">
                    <label :id="getInputId('artwork-motion-label')" class="tools-select-label">Artwork Motion</label>
                    <div class="tools-select-wrap">
                        <Select
                            v-model="selectedArtworkMotionOption"
                            :options="artworkMotionOptions"
                            :aria-labelledby="getInputId('artwork-motion-label')"
                            :pt="{ label: { 'aria-describedby': getInputId('artwork-motion-description') } }"
                            option-label="label"
                            class="tools-select"
                        />
                    </div>
                    <div :id="getInputId('artwork-motion-description')" class="tools-setting-description">{{ artworkMotionDescription }}</div>
                </div>

                <ArtworkTiltControls v-if="app.artworkMotionMode === 'circularTilt'" />

                <div
                    v-if="app.artworkMotionMode !== 'none'"
                    class="tools-slider"
                >
                    <label :id="motionRateId">
                        Motion Rate
                        <span class="tools-slider-value" aria-hidden="true">{{ viewerMotionRateRatio }}</span>
                    </label>
                    <div class="motion-rate-track">
                        <Slider
                            v-model="viewerMotionRateIndex"
                            :min="0"
                            :max="viewerMotionLoopCountOptions.length - 1"
                            :step="1"
                            :aria-labelledby="motionRateId"
                            :pt="{ handle: { 'aria-valuetext': selectedViewerMotionLoopCountOption.label, 'aria-describedby': `${motionRateId}-description` } }"
                        />
                        <div class="motion-rate-ticks" aria-hidden="true">
                            <span v-for="option in viewerMotionLoopCountOptions" :key="option.value"></span>
                        </div>
                        <div class="motion-rate-scale" aria-hidden="true">
                            <span>1:8</span>
                            <span>1:1</span>
                            <span>8:1</span>
                        </div>
                    </div>
                    <div :id="`${motionRateId}-description`" class="tools-setting-description">{{ viewerMotionLoopDescription }}</div>
                </div>

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
                    v-if="showUndulation && app.proceduralPathMode !== 'mobius'"
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
                        <span class="tools-hint tools-toggle-hint">{{ undulationModel ? 'On' : 'Off' }}</span>
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
            <div class="tools-section-label">Background</div>
            <div class="tools-section-items">
                <div class="tools-toggle-row">
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('background-spherical-layers')"
                    >
                        <span class="material-symbols-outlined">layers</span>
                        <span>Spherical background layers</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ backgroundSphericalLayersModel ? 'On' : 'Off' }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('background-spherical-layers')"
                            v-model="backgroundSphericalLayersModel"
                        />
                    </div>
                </div>

                <div
                    v-if="backgroundSphericalLayersModel"
                    class="tools-slider-block"
                >
                    <div class="tools-slider-head">
                        <label
                            class="tools-slider-label"
                            :for="getInputId('background-curvature')"
                        >
                            <span>Background curvature</span>
                        </label>
                        <span class="tools-hint tools-slider-hint">{{ backgroundCurvatureModel }}%</span>
                    </div>
                    <Slider
                        v-model="backgroundCurvatureModel"
                        :input-id="getInputId('background-curvature')"
                        :min="0"
                        :max="100"
                        :step="1"
                        aria-label="Background curvature"
                    />
                    <div class="tools-slider-caption">
                        <span>Flat</span>
                        <span>Deep curve</span>
                    </div>
                </div>

                <div class="tools-background-base-group">
                    <div class="tools-toggle-row">
                        <label
                            class="tools-toggle-main"
                            :for="getInputId('background-base')"
                        >
                            <span class="material-symbols-outlined">layers</span>
                            <span>KTX2 Texture</span>
                        </label>
                        <div class="tools-toggle-control">
                            <span class="tools-hint tools-toggle-hint">{{ backgroundBaseModel ? 'On' : 'Off' }}</span>
                            <ToggleSwitch
                                :inputId="getInputId('background-base')"
                                v-model="backgroundBaseModel"
                            />
                        </div>
                    </div>

                    <div
                        v-if="backgroundBaseModel"
                        class="tools-background-base-subitems"
                    >
                        <div
                            v-if="textureAnimationModel && backgroundLayerCount > 1"
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

                        <template v-if="animatedBackgroundModel && textureAnimationModel && backgroundLayerCount > 1">
                            <div class="tools-toggle-row">
                                <label class="tools-toggle-main" :for="getInputId('background-sync')">
                                    <span class="material-symbols-outlined" aria-hidden="true">sync</span>
                                    <span>Sync to Scene Loop</span>
                                </label>
                                <div class="tools-toggle-control">
                                    <span class="tools-hint tools-toggle-hint">{{ backgroundSyncModel ? 'On' : 'Off' }}</span>
                                    <ToggleSwitch :inputId="getInputId('background-sync')" v-model="backgroundSyncModel" />
                                </div>
                            </div>
                            <div class="tools-slider-block">
                                <div class="tools-slider-head">
                                    <label class="tools-slider-label" :for="backgroundSyncModel ? undefined : getInputId('background-duration')">
                                        <span class="material-symbols-outlined" aria-hidden="true">wallpaper</span>
                                        <span>Background Cycle Duration</span>
                                    </label>
                                    <span class="tools-hint tools-slider-hint">{{ backgroundDurationDisplay }}</span>
                                </div>
                                <Slider v-if="!backgroundSyncModel" v-model="backgroundDurationSlider"
                                    :input-id="getInputId('background-duration')" :min="0" :max="100" :step="0.1"
                                    aria-label="Background cycle duration"
                                    :pt="{ handle: { 'aria-valuetext': backgroundDurationDisplay } }" />
                                <div class="tools-slider-caption">
                                    <template v-if="backgroundSyncModel">
                                        <span>One background cycle per scene loop.</span>
                                    </template>
                                    <template v-else>
                                        <span>Faster · 0.25 s</span>
                                        <span>Slower · 120 s</span>
                                    </template>
                                </div>
                            </div>
                        </template>

                        <div
                            v-if="(!animatedBackgroundModel || !textureAnimationModel) && backgroundLayerCount > 1"
                            class="tools-slider-block"
                        >
                            <div class="tools-slider-head">
                                <label
                                    class="tools-slider-label"
                                    :for="getInputId('background-layer')"
                                >
                                    <span class="material-symbols-outlined">layers</span>
                                    <span>Background Layer</span>
                                </label>
                                <span class="tools-hint tools-slider-hint">{{ backgroundLayerDisplay }}</span>
                            </div>
                            <Slider
                                v-model="backgroundLayerIndexModel"
                                :input-id="getInputId('background-layer')"
                                :min="0"
                                :max="backgroundLayerCount - 1"
                                :step="1"
                                aria-label="Background layer"
                            />
                            <div class="tools-slider-caption">
                                <span>Layer 1</span>
                                <span>Layer {{ backgroundLayerCount }}</span>
                            </div>
                        </div>

                        <div class="tools-toggle-row">
                            <label
                                class="tools-toggle-main"
                                :for="getInputId('background-flip-vertical')"
                            >
                                <span class="material-symbols-outlined" aria-hidden="true">swap_vert</span>
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
                                :for="getInputId('background-flip-horizontal')"
                            >
                                <span class="material-symbols-outlined" aria-hidden="true">swap_horiz</span>
                                <span>Flip Background Horizontally</span>
                            </label>
                            <div class="tools-toggle-control">
                                <span class="tools-hint tools-toggle-hint">{{ backgroundFlipHorizontalModel ? 'On' : 'Off' }}</span>
                                <ToggleSwitch
                                    :inputId="getInputId('background-flip-horizontal')"
                                    v-model="backgroundFlipHorizontalModel"
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

                        <div class="tools-select-block">
                            <label class="tools-select-label" :for="getInputId('background-mode')">
                                Background Style
                            </label>
                            <Select
                                :inputId="getInputId('background-mode')"
                                v-model="backgroundModeModel"
                                :options="backgroundModeOptions"
                                optionLabel="label"
                                optionValue="value"
                                class="tools-select"
                            />
                        </div>

                        <template v-if="backgroundModeModel === 'gradient'">
                            <div class="tools-slider-block">
                                <div class="tools-slider-head">
                                    <label class="tools-slider-label" :for="getInputId('gradient-influence')">Color Influence</label>
                                    <span class="tools-hint tools-slider-hint">{{ backgroundGradientInfluenceModel.toFixed(2) }}</span>
                                </div>
                                <Slider :id="getInputId('gradient-influence')" v-model="backgroundGradientInfluenceModel"
                                    :min="0.15" :max="1.5" :step="0.05" aria-label="Gradient color influence" />
                                <div class="tools-slider-caption"><span>Local</span><span>Broad</span></div>
                            </div>
                            <div class="tools-slider-block">
                                <div class="tools-slider-head">
                                    <label class="tools-slider-label" :for="getInputId('gradient-falloff')">Color Falloff</label>
                                    <span class="tools-hint tools-slider-hint">{{ backgroundGradientFalloffModel.toFixed(1) }}</span>
                                </div>
                                <Slider :id="getInputId('gradient-falloff')" v-model="backgroundGradientFalloffModel"
                                    :min="0.5" :max="6" :step="0.1" aria-label="Gradient color falloff" />
                                <div class="tools-slider-caption"><span>Gentle</span><span>Steep</span></div>
                            </div>
                        </template>

                        <div v-if="backgroundModeModel === 'texture'" class="tools-toggle-row">
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
                            v-if="backgroundModeModel === 'texture' && backgroundBlurModel"
                            class="tools-slider-block"
                        >
                            <div class="tools-slider-head">
                                <label class="tools-slider-label" :for="getInputId('background-blur-amount')">
                                    <span class="material-symbols-outlined">blur_linear</span>
                                    <span>Blur Amount</span>
                                </label>
                                <span class="tools-hint tools-slider-hint">{{ backgroundBlurDisplay }}</span>
                            </div>
                            <Slider
                                :id="getInputId('background-blur-amount')"
                                :min="1" :max="200" :step="0.5"
                                :modelValue="app.backgroundBlurAmount"
                                @update:modelValue="app.setBackgroundBlurAmount($event)"
                                aria-label="Background blur amount"
                            />
                            <div class="tools-slider-caption">
                                <span>Soft</span>
                                <span>Strong</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="tools-background-independent-subitems">
                    <div class="tools-toggle-row">
                        <label
                            class="tools-toggle-main"
                            :for="getInputId('background-texture')"
                        >
                            <span class="material-symbols-outlined">texture</span>
                            <span>Background Media</span>
                        </label>
                        <div class="tools-toggle-control">
                            <span class="tools-hint tools-toggle-hint">{{ backgroundTextureModel ? 'On' : 'Off' }}</span>
                            <ToggleSwitch
                                :inputId="getInputId('background-texture')"
                                v-model="backgroundTextureModel"
                                :disabled="disabled || app.isApplyingBackgroundImage"
                            />
                        </div>
                    </div>

                    <div v-if="backgroundTextureModel">
                        <BackgroundImageSelection :disabled="disabled || app.isApplyingBackgroundImage" />
                        <div class="tools-select-block">
                            <label class="tools-select-label" :for="getInputId('static-image-blend')">Blend</label>
                            <Select :input-id="getInputId('static-image-blend')" :model-value="app.backgroundTextureBlendMode"
                                :options="BLEND_MODE_OPTIONS" option-label="label" option-value="value" class="tools-select"
                                :disabled="disabled || app.isApplyingBackgroundImage" @update:model-value="app.setBackgroundTextureBlendMode" />
                        </div>

                        <div v-if="app.backgroundTextureBlendMode !== 'normal'" class="tools-slider-block">
                            <div class="tools-slider-head">
                                <label class="tools-slider-label" :for="getInputId('background-blend-strength')">Blend Strength</label>
                                <span class="tools-hint tools-slider-hint">{{ Math.round(app.backgroundTextureBlendStrength * 100) }}%</span>
                            </div>
                            <Slider :id="getInputId('background-blend-strength')" :model-value="Math.round(app.backgroundTextureBlendStrength * 100)"
                                :min="0" :max="100" :step="1" aria-label="Background blend strength"
                                :disabled="disabled || app.isApplyingBackgroundImage"
                                @update:model-value="app.setBackgroundTextureBlendStrength($event / 100)" />
                            <div class="tools-slider-note">0% uses Normal; 100% applies the selected blend fully.</div>
                        </div>

                        <div class="tools-slider-block">
                            <div class="tools-slider-head">
                                <label class="tools-slider-label" :for="getInputId('static-texture-vertical-alignment')">Vertical Alignment</label>
                                <span class="tools-hint tools-slider-hint">{{ Math.round(app.backgroundTextureVerticalAlignment * 100) }}%</span>
                            </div>
                            <Slider
                                :id="getInputId('static-texture-vertical-alignment')"
                                :modelValue="app.backgroundTextureVerticalAlignment * 100"
                                :min="0" :max="100" :step="1"
                                aria-label="Static texture vertical alignment"
                                @update:modelValue="app.setBackgroundTextureVerticalAlignment($event / 100)"
                            />
                            <div class="tools-slider-caption"><span>Top</span><span>Bottom</span></div>
                        </div>

                        <div class="tools-toggle-row">
                            <label class="tools-toggle-main" :for="getInputId('static-texture-gradient-map')">
                                <span class="material-symbols-outlined" aria-hidden="true">palette</span>
                                <span>Gradient Map</span>
                            </label>
                            <div class="tools-toggle-control">
                                <span class="tools-hint tools-toggle-hint">{{ backgroundTextureGradientMapModel ? 'On' : 'Off' }}</span>
                                <ToggleSwitch
                                    :inputId="getInputId('static-texture-gradient-map')"
                                    v-model="backgroundTextureGradientMapModel"
                                    aria-label="Static texture gradient map"
                                />
                            </div>
                        </div>

                        <GradientMapEditor
                            v-if="backgroundTextureGradientMapModel"
                            :modelValue="app.backgroundTextureGradientMapStops"
                            :mix="app.backgroundTextureGradientMapMix"
                            @update:mix="app.setBackgroundTextureGradientMapMix"
                            subject="static texture"
                            @update:modelValue="app.setBackgroundTextureGradientMapStops"
                        />

                        <div class="tools-slider-block">
                            <div class="tools-slider-head">
                                <label class="tools-slider-label" :for="getInputId('static-texture-contrast')">
                                    <span class="material-symbols-outlined" aria-hidden="true">contrast</span>
                                    <span>Contrast</span>
                                </label>
                                <span class="tools-hint tools-slider-hint">{{ Math.round(app.backgroundTextureContrast * 100) }}%</span>
                            </div>
                            <Slider
                                :id="getInputId('static-texture-contrast')"
                                :modelValue="app.backgroundTextureContrast * 100"
                                :min="0" :max="200" :step="1"
                                aria-label="Static texture contrast"
                                @update:modelValue="app.setBackgroundTextureContrast($event / 100)"
                            />
                            <div class="tools-slider-caption"><span>Soft</span><span>Strong</span></div>
                        </div>

                        <div class="tools-slider-block">
                            <div class="tools-slider-head">
                                <label class="tools-slider-label" :for="getInputId('static-texture-saturation')">
                                    <span class="material-symbols-outlined" aria-hidden="true">palette</span>
                                    <span>Saturation</span>
                                </label>
                                <span class="tools-hint tools-slider-hint">{{ Math.round(app.backgroundTextureSaturation * 100) }}%</span>
                            </div>
                            <Slider
                                :id="getInputId('static-texture-saturation')"
                                :modelValue="app.backgroundTextureSaturation * 100"
                                :min="0" :max="200" :step="1"
                                aria-label="Static texture saturation"
                                @update:modelValue="app.setBackgroundTextureSaturation($event / 100)"
                            />
                            <div class="tools-slider-caption"><span>Grayscale</span><span>Vivid</span></div>
                        </div>
                    </div>

                    <div class="tools-toggle-row">
                        <label
                            class="tools-toggle-main"
                            :for="getInputId('background-water')"
                        >
                            <span class="material-symbols-outlined">water</span>
                            <span>Water Texture</span>
                        </label>
                        <div class="tools-toggle-control">
                            <span class="tools-hint tools-toggle-hint">{{ backgroundWaterModel ? 'On' : 'Off' }}</span>
                            <ToggleSwitch
                                :inputId="getInputId('background-water')"
                                v-model="backgroundWaterModel"
                            />
                        </div>
                    </div>

                    <template v-if="backgroundWaterModel">
                        <div class="tools-color-row">
                            <label
                                class="tools-color-main"
                                :for="getInputId('background-water-color')"
                            >
                                <span
                                    class="tools-color-swatch"
                                    :style="{ backgroundColor: backgroundWaterColorModel }"
                                ></span>
                                <span>Water Tint</span>
                            </label>
                            <div class="tools-color-control">
                                <input
                                    :id="getInputId('background-water-color-hex')"
                                    type="text"
                                    class="background-overlay-hex"
                                    :value="backgroundWaterColorInputModel"
                                    maxlength="7"
                                    spellcheck="false"
                                    autocomplete="off"
                                    aria-label="Water tint hex code"
                                    @change="onBackgroundWaterColorInput"
                                />
                                <ColorPickerPopover
                                    :inputId="getInputId('background-water-color')"
                                    v-model="backgroundWaterColorPickerModel"
                                    format="hex"
                                    class="tools-color-picker"
                                />
                            </div>
                        </div>

                        <div class="tools-slider-block">
                            <div class="tools-slider-head">
                                <label class="tools-slider-label">
                                    <span class="material-symbols-outlined">water</span>
                                    <span>Water Flow</span>
                                </label>
                                <span class="tools-hint tools-slider-hint">{{ backgroundWaterFlowDisplay }}</span>
                            </div>
                            <input
                                :id="getInputId('background-water-flow')"
                                type="range"
                                min="0"
                                max="360"
                                step="1"
                                :value="app.backgroundWaterFlow"
                                @input="handleBackgroundWaterFlowInput"
                                class="tools-native-range"
                            />
                            <div class="tools-slider-caption">
                                <span>Right</span>
                                <span>Full circle</span>
                            </div>
                        </div>

                        <div class="tools-slider-block">
                            <div class="tools-slider-head">
                                <label class="tools-slider-label">
                                    <span class="material-symbols-outlined">zoom_in</span>
                                    <span>Water Scale</span>
                                </label>
                                <span class="tools-hint tools-slider-hint">{{ backgroundWaterScaleDisplay }}</span>
                            </div>
                            <input
                                :id="getInputId('background-water-scale')"
                                type="range"
                                min="2"
                                max="24"
                                step="0.5"
                                :value="app.backgroundWaterScale"
                                @input="handleBackgroundWaterScaleInput"
                                class="tools-native-range"
                            />
                            <div class="tools-slider-caption">
                                <span>Broad</span>
                                <span>Fine</span>
                            </div>
                        </div>

                        <div class="tools-slider-block">
                            <div class="tools-slider-head">
                                <label class="tools-slider-label">
                                    <span class="material-symbols-outlined">speed</span>
                                    <span>Water Speed</span>
                                </label>
                                <span class="tools-hint tools-slider-hint">{{ backgroundWaterSpeedDisplay }}</span>
                            </div>
                            <input
                                :id="getInputId('background-water-speed')"
                                type="range"
                                min="0"
                                max="3"
                                step="0.05"
                                :value="app.backgroundWaterSpeed"
                                @input="handleBackgroundWaterSpeedInput"
                                class="tools-native-range"
                            />
                            <div class="tools-slider-caption">
                                <span>Still</span>
                                <span>Fast</span>
                            </div>
                        </div>

                        <div class="tools-slider-block">
                            <div class="tools-slider-head">
                                <label class="tools-slider-label">
                                    <span class="material-symbols-outlined">contrast</span>
                                    <span>Water Strength</span>
                                </label>
                                <span class="tools-hint tools-slider-hint">{{ backgroundWaterStrengthDisplay }}</span>
                            </div>
                            <input
                                :id="getInputId('background-water-strength')"
                                type="range"
                                min="0.05"
                                max="0.6"
                                step="0.01"
                                :value="app.backgroundWaterStrength"
                                @input="handleBackgroundWaterStrengthInput"
                                class="tools-native-range"
                            />
                            <div class="tools-slider-caption">
                                <span>Subtle</span>
                                <span>Strong</span>
                            </div>
                        </div>
                    </template>

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
                            <input
                                :id="getInputId('background-overlay-color-hex')"
                                type="text"
                                class="background-overlay-hex"
                                :value="backgroundOverlayColorInputModel"
                                maxlength="7"
                                spellcheck="false"
                                autocomplete="off"
                                aria-label="Overlay color hex code"
                                @change="onBackgroundOverlayColorInput"
                            />
                            <ColorPickerPopover
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

    .tools-setting-description {
        padding: 0 0.1rem;
        font-size: 0.78rem;
        line-height: 1.35;
        color: rgba(255, 255, 255, 0.55);
    }

    .motion-rate-track {
        margin: 0.5rem 0.5rem 0;
    }

    .motion-rate-ticks {
        display: flex;
        justify-content: space-between;
        margin-top: 0.6rem;
    }

    .motion-rate-ticks span {
        width: 1px;
        height: 4px;
        background: var(--p-content-border-color);
    }

    .motion-rate-scale {
        display: flex;
        justify-content: space-between;
        margin: 0.25rem -0.5rem 0;
        font-size: 0.72rem;
        color: var(--p-text-muted-color);
    }

    .tools-toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.875rem 1rem;
        color: var(--p-text-color, #fff);
    }

    .tools-background-base-subitems {
        margin: 0 0.75rem 0.25rem 1.65rem;
        padding-left: 0.4rem;
        border-left: 1px solid rgba(255, 255, 255, 0.14);
    }

    .tools-background-base-subitems .tools-toggle-row {
        padding-left: 0.6rem;
        padding-right: 0.25rem;
    }

    .tools-background-base-subitems .tools-slider,
    .tools-background-base-subitems .tools-slider-block {
        padding-left: 0.6rem;
        padding-right: 0.25rem;
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

    :deep(.tools-color-picker.color-picker-trigger) {
        width: 1.75rem;
        height: 1.75rem;
    }

    .background-overlay-hex {
        width: 5.5rem;
        box-sizing: border-box;
        padding: 0.45rem 0.5rem;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.2);
        color: rgba(255, 255, 255, 0.9);
        font: 0.75rem/1.2 monospace;
        outline: none;
        text-transform: uppercase;
    }

    .background-overlay-hex:focus {
        border-color: var(--p-primary-color, #10b981);
        box-shadow: 0 0 0 1px var(--p-primary-color, #10b981);
    }

</style>
