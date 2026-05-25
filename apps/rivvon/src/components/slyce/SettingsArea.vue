<script setup>

    import { watch, watchEffect, ref, computed, onMounted, onUnmounted } from 'vue';
    import { useSlyceStore } from '../../stores/slyceStore';
    const app = useSlyceStore()  // Pinia store

    const props = defineProps({
        showActionButtons: {
            type: Boolean,
            default: true,
        },
    });

    const emit = defineEmits(['request-back']);

    import { useTilePlan } from '../../composables/slyce/useTilePlan';
    const { tilePlan } = useTilePlan();

    import { getMetaData } from '../../modules/slyce/metaDataExtractor';
    import { processVideo } from '../../modules/slyce/videoProcessor';
    import {
        getDefaultTileBuilderBackend,
        isLikelyIOSDevice,
        TILE_BUILDER_BACKEND_CANVAS,
        TILE_BUILDER_BACKEND_WEBGL,
        TILE_BUILDER_BACKEND_WEBGPU,
        TILE_BUILDER_BACKEND_WEBGPU_ARRAY,
    } from '../../modules/slyce/encodingPolicy';
    import { WebGPUDirectArrayTileBuilder } from '../../modules/slyce/webgpuDirectArrayTileBuilder';
    import { WebGLTileBuilder } from '../../modules/slyce/webglTileBuilder';
    import { WebGPUTileBuilder } from '../../modules/slyce/webgpuTileBuilder';

    import TilePreview from './TilePreview.vue';


    // when a file is uploaded get the metadata (skip if file is null/undefined)
    watch(() => app.file, (newFile) => {
        if (newFile) {
            getMetaData();
        }
    }, { immediate: true })

    import FileInfo from './FileInfo.vue';
    import Button from 'primevue/button';
    import Select from 'primevue/select';
    import InputNumber from 'primevue/inputnumber';
    import Slider from 'primevue/slider';

    import InputGroup from 'primevue/inputgroup';
    import InputGroupAddon from 'primevue/inputgroupaddon';
    import ToggleSwitch from 'primevue/toggleswitch';

    import LoadingIndicator from '../shared/LoadingIndicator.vue';

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

    const canProcessVideo = computed(() => (tilePlan.value?.tiles?.length ?? 0) > 0);
    const processDisabledReason = computed(() => {
        if (canProcessVideo.value) {
            return '';
        }

        return tilePlan.value?.notices?.find(notice => typeof notice === 'string' && notice.trim())
            || 'Adjust the current settings so at least one tile can be generated before processing.';
    });

    function handleProcessClick() {
        if (!canProcessVideo.value) {
            return;
        }

        processVideo({
            file: app.file,
            tilePlan: tilePlan.value,
            samplingMode: app.samplingAxis,
            config: app.config,
            frameCount: app.frameCount,
            fileInfo: app.fileInfo,
            crossSectionCount: app.crossSectionCount,
            crossSectionType: app.crossSectionType,
            frameInterpolationFactor: app.effectiveInterpolationFactor,
            tileBuilderBackend: app.tileBuilderBackend,
        });
    }

    const interpolationOptions = [
        { name: '2x', value: 2 },
        { name: '4x', value: 4 },
        { name: '8x', value: 8 },
    ];
    const tileBuilderBackendOptions = [
        { name: 'Canvas', value: TILE_BUILDER_BACKEND_CANVAS },
        { name: 'WebGL', value: TILE_BUILDER_BACKEND_WEBGL },
        { name: 'WebGPU', value: TILE_BUILDER_BACKEND_WEBGPU_ARRAY },
        { name: 'WebGPU Atlas (Fallback)', value: TILE_BUILDER_BACKEND_WEBGPU },
    ];
    const frameInterpolationSupported = !isLikelyIOSDevice();
    const defaultTileBuilderBackend = getDefaultTileBuilderBackend();
    const gpuTileAssemblyInfoOpen = ref(false);

    function formatPixelSize(width, height) {
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
            return 'n/a';
        }

        return `${width.toLocaleString()}x${height.toLocaleString()} px`;
    }

    function getTileBuilderBackendLabel(backend) {
        return tileBuilderBackendOptions.find(option => option.value === backend)?.name || backend;
    }

    function buildTileBuilderDefaultLine(selectedBackend) {
        const selectedLabel = getTileBuilderBackendLabel(selectedBackend);
        const defaultLabel = getTileBuilderBackendLabel(defaultTileBuilderBackend);

        if (selectedBackend === defaultTileBuilderBackend) {
            return `This device family defaults to ${selectedLabel} tile assembly.`;
        }

        return `This device family defaults to ${defaultLabel} tile assembly; ${selectedLabel} is a manual override.`;
    }

    function buildTextureLimitLine(apiLabel, maxTextureSize) {
        if (!Number.isFinite(maxTextureSize) || maxTextureSize <= 0) {
            return `The browser did not report a usable ${apiLabel} texture-size limit.`;
        }

        const limitLabel = maxTextureSize.toLocaleString();
        return `${apiLabel} texture limit: ${limitLabel} px per side for a single texture or render target. In practice that means up to about ${limitLabel}x${limitLabel} px when both width and height stay within the limit.`;
    }

    function buildArrayLayerLimitLine(maxTextureArrayLayers) {
        if (!Number.isFinite(maxTextureArrayLayers) || maxTextureArrayLayers <= 0) {
            return 'The browser did not report a usable WebGPU array-layer limit.';
        }

        return `WebGPU array-layer limit: ${maxTextureArrayLayers.toLocaleString()} layers per array texture.`;
    }

    function getEffectiveGpuAssemblySourceSize(plan) {
        const baseWidth = plan?.isCropping ? plan.cropWidth : app.fileInfo?.width;
        const baseHeight = plan?.isCropping ? plan.cropHeight : app.fileInfo?.height;

        if (!Number.isFinite(baseWidth) || !Number.isFinite(baseHeight) || baseWidth <= 0 || baseHeight <= 0) {
            return null;
        }

        if (plan?.isScaled && Number.isFinite(plan.scaleFrom) && plan.scaleFrom > 0 && Number.isFinite(plan.scaleTo) && plan.scaleTo > 0) {
            const scaleFactor = plan.scaleTo / plan.scaleFrom;
            return {
                width: Math.floor(baseWidth * scaleFactor),
                height: Math.floor(baseHeight * scaleFactor),
            };
        }

        return {
            width: Math.floor(baseWidth),
            height: Math.floor(baseHeight),
        };
    }

    function createTileBuilderStatus({ available = null, icon = 'info', summary, detailLines = [] }) {
        return {
            available,
            icon,
            summary,
            detailLines,
        };
    }

    function buildGpuBuilderStatus({ apiLabel, baseExplanation, report, sourceLabel, atlasCellLabel, defaultLine }) {
        const textureLimitLine = buildTextureLimitLine(apiLabel, report?.maxTextureSize);

        if (!report?.supported || !report?.layout) {
            return createTileBuilderStatus({
                available: false,
                icon: 'warning',
                summary: `Current settings do not fit within GPU capacity for ${apiLabel} tile assembly.`,
                detailLines: [
                    baseExplanation,
                    report?.reason || `${apiLabel} tile assembly is unavailable.`,
                    `Effective source frame for this check: ${sourceLabel} after crop and tile-plan scaling.`,
                    `Each layer needs one ${atlasCellLabel} atlas cell. Increasing output tile size makes every atlas cell larger, and increasing cross-section count adds more cells to the atlas.`,
                    textureLimitLine,
                    defaultLine,
                ],
            });
        }

        return createTileBuilderStatus({
            available: true,
            icon: 'check_circle',
            summary: `Current settings fit within GPU capacity for ${apiLabel} tile assembly.`,
            detailLines: [
                baseExplanation,
                `Effective source frame for this check: ${sourceLabel} after crop and tile-plan scaling.`,
                `Each layer uses one ${atlasCellLabel} atlas cell. With ${app.crossSectionCount} layers, the current atlas is ${formatPixelSize(report.layout.width, report.layout.height)} arranged as ${report.layout.columns} columns by ${report.layout.rows} rows.`,
                textureLimitLine,
                defaultLine,
            ],
        });
    }

    function buildWebGPUArrayBuilderStatus({ report, sourceLabel, tileLabel, defaultLine }) {
        const textureLimitLine = buildTextureLimitLine('WebGPU', report?.maxTextureSize);
        const layerLimitLine = buildArrayLayerLimitLine(report?.maxTextureArrayLayers);

        if (!report?.supported || !report?.arrayTexture) {
            return createTileBuilderStatus({
                available: false,
                icon: 'warning',
                summary: 'Current settings do not fit within GPU capacity for WebGPU assembly.',
                detailLines: [
                    'WebGPU assembly writes samples straight into a 2D array texture before KTX2 encoding. This is the preferred WebGPU path.',
                    report?.reason || 'WebGPU assembly is unavailable.',
                    `Effective source frame for this check: ${sourceLabel} after crop and tile-plan scaling.`,
                    `The direct-array path needs the output tile ${tileLabel} to fit within the texture-size limit and the current cross-section count to fit within the array-layer limit.`,
                    textureLimitLine,
                    layerLimitLine,
                    defaultLine,
                ],
            });
        }

        return createTileBuilderStatus({
            available: true,
            icon: 'check_circle',
            summary: 'Current settings fit within GPU capacity for WebGPU assembly.',
            detailLines: [
                'WebGPU assembly writes samples straight into a 2D array texture before KTX2 encoding. This is the preferred WebGPU path.',
                `Effective source frame for this check: ${sourceLabel} after crop and tile-plan scaling.`,
                `The current output array texture is ${tileLabel} across ${report.arrayTexture.layerCount} layers.`,
                textureLimitLine,
                layerLimitLine,
                defaultLine,
            ],
        });
    }

    const tileBuilderStatus = ref(createTileBuilderStatus({
        summary: 'Tile builder details will appear here when a backend is selected.',
    }));

    watchEffect((onCleanup) => {
        let cancelled = false;
        onCleanup(() => {
            cancelled = true;
        });

        const selectedBackend = app.tileBuilderBackend;
        const defaultLine = buildTileBuilderDefaultLine(selectedBackend);
        const plan = tilePlan.value;

        if (selectedBackend === TILE_BUILDER_BACKEND_CANVAS) {
            tileBuilderStatus.value = createTileBuilderStatus({
                available: true,
                icon: 'info',
                summary: 'Canvas tile assembly uses 2D canvases instead of GPU render targets.',
                detailLines: [
                    'Canvas is the most compatible path and avoids GPU atlas limits, but it usually has lower throughput than WebGL or WebGPU assembly.',
                    defaultLine,
                ],
            });
            return;
        }

        const isWebGPUArray = selectedBackend === TILE_BUILDER_BACKEND_WEBGPU_ARRAY;
        const isWebGPUAtlasFallback = selectedBackend === TILE_BUILDER_BACKEND_WEBGPU;
        const apiLabel = selectedBackend === TILE_BUILDER_BACKEND_WEBGL ? 'WebGL2' : 'WebGPU';
        const baseExplanation = isWebGPUArray
            ? 'WebGPU assembly writes samples straight into a 2D array texture before KTX2 encoding. This is the preferred WebGPU path.'
            : isWebGPUAtlasFallback
                ? 'WebGPU atlas fallback packs all layers into one 2D atlas before KTX2 encoding.'
            : `${apiLabel} assembly packs all layers into one 2D atlas before KTX2 encoding.`;

        if (!plan?.width || !plan?.height || !app.crossSectionCount || !app.fileInfo?.width || !app.fileInfo?.height) {
            tileBuilderStatus.value = createTileBuilderStatus({
                available: null,
                icon: 'info',
                summary: `${apiLabel} tile assembly availability depends on the current crop, output tile size, layer count, and browser support.`,
                detailLines: [
                    baseExplanation,
                    isWebGPUArray
                        ? 'The direct-array path is constrained by the output tile size and the maximum WebGPU array-layer count.'
                        : 'Larger output tiles create larger atlas cells, and more cross-sections add more cells to the atlas.',
                    defaultLine,
                ],
            });
            return;
        }

        const sourceSize = getEffectiveGpuAssemblySourceSize(plan);
        if (!sourceSize) {
            tileBuilderStatus.value = createTileBuilderStatus({
                available: null,
                icon: 'info',
                summary: `${apiLabel} tile assembly availability depends on the current crop, output tile size, layer count, and browser support.`,
                detailLines: [
                    baseExplanation,
                    isWebGPUArray
                        ? 'The direct-array path is constrained by the output tile size and the maximum WebGPU array-layer count.'
                        : 'Larger output tiles create larger atlas cells, and more cross-sections add more cells to the atlas.',
                    defaultLine,
                ],
            });
            return;
        }

        const builderSettings = {
            tilePlan: plan,
            fileInfo: sourceSize,
            crossSectionCount: app.crossSectionCount,
        };
        const sourceLabel = formatPixelSize(sourceSize.width, sourceSize.height);
        const tileLabel = formatPixelSize(plan.width, plan.height);

        if (selectedBackend === TILE_BUILDER_BACKEND_WEBGL) {
            const report = WebGLTileBuilder.getSupportReport(builderSettings);
            tileBuilderStatus.value = buildGpuBuilderStatus({
                apiLabel,
                baseExplanation,
                report,
                sourceLabel,
                atlasCellLabel: tileLabel,
                defaultLine,
            });
            return;
        }

        if (selectedBackend === TILE_BUILDER_BACKEND_WEBGPU_ARRAY) {
            tileBuilderStatus.value = createTileBuilderStatus({
                available: null,
                icon: 'info',
                summary: 'Checking WebGPU support for the preferred array-texture path.',
                detailLines: [
                    baseExplanation,
                    defaultLine,
                ],
            });

            void (async () => {
                const report = await WebGPUDirectArrayTileBuilder.getSupportReport(builderSettings);
                if (cancelled) {
                    return;
                }

                tileBuilderStatus.value = buildWebGPUArrayBuilderStatus({
                    report,
                    sourceLabel,
                    tileLabel,
                    defaultLine,
                });
            })();
            return;
        }

        tileBuilderStatus.value = createTileBuilderStatus({
            available: null,
            icon: 'info',
            summary: 'Checking WebGPU support for the current settings.',
            detailLines: [
                baseExplanation,
                defaultLine,
            ],
        });

        void (async () => {
            const report = await WebGPUTileBuilder.getSupportReport(builderSettings);
            if (cancelled) {
                return;
            }

            tileBuilderStatus.value = buildGpuBuilderStatus({
                apiLabel,
                baseExplanation,
                report,
                sourceLabel,
                atlasCellLabel: tileLabel,
                defaultLine,
            });
        })();
    });

    const lastEnabledInterpolationFactor = ref(
        app.frameInterpolationFactor > 1 ? app.frameInterpolationFactor : 2
    );

    watchEffect(() => {
        if (!frameInterpolationSupported && app.frameInterpolationFactor > 1) {
            app.frameInterpolationFactor = 1;
        }
    });

    watch(() => app.frameInterpolationFactor, (newFactor) => {
        if (newFactor > 1) {
            lastEnabledInterpolationFactor.value = newFactor;
        }
    }, { immediate: true });

    const interpolationEnabled = computed({
        get: () => app.frameInterpolationFactor > 1,
        set: (enabled) => {
            app.frameInterpolationFactor = enabled ? lastEnabledInterpolationFactor.value : 1;
        },
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
    const activeTrimHandle = ref(null);

    function unwrapMaybeRef(value) {
        return value && typeof value === 'object' && 'value' in value ? value.value : value;
    }

    function getVideoPlayerInstance() {
        return unwrapMaybeRef(fileInfoRef.value?.videoPlayerRef) || null;
    }

    function getPreviewFrameRate() {
        const frameRate = app.fileInfo?.r_frame_rate;

        if (typeof frameRate === 'string' && frameRate.includes('/')) {
            const [num, den] = frameRate.split('/').map(Number);
            if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
                return num / den;
            }
        }

        const numericFrameRate = Number(frameRate);
        if (Number.isFinite(numericFrameRate) && numericFrameRate > 0) {
            return numericFrameRate;
        }

        const duration = Number(app.fileInfo?.duration);
        const totalFrames = Number(app.frameCount || app.fileInfo?.nb_frames);
        if (Number.isFinite(duration) && duration > 0 && Number.isFinite(totalFrames) && totalFrames > 0) {
            return totalFrames / duration;
        }

        return 30;
    }

    function frameToPreviewTime(frameNumber) {
        const fps = getPreviewFrameRate();
        const totalFrames = app.frameCount || app.fileInfo?.nb_frames || frameNumber;
        const resolvedFrame = Math.max(1, Math.min(Math.round(frameNumber), totalFrames));
        const previewTime = Math.max(0, (resolvedFrame - 1) / fps);
        const maxDuration = getVideoPlayerInstance()?.getDuration?.() || Number(app.fileInfo?.duration) || 0;

        if (maxDuration <= 0) {
            return previewTime;
        }

        return Math.min(previewTime, Math.max(0, maxDuration - (1 / fps)));
    }

    function seekPreviewToFrame(frameNumber) {
        const videoPlayer = getVideoPlayerInstance();
        if (!videoPlayer) return;

        videoPlayer.pause?.();
        videoPlayer.seek?.(frameToPreviewTime(frameNumber));
    }

    function resolvePreviewFrame(newRange, previousRange) {
        const [newStart, newEnd] = newRange;
        const [previousStart, previousEnd] = previousRange;
        const changedStart = newStart !== previousStart;
        const changedEnd = newEnd !== previousEnd;

        if (!changedStart && !changedEnd) {
            return null;
        }

        if (changedStart && !changedEnd) {
            return newStart;
        }

        if (changedEnd && !changedStart) {
            return newEnd;
        }

        if (activeTrimHandle.value === 'min') {
            return newStart;
        }

        if (activeTrimHandle.value === 'max') {
            return newEnd;
        }

        return Math.abs(newStart - previousStart) >= Math.abs(newEnd - previousEnd)
            ? newStart
            : newEnd;
    }

    function updateActiveTrimHandle(event) {
        const sliderRoot = event.currentTarget;
        const handle = event.target?.closest?.('.p-slider-handle');

        if (!sliderRoot || !handle || typeof sliderRoot.querySelectorAll !== 'function') {
            activeTrimHandle.value = null;
            return;
        }

        const handles = Array.from(sliderRoot.querySelectorAll('.p-slider-handle'));
        const handleIndex = handles.indexOf(handle);
        activeTrimHandle.value = handleIndex === 0 ? 'min' : handleIndex === 1 ? 'max' : null;
    }

    function clearActiveTrimHandle() {
        activeTrimHandle.value = null;
    }

    onMounted(() => {
        window.addEventListener('pointerup', clearActiveTrimHandle);
        window.addEventListener('pointercancel', clearActiveTrimHandle);
    });

    onUnmounted(() => {
        window.removeEventListener('pointerup', clearActiveTrimHandle);
        window.removeEventListener('pointercancel', clearActiveTrimHandle);
    });

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
            const previousRange = [app.frameStart || 1, app.frameEnd || app.frameCount || 1];
            app.frameStart = val[0];
            app.frameEnd = val[1];

            const previewFrame = resolvePreviewFrame(val, previousRange);
            if (previewFrame !== null) {
                seekPreviewToFrame(previewFrame);
            }
        }
    });




</script>
<template>
    <!-- Loading state -->
    <LoadingIndicator
        v-if="isLoading"
        class="settings-placeholder"
    />
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

            <p class="settings-paragraph">
                <ToggleSwitch
                    v-model="interpolationEnabled"
                    :disabled="!frameInterpolationSupported"
                />
                <template v-if="!frameInterpolationSupported">
                    <span>Frame interpolation is currently unavailable on iPhone and iPad. The shipped ONNX model cannot
                        initialize reliably within mobile runtime limits yet.</span>
                </template>
                <template v-else-if="!interpolationEnabled">
                    <span>Interpolate frames before tile generation.</span>
                </template>
                <template v-else>
                    <span>Interpolate frames at</span>
                    <Select
                        v-model="app.frameInterpolationFactor"
                        :options="interpolationOptions"
                        optionValue="value"
                        optionLabel="name"
                        class="inline-select"
                        :disabled="!frameInterpolationSupported"
                    />
                    <span>
                        to emit {{ app.effectiveFrameCount.toLocaleString() }} frames from {{
                            app.selectedSourceFrameCount.toLocaleString() }} source frames.
                    </span>
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
                @pointerdown.capture="updateActiveTrimHandle"
                @focusin.capture="updateActiveTrimHandle"
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

            <p class="settings-paragraph">
                <span>Assemble tiles with</span>
                <Select
                    v-model="app.tileBuilderBackend"
                    :options="tileBuilderBackendOptions"
                    optionValue="value"
                    optionLabel="name"
                    class="inline-select"
                />
                <span>backend.</span>
                <button
                    type="button"
                    class="info-toggle-button"
                    :aria-expanded="gpuTileAssemblyInfoOpen ? 'true' : 'false'"
                    :aria-label="gpuTileAssemblyInfoOpen ? 'Hide tile builder details' : 'Show tile builder details'"
                    @click="gpuTileAssemblyInfoOpen = !gpuTileAssemblyInfoOpen"
                >
                    <span class="material-symbols-outlined">info</span>
                </button>
            </p>
            <div
                v-if="gpuTileAssemblyInfoOpen"
                class="gpu-assembly-details"
            >
                <p
                    class="settings-paragraph subordinate setting-note gpu-assembly-summary"
                    :class="{
                        'gpu-assembly-summary-supported': tileBuilderStatus.available === true,
                        'gpu-assembly-summary-unsupported': tileBuilderStatus.available === false,
                        'gpu-assembly-summary-unknown': tileBuilderStatus.available == null,
                    }"
                >
                    <span class="material-symbols-outlined gpu-assembly-summary-icon">{{ tileBuilderStatus.icon
                        }}</span>
                    <span class="setting-note-text">{{ tileBuilderStatus.summary }}</span>
                </p>
                <p
                    v-for="(line, index) in tileBuilderStatus.detailLines"
                    :key="`${index}-${line}`"
                    class="settings-paragraph subordinate setting-note"
                >
                    <span class="setting-note-text">{{ line }}</span>
                </p>
            </div>

        </div>

        <div class="tiles-column">

            <TilePreview
                v-if="tilePlan?.tiles?.length"
                :tilePlan="tilePlan"
            />

            <p
                v-else-if="processDisabledReason"
                class="tile-plan-notice"
            >
                {{ processDisabledReason }}
            </p>


            <div
                v-if="props.showActionButtons"
                class="action-buttons"
            >
                <Button
                    type="button"
                    class="back-button"
                    severity="secondary"
                    variant="outlined"
                    @click="emit('request-back')"
                >
                    <span class="material-symbols-outlined">arrow_back</span>
                    Back
                </Button>
                <Button
                    id="process-button"
                    type="button"
                    class="process-button"
                    label="Process"
                    :disabled="!canProcessVideo"
                    :title="processDisabledReason || null"
                    @click="handleProcessClick"
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
                @click.prevent="emit('request-back')"
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

    .settings-paragraph.setting-note {
        align-items: flex-start;
        margin-top: 0.1rem;
    }

    .gpu-assembly-summary {
        flex-wrap: nowrap;
        gap: 0.5rem;
    }

    .gpu-assembly-summary .setting-note-text {
        flex: 1 1 auto;
        min-width: 0;
    }

    .gpu-assembly-summary-icon {
        flex-shrink: 0;
        font-size: 1rem;
        line-height: 1;
        margin-top: 0.1rem;
    }

    .gpu-assembly-summary-supported .gpu-assembly-summary-icon {
        color: rgba(74, 222, 128, 0.95);
    }

    .gpu-assembly-summary-unsupported .gpu-assembly-summary-icon {
        color: rgba(251, 191, 36, 0.95);
    }

    .gpu-assembly-summary-unknown .gpu-assembly-summary-icon {
        color: rgba(148, 163, 184, 0.95);
    }

    .gpu-assembly-details {
        width: 100%;
    }

    .settings-paragraph .setting-note-text {
        white-space: normal;
        line-height: 1.4;
    }

    .info-toggle-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.5rem;
        height: 1.5rem;
        margin-left: 0.1rem;
        padding: 0;
        border: none;
        border-radius: 999px;
        background: transparent;
        color: rgba(255, 255, 255, 0.55);
        cursor: pointer;
        flex-shrink: 0;
    }

    .info-toggle-button:hover {
        color: rgba(255, 255, 255, 0.85);
        background: rgba(255, 255, 255, 0.08);
    }

    .info-toggle-button[aria-expanded="true"] {
        color: rgba(255, 255, 255, 0.9);
        background: rgba(255, 255, 255, 0.12);
    }

    .info-toggle-button .material-symbols-outlined {
        font-size: 1rem;
        line-height: 1;
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

    .tile-plan-notice {
        margin: 0;
        color: #b45309;
        font-size: 0.95rem;
        line-height: 1.5;
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