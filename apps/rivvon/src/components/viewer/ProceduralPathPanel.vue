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

    const emit = defineEmits(['request-close', 'settings-change', 'request-create']);

    const app = useViewerStore();

    const functionLabel = computed(() => (app.proceduralPathMode === 'sineWave' ? 'Live sine wave' : 'Sine wave'));
    const hasActiveProceduralPath = computed(() => app.proceduralPathMode === 'sineWave');

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

    function getSettingValue(key) {
        return app.sineWaveSettings[key] ?? DEFAULT_SINE_WAVE_SETTINGS[key];
    }

    function updateSetting(key, rawValue) {
        const nextValue = key === 'sampleCount'
            ? Math.round(Number(rawValue))
            : Number(rawValue);

        app.setSineWaveSettings({ [key]: nextValue });
        emit('settings-change', { ...app.sineWaveSettings });
    }

    function resetSettings() {
        app.resetSineWaveSettings();
        emit('settings-change', { ...app.sineWaveSettings });
    }

    function createOrRefresh() {
        emit('request-create', { ...app.sineWaveSettings });
    }
</script>

<template>
    <div
        class="procedural-panel"
        :class="{ active: props.active }"
    >
        <div class="procedural-panel-container viewer-chrome-panel-container">
            <ScrollPanel class="procedural-panel-scrollpanel">
                <div class="procedural-panel-content">
                    <div class="tools-section">
                        <div class="tools-section-label">Function</div>
                        <div class="tools-section-items">
                            <div class="procedural-summary">
                                <span class="material-symbols-outlined">airwave</span>
                                <div class="procedural-summary-copy">
                                    <span class="procedural-summary-title">{{ functionLabel }}</span>
                                    <span class="procedural-summary-meta">
                                        y = offset + amplitude(t) * sin(progress * frequency(t) * 2pi + phase(t))
                                    </span>
                                </div>
                            </div>

                            <div
                                v-for="row in settingRows"
                                :key="row.key"
                                class="tools-slider procedural-slider"
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

            <PanelActionBar class="procedural-panel-footer">
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
                    @click="createOrRefresh"
                >
                    <span class="material-symbols-outlined">{{ hasActiveProceduralPath ? 'refresh' : 'airwave' }}</span>
                    <span>{{ hasActiveProceduralPath ? 'Refresh' : 'Create' }}</span>
                </Button>
                <Button
                    type="button"
                    severity="secondary"
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
    .procedural-panel {
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

    .procedural-panel.active {
        pointer-events: auto;
        opacity: 1;
    }

    .procedural-panel-container {
        display: flex;
        flex-direction: column;
        position: relative;
        height: 100%;
        min-height: 0;
        width: 100%;
        background: transparent;
    }

    .procedural-panel-scrollpanel {
        --p-scrollpanel-bar-size: 0.55rem;
        --p-scrollpanel-bar-background: rgba(255, 255, 255, 0.34);
        flex: 1;
        height: 100%;
        min-height: 0;
        width: 100%;
    }

    :deep(.procedural-panel-scrollpanel .p-scrollpanel-content-container) {
        height: 100%;
        min-height: 0;
    }

    :deep(.procedural-panel-scrollpanel .p-scrollpanel-content) {
        height: 100%;
        min-height: 100%;
        overflow-x: hidden;
        padding-bottom: 0;
    }

    :deep(.procedural-panel-scrollpanel .p-scrollpanel-bar) {
        opacity: 0.55;
    }

    :deep(.procedural-panel-scrollpanel:hover .p-scrollpanel-bar),
    :deep(.procedural-panel-scrollpanel:active .p-scrollpanel-bar),
    :deep(.procedural-panel-scrollpanel .p-scrollpanel-bar:focus-visible) {
        opacity: 0.9;
    }

    .procedural-panel-content {
        box-sizing: border-box;
        padding: 1.5rem 1.25rem;
        width: 100%;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
    }

    .procedural-panel-footer {
        --panel-action-bar-background: var(--viewer-toolbar-panel-background);
        --panel-action-bar-border-color: #374151;
        --panel-action-bar-padding: 1rem 1.25rem;
    }

    .procedural-summary {
        display: flex;
        gap: 0.875rem;
        align-items: flex-start;
        padding: 0.875rem 1rem;
        border-radius: 8px;
        color: var(--p-text-color, #fff);
        background: rgba(255, 255, 255, 0.06);
    }

    .procedural-summary>.material-symbols-outlined {
        font-size: 1.45rem;
        opacity: 0.9;
    }

    .procedural-summary-copy {
        display: flex;
        flex-direction: column;
        gap: 0.18rem;
        min-width: 0;
    }

    .procedural-summary-title {
        font-size: 0.95rem;
        font-weight: 600;
        line-height: 1.25;
    }

    .procedural-summary-meta {
        color: rgba(255, 255, 255, 0.62);
        font-size: 0.78rem;
        line-height: 1.35;
    }

    .procedural-slider {
        padding: 0.625rem 1rem;
    }

    @media (min-width: 769px) {
        .procedural-panel-content {
            align-items: center;
        }

        .procedural-panel-content .tools-section {
            width: min(44rem, 100%);
        }
    }
</style>
