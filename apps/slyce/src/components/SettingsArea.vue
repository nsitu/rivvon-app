<script setup>

    import { watch, watchEffect, ref, onMounted, computed } from 'vue';
    import { useAppStore } from '../stores/appStore';
    const app = useAppStore()  // Pinia store

    import { useTilePlan } from '../composables/useTilePlan';
    const { tilePlan } = useTilePlan();

    import { getMetaData } from '../modules/metaDataExtractor';
    import { processVideo } from '../modules/videoProcessor';

    import Tile from './Tile.vue';
    import ExplanatoryMessages from './ExplanatoryMessages.vue';


    // when a file is uploaded get the metadata (skip if file is null/undefined)
    watch(() => app.file, (newFile) => {
        if (newFile) {
            getMetaData();
        }
    })

    import FileInfo from './FileInfo.vue';
    import Select from 'primevue/select';
    import InputNumber from 'primevue/inputnumber';

    import InputGroup from 'primevue/inputgroup';
    import InputGroupAddon from 'primevue/inputgroupaddon';



    // Watch for changes in samplingMode and adjust samplePixelCount accordingly
    watchEffect(() => {
        const width = app.cropMode && app.cropWidth ? app.cropWidth : app.fileInfo?.width;
        const height = app.cropMode && app.cropHeight ? app.cropHeight : app.fileInfo?.height;

        if (height && width) {
            if (app.samplingMode === 'columns') {
                app.samplePixelCount = height;
            }
            if (app.samplingMode === 'rows') {
                app.samplePixelCount = width;
            }
        }
    });

    // Sync framesToSample with frameCount when frameCount changes (new video loaded)
    watch(() => app.frameCount, (newFrameCount) => {
        if (newFrameCount > 0) {
            app.framesToSample = newFrameCount;
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

    // Loading state - show spinner until metadata is ready
    const isLoading = computed(() => {
        return app.file && !app.fileInfo?.name;
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
        class="three-column-layout flex  items-start gap-5"
    >
        <FileInfo :class="isPortraitVideo ? 'file-info-narrow' : 'file-info-wide'"></FileInfo>

        <div
            id="settings"
            class="settings-column flex flex-col gap-3 items-start"
        >
            <h3 class="text-xl">Sampling</h3>


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
                class="flex gap-2 justify-start items-center"
            >
                <span class="whitespace-pre">Crop to</span>
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
                <span class="whitespace-pre">at offset</span>
                <InputGroup
                    :class="{ 'disabled-group': app.cropWidth >= app.fileInfo?.width }"
                    class="display: inline-flex;
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
                    class="display: inline-flex;
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

            <div class="flex gap-2 justify-start items-center">
                <span>Sample</span>
                <InputNumber
                    v-model="app.crossSectionCount"
                    placeholder="60"
                    :min="1"
                    :max="240"
                >
                </InputNumber>
                <Select
                    v-model="app.samplingMode"
                    :options="['columns', 'rows']"
                />
                <span>of</span>
                <span v-if="app.samplePixelCount">
                    {{ app.samplePixelCount }}px</span>
                <span>from</span>
                <InputNumber
                    v-model="app.framesToSample"
                    :min="1"
                    :max="app.frameCount"
                    :disabled="!app.frameCount"
                    class="frames-input"
                ></InputNumber>
                <span>frames</span>
            </div>





            <h3 class="text-xl">Output</h3>

            <div class="flex w-full segmented-control">
                <label
                    class="flex flex-col grow items-start gap-2 segment-left"
                    for="webm"
                    :class="(app.outputFormat === 'webm') ? 'activeLabel' : ''"
                >
                    <div class="flex items-center gap-2 w-full">
                        <RadioButton
                            v-model="app.outputFormat"
                            inputId="webm"
                            name="outputFormat"
                            value="webm"
                        />
                        <span>Video Loop</span>
                    </div>
                </label>
                <label
                    class="flex flex-col grow items-start gap-2 segment-right"
                    for="ktx2"
                    :class="(app.outputFormat === 'ktx2') ? 'activeLabel' : ''"
                >
                    <div class="flex items-center gap-2 w-full">
                        <RadioButton
                            v-model="app.outputFormat"
                            inputId="ktx2"
                            name="outputFormat"
                            value="ktx2"
                        />
                        <span>KTX2 Texture Array</span>
                    </div>
                </label>
            </div>

            <div class="flex gap-2 justify-start items-center">
                <span>Join samples as</span>

                <Select
                    v-model="app.outputMode"
                    :options="['columns', 'rows']"
                />
                <span>to form</span>
                <Select
                    v-model="app.tileMode"
                    :options="[{
                        name: 'full size',
                        value: 'full'
                    }, {
                        name: 'tiled',
                        value: 'tile'
                    }]"
                    optionValue="value"
                    optionLabel="name"
                />
                <span>cross-sections.</span>
            </div>
            <div
                v-if="app.tileMode === 'tile'"
                class="flex gap-2 justify-start items-center"
            >
                <span>Make </span>

                <Select
                    v-model="app.tileProportion"
                    :options="[{
                        name: 'square (1:1)',
                        value: 'square'
                    }, {
                        name: 'landscape (16:9)',
                        value: 'landscape'
                    }, {
                        name: 'portrait (9:16)',
                        value: 'portrait'
                    }]"
                    optionValue="value"
                    optionLabel="name"
                />
                <span>tiles optimized for</span>
                <Select
                    v-model="app.prioritize"
                    :options="[{
                        name: 'quantity',
                        value: 'quantity'
                    }, {
                        name: 'quality',
                        value: 'quality'
                    }, {
                        name: 'powers of two',
                        value: 'powersOfTwo'
                    }]"
                    optionValue="value"
                    optionLabel="name"
                />
            </div>
            <div
                v-if="app.tileMode === 'tile'"
                class="flex gap-2 justify-start items-center"
            >


                <div
                    v-if="app.prioritize === 'powersOfTwo'"
                    class="flex gap-2 justify-start items-center"
                >
                    <span>with</span>
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
                <div
                    v-if="(app.prioritize === 'quantity' || app.prioritize === 'powersOfTwo')"
                    class="flex gap-2 justify-start items-center"
                >
                    <span>using</span>
                    <Select
                        v-model="app.downsampleStrategy"
                        :options="[{
                            name: 'per sample',
                            value: 'perSample'
                        }, {
                            name: 'upfront',
                            value: 'upfront'
                        }]"
                        optionValue="value"
                        optionLabel="name"
                    />
                    <span>down-scaling</span>
                </div>
            </div>
            <ExplanatoryMessages
                style="max-width: 31.5rem;"
                :plan="tilePlan"
            ></ExplanatoryMessages>

        </div>

        <div class="tiles-column flex flex-col items-start gap-2">
            <div
                v-if="tilePlan?.tiles?.length"
                :class="(app.outputMode == 'columns') ? 'tile-container-columns' : 'tile-container-rows'"
            >
                <Tile
                    v-for="tile in tilePlan.tiles"
                    :start="tile.start"
                    :end="tile.end"
                    :width="tilePlan.width"
                    :height="tilePlan.height"
                ></Tile>
            </div>



            <h3 class="text-xl">Are you ready?</h3>
            <button
                id="process-button"
                class="bg-blue-500 text-white px-4 py-2 rounded-md"
                @click="processVideo({
                    file: app.file,
                    tilePlan: tilePlan,
                    samplingMode: app.samplingMode,
                    outputMode: app.outputMode,
                    config: app.config,
                    frameCount: app.frameCount,
                    fileInfo: app.fileInfo,
                    crossSectionCount: app.crossSectionCount,
                    crossSectionType: app.crossSectionType,
                })"
            >Process</button>
        </div>

    </div>
    <div
        v-else
        class="settings-placeholder"
    >
        <p>Please <a
                href="#"
                @click.prevent="app.currentTab = '0'"
            >upload a video</a> to define processing settings here.</p>
    </div>
</template>
<style scoped>

    /* Three-column layout container */
    .three-column-layout {
        max-width: 100%;
        overflow: hidden;
    }

    /* Three-column layout flex basis settings */
    .file-info-narrow {
        flex: 0 1 20%;
        min-width: 0;
    }

    .file-info-wide {
        flex: 0 1 30%;
        min-width: 0;
    }

    .settings-column {
        flex: 0 1 700px;
        min-width: 400px;
    }

    .tiles-column {
        flex: 1 1 auto;
        min-width: 0;
    }

    span.sample-pixel-count {
        font-variant: small-caps;
        color: #10b981;
        border: 1px solid #10b981;
        border-radius: 0.25rem;
        padding: 0.25rem 0.5rem;
    }

    .tile-container-columns {
        display: grid;
        gap: 0.5rem;
        grid-template-columns: 1fr 1fr 1fr 1fr;
        max-height: 60vh;
        overflow-y: auto;
        padding-right: 0.5rem;
    }

    /* Multi-column newspaper-style layout that flows top-to-bottom, then left-to-right */
    .tile-container-rows {
        column-count: 4;
        column-gap: 0.5rem;
        max-height: 60vh;
        overflow-y: auto;
        padding-right: 0.5rem;
    }

    /* Prevent tiles from breaking across columns */
    .tile-container-rows>* {
        break-inside: avoid;
        margin-bottom: 0.5rem;
    }

    /* Custom scrollbar styling for better visibility */
    .tile-container-columns::-webkit-scrollbar,
    .tile-container-rows::-webkit-scrollbar {
        width: 8px;
    }

    .tile-container-columns::-webkit-scrollbar-track,
    .tile-container-rows::-webkit-scrollbar-track {
        background: #f1f1f1;
        border-radius: 4px;
    }

    .tile-container-columns::-webkit-scrollbar-thumb,
    .tile-container-rows::-webkit-scrollbar-thumb {
        background: #10b981;
        border-radius: 4px;
    }

    .tile-container-columns::-webkit-scrollbar-thumb:hover,
    .tile-container-rows::-webkit-scrollbar-thumb:hover {
        background: #059669;
    }



    .segmented-control label {
        box-shadow: rgba(0, 30, 43, 0.3) 0px 4px 10px -4px;
        padding: 1.5rem;
        border-radius: 1rem;
        cursor: pointer;
        outline: 2px solid #eee;
    }

    .segmented-control label span {
        font-weight: 700;
    }

    .segmented-control label:hover {
        outline: 2px solid lightgreen;
    }

    .segmented-control label.activeLabel {
        outline: 2px solid #10b981;
    }

    .segmented-control label svg {
        background: #ddd;
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

    /* Segmented control styling */
    .segmented-control {
        gap: 0;
    }

    .segmented-control label {
        box-shadow: none;
        outline: 2px solid #eee;
        max-width: 50%;
    }

    .segmented-control label.segment-left {
        border-radius: 1rem 0 0 1rem;
    }

    .segmented-control label.segment-right {
        border-radius: 0 1rem 1rem 0;
    }

    .segmented-control label.activeLabel {
        outline: 2px solid #10b981;
        background-color: #ecfdf5;
        z-index: 1;
    }

    .settings-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 450px;
        color: #64748b;
    }

    .settings-placeholder a {
        color: #3b82f6;
        text-decoration: underline;
        cursor: pointer;
    }

    .settings-placeholder a:hover {
        color: #2563eb;
    }
</style>