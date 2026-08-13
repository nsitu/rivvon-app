<script setup>
    import { computed, getCurrentInstance } from 'vue';
    import InputNumber from 'primevue/inputnumber';
    import Slider from 'primevue/slider';
    import ToggleSwitch from 'primevue/toggleswitch';
    import { useViewerStore } from '../../stores/viewerStore';

    const app = useViewerStore();
    const instanceUid = getCurrentInstance()?.uid ?? Math.round(Math.random() * 1e9);
    const inputIdPrefix = `lighting-settings-${instanceUid}`;

    const sceneLightingEnabledModel = computed({
        get: () => app.sceneLightingEnabled,
        set: (value) => app.setSceneLightingEnabled(value)
    });

    const sceneLightingIntensityModel = computed({
        get: () => app.sceneLightingIntensity,
        set: (value) => app.setSceneLightingIntensity(value)
    });

    const sceneLightDistanceModel = computed({
        get: () => app.sceneLightDistance,
        set: (value) => app.setSceneLightDistance(value)
    });

    const sceneShadowPlaneDistanceModel = computed({
        get: () => app.sceneShadowPlaneDistance,
        set: (value) => app.setSceneShadowPlaneDistance(value)
    });

    const sceneShadowOpacityModel = computed({
        get: () => app.sceneShadowOpacity,
        set: (value) => app.setSceneShadowOpacity(value)
    });

    const sceneColoredShadowsEnabledModel = computed({
        get: () => app.sceneColoredShadowsEnabled,
        set: (value) => app.setSceneColoredShadowsEnabled(value)
    });

    function getInputId(name) {
        return `${inputIdPrefix}-${name}`;
    }
</script>

<template>
    <div class="lighting-settings-controls">
        <div class="tools-section">
            <div class="tools-section-label">Lighting</div>
            <div class="tools-section-items">
                <div class="lighting-control-stack">
                    <div class="tools-toggle-row lighting-control-row">
                        <label
                            class="tools-toggle-main"
                            :for="getInputId('spotlight')"
                        >
                            <span class="material-symbols-outlined">lightbulb</span>
                            <span>Camera spotlight</span>
                        </label>
                        <div class="tools-toggle-control">
                            <span class="tools-toggle-copy">{{ sceneLightingEnabledModel ? 'On' : 'Off' }}</span>
                            <ToggleSwitch
                                :inputId="getInputId('spotlight')"
                                v-model="sceneLightingEnabledModel"
                            />
                        </div>
                    </div>
                    <div class="lighting-number-row">
                        <label :for="getInputId('intensity')">Intensity</label>
                        <InputNumber
                            v-model="sceneLightingIntensityModel"
                            :input-id="getInputId('intensity')"
                            :min="0.1"
                            :max="2"
                            :step="0.1"
                            :min-fraction-digits="1"
                            :max-fraction-digits="1"
                            suffix="×"
                            class="lighting-number-input"
                        />
                    </div>
                    <div class="tools-toggle-row lighting-control-row">
                        <label
                            class="tools-toggle-main"
                            :for="getInputId('coloredShadows')"
                        >
                            <span>Colored projection</span>
                        </label>
                        <div class="tools-toggle-control">
                            <span class="tools-toggle-copy">{{ sceneColoredShadowsEnabledModel ? 'On' : 'Off' }}</span>
                            <ToggleSwitch
                                :inputId="getInputId('coloredShadows')"
                                v-model="sceneColoredShadowsEnabledModel"
                                :disabled="!sceneLightingEnabledModel"
                            />
                        </div>
                    </div>
                    <div class="lighting-slider-control">
                        <div class="lighting-slider-label">
                            <label :for="getInputId('lightDistance')">Light distance</label>
                            <output :for="getInputId('lightDistance')">{{ sceneLightDistanceModel.toFixed(1) }}</output>
                        </div>
                        <Slider
                            v-model="sceneLightDistanceModel"
                            :input-id="getInputId('lightDistance')"
                            :min="2"
                            :max="30"
                            :step="0.5"
                            :disabled="!sceneLightingEnabledModel"
                            aria-label="Light distance from artwork"
                            class="lighting-distance-slider"
                        />
                    </div>
                    <div class="lighting-number-row">
                        <label :for="getInputId('shadowOpacity')">Shadow strength</label>
                        <InputNumber
                            v-model="sceneShadowOpacityModel"
                            :input-id="getInputId('shadowOpacity')"
                            :min="0.05"
                            :max="0.6"
                            :step="0.05"
                            :min-fraction-digits="2"
                            :max-fraction-digits="2"
                            class="lighting-number-input"
                        />
                    </div>
                    <div class="lighting-slider-control">
                        <div class="lighting-slider-label">
                            <label :for="getInputId('shadowPlaneDistance')">Shadow plane distance</label>
                            <output :for="getInputId('shadowPlaneDistance')">{{ sceneShadowPlaneDistanceModel.toFixed(1) }}</output>
                        </div>
                        <Slider
                            v-model="sceneShadowPlaneDistanceModel"
                            :input-id="getInputId('shadowPlaneDistance')"
                            :min="2"
                            :max="120"
                            :step="1"
                            :disabled="!sceneLightingEnabledModel"
                            aria-label="Shadow plane distance from artwork"
                            class="lighting-distance-slider"
                        />
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .lighting-settings-controls {
        width: 100%;
    }

    .lighting-control-stack {
        display: flex;
        flex-direction: column;
        gap: 0.8rem;
        padding: 0.5rem;
    }

    .lighting-control-row,
    .lighting-number-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        min-height: 2.75rem;
    }

    .lighting-number-row label {
        color: var(--viewer-toolbar-text, #fff);
        font-size: 0.92rem;
    }

    .lighting-number-input {
        width: 7.5rem;
    }

    :deep(.lighting-number-input .p-inputnumber-input) {
        width: 100%;
        text-align: right;
    }

    .lighting-slider-control {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 0.2rem 0 0.45rem;
    }

    .lighting-slider-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        color: var(--viewer-toolbar-text, #fff);
        font-size: 0.92rem;
    }

    .lighting-slider-label output {
        color: var(--viewer-toolbar-muted-text, rgba(255, 255, 255, 0.72));
        font-variant-numeric: tabular-nums;
    }

    .lighting-distance-slider {
        margin: 0 0.5rem;
    }

    .tools-toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.25rem 0.1rem 0.1rem;
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
        gap: 0.625rem;
        flex-shrink: 0;
    }

    .tools-toggle-copy {
        min-width: 1.8rem;
        font-size: 0.78rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.6);
        text-align: right;
    }
</style>
