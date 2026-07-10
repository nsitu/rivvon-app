<script setup>
    import { computed, ref } from 'vue';
    import Button from 'primevue/button';
    import ToggleSwitch from 'primevue/toggleswitch';
    import PanelActionBar from '../shared/PanelActionBar.vue';
    import { useLocalStorage } from '../../services/localStorage.js';
    import { useViewerStore } from '../../stores/viewerStore.js';
    import {
        EXPORT_ASPECT_RATIO_OPTIONS,
        getExportResolutionOptions,
        normalizeExportDimensionSettings,
    } from '../../modules/viewer/exportVideoDimensions';
    import {
        TEXTURE_OVERVIEW_LAYOUT_STRATEGY_ALIGN_TO_EDGE,
        TEXTURE_OVERVIEW_LAYOUT_STRATEGY_FILL_FRAME,
    } from '../../modules/viewer/textureOverviewLayout.js';
    import TextureOverviewPreview from './TextureOverviewPreview.vue';
    import TextureSettingsControls from './TextureSettingsControls.vue';

    const props = defineProps({
        texture: {
            type: Object,
            required: true,
        },
        source: {
            type: String,
            default: 'cloud',
        },
        isCached: {
            type: Boolean,
            default: false,
        },
    });

    const emit = defineEmits(['request-apply', 'request-close', 'request-export-preview']);

    const app = useViewerStore();
    const { getTiles: getLocalTiles, getCachedLocalId } = useLocalStorage();
    const overviewRef = ref(null);

    const isLocal = computed(() => props.source === 'local');
    const exportDimensionSettings = computed(() => normalizeExportDimensionSettings({
        aspectRatioPreset: app.exportAspectRatioPreset,
        resolutionPreset: app.exportResolutionPreset,
        customWidth: app.exportCustomWidth,
        customHeight: app.exportCustomHeight,
    }));
    const aspectRatioPreset = computed({
        get: () => exportDimensionSettings.value.aspectRatioPreset,
        set: (value) => {
            app.setExportAspectRatioPreset(value);
        },
    });
    const resolutionPreset = computed({
        get: () => exportDimensionSettings.value.resolutionPreset,
        set: (value) => {
            app.setExportResolutionPreset(value);
        },
    });
    const alignTilesToEdge = computed({
        get: () => app.textureOverviewLayoutStrategy === TEXTURE_OVERVIEW_LAYOUT_STRATEGY_ALIGN_TO_EDGE,
        set: (value) => {
            app.setTextureOverviewLayoutStrategy(
                value
                    ? TEXTURE_OVERVIEW_LAYOUT_STRATEGY_ALIGN_TO_EDGE
                    : TEXTURE_OVERVIEW_LAYOUT_STRATEGY_FILL_FRAME,
            );
        },
    });
    const customWidth = computed({
        get: () => exportDimensionSettings.value.customWidth,
        set: (value) => {
            app.setExportCustomWidth(value);
        },
    });
    const customHeight = computed({
        get: () => exportDimensionSettings.value.customHeight,
        set: (value) => {
            app.setExportCustomHeight(value);
        },
    });
    const resolvedDimensions = computed(() => ({
        width: exportDimensionSettings.value.width,
        height: exportDimensionSettings.value.height,
    }));
    const resolutionOptions = computed(() => getExportResolutionOptions(aspectRatioPreset.value));
    const tileCount = computed(() => overviewRef.value?.tileCount ?? props.texture?.tile_count ?? 0);
    const displayScale = computed(() => overviewRef.value?.displayScale ?? 1);
    const isPreviewReady = computed(() => overviewRef.value?.isReady ?? false);
    const backgroundThumbnailUrl = computed(() => props.texture?.thumbnail_data_url || props.texture?.thumbnail_url || null);
    const backgroundThumbnailStyle = computed(() => {
        if (!backgroundThumbnailUrl.value) {
            return {};
        }

        return {
            backgroundImage: `url("${String(backgroundThumbnailUrl.value).replace(/"/g, '\\"')}")`,
        };
    });
    const sourceLabel = computed(() => {
        if (isLocal.value) {
            return 'Local texture';
        }

        return props.isCached ? 'Cached cloud texture' : 'Cloud texture';
    });

    function handleApply() {
        emit('request-apply', {
            texture: props.texture,
            source: props.source,
            isCached: props.isCached,
        });
    }

    function handleClose() {
        emit('request-close');
    }

    function handleExport() {
        emit('request-export-preview', {
            texture: props.texture,
            source: props.source,
            isCached: props.isCached,
            getTextureOnlyExportInfo: () => overviewRef.value?.getTextureOnlyExportInfo?.() ?? null,
            exportTextureOnlyVideo: (options) => overviewRef.value?.exportVideoWithLiveScene?.(options) ?? null,
            exportSettings: {
                ...exportDimensionSettings.value,
                layoutStrategy: app.textureOverviewLayoutStrategy,
            },
        });
    }
</script>

<template>
    <div class="texture-overview-panel">
        <div
            v-if="app.transparentShadowsEnabled && backgroundThumbnailUrl"
            class="texture-overview-panel-backdrop"
            :style="backgroundThumbnailStyle"
            aria-hidden="true"
        ></div>
        <div class="texture-overview-panel-container viewer-chrome-panel-container">
            <section class="texture-overview-panel-content">
                <div class="texture-overview-panel-body">
                    <div class="texture-overview-meta">
                        <p class="texture-overview-name">{{ texture?.name || 'Untitled Texture' }}</p>
                        <p class="texture-overview-subtitle">{{ sourceLabel }}</p>
                    </div>

                    <div class="texture-overview-controls">
                        <div class="preview-dimension-grid">
                            <label
                                class="preview-control-field"
                                :class="{ 'preview-control-field-full': aspectRatioPreset === 'custom' }"
                            >
                                <span class="preview-control-label">Aspect Ratio</span>
                                <select
                                    v-model="aspectRatioPreset"
                                    class="preview-control-select"
                                >
                                    <option
                                        v-for="option in EXPORT_ASPECT_RATIO_OPTIONS"
                                        :key="option.value"
                                        :value="option.value"
                                    >
                                        {{ option.label }}
                                    </option>
                                </select>
                            </label>

                            <label
                                v-if="aspectRatioPreset !== 'custom'"
                                class="preview-control-field"
                            >
                                <span class="preview-control-label">Resolution</span>
                                <select
                                    v-model="resolutionPreset"
                                    class="preview-control-select"
                                >
                                    <option
                                        v-for="option in resolutionOptions"
                                        :key="option.value"
                                        :value="option.value"
                                    >
                                        {{ option.label }}
                                    </option>
                                </select>
                            </label>

                            <label class="preview-control-field preview-control-field-full">
                                <span class="preview-control-label">Snap Tiles to Frame Height</span>
                                <div class="preview-control-toggle-row">
                                    <ToggleSwitch v-model="alignTilesToEdge" />
                                    <span class="preview-control-toggle-copy">{{ alignTilesToEdge ? 'On' : 'Off'
                                        }}</span>
                                </div>
                            </label>

                            <div
                                v-if="aspectRatioPreset === 'custom' || resolutionPreset === 'custom'"
                                class="preview-control-custom-row"
                            >
                                <label class="preview-control-field preview-control-field-small">
                                    <span class="preview-control-label">Width</span>
                                    <input
                                        v-model.number="customWidth"
                                        class="preview-control-input"
                                        type="number"
                                        min="320"
                                        max="7680"
                                        step="2"
                                    >
                                </label>
                                <label class="preview-control-field preview-control-field-small">
                                    <span class="preview-control-label">Height</span>
                                    <input
                                        v-model.number="customHeight"
                                        class="preview-control-input"
                                        type="number"
                                        min="240"
                                        max="4320"
                                        step="2"
                                    >
                                </label>
                            </div>
                        </div>

                        <TextureSettingsControls
                            class="texture-overview-filter-controls"
                            :show-texture-materials="false"
                            :show-duotone-filter="true"
                            :show-transparent-shadows-filter="true"
                            :show-vertical-flip="false"
                        />

                    </div>

                    <div class="texture-overview-stage">
                        <TextureOverviewPreview
                            ref="overviewRef"
                            :texture="texture"
                            :is-local="isLocal"
                            :get-local-tiles="getLocalTiles"
                            :get-cached-local-id="getCachedLocalId"
                            :is-cached="isCached"
                            :target-width="resolvedDimensions.width"
                            :target-height="resolvedDimensions.height"
                        />

                        <div
                            v-if="isPreviewReady && (tileCount > 0 || texture?.tile_count)"
                            class="preview-tile-info"
                        >
                            {{ tileCount || texture?.tile_count }} tile{{ (tileCount || texture?.tile_count) > 1 ? 's' :
                                '' }}
                            <span v-if="displayScale < 1">({{ Math.round(displayScale * 100) }}% scale)</span>
                        </div>
                    </div>
                </div>

                <PanelActionBar class="texture-overview-panel-footer">
                    <Button
                        label="Close"
                        severity="secondary"
                        variant="outlined"
                        icon="material-symbols-outlined"
                        @click="handleClose"
                    >
                        <template #icon>
                            <span class="material-symbols-outlined">close</span>
                        </template>
                    </Button>
                    <Button
                        label="Export"
                        severity="secondary"
                        variant="outlined"
                        icon="material-symbols-outlined"
                        @click="handleExport"
                    >
                        <template #icon>
                            <span class="material-symbols-outlined">movie</span>
                        </template>
                    </Button>
                    <Button
                        label="Apply"
                        icon="material-symbols-outlined"
                        @click="handleApply"
                    >
                        <template #icon>
                            <span class="material-symbols-outlined">check</span>
                        </template>
                    </Button>
                </PanelActionBar>
            </section>
        </div>
    </div>
</template>

<style scoped>
    .texture-overview-panel {
        position: absolute;
        inset: 0;
        z-index: 5;
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.76);
    }

    .texture-overview-panel::after {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        background:
            linear-gradient(180deg, rgba(3, 6, 12, 0.42) 0%, rgba(3, 6, 12, 0.42) 100%),
            radial-gradient(circle at center, rgba(11, 18, 32, 0.12) 0%, rgba(11, 18, 32, 0.34) 100%);
        z-index: 0;
    }

    .texture-overview-panel-backdrop {
        position: absolute;
        inset: -2rem;
        pointer-events: none;
        background-position: center;
        background-repeat: no-repeat;
        background-size: cover;
        filter: blur(42px) saturate(1.08);
        transform: scale(1.08);
        opacity: 0.5;
        z-index: 0;
    }

    .texture-overview-panel-container {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
    }

    .texture-overview-panel-content {
        flex: 1;
        width: 100%;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        padding: 1.5rem 1.25rem;
        gap: 1rem;
    }

    .texture-overview-panel-body {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .texture-overview-meta {
        display: flex;
        flex-direction: column;
        gap: 0.18rem;
        min-width: 0;
    }

    .texture-overview-name {
        margin: 0;
        color: #f8fafc;
        font-size: clamp(1rem, 1.8vw, 1.35rem);
        font-weight: 700;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .texture-overview-subtitle {
        margin: 0;
        color: #94a3b8;
        font-size: 0.85rem;
    }

    .texture-overview-controls {
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
        padding-top: 0.6rem;
        border-top: 1px solid var(--p-content-border-color, rgba(255, 255, 255, 0.1));
    }

    .preview-dimension-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
        gap: 0.75rem;
    }

    .texture-overview-filter-controls {
        max-height: min(22rem, 34vh);
        overflow-y: auto;
        padding-right: 0.25rem;
    }

    .preview-control-field {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        min-width: 0;
    }

    .preview-control-field-small {
        min-width: 0;
    }

    .preview-control-label {
        color: #9ca3af;
        font-size: 0.68rem;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
    }

    .preview-control-select,
    .preview-control-input {
        width: 100%;
        min-width: 0;
        border: 1px solid #4b5563;
        background: rgba(17, 24, 39, 0.82);
        color: #f8fafc;
        border-radius: 8px;
        padding: 0.65rem 0.75rem;
        font-size: 0.82rem;
        outline: none;
    }

    .preview-control-select:focus,
    .preview-control-input:focus {
        border-color: #60a5fa;
    }

    .preview-control-custom-row {
        grid-column: 1 / -1;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.75rem;
    }

    .preview-control-toggle-row {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        min-height: 2.5rem;
        padding: 0.25rem 0;
    }

    .preview-control-toggle-copy {
        color: #cbd5e1;
        font-size: 0.8rem;
        font-weight: 600;
    }

    .texture-overview-stage {
        position: relative;
        flex: 1;
        width: 100%;
        min-height: 0;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        overflow: auto;
    }

    .preview-tile-info {
        position: absolute;
        top: 0.75rem;
        left: 50%;
        transform: translateX(-50%);
        font-size: 12px;
        color: rgba(255, 255, 255, 0.7);
        background: rgba(0, 0, 0, 0.5);
        padding: 4px 8px;
        border-radius: 999px;
        pointer-events: none;
        z-index: 2;
        white-space: nowrap;
    }

    .texture-overview-panel-footer {
        --panel-action-bar-padding: 0.85rem 0 0;
        --panel-action-bar-button-min-width: 8.5rem;
    }

    @media (max-width: 767px) {
        .texture-overview-panel-content {
            padding: 0.85rem 0.6rem 1rem;
        }

        .preview-dimension-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .preview-control-field-full,
        .preview-control-custom-row {
            grid-column: 1 / -1;
        }

        .texture-overview-panel-footer {
            --panel-action-bar-gap: 0.5rem;
            --panel-action-bar-button-min-width: 0;
            --panel-action-bar-mobile-basis: 0;
        }

        .texture-overview-panel-footer :deep(.panel-action-bar-actions) {
            flex-wrap: nowrap;
        }

        .texture-overview-panel-footer :deep(.p-button) {
            flex: 1 1 0;
            min-width: 0;
            padding-inline: 0.7rem;
        }

        .preview-control-custom-row {
            grid-template-columns: minmax(0, 1fr);
        }

    }
</style>
