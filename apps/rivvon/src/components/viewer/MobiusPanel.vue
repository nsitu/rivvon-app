<script setup>
    import { computed } from 'vue';
    import Button from 'primevue/button';
    import Select from 'primevue/select';
    import ScrollPanel from 'primevue/scrollpanel';
    import PanelActionBar from '../shared/PanelActionBar.vue';
    import { DEFAULT_MOBIUS_SETTINGS } from '../../modules/viewer/proceduralPaths.js';
    import { useViewerStore } from '../../stores/viewerStore';

    const props = defineProps({
        active: { type: Boolean, default: false },
    });

    const emit = defineEmits(['request-close', 'settings-change', 'save-drawing']);

    const app = useViewerStore();

    const functionLabel = 'Möbius Strip';
    const handednessOptions = [
        { label: 'Right-handed', value: 1 },
        { label: 'Left-handed', value: -1 },
    ];
    const handedness = computed({
        get: () => app.mobiusSettings.handedness,
        set: (value) => updateSetting('handedness', value),
    });

    const settingRows = [
        { key: 'radius', label: 'Radius', icon: 'crop_free', min: 0.5, max: 6, step: 0.05 },
        { key: 'width', label: 'Width', icon: 'swap_horiz', min: 0.1, max: 9.6, step: 0.05 },
        { key: 'twistPhase', label: 'Twist Phase', icon: '360', min: 0, max: 360, step: 1 },
    ];

    function buildPayload() {
        return {
            type: 'mobius',
            settings: { ...app.mobiusSettings },
        };
    }

    function getSettingValue(key) {
        return app.mobiusSettings[key] ?? DEFAULT_MOBIUS_SETTINGS[key];
    }

    function updateSetting(key, rawValue) {
        app.setMobiusSettings({ [key]: Number(rawValue) });
        emit('settings-change', buildPayload());
    }

    function commitNumericSetting(key, event) {
        const value = event.target.value;
        if (value !== '' && Number.isFinite(Number(value))) updateSetting(key, value);
        // Also restore the field when clamping produced the existing value.
        event.target.value = getSettingValue(key);
    }

    function resetSettings() {
        app.resetMobiusSettings();
        emit('settings-change', buildPayload());
    }

</script>

<template>
    <div
        class="mobius-panel"
        :class="{ active: props.active }"
    >
        <div class="mobius-panel-container viewer-chrome-panel-container">
            <ScrollPanel class="rivvon-scroll-panel mobius-panel-scrollpanel">
                <div class="mobius-panel-content">
                    <div class="tools-section">
                        <div class="tools-section-label">Möbius Strip</div>
                        <div class="tools-section-items">
                            <div class="mobius-summary">
                                <span class="material-symbols-outlined">all_inclusive</span>
                                <div class="mobius-summary-copy">
                                    <span class="mobius-summary-title">{{ functionLabel }}</span>
                                    <span class="mobius-summary-meta">
                                        One continuous band with a 180° twist. Texture flow is supported;
                                        the texture join may remain visible.
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="tools-section">
                        <div class="tools-section-label">Shape</div>
                        <div class="tools-select-block">
                            <label for="mobius-handedness" class="tools-select-label">Handedness</label>
                            <Select input-id="mobius-handedness" v-model="handedness"
                                :options="handednessOptions" option-label="label" option-value="value" class="tools-select" />
                        </div>
                        <div class="tools-section-items">
                            <div
                                v-for="row in settingRows"
                                :key="row.key"
                                class="tools-slider"
                            >
                                <div class="mobius-slider-heading">
                                    <label :for="`mobius-${row.key}`">
                                        <span class="material-symbols-outlined tools-slider-icon">{{ row.icon }}</span>
                                        {{ row.label }}
                                    </label>
                                    <input
                                        class="mobius-number"
                                        type="number"
                                        :aria-label="row.label + ' value'"
                                        :min="row.min"
                                        :max="row.key === 'width' ? app.mobiusSettings.radius * 1.6 : row.max"
                                        :step="row.step"
                                        :value="getSettingValue(row.key)"
                                        @change="commitNumericSetting(row.key, $event)"
                                        @keydown.enter="commitNumericSetting(row.key, $event)"
                                    />
                                    <span v-if="row.key === 'twistPhase'">°</span>
                                </div>
                                <input
                                    :id="`mobius-${row.key}`"
                                    type="range"
                                    :min="row.min"
                                    :max="row.key === 'width' ? app.mobiusSettings.radius * 1.6 : row.max"
                                    :step="row.step"
                                    :value="getSettingValue(row.key)"
                                    @input="updateSetting(row.key, $event.target.value)"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </ScrollPanel>

            <PanelActionBar class="mobius-panel-footer">
                <Button type="button" severity="secondary" @click="emit('save-drawing', buildPayload())">
                    <span class="material-symbols-outlined">save</span>
                    <span>Save Drawing</span>
                </Button>
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
    .mobius-slider-heading {
        display: flex;
        align-items: center;
        gap: 0.4rem;
    }

    .mobius-number {
        margin-left: auto;
        width: 5.5rem;
        padding: 0.25rem 0.4rem;
        border: 1px solid rgba(255, 255, 255, 0.22);
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.06);
        color: inherit;
        text-align: right;
    }

    .tools-select-block {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        padding: 0.5rem;
    }

    .mobius-panel {
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

    .mobius-panel.active {
        pointer-events: auto;
        opacity: 1;
    }

    .mobius-panel-container {
        display: flex;
        flex-direction: column;
        position: relative;
        height: 100%;
        min-height: 0;
        width: 100%;
        background: transparent;
    }

    .mobius-panel-content {
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

    .mobius-panel-footer {
        --panel-action-bar-background: var(--viewer-toolbar-panel-background);
        --panel-action-bar-border-color: #374151;
        --panel-action-bar-padding: 1rem 1.25rem;
    }

    .mobius-summary {
        display: flex;
        gap: 0.875rem;
        align-items: flex-start;
        padding: 0.875rem 1rem;
        border-radius: 8px;
        color: var(--p-text-color, #fff);
        background: rgba(255, 255, 255, 0.06);
    }

    .mobius-summary>.material-symbols-outlined {
        font-size: 1.45rem;
        opacity: 0.9;
    }

    .mobius-summary-copy {
        display: flex;
        flex-direction: column;
        gap: 0.18rem;
        min-width: 0;
    }

    .mobius-summary-title {
        font-size: 0.95rem;
        font-weight: 600;
        line-height: 1.25;
    }

    .mobius-summary-meta {
        color: rgba(255, 255, 255, 0.62);
        font-size: 0.78rem;
        line-height: 1.35;
    }

    @media (min-width: 769px) {
        .mobius-panel-content {
            align-items: center;
        }

        .mobius-panel-content .tools-section {
            width: min(44rem, 100%);
        }
    }
</style>
