<script setup>
    import { computed } from 'vue';
    import Button from 'primevue/button';
    import ScrollPanel from 'primevue/scrollpanel';
    import PanelActionBar from '../shared/PanelActionBar.vue';
    import { DEFAULT_CLOCK_SETTINGS } from '../../modules/viewer/proceduralPaths.js';
    import { useViewerStore } from '../../stores/viewerStore';

    const props = defineProps({
        active: { type: Boolean, default: false },
    });

    const emit = defineEmits(['request-close', 'settings-change', 'request-create']);

    const app = useViewerStore();

    const functionLabel = computed(() => (app.proceduralPathMode === 'clock' ? 'Live clock' : 'Clock'));
    const hasActiveClock = computed(() => app.proceduralPathMode === 'clock');

    const handSettingRows = [
        {
            key: 'hourHandLength',
            label: 'Hour Reach',
            icon: 'timer',
            min: 0.1,
            max: 1,
            step: 0.01,
            format: (value) => `${Math.round(value * 100)}%`,
        },
        {
            key: 'minuteHandLength',
            label: 'Minute Reach',
            icon: 'timer',
            min: 0.1,
            max: 1.2,
            step: 0.01,
            format: (value) => `${Math.round(value * 100)}%`,
        },
        {
            key: 'secondHandLength',
            label: 'Second Reach',
            icon: 'timer',
            min: 0.1,
            max: 1.3,
            step: 0.01,
            format: (value) => `${Math.round(value * 100)}%`,
        },
        {
            key: 'millisecondHandLength',
            label: 'Millisecond Reach',
            icon: 'timer',
            min: 0.1,
            max: 1.4,
            step: 0.01,
            format: (value) => `${Math.round(value * 100)}%`,
        },
    ];

    function buildPayload() {
        return {
            type: 'clock',
            settings: { ...app.clockSettings },
        };
    }

    function getSettingValue(key) {
        return app.clockSettings[key] ?? DEFAULT_CLOCK_SETTINGS[key];
    }

    function updateSetting(key, rawValue) {
        app.setClockSettings({ [key]: Number(rawValue) });
        emit('settings-change', buildPayload());
    }

    function resetSettings() {
        app.resetClockSettings();
        emit('settings-change', buildPayload());
    }

    function createOrRefresh() {
        emit('request-create', buildPayload());
    }
</script>

<template>
    <div
        class="clock-panel"
        :class="{ active: props.active }"
    >
        <div class="clock-panel-container viewer-chrome-panel-container">
            <ScrollPanel class="clock-panel-scrollpanel">
                <div class="clock-panel-content">
                    <div class="tools-section">
                        <div class="tools-section-label">Clock Face</div>
                        <div class="tools-section-items">
                            <div class="clock-summary">
                                <span class="material-symbols-outlined">schedule</span>
                                <div class="clock-summary-copy">
                                    <span class="clock-summary-title">{{ functionLabel }}</span>
                                    <span class="clock-summary-meta">
                                        Bezel, noon/3/6/9 markers, and four live hands animate from the current local
                                        time.
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="tools-section">
                        <div class="tools-section-label">Hands</div>
                        <div class="tools-section-items">
                            <div
                                v-for="row in handSettingRows"
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

            <PanelActionBar class="clock-panel-footer">
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
                    <span class="material-symbols-outlined">{{ hasActiveClock ? 'refresh' : 'schedule' }}</span>
                    <span>{{ hasActiveClock ? 'Refresh' : 'Create' }}</span>
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
    .clock-panel {
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

    .clock-panel.active {
        pointer-events: auto;
        opacity: 1;
    }

    .clock-panel-container {
        display: flex;
        flex-direction: column;
        position: relative;
        height: 100%;
        min-height: 0;
        width: 100%;
        background: transparent;
    }

    .clock-panel-scrollpanel {
        --p-scrollpanel-bar-size: 0.55rem;
        --p-scrollpanel-bar-background: rgba(255, 255, 255, 0.34);
        flex: 1;
        height: 100%;
        min-height: 0;
        width: 100%;
    }

    :deep(.clock-panel-scrollpanel .p-scrollpanel-content-container) {
        height: 100%;
        min-height: 0;
    }

    :deep(.clock-panel-scrollpanel .p-scrollpanel-content) {
        height: 100%;
        min-height: 100%;
        overflow-x: hidden;
        padding-bottom: 0;
    }

    :deep(.clock-panel-scrollpanel .p-scrollpanel-bar) {
        opacity: 0.55;
    }

    :deep(.clock-panel-scrollpanel:hover .p-scrollpanel-bar),
    :deep(.clock-panel-scrollpanel:active .p-scrollpanel-bar),
    :deep(.clock-panel-scrollpanel .p-scrollpanel-bar:focus-visible) {
        opacity: 0.9;
    }

    .clock-panel-content {
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

    .clock-panel-footer {
        --panel-action-bar-background: var(--viewer-toolbar-panel-background);
        --panel-action-bar-border-color: #374151;
        --panel-action-bar-padding: 1rem 1.25rem;
    }

    .clock-summary {
        display: flex;
        gap: 0.875rem;
        align-items: flex-start;
        padding: 0.875rem 1rem;
        border-radius: 8px;
        color: var(--p-text-color, #fff);
        background: rgba(255, 255, 255, 0.06);
    }

    .clock-summary>.material-symbols-outlined {
        font-size: 1.45rem;
        opacity: 0.9;
    }

    .clock-summary-copy {
        display: flex;
        flex-direction: column;
        gap: 0.18rem;
        min-width: 0;
    }

    .clock-summary-title {
        font-size: 0.95rem;
        font-weight: 600;
        line-height: 1.25;
    }

    .clock-summary-meta {
        color: rgba(255, 255, 255, 0.62);
        font-size: 0.78rem;
        line-height: 1.35;
    }

    @media (min-width: 769px) {
        .clock-panel-content {
            align-items: center;
        }

        .clock-panel-content .tools-section {
            width: min(44rem, 100%);
        }
    }
</style>