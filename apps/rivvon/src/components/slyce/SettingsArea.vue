<script setup>

    import { watch, watchEffect, ref, computed } from 'vue';
    import { useSlyceStore } from '../../stores/slyceStore';
    const app = useSlyceStore()  // Pinia store

    const emit = defineEmits(['back']);

    import { useTilePlan } from '../../composables/slyce/useTilePlan';
    const { tilePlan } = useTilePlan();

    import { getMetaData } from '../../modules/slyce/metaDataExtractor';
    import { processVideo } from '../../modules/slyce/videoProcessor';

    import TilePreview from './TilePreview.vue';


    // when a file is uploaded get the metadata (skip if file is null/undefined)
    watch(() => app.file, (newFile) => {
        if (newFile) {
            getMetaData();
        }
    })

    import FileInfo from './FileInfo.vue';
    import Button from 'primevue/button';
    import Select from 'primevue/select';
    import InputNumber from 'primevue/inputnumber';
    import Slider from 'primevue/slider';

    import InputGroup from 'primevue/inputgroup';
    import InputGroupAddon from 'primevue/inputgroupaddon';

    import ProgressSpinner from 'primevue/progressspinner';
    import ToggleSwitch from 'primevue/toggleswitch';

    // Watch for changes in samplingSide and adjust samplePixelCount accordingly
    watchEffect(() => {
        const width = app.cropMode && app.cropWidth ? app.cropWidth : app.fileInfo?.width;
        const height = app.cropMode && app.cropHeight ? app.cropHeight : app.fileInfo?.height;

        if (height && width) {
            if (app.samplingAxis === 'columns') {
                app.samplePixelCount = height;
            }
            if (app.samplingAxis === 'rows') {
                app.samplePixelCount = width;
            }
        }
    });

    // Sync frame range with frameCount when frameCount changes (new video loaded)
    watch(() => app.frameCount, (newFrameCount) => {
        if (newFrameCount > 0) {
            app.frameStart = 1;
            app.frameEnd = newFrameCount;
        }
    });

    // Reset crop to full frame when video changes
    watch(() => app.fileInfo, (newFileInfo) => {
        if (newFileInfo?.width && newFileInfo?.height) {
            app.cropWidth = newFileInfo.width;
            app.cropHeight = newFileInfo.height;
            app.cropX = 0;
            app.cropY = 0;
        }
    }, { immediate: true });

    // Initialize crop dimensions when cropMode is enabled and they're not set
    watch(() => app.cropMode, (isCropMode) => {
        if (isCropMode && app.fileInfo?.width && app.fileInfo?.height) {
            // Initialize with full dimensions if not already set
            if (!app.cropWidth) app.cropWidth = app.fileInfo.width;
            if (!app.cropHeight) app.cropHeight = app.fileInfo.height;
        }
    });

    // Determine if video displays as portrait (height > width after rotation)
    const isPortraitVideo = computed(() => {
        if (!app.fileInfo?.width || !app.fileInfo?.height) return false;
        const rotation = ((app.fileInfo.rotation || 0) % 360 + 360) % 360;
        const isRotated90or270 = rotation === 90 || rotation === 270;
        const effectiveWidth = isRotated90or270 ? app.fileInfo.height : app.fileInfo.width;
        const effectiveHeight = isRotated90or270 ? app.fileInfo.width : app.fileInfo.height;
        return effectiveHeight > effectiveWidth;
    });

    // Loading state - show spinner until metadata is ready
    const isLoading = computed(() => {
        return app.file && !app.fileInfo?.name;
    });

    // Compute perceived long/short side pixel counts (accounting for rotation)
    const sideOptions = computed(() => {
        const w = app.cropMode && app.cropWidth ? app.cropWidth : app.fileInfo?.width;
        const h = app.cropMode && app.cropHeight ? app.cropHeight : app.fileInfo?.height;
        if (!w || !h) return [];
        const rotation = ((app.fileInfo?.rotation || 0) % 360 + 360) % 360;
        const isRotated = rotation === 90 || rotation === 270;
        const perceivedW = isRotated ? h : w;
        const perceivedH = isRotated ? w : h;
        const longPx = Math.max(perceivedW, perceivedH);
        const shortPx = Math.min(perceivedW, perceivedH);
        return [
            { name: 'long', value: 'long', px: longPx },
            { name: 'short', value: 'short', px: shortPx },
        ];
    });

    const selectedSidePx = computed(() => {
        const opt = sideOptions.value.find(o => o.value === app.samplingSide);
        return opt ? opt.px : '';
    });

    const fileInfoRef = ref(null);

    // Trimmed vs full length — explicit flag so the dropdown stays on "trimmed"
    // even before the user changes the frame range
    const isTrimmed = ref(
        app.frameStart > 1 || (app.frameEnd > 0 && app.frameEnd < app.frameCount)
    );

    function setTrimmed(val) {
        isTrimmed.value = val;
        if (!val) {
            app.frameStart = 1;
            app.frameEnd = app.frameCount;
        }
    }

    const frameRange = computed({
        get: () => [app.frameStart || 1, app.frameEnd || app.frameCount || 1],
        set: (val) => {
            app.frameStart = val[0];
            app.frameEnd = val[1];
        }
    });




</script>
<template>
    <!-- Loading state -->
    <div
        v-if="isLoading"
        class="settings-placeholder"
    >
        <ProgressSpinner
            style="width: 50px; height: 50px"
            strokeWidth="4"
        />
    </div>
    <!-- Settings content -->
    <div
        v-else-if="app.file"
        class="three-column-layout"
    >
        <FileInfo
            ref="fileInfoRef"
            class="file-info-column"
            :class="isPortraitVideo ? 'file-info-narrow' : 'file-info-wide'"
        ></FileInfo>

        <div
            id="settings"
            class="settings-column"
        >
            <p class="settings-paragraph">
                <span>Sample from the</span>
                <Select
                    v-model="app.samplingSide"
                    :options="sideOptions"
                    optionValue="value"
                    optionLabel="name"
                    class="inline-select"
                />
                <span>side<template v-if="selectedSidePx"> ({{ selectedSidePx }}px)</template>.</span>
            </p>
            <p class="settings-paragraph">
                <span>Make</span>
                <Select
                    v-model="app.crossSectionCount"
                    :options="[30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240]"
                    class="inline-select"
                />
                <span>distinct cross sections.</span>
            </p>


            <p class="settings-paragraph">
                <ToggleSwitch
                    :modelValue="app.crossSectionType === 'waves'"
                    @update:modelValue="val => app.crossSectionType = val ? 'waves' : 'planes'"
                />
                <span>Use dynamic sampling</span>
            </p>

            <p class="settings-paragraph">
                <ToggleSwitch
                    :modelValue="isTrimmed"
                    @update:modelValue="setTrimmed"
                />
                <template v-if="!isTrimmed">
                    <span>Trim video.</span>
                </template>
                <template v-else>
                    <span>Trim frames {{ frameRange[0] }}–{{ frameRange[1] }} of {{ app.frameCount }}.</span>
                </template>
            </p>

            <Slider
                v-if="isTrimmed"
                v-model="frameRange"
                range
                :min="1"
                :max="app.frameCount || 1"
                :step="1"
                class="trim-slider"
            />

            <p class="settings-paragraph">
                <ToggleSwitch v-model="app.cropMode" />
                <template v-if="!app.cropMode">
                    <span>Crop video.</span>
                </template>
                <template v-else>
                    <span>Crop to</span>
                    <InputNumber
                        v-model="app.cropWidth"
                        :min="1"
                        :max="app.fileInfo?.width"
                        :disabled="!app.fileInfo?.width"
                        class="inline-number crop-input"
                    />
                    <span>×</span>
                    <InputNumber
                        v-model="app.cropHeight"
                        :min="1"
                        :max="app.fileInfo?.height"
                        :disabled="!app.fileInfo?.height"
                        class="inline-number crop-input"
                    />
                    <span>pixels.</span>
                </template>
            </p>
            <p
                v-if="app.cropMode"
                class="settings-paragraph subordinate"
            >
                <span>Offset by</span>
                <InputGroup
                    :class="{ 'disabled-group': app.cropWidth >= app.fileInfo?.width }"
                    class="inline-input-group"
                >
                    <InputGroupAddon>x</InputGroupAddon>
                    <InputNumber
                        v-model="app.cropX"
                        :min="0"
                        :max="Math.max(0, (app.fileInfo?.width || 0) - (app.cropWidth || 0))"
                        :disabled="!app.fileInfo?.width || app.cropWidth >= app.fileInfo?.width"
                        class="crop-input"
                    />
                </InputGroup>
                <span>,</span>
                <InputGroup
                    :class="{ 'disabled-group': app.cropHeight >= app.fileInfo?.height }"
                    class="inline-input-group"
                >
                    <InputGroupAddon>y</InputGroupAddon>
                    <InputNumber
                        v-model="app.cropY"
                        :min="0"
                        :max="Math.max(0, (app.fileInfo?.height || 0) - (app.cropHeight || 0))"
                        :disabled="!app.fileInfo?.height || app.cropHeight >= app.fileInfo?.height"
                        class="crop-input"
                    />
                </InputGroup>
            </p>

            <p class="settings-paragraph">
                <span>Output tiles with</span>
                <Select
                    v-model="app.potResolution"
                    :options="[
                        { name: '32', value: 32 },
                        { name: '64', value: 64 },
                        { name: '128', value: 128 },
                        { name: '256', value: 256 },
                        { name: '512', value: 512 },
                        { name: '1024', value: 1024 },
                    ]"
                    optionValue="value"
                    optionLabel="name"
                    class="inline-select"
                />
                <span>pixels square.</span>
            </p>

        </div>

        <div class="tiles-column">

            <TilePreview
                v-if="tilePlan?.tiles?.length"
                :tilePlan="tilePlan"
            />


            <div class="action-buttons">
                <Button
                    type="button"
                    class="back-button"
                    severity="secondary"
                    variant="outlined"
                    @click="emit('back')"
                >
                    <span class="material-symbols-outlined">arrow_back</span>
                    Back
                </Button>
                <Button
                    id="process-button"
                    type="button"
                    class="process-button"
                    label="Process"
                    @click="processVideo({
                        file: app.file,
                        tilePlan: tilePlan,
                        samplingMode: app.samplingAxis,
                        config: app.config,
                        frameCount: app.frameCount,
                        fileInfo: app.fileInfo,
                        crossSectionCount: app.crossSectionCount,
                        crossSectionType: app.crossSectionType,
                    })"
                />
            </div>
        </div>

    </div>
    <div
        v-else
        class="settings-placeholder"
    >
        <p>Please <a
                href="#"
                @click.prevent="emit('back')"
            >upload a video</a> to define processing settings here.
        </p>
    </div>
</template>
<style scoped>

    /* Three-column layout container - mobile first */
    .three-column-layout {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        max-width: 100%;
        overflow: hidden;
    }

    /* Medium screens: file-info and settings side by side, tiles below */
    @media (min-width: 768px) {
        .three-column-layout {
            display: grid;
            grid-template-columns: auto 1fr;
            grid-template-rows: auto auto;
            gap: 1.5rem;
            padding: 1rem;
        }

        .file-info-column {
            grid-column: 1;
            grid-row: 1;
        }

        .settings-column {
            grid-column: 2;
            grid-row: 1;
        }

        .tiles-column {
            grid-column: 1 / -1;
            grid-row: 2;
        }
    }

    /* Large screens: all three columns in a row */
    @media (min-width: 1280px) {
        .three-column-layout {
            display: flex;
            flex-direction: row;
            align-items: flex-start;
            gap: 1.5rem;
            padding: 1rem;
        }

        .file-info-column {
            grid-column: unset;
            grid-row: unset;
        }

        .settings-column {
            grid-column: unset;
            grid-row: unset;
        }

        .tiles-column {
            grid-column: unset;
            grid-row: unset;
        }
    }

    /* File info column - fixed width on desktop to prevent spill */
    .file-info-column {
        width: 100%;
        min-width: 0;
        overflow: hidden;
    }

    @media (min-width: 768px) {
        .file-info-column {
            width: 280px;
        }

        .file-info-narrow {
            width: 240px;
        }

        .file-info-wide {
            width: 320px;
        }
    }

    @media (min-width: 1280px) {
        .file-info-column {
            flex: 0 0 320px;
            width: 320px;
        }

        .file-info-narrow {
            flex: 0 0 280px;
            width: 280px;
        }

        .file-info-wide {
            flex: 0 0 360px;
            width: 360px;
        }
    }

    /* Settings column - takes available space, with min-width for inputs */
    .settings-column {
        display: flex;
        flex-direction: column;
        gap: 0;
        align-items: flex-start;
        width: 100%;
        min-width: 0;
    }

    @media (min-width: 1280px) {
        .settings-column {
            flex: 0 1 650px;
        }
    }

    /* Sentence-based settings paragraph */
    .settings-paragraph {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.35rem;
        color: var(--text-secondary, #ccc);
        margin: 0.5rem 0;
        padding: 0.1rem 0;
    }


    .settings-paragraph.conditional {
        padding-left: 1.25rem;
        border-left: 2px solid var(--border-muted, #333);
    }

    .settings-paragraph.subordinate {
        margin-top: 0;
        padding-left: 1.25rem;
        border-left: 2px solid rgba(255, 255, 255, 0.12);
    }


    .settings-paragraph>span {

        white-space: nowrap;
    }

    /* Inline PrimeVue overrides */
    .inline-select {
        display: inline-flex;
    }

    .inline-number {
        display: inline-flex;
    }

    .inline-input-group {
        display: inline-flex;
        position: relative;
        width: auto;
    }

    :deep(.inline-input-group .p-inputgroupaddon) {
        min-width: unset;
    }

    :deep(.inline-select .p-select) {
        min-width: 0;
    }

    :deep(.inline-number .p-inputnumber-input) {
        width: 4rem;
    }

    :deep(.frames-input .p-inputnumber-input) {
        width: 5.5rem;
    }

    :deep(.crop-input .p-inputnumber-input) {
        width: 5rem;
    }

    .disabled-group {
        opacity: 0.5;
        pointer-events: none;
    }

    .trim-slider {
        width: calc(100% - 1.5rem);
        margin: 0.75rem 0.75rem 1rem;
    }

    :deep(.trim-slider .p-slider-handle) {
        background: var(--p-primary-color, #10b981) !important;
        border-color: var(--p-primary-color, #10b981) !important;
    }

    :deep(.trim-slider .p-slider-handle::before) {
        background: var(--p-primary-color, #10b981) !important;
    }

    .tiles-column {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.5rem;
        width: 100%;
    }

    @media (min-width: 1280px) {
        .tiles-column {
            flex: 0 0 auto;
            width: auto;
        }
    }

    /* Process button */
    .process-button {
        width: 100%;
        min-height: 44px;
    }

    @media (min-width: 640px) {
        .process-button {
            width: auto;
        }
    }

    :deep(.p-inputnumber-input) {
        width: 4rem;
    }

    :deep(.frames-input .p-inputnumber-input) {
        width: 6rem;
    }

    :deep(.crop-input .p-inputnumber-input) {
        width: 5rem;
    }

    .settings-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 200px;
        padding: 1rem;
        color: var(--text-tertiary);
    }

    @media (min-width: 640px) {
        .settings-placeholder {
            min-height: 350px;
        }
    }

    @media (min-width: 1024px) {
        .settings-placeholder {
            min-height: 450px;
        }
    }

    .settings-placeholder a {
        color: #3b82f6;
        text-decoration: underline;
        cursor: pointer;
    }

    .settings-placeholder a:hover {
        color: #2563eb;
    }

    /* GPU resource toggle */
    .gpu-toggle {
        margin-bottom: 1rem;
    }

    .gpu-toggle-label {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        cursor: pointer;
        font-size: 0.95rem;
        color: #ccc;
    }

    .gpu-toggle-hint {
        margin-top: 0.35rem;
        font-size: 0.8rem;
        color: #777;
        line-height: 1.4;
    }

    /* Step navigation */
    .action-buttons {
        display: flex;
        gap: 0.75rem;
        align-items: center;
        margin-top: 0.5rem;
    }

    .back-button {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.9rem;
    }

    .back-button .material-symbols-outlined {
        font-size: 1.1rem;
    }
</style>