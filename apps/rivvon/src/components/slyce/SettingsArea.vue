<script setup>

    import { watch, watchEffect, ref, onMounted, computed } from 'vue';
    import { useSlyceStore } from '../../stores/slyceStore';
    const app = useSlyceStore()  // Pinia store

    const emit = defineEmits(['back']);

    import { useTilePlan } from '../../composables/slyce/useTilePlan';
    const { tilePlan } = useTilePlan();

    import { getMetaData } from '../../modules/slyce/metaDataExtractor';
    import { processVideo } from '../../modules/slyce/videoProcessor';

    import TilePreview from './TilePreview.vue';
    import ExplanatoryMessages from './ExplanatoryMessages.vue';


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

    import InputGroup from 'primevue/inputgroup';
    import InputGroupAddon from 'primevue/inputgroupaddon';



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
        // Normalize rotation to 0-359 range (handles negative values like -90)
        const rotation = ((app.fileInfo.rotation || 0) % 360 + 360) % 360;
        const isRotated90or270 = rotation === 90 || rotation === 270;
        // After rotation, dimensions are swapped
        const effectiveWidth = isRotated90or270 ? app.fileInfo.height : app.fileInfo.width;
        const effectiveHeight = isRotated90or270 ? app.fileInfo.width : app.fileInfo.height;
        return effectiveHeight > effectiveWidth;
    });

    import RadioButton from 'primevue/radiobutton';
    import ProgressSpinner from 'primevue/progressspinner';
    import ToggleSwitch from 'primevue/toggleswitch';

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
            { name: `${longPx}`, value: 'long' },
            { name: `${shortPx}`, value: 'short' },
        ];
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
            class="file-info-column"
            :class="isPortraitVideo ? 'file-info-narrow' : 'file-info-wide'"
        ></FileInfo>

        <div
            id="settings"
            class="settings-column"
        >
            <h3 class="text-xl">Area of Interest</h3>


            <div class="flex w-full segmented-control">
                <label
                    class="flex flex-col grow items-start gap-2 segment-left"
                    for="fullFrame"
                    :class="(!app.cropMode) ? 'activeLabel' : ''"
                >
                    <div class="flex items-center gap-2 w-full">
                        <RadioButton
                            v-model="app.cropMode"
                            inputId="fullFrame"
                            name="cropMode"
                            :value="false"
                        />
                        <span>Entire Video Frame</span>

                    </div>
                    <small>Sample the full dimensions of the original video</small>
                </label>
                <label
                    class="flex flex-col grow items-start gap-2 segment-right"
                    for="regionOfInterest"
                    :class="(app.cropMode) ? 'activeLabel' : ''"
                >
                    <div class="flex items-center gap-2 w-full">
                        <RadioButton
                            v-model="app.cropMode"
                            inputId="regionOfInterest"
                            name="cropMode"
                            :value="true"
                        />
                        <span>Region of Interest</span>

                    </div>
                    <small>Sample a cropped rectangular area</small>
                </label>
            </div>


            <div
                v-if="app.cropMode"
                class="input-row"
            >
                <span>Crop to</span>
                <InputNumber
                    v-model="app.cropWidth"
                    :min="1"
                    :max="app.fileInfo?.width"
                    :disabled="!app.fileInfo?.width"
                    class="crop-input"
                />
                <span>×</span>
                <InputNumber
                    v-model="app.cropHeight"
                    :min="1"
                    :max="app.fileInfo?.height"
                    :disabled="!app.fileInfo?.height"
                    class="crop-input"
                />
                <span>at offset</span>
                <InputGroup
                    :class="{ 'disabled-group': app.cropWidth >= app.fileInfo?.width }"
                    style="display: inline-flex;
    position: relative;
    width: auto;"
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




                <span> and</span>

                <InputGroup
                    :class="{ 'disabled-group': app.cropHeight >= app.fileInfo?.height }"
                    style="display: inline-flex;
    position: relative;
    width: auto;"
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
            </div>

            <h3 class="text-xl">Cross Section Type</h3>

            <div class="flex w-full segmented-control">
                <label
                    class="flex flex-col grow items-start gap-2 segment-left"
                    for="planes"
                    :class="(app.crossSectionType === 'planes') ? 'activeLabel' : ''"
                >

                    <div class="flex items-center gap-2 w-full">
                        <RadioButton
                            v-model="app.crossSectionType"
                            inputId="planes"
                            name="crossSectionType"
                            value="planes"
                        />
                        <span>Planes</span>
                        <svg
                            class="ml-auto"
                            xmlns="http://www.w3.org/2000/svg"
                            version="1.1"
                            viewBox="0 0 100 30"
                        >
                            <line
                                x1="0"
                                y1="2.3"
                                x2="100"
                                y2="2.3"
                            />
                            <line
                                x1="0"
                                y1="5.1"
                                x2="100"
                                y2="5.1"
                            />
                            <line
                                x1="0"
                                y1="20.7"
                                x2="100"
                                y2="20.7"
                            />
                            <line
                                x1="0"
                                y1="15"
                                x2="100"
                                y2="15"
                            />
                            <line
                                x1="0"
                                y1="27.7"
                                x2="100"
                                y2="27.7"
                            />
                            <line
                                x1="0"
                                y1="24.9"
                                x2="100"
                                y2="24.9"
                            />
                            <line
                                x1="0"
                                y1="9.3"
                                x2="100"
                                y2="9.3"
                            />
                        </svg>
                    </div>
                    <small>Sample an eased distribution of planes</small>
                </label>
                <label
                    class="flex flex-col grow items-start gap-2 segment-right"
                    for="waves"
                    :class="(app.crossSectionType === 'waves') ? 'activeLabel' : ''"
                >
                    <div class="flex items-center gap-2 w-full">
                        <RadioButton
                            v-model="app.crossSectionType"
                            inputId="waves"
                            name="crossSectionType"
                            value="waves"
                        />

                        <span>Waves</span>
                        <svg
                            viewBox="0 0 100 30"
                            class="ml-auto"
                        >
                            <path
                                d="M0,0c9.1,0,17.1,7.5,25,15,8,7.5,15.9,15,25,15s17.1-7.5,25-15c8-7.5,15.9-15,25-15" />
                            <path d="M0,15c7.9,7.5,15.9,15,25,15s17.1-7.5,25-15C58,7.5,65.9,0,75,0s17.1,7.5,25,15" />
                            <path
                                d="M0,30c9.1,0,17.1-7.5,25-15C33,7.5,40.9,0,50,0s17.1,7.5,25,15c8,7.5,15.9,15,25,15" />
                            <path d="M0,15C8,7.5,15.9,0,25,0s17.1,7.5,25,15c8,7.5,15.9,15,25,15s17.1-7.5,25-15" />
                        </svg>
                    </div>
                    <small>Sample a linear distribution of wave forms</small>
                </label>
            </div>

            <h3 class="text-xl">Sampling</h3>

            <div class="input-row">
                <span>Sample</span>
                <InputNumber
                    v-model="app.crossSectionCount"
                    placeholder="60"
                    :min="1"
                    :max="240"
                >
                </InputNumber>
                <span>arrays of</span>
                <Select
                    v-model="app.samplingSide"
                    :options="sideOptions"
                    optionValue="value"
                    optionLabel="name"
                />
                <span>pixels from frames</span>
                <InputNumber
                    v-model="app.frameStart"
                    :min="1"
                    :max="app.frameEnd || app.frameCount"
                    :disabled="!app.frameCount"
                    class="frames-input"
                ></InputNumber>
                <span>to</span>
                <InputNumber
                    v-model="app.frameEnd"
                    :min="app.frameStart || 1"
                    :max="app.frameCount"
                    :disabled="!app.frameCount"
                    class="frames-input"
                ></InputNumber>
            </div>
            <div class="input-row">
                <span>Make square tiles with</span>
                <Select
                    v-model="app.potResolution"
                    :options="[{
                        name: '32px',
                        value: 32
                    }, {
                        name: '64px',
                        value: 64
                    }, {
                        name: '128px',
                        value: 128
                    }, {
                        name: '256px',
                        value: 256
                    }, {
                        name: '512px',
                        value: 512
                    }, {
                        name: '1024px',
                        value: 1024
                    }]"
                    optionValue="value"
                    optionLabel="name"
                />
                <span>resolution</span>
            </div>



        </div>

        <div class="tiles-column">


            <h3 class="text-xl">Processing Plan</h3>

            <ExplanatoryMessages
                style="max-width: 31.5rem;"
                :plan="tilePlan"
            ></ExplanatoryMessages>


            <h3 class="text-xl">Tile Preview</h3>

            <TilePreview
                v-if="tilePlan?.tiles?.length"
                :tilePlan="tilePlan"
            />



            <h3 class="text-xl">Are you ready?</h3>
            <div class="gpu-toggle">
                <label class="gpu-toggle-label">
                    <ToggleSwitch v-model="app.freeGpuResources" />
                    <span>Optimize GPU Resources</span>
                </label>
                <p class="gpu-toggle-hint">
                    Release viewer GPU context while encoding.

                </p>
            </div>
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
        gap: 0.75rem;
        align-items: flex-start;
        width: 100%;
        min-width: 0;
    }

    @media (min-width: 1280px) {
        .settings-column {
            flex: 0 1 650px;
        }
    }

    /* Tiles column - fixed width based on tile container */
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

    /* Input row - wraps on mobile */
    .input-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
        justify-content: flex-start;
        width: 100%;
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

    span.sample-pixel-count {
        font-variant: small-caps;
        color: #10b981;
        border: 1px solid #10b981;
        border-radius: 0.25rem;
        padding: 0.25rem 0.5rem;
    }



    .segmented-control label {
        box-shadow: rgba(0, 30, 43, 0.3) 0px 4px 10px -4px;
        padding: 1.5rem;
        border-radius: 1rem;
        cursor: pointer;
        outline: 2px solid var(--border-muted);
        background-color: var(--bg-card);
        color: var(--text-primary);
    }

    .segmented-control label span {
        font-weight: 700;
        color: var(--text-primary);
    }

    .segmented-control label small {
        color: var(--text-tertiary);
    }

    .segmented-control label:hover {
        outline: 2px solid lightgreen;
    }

    .segmented-control label.activeLabel {
        outline: 2px solid #10b981;
    }

    .segmented-control label svg {
        background: var(--bg-muted-alt);
        width: 6rem;
        margin-left: auto;
    }

    .segmented-control label.activeLabel svg {
        background: #10b981;
    }

    .segmented-control label svg line,
    .segmented-control label svg path {
        fill: none;
        stroke: #fff;
        stroke-miterlimit: 10;
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

    .disabled-group {
        opacity: 0.5;
        pointer-events: none;
    }

    /* Segmented control styling - mobile first (stacked) */
    .segmented-control {
        flex-direction: column;
        gap: 0.5rem;
    }

    @media (min-width: 640px) {
        .segmented-control {
            flex-direction: row;
            gap: 0;
        }
    }

    .segmented-control label {
        box-shadow: none;
        outline: 2px solid var(--border-muted);
        max-width: 100%;
        margin: 0 0.25rem;
        background-color: var(--bg-card);
    }

    @media (min-width: 640px) {
        .segmented-control label {
            max-width: 50%;
            margin: 0;
        }
    }

    .segmented-control label.segment-left {
        border-radius: 1rem;
    }

    .segmented-control label.segment-right {
        border-radius: 1rem;
    }

    @media (min-width: 640px) {
        .segmented-control label.segment-left {
            border-radius: 1rem 0 0 1rem;
        }

        .segmented-control label.segment-right {
            border-radius: 0 1rem 1rem 0;
        }
    }

    .segmented-control label.activeLabel {
        outline: 2px solid #10b981;
        background-color: var(--accent-green-light);
        z-index: 1;
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