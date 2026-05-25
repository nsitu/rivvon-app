<script setup>
    import { computed, getCurrentInstance, ref, watch } from 'vue';
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

    const backgroundBlurModel = computed({
        get: () => app.backgroundBlurEnabled,
        set: (value) => {
            app.setBackgroundBlurEnabled(!!value);
        },
    });

    const reverseLayerCycleModel = computed({
        get: () => app.textureAnimationReversed,
        set: (value) => {
            app.setTextureAnimationReversed(!!value);
        },
    });

    function handleFlowSpeedInput(event) {
        app.setFlowSpeed(parseFloat(event.target.value));
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
                    v-if="flowEnabledModel && textureAnimationModel"
                    class="tools-toggle-row"
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

    </div>
</template>

<style scoped>
    .animation-settings-controls {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        width: 100%;
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

</style>
