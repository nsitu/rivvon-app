<script setup>
    import { computed, getCurrentInstance } from 'vue';
    import Select from 'primevue/select';
    import ToggleSwitch from 'primevue/toggleswitch';
    import { useViewerStore } from '../../stores/viewerStore';

    const app = useViewerStore();
    const instanceUid = getCurrentInstance()?.uid ?? Math.round(Math.random() * 1e9);
    const inputIdPrefix = `geometry-settings-${instanceUid}`;

    const capOptions = [
        { label: 'Rounded Caps', value: 'rounded', icon: 'rounded_corner' },
        { label: 'Pointed Caps', value: 'pointed', icon: 'change_history' },
        { label: 'Swallowtail Caps', value: 'swallowtail', icon: 'content_cut' },
        { label: 'Square Caps', value: 'square', icon: 'crop' }
    ];

    const surfaceOptions = [
        { label: 'Ribbon', value: 'ribbon', icon: 'gesture' },
        { label: 'Tube', value: 'tube', icon: 'view_in_ar' }
    ];

    const ribbonPathAlignmentOptions = [
        { label: 'Align to Inside', value: 'inside' },
        { label: 'Align to Centre', value: 'center' },
        { label: 'Align to Outside', value: 'outside' }
    ];

    const selectedCapOption = computed({
        get: () => capOptions.find((option) => option.value === app.capStyle) ?? capOptions[0],
        set: (option) => {
            if (!option?.value) return;
            app.setCapStyle(option.value);
        }
    });

    const surfaceModeModel = computed({
        get: () => app.surfaceMode,
        set: (value) => app.setSurfaceMode(value)
    });

    const doubleHelixModel = computed({
        get: () => app.helixEnabled,
        set: (value) => {
            app.setHelixMode(!!value);
        }
    });

    const cornerNarrowingModel = computed({
        get: () => app.cornerNarrowingEnabled,
        set: (value) => {
            app.setCornerNarrowingEnabled(!!value);
        }
    });

    const sphericalProjectionModel = computed({
        get: () => app.sphericalProjectionEnabled,
        set: (value) => {
            app.setSphericalProjectionEnabled(!!value);
        }
    });

    const sphericalProjectionWrapDegreesLabel = computed(() => `${Math.round(app.sphericalProjectionWrapDegrees)}°`);

    const ribbonPathAlignmentModel = computed({
        get: () => app.ribbonPathAlignmentMode,
        set: (value) => {
            app.setRibbonPathAlignmentMode(value);
        }
    });

    const tubeJoinOffsetDegreesLabel = computed(() => `${Math.round(app.tubeTextureJoinOffsetDegrees)}°`);

    function getInputId(name) {
        return `${inputIdPrefix}-${name}`;
    }
</script>

<template>
    <div class="geometry-settings-controls">
        <div class="tools-section">
            <div class="tools-section-label">Geometry</div>
            <div class="tools-section-items">
                <div class="tools-slider">
                    <label>
                        <span class="material-symbols-outlined tools-slider-icon">fit_page_width</span>
                        <span>Ribbon Width</span>
                        <span class="tools-slider-value">{{ app.ribbonWidthScale.toFixed(2) }}x</span>
                    </label>
                    <input
                        type="range"
                        min="0.1"
                        max="2.5"
                        step="0.05"
                        :value="app.ribbonWidthScale"
                        @input="app.setRibbonWidthScale(parseFloat($event.target.value))"
                    />
                </div>

                <div class="tools-select-block">
                    <label class="tools-select-label">Surface</label>
                    <div class="tools-select-wrap">
                        <Select
                            v-model="surfaceModeModel"
                            :options="surfaceOptions"
                            option-label="label"
                            option-value="value"
                            class="tools-select"
                        />
                    </div>
                </div>

                <div
                    v-if="app.surfaceMode === 'tube'"
                    class="tools-geometry-details"
                >
                    <div class="tools-slider">
                        <label>Tube Radius <span class="tools-slider-value">{{ app.tubeRadiusScale.toFixed(2)
                                }}x</span></label>
                        <input
                            type="range"
                            min="0.1"
                            max="1"
                            step="0.05"
                            :value="app.tubeRadiusScale"
                            @input="app.setTubeRadiusScale(parseFloat($event.target.value))"
                        />
                    </div>
                    <div class="tools-slider">
                        <label>Tube Sides <span class="tools-slider-value">{{ app.tubeRadialSegments }}</span></label>
                        <input
                            type="range"
                            min="4"
                            max="24"
                            step="2"
                            :value="app.tubeRadialSegments"
                            @input="app.setTubeRadialSegments(parseInt($event.target.value, 10))"
                        />
                    </div>
                    <div class="tools-slider">
                        <label>Join Offset <span class="tools-slider-value">{{ tubeJoinOffsetDegreesLabel
                                }}</span></label>
                        <input
                            type="range"
                            min="0"
                            max="350"
                            step="10"
                            :value="app.tubeTextureJoinOffsetDegrees"
                            @input="app.setTubeTextureJoinOffsetDegrees(parseInt($event.target.value, 10))"
                        />
                    </div>
                    <div class="tools-hint tools-surface-hint">Texture wraps twice with mirrored seams. Tube ends are
                        open.</div>
                </div>

                <div
                    v-if="app.surfaceMode !== 'tube'"
                    class="tools-select-block"
                >
                    <label class="tools-select-label">Path Alignment</label>
                    <div class="tools-select-wrap">
                        <Select
                            v-model="ribbonPathAlignmentModel"
                            :options="ribbonPathAlignmentOptions"
                            option-label="label"
                            option-value="value"
                            class="tools-select"
                        />
                    </div>
                </div>

                <div class="tools-geometry-group">
                    <div class="tools-toggle-row">
                        <label
                            class="tools-toggle-main"
                            :for="getInputId('spherical-projection')"
                        >
                            <span class="material-symbols-outlined">3d_rotation</span>
                            <span>Spherical Projection</span>
                        </label>
                        <div class="tools-toggle-control">
                            <span class="tools-hint tools-toggle-hint">{{ sphericalProjectionModel ? 'On' : 'Off'
                                }}</span>
                            <ToggleSwitch
                                :inputId="getInputId('spherical-projection')"
                                v-model="sphericalProjectionModel"
                            />
                        </div>
                    </div>

                    <div
                        v-if="app.sphericalProjectionEnabled"
                        class="tools-geometry-details"
                    >
                        <div class="tools-slider">
                            <label>Horizontal Wrap <span class="tools-slider-value">{{
                                sphericalProjectionWrapDegreesLabel }}</span></label>
                            <input
                                type="range"
                                min="15"
                                max="360"
                                step="5"
                                :value="app.sphericalProjectionWrapDegrees"
                                @input="app.setSphericalProjectionWrapDegrees(parseFloat($event.target.value))"
                            />
                        </div>
                    </div>

                    <div class="tools-toggle-row">
                        <label
                            class="tools-toggle-main"
                            :for="getInputId('double-helix')"
                        >
                            <span class="material-symbols-outlined">genetics</span>
                            <span>Double Helix</span>
                        </label>
                        <div class="tools-toggle-control">
                            <span class="tools-hint tools-toggle-hint">{{ doubleHelixModel ? 'On' : 'Off' }}</span>
                            <ToggleSwitch
                                :inputId="getInputId('double-helix')"
                                v-model="doubleHelixModel"
                            />
                        </div>
                    </div>

                    <div
                        v-if="app.helixEnabled"
                        class="tools-geometry-details"
                    >
                        <div class="tools-slider">
                            <label>Radius <span class="tools-slider-value">{{ app.helixRadius.toFixed(2)
                            }}</span></label>
                            <input
                                type="range"
                                min="0.1"
                                max="1.5"
                                step="0.05"
                                :value="app.helixRadius"
                                @input="app.setHelixOption('helixRadius', parseFloat($event.target.value))"
                            />
                        </div>

                        <div class="tools-slider">
                            <label>Pitch <span class="tools-slider-value">{{ app.helixPitch.toFixed(1) }}</span></label>
                            <input
                                type="range"
                                min="1"
                                max="12"
                                step="0.5"
                                :value="app.helixPitch"
                                @input="app.setHelixOption('helixPitch', parseFloat($event.target.value))"
                            />
                        </div>

                        <div class="tools-slider">
                            <label>Strand Width <span class="tools-slider-value">{{ app.helixStrandWidth.toFixed(2)
                            }}</span></label>
                            <input
                                type="range"
                                min="0.05"
                                max="0.8"
                                step="0.05"
                                :value="app.helixStrandWidth"
                                @input="app.setHelixOption('helixStrandWidth', parseFloat($event.target.value))"
                            />
                        </div>
                    </div>
                </div>

                <div
                    v-if="app.surfaceMode !== 'tube'"
                    class="tools-select-block"
                >
                    <label class="tools-select-label">Cap Style</label>
                    <div class="tools-select-wrap">
                        <Select
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
                    v-if="app.surfaceMode !== 'tube'"
                    class="tools-toggle-row"
                >
                    <label
                        class="tools-toggle-main"
                        :for="getInputId('corner-narrowing')"
                    >
                        <span class="material-symbols-outlined">line_curve</span>
                        <span>Adaptive Corner Narrowing</span>
                    </label>
                    <div class="tools-toggle-control">
                        <span class="tools-hint tools-toggle-hint">{{ app.helixEnabled ? 'Flat only' : 'EXP' }}</span>
                        <ToggleSwitch
                            :inputId="getInputId('corner-narrowing')"
                            v-model="cornerNarrowingModel"
                        />
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .geometry-settings-controls {
        width: 100%;
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

    .tools-geometry-group {
        display: flex;
        flex-direction: column;
        gap: 0;
    }

    .tools-geometry-details {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        border-left: 2px solid rgba(16, 185, 129, 0.3);
        margin: 0 0.75rem 0.75rem 1.25rem;
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

    .tools-surface-hint {
        margin: 0.25rem 0.75rem 0.75rem;
        line-height: 1.4;
        white-space: normal;
    }

</style>
