<script setup>
    import { computed } from 'vue';
    import Button from 'primevue/button';
    import ScrollPanel from 'primevue/scrollpanel';
    import PanelActionBar from '../shared/PanelActionBar.vue';
    import { DEFAULT_SINE_WAVE_SETTINGS } from '../../modules/viewer/proceduralPaths.js';
    import { useViewerStore } from '../../stores/viewerStore';

    const props = defineProps({
        active: { type: Boolean, default: false },
    });

    const emit = defineEmits(['request-close', 'settings-change']);

    const app = useViewerStore();

    const functionLabel = computed(() => (app.proceduralPathMode === 'sineWave' ? 'Live sine wave' : 'Sine wave'));

    const settingRows = [
        {
            key: 'amplitudeMin',
            label: 'Amplitude Min',
            icon: 'height',
            min: 0,
            max: 4,
            step: 0.05,
            format: (value) => value.toFixed(2),
        },
        {
            key: 'amplitudeMax',
            label: 'Amplitude Max',
            icon: 'height',
            min: 0,
            max: 4,
            step: 0.05,
            format: (value) => value.toFixed(2),
        },
        {
            key: 'frequencyMin',
            label: 'Frequency Min',
            icon: 'waves',
            min: 0.05,
            max: 12,
            step: 0.05,
            format: (value) => value.toFixed(2),
        },
        {
            key: 'frequencyMax',
            label: 'Frequency Max',
            icon: 'waves',
            min: 0.05,
            max: 12,
            step: 0.05,
            format: (value) => value.toFixed(2),
        },
        {
            key: 'domainWidth',
            label: 'Width',
            icon: 'swap_horiz',
            min: 0.5,
            max: 24,
            step: 0.1,
            format: (value) => value.toFixed(1),
        },
        {
            key: 'verticalOffset',
            label: 'Vertical Offset',
            icon: 'vertical_align_center',
            min: -8,
            max: 8,
            step: 0.05,
            format: (value) => value.toFixed(2),
        },
        {
            key: 'phaseSpeed',
            label: 'Phase Speed',
            icon: 'speed',
            min: -12,
            max: 12,
            step: 0.05,
            format: (value) => value.toFixed(2),
        },
        {
            key: 'amplitudeCycleSpeed',
            label: 'Amplitude Drift',
            icon: 'sync',
            min: 0,
            max: 4,
            step: 0.05,
            format: (value) => value.toFixed(2),
        },
        {
            key: 'frequencyCycleSpeed',
            label: 'Frequency Drift',
            icon: 'sync_alt',
            min: 0,
            max: 4,
            step: 0.05,
            format: (value) => value.toFixed(2),
        },
        {
            key: 'frequencyCyclePhase',
            label: 'Frequency Phase',
            icon: 'motion_photos_on',
            min: -Math.PI * 2,
            max: Math.PI * 2,
            step: 0.05,
            format: (value) => `${value.toFixed(2)} rad`,
        },
        {
            key: 'sampleCount',
            label: 'Samples',
            icon: 'linear_scale',
            min: 32,
            max: 720,
            step: 1,
            format: (value) => `${Math.round(value)}`,
        },
    ];

    function buildPayload() {
        return {
            type: 'sineWave',
            settings: { ...app.sineWaveSettings },
        };
    }

    function getSettingValue(key) {
        return app.sineWaveSettings[key] ?? DEFAULT_SINE_WAVE_SETTINGS[key];
    }

    function updateSetting(key, rawValue) {
        const nextValue = key === 'sampleCount'
            ? Math.round(Number(rawValue))
            : Number(rawValue);

        app.setSineWaveSettings({ [key]: nextValue });
        emit('settings-change', buildPayload());
    }

    function resetSettings() {
        app.resetSineWaveSettings();
        emit('settings-change', buildPayload());
    }

</script>

<template>
    <div
        class="sine-wave-panel"
        :class="{ active: props.active }"
    >
        <div class="sine-wave-panel-container viewer-chrome-panel-container">
            <ScrollPanel class="sine-wave-panel-scrollpanel">
                <div class="sine-wave-panel-content">
                    <div class="tools-section">
                        <div class="tools-section-label">Wave</div>
                        <div class="tools-section-items">
                            <div class="sine-wave-summary">
                                <span class="material-symbols-outlined">airwave</span>
                                <div class="sine-wave-summary-copy">
                                    <span class="sine-wave-summary-title">{{ functionLabel }}</span>
                                    <span class="sine-wave-summary-meta">
                                        y = offset + amplitude(t) * sin(progress * frequency(t) * 2pi + phase(t))
                                    </span>
                                </div>
                            </div>

                            <div
                                v-for="row in settingRows"
                                :key="row.key"
                                class="tools-slider"
                            >
                                <label>
                                    <span class="material-symbols-outlined tools-slider-icon">{{ row.icon }}</span>
                                    {{ row.label }}
                                    <span class="tools-slider-value">{{ row.format(getSettingValue(row.key)) }}</span>
                                </label>
                                <input
                                    type="range"
                                    :min="row.min"
                                    :max="row.max"
                                    :step="row.step"
                                    :value="getSettingValue(row.key)"
                                    @input="updateSetting(row.key, $event.target.value)"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </ScrollPanel>

            <PanelActionBar class="sine-wave-panel-footer">
                <Button
                    type="button"
                    severity="secondary"
                    @click="resetSettings"
                >
                    <span class="material-symbols-outlined">restart_alt</span>
                    <span>Reset</span>
                </Button>
                <Button
                    type="button"
                    severity="success"
                    @click="emit('request-close')"
                >
                    <span class="material-symbols-outlined">check</span>
                    <span>Done</span>
                </Button>
            </PanelActionBar>
        </div>
    </div>
</template>

<style scoped>
    .sine-wave-panel {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 8;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease;
        display: flex;
        flex-direction: column;
    }

    .sine-wave-panel.active {
        pointer-events: auto;
        opacity: 1;
    }

    .sine-wave-panel-container {
        display: flex;
        flex-direction: column;
        position: relative;
        height: 100%;
        min-height: 0;
        width: 100%;
        background: transparent;
    }

    .sine-wave-panel-scrollpanel {
        --p-scrollpanel-bar-size: 0.55rem;
        --p-scrollpanel-bar-background: rgba(255, 255, 255, 0.34);
        flex: 1;
        height: 100%;
        min-height: 0;
        width: 100%;
    }

    :deep(.sine-wave-panel-scrollpanel .p-scrollpanel-content-container) {
        height: 100%;
        min-height: 0;
    }

    :deep(.sine-wave-panel-scrollpanel .p-scrollpanel-content) {
        height: 100%;
        min-height: 100%;
        overflow-x: hidden;
        padding-bottom: 0;
    }

    :deep(.sine-wave-panel-scrollpanel .p-scrollpanel-bar) {
        opacity: 0.55;
    }

    :deep(.sine-wave-panel-scrollpanel:hover .p-scrollpanel-bar),
    :deep(.sine-wave-panel-scrollpanel:active .p-scrollpanel-bar),
    :deep(.sine-wave-panel-scrollpanel .p-scrollpanel-bar:focus-visible) {
        opacity: 0.9;
    }

    .sine-wave-panel-content {
        box-sizing: border-box;
        padding: 1.5rem 1.25rem;
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        min-height: 100%;
        justify-content: flex-end;
        background: var(--viewer-toolbar-panel-background);
    }

    .sine-wave-panel-footer {
        --panel-action-bar-background: var(--viewer-toolbar-panel-background);
        --panel-action-bar-border-color: #374151;
        --panel-action-bar-padding: 1rem 1.25rem;
    }

    .sine-wave-summary {
        display: flex;
        gap: 0.875rem;
        align-items: flex-start;
        padding: 0.875rem 1rem;
        border-radius: 8px;
        color: var(--p-text-color, #fff);
        background: rgba(255, 255, 255, 0.06);
    }

    .sine-wave-summary>.material-symbols-outlined {
        font-size: 1.45rem;
        opacity: 0.9;
    }

    .sine-wave-summary-copy {
        display: flex;
        flex-direction: column;
        gap: 0.18rem;
        min-width: 0;
    }

    .sine-wave-summary-title {
        font-size: 0.95rem;
        font-weight: 600;
        line-height: 1.25;
    }

    .sine-wave-summary-meta {
        color: rgba(255, 255, 255, 0.62);
        font-size: 0.78rem;
        line-height: 1.35;
    }

    @media (min-width: 769px) {
        .sine-wave-panel-content {
            align-items: center;
        }

        .sine-wave-panel-content .tools-section {
            width: min(44rem, 100%);
        }
    }
</style>