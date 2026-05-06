<script setup>
    import { computed, getCurrentInstance } from 'vue';
    import Select from 'primevue/select';
    import ToggleSwitch from 'primevue/toggleswitch';
    import { useViewerStore } from '../../stores/viewerStore';

    defineProps({
        showPreferredResolution: { type: Boolean, default: false },
        showBlackAndWhiteFilter: { type: Boolean, default: false },
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
</style>