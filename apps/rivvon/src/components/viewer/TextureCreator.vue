<script setup>
    import { computed, nextTick, ref, watch } from 'vue';
    import { useSlyceStore } from '../../stores/slyceStore';
    import { useRealtimeSlyce } from '../../composables/slyce/useRealtimeSlyce.js';

    import UploadArea from '../slyce/UploadArea.vue';
    import SettingsArea from '../slyce/SettingsArea.vue';
    import ResultsArea from '../slyce/ResultsArea.vue';
    import RealtimeSampler from '../slyce/RealtimeSampler.vue';

    import Stepper from 'primevue/stepper';
    import StepList from 'primevue/steplist';
    import Step from 'primevue/step';
    import StepPanels from 'primevue/steppanels';
    import StepPanel from 'primevue/steppanel';

    const props = defineProps({
        active: {
            type: Boolean,
            default: false
        },
        launchSource: {
            type: String,
            default: null
        }
    });

    const emit = defineEmits(['close', 'apply-texture', 'apply-realtime-texture']);

    const slyce = useSlyceStore();
    const realtime = useRealtimeSlyce();

    // Check if processing is in progress
    const isProcessing = computed(() => Object.keys(slyce.status).length > 0);
    const selectedSource = ref(null);
    const cameraStep = ref('1');
    const suppressRealtimeAutoStart = ref(false);

    const hasExistingFileFlow = computed(() =>
        !!slyce.file
        || Object.keys(slyce.ktx2BlobURLs).length > 0
        || slyce.currentStep !== '1'
    );

    const hasRealtimeWork = computed(() =>
        realtime.isCapturing.value
        || realtime.encodingTiles.value > 0
        || realtime.completedKtx2Buffers.value.length > 0
        || realtime.isSavingLocally.value
        || !!realtime.savedLocalTextureId.value
    );

    const isFileFinished = computed(() =>
        slyce.currentStep === '3' && slyce.isComplete
    );

    const isCameraFinished = computed(() =>
        !realtime.isCapturing.value
        && realtime.encodingTiles.value === 0
        && realtime.completedKtx2Buffers.value.length > 0
    );

    const fileDisplayStep = computed(() => {
        if (slyce.currentStep !== '3') return slyce.currentStep;
        return isFileFinished.value ? '4' : '3';
    });

    const cameraDisplayStep = computed(() => {
        if (cameraStep.value === '1' || cameraStep.value === '2') return cameraStep.value;
        if (realtime.isCapturing.value || realtime.encodingTiles.value > 0) return '3';
        if (isCameraFinished.value) return '4';
        return '2';
    });

    const stepperValue = computed(() => {
        if (selectedSource.value === 'camera') return cameraDisplayStep.value;
        if (selectedSource.value === 'file') return fileDisplayStep.value;
        return '1';
    });

    const cameraWorkflowPhase = computed(() => {
        if (cameraDisplayStep.value === '2') return 'setup';
        if (cameraDisplayStep.value === '4') return 'finished';
        return 'processing';
    });
    const isSourceNavigationLocked = computed(() => {
        if (selectedSource.value === 'camera') return realtime.isSavingLocally.value;
        if (selectedSource.value === 'file') return slyce.isSavingLocally;
        return false;
    });

    function selectFileMode() {
        selectedSource.value = 'file';
        cameraStep.value = '1';
        suppressRealtimeAutoStart.value = false;

        if (!hasExistingFileFlow.value) {
            slyce.set('currentStep', '1');
        }
    }

    function handleFileSelected() {
        selectedSource.value = 'file';
        cameraStep.value = '1';
        suppressRealtimeAutoStart.value = false;
        slyce.set('currentStep', '2');
    }

    function clearRealtimeFlow() {
        if (realtime.isCapturing.value) {
            realtime.stopRealtime();
        }
        if (realtime.isCameraActive.value) {
            realtime.stopCamera();
        }
        realtime.discardResults();
    }

    function selectWebcamMode() {
        if (hasRealtimeWork.value || realtime.completedKtx2Buffers.value.length > 0) {
            clearRealtimeFlow();
        }

        suppressRealtimeAutoStart.value = false;
        selectedSource.value = 'camera';
        cameraStep.value = '2';
    }

    async function handleStartCameraProcessing() {
        suppressRealtimeAutoStart.value = false;
        cameraStep.value = '3';
        await nextTick();
        await realtime.startRealtime();
    }

    function handleCameraStepClick(targetStep) {
        if (targetStep === '1') {
            returnToSourceChooser();
            return;
        }

        if (targetStep === '2' && cameraDisplayStep.value !== '2') {
            if (hasRealtimeWork.value) {
                const confirmed = confirm(
                    'Returning to camera setup will clear the current capture and results. Continue?'
                );
                if (!confirmed) return;
                clearRealtimeFlow();
            }

            suppressRealtimeAutoStart.value = false;
            cameraStep.value = '2';
        }
    }

    function returnToSourceChooser() {
        if (selectedSource.value === 'file' && isProcessing.value) {
            const confirmed = confirm(
                'Video processing is in progress. Switching source will cancel the current process and clear any generated results. Continue?'
            );
            if (!confirmed) return;
            slyce.resetProcessing();
        }

        if (selectedSource.value === 'camera' && hasRealtimeWork.value) {
            const confirmed = confirm(
                'Current camera capture will be cleared when you switch sources. Continue?'
            );
            if (!confirmed) return;
            clearRealtimeFlow();
        }

        selectedSource.value = null;
        cameraStep.value = '1';
        suppressRealtimeAutoStart.value = false;
    }

    function handleEmbeddedRealtimeClose() {
        suppressRealtimeAutoStart.value = true;
        emit('close');
    }

    function handleRealtimeApply(payload) {
        suppressRealtimeAutoStart.value = true;
        emit('apply-realtime-texture', payload);
    }

    const stepLabels = { '1': 'Start', '2': 'Config', '3': 'Process', '4': 'Done' };
    const currentStepLabel = computed(() => stepLabels[stepperValue.value] || '');

    function isStepActive(value) {
        return Number(value) <= Number(stepperValue.value);
    }

    function handleSourceStepClick(activateCallback) {
        if (isSourceNavigationLocked.value) return;

        if (selectedSource.value === null) {
            activateCallback();
            return;
        }

        returnToSourceChooser();
    }

    function handleBackFromSettings(activateCallback) {
        returnToSourceChooser();
        activateCallback('1');
    }

    // Handle going back from Results with processing check
    function handleBackFromResults(activateCallback) {
        if (isProcessing.value) {
            const confirmed = confirm(
                'Processing is in progress. Going back will abandon the current process and clear any generated results. Continue?'
            );
            if (!confirmed) return;
            slyce.resetProcessing();
        }

        slyce.set('currentStep', '2');
        activateCallback('2');
    }

    // Handle reset (Start Over)
    function handleReset(activateCallback) {
        selectedSource.value = null;
        cameraStep.value = '1';
        activateCallback('1');
    }

    /**
     * Guard stepper header clicks. If we're on step 3 and processing is active,
     * confirm before navigating away (which cancels the process).
     */
    function handleStepClick(activateCallback, targetStep) {
        if (selectedSource.value === null && targetStep !== '1') {
            return;
        }

        // Only guard when navigating away from step 3 while processing
        if (slyce.currentStep === '3' && targetStep !== '3' && isProcessing.value) {
            const confirmed = confirm(
                'Video processing is in progress. Navigating away will cancel the current process and discard any results. Continue?'
            );
            if (!confirmed) return;
            slyce.resetProcessing();
        }
        activateCallback();
    }

    // Drag and drop handlers
    function handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer?.files[0];
        if (file && file.type.startsWith('video/')) {
            selectedSource.value = 'file';
            cameraStep.value = '1';
            slyce.set('file', file);
            slyce.set('fileURL', URL.createObjectURL(file));
            slyce.set('textureName', file.name.replace(/\.[^.]+$/, '') || 'texture');
            slyce.set('textureDescription', '');
            slyce.set('currentStep', '2');
        }
    }

    function applyLaunchSource(source) {
        if (!props.active || !source) return;

        if (source === 'file' && selectedSource.value !== 'file') {
            selectFileMode();
            return;
        }

        if (source === 'camera' && selectedSource.value !== 'camera') {
            selectWebcamMode();
        }
    }

    watch(() => props.launchSource, (source) => {
        applyLaunchSource(source);
    }, { immediate: true });

    watch(() => props.active, (active) => {
        if (!active) return;
        applyLaunchSource(props.launchSource);
    });
</script>

<template>
    <div
        class="slyce-panel"
        :class="{ active: active }"
        @dragover="handleDragOver"
        @drop="handleDrop"
    >
        <div class="slyce-container">
            <!-- Main content area -->
            <div class="slyce-content">
                <Stepper
                    :value="stepperValue"
                    linear
                >
                    <StepList>
                        <Step
                            v-slot="{ activateCallback, value, a11yAttrs, class: stepClass }"
                            asChild
                            value="1"
                        >
                            <div
                                :class="[stepClass, 'step-item']"
                                v-bind="a11yAttrs.root"
                            >
                                <button
                                    class="step-button"
                                    :class="{ active: isStepActive(value) }"
                                    :disabled="selectedSource !== null && isSourceNavigationLocked"
                                    @click="handleSourceStepClick(activateCallback)"
                                    v-bind="a11yAttrs.header"
                                >
                                    <span class="material-symbols-outlined">video_camera_back_add</span>
                                </button>
                                <span
                                    class="step-label"
                                    :class="{ active: isStepActive(value) }"
                                >Start</span>
                                <div class="step-separator"></div>
                            </div>
                        </Step>
                        <Step
                            v-slot="{ activateCallback, value, a11yAttrs, class: stepClass }"
                            asChild
                            value="2"
                        >
                            <div
                                :class="[stepClass, 'step-item']"
                                v-bind="a11yAttrs.root"
                            >
                                <button
                                    class="step-button"
                                    :class="{ active: isStepActive(value) }"
                                    :disabled="selectedSource === null"
                                    @click="selectedSource === 'camera' ? handleCameraStepClick('2') : handleStepClick(activateCallback, '2')"
                                    v-bind="a11yAttrs.header"
                                >
                                    <span class="material-symbols-outlined">settings</span>
                                </button>
                                <span
                                    class="step-label"
                                    :class="{ active: isStepActive(value) }"
                                >Config</span>
                                <div class="step-separator"></div>
                            </div>
                        </Step>
                        <Step
                            v-slot="{ value, a11yAttrs, class: stepClass }"
                            asChild
                            value="3"
                        >
                            <div
                                :class="[stepClass, 'step-item']"
                                v-bind="a11yAttrs.root"
                            >
                                <button
                                    class="step-button"
                                    :class="{ active: isStepActive(value) }"
                                    :disabled="true"
                                    v-bind="a11yAttrs.header"
                                >
                                    <span class="material-symbols-outlined">progress_activity</span>
                                </button>
                                <span
                                    class="step-label"
                                    :class="{ active: isStepActive(value) }"
                                >Process</span>
                                <div class="step-separator"></div>
                            </div>
                        </Step>
                        <Step
                            v-slot="{ value, a11yAttrs, class: stepClass }"
                            asChild
                            value="4"
                        >
                            <div
                                :class="[stepClass, 'step-item']"
                                v-bind="a11yAttrs.root"
                            >
                                <button
                                    class="step-button"
                                    :class="{ active: isStepActive(value) }"
                                    :disabled="true"
                                    v-bind="a11yAttrs.header"
                                >
                                    <span class="material-symbols-outlined">check_circle</span>
                                </button>
                                <span
                                    class="step-label"
                                    :class="{ active: isStepActive(value) }"
                                >Done</span>
                            </div>
                        </Step>
                    </StepList>
                    <div class="mobile-step-label">{{ currentStepLabel }}</div>
                    <StepPanels>
                        <StepPanel value="1">
                            <UploadArea
                                :can-resume-file-flow="hasExistingFileFlow"
                                @resume-file-flow="selectFileMode"
                                @next="handleFileSelected"
                                @choose-camera="selectWebcamMode"
                            />
                        </StepPanel>

                        <template v-if="selectedSource === 'camera'">
                            <div class="camera-flow-panel">
                                <RealtimeSampler
                                    embedded
                                    :active="true"
                                    :auto-start-camera="!suppressRealtimeAutoStart"
                                    :workflow-phase="cameraWorkflowPhase"
                                    @start-capture="handleStartCameraProcessing"
                                    @apply="handleRealtimeApply"
                                    @close="handleEmbeddedRealtimeClose"
                                />
                            </div>
                        </template>

                        <template v-else>
                            <StepPanel
                                v-slot="{ activateCallback }"
                                value="2"
                            >
                                <SettingsArea @back="handleBackFromSettings(activateCallback)" />
                            </StepPanel>
                            <StepPanel
                                v-slot="{ activateCallback }"
                                value="3"
                            >
                                <ResultsArea
                                    @back="handleBackFromResults(activateCallback)"
                                    @reset="handleReset(activateCallback)"
                                    @apply-texture="(texture) => emit('apply-texture', texture)"
                                />
                            </StepPanel>
                            <StepPanel
                                v-slot="{ activateCallback }"
                                value="4"
                            >
                                <ResultsArea
                                    @back="handleBackFromResults(activateCallback)"
                                    @reset="handleReset(activateCallback)"
                                    @apply-texture="(texture) => emit('apply-texture', texture)"
                                />
                            </StepPanel>
                        </template>
                    </StepPanels>
                </Stepper>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .slyce-panel {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 5;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease;
        display: flex;
        flex-direction: column;
    }

    .slyce-panel.active {
        pointer-events: auto;
        opacity: 1;
    }

    .slyce-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        background: #1a1a1a;
        padding-top: 5.5rem;
        /* Space for AppHeader */
        padding-bottom: 5.5rem;
        /* Space for BottomToolbar */
        /* note, this is based on the button dimensions
         in the app header and bottom toolbar, ie.
        height: 1.5rem 
        padding-top: 2rem 
        padding-bottom 2rem
         */
    }

    .slyce-content {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        width: 100%;
        --texture-creator-step-muted: var(--p-stepper-step-number-color, var(--p-text-muted-color, #888));
        --texture-creator-step-surface: var(--p-stepper-step-number-background, var(--p-content-background, #333));
        --texture-creator-step-border: var(--p-stepper-step-number-border-color, var(--p-content-border-color, #555));
        --texture-creator-step-hover-surface: var(--p-content-hover-background, #444);
        --texture-creator-step-active-bg: var(--p-stepper-step-number-active-background, var(--p-primary-color, #10b981));
        --texture-creator-step-active-border: var(--p-stepper-step-number-active-border-color, var(--p-primary-color, #10b981));
        --texture-creator-step-active-color: var(--p-stepper-step-number-active-color, var(--p-primary-contrast-color, #fff));
        --texture-creator-step-title: var(--p-stepper-step-title-color, var(--p-text-muted-color, #888));
        --texture-creator-step-title-active: var(--p-stepper-step-title-active-color, var(--p-text-color, #fff));
        --texture-creator-step-separator: var(--p-stepper-separator-background, var(--p-content-border-color, #555));
    }

    .camera-flow-panel {
        max-width: 920px;
        margin: 0 auto;
    }

    .slyce-content :deep(.p-steplist) {
        justify-content: center;
        padding: 0 0 1rem 0;
        width: min(100%, 760px);
        margin: 0 auto;
    }

    /* Custom step item layout */
    .step-item {
        flex-direction: row;
        align-items: flex-start;
    }

    .step-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 3rem;
        height: 3rem;
        border-radius: 50%;
        border: 2px solid var(--texture-creator-step-border);
        background: var(--texture-creator-step-surface);
        color: var(--texture-creator-step-muted);
        cursor: pointer;
        transition: all 0.2s ease;
        flex-shrink: 0;
    }

    .step-button:hover:not(:disabled) {
        border-color: var(--texture-creator-step-active-border);
        background: var(--texture-creator-step-hover-surface);
    }

    .step-button:disabled {
        cursor: default;
    }

    .step-button.active {
        background: var(--texture-creator-step-active-bg);
        color: var(--texture-creator-step-active-color);
        border-color: var(--texture-creator-step-active-border);
    }

    .step-button .material-symbols-outlined {
        font-size: 1.25rem;
    }

    .step-label {
        display: block;
        margin-left: 1rem;
        align-self: center;
        color: var(--texture-creator-step-title);
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.06em;
        line-height: 1.25;
        text-align: center;
        text-transform: uppercase;
    }

    .step-label.active {
        color: var(--texture-creator-step-title-active);
    }

    .step-separator {
        flex: 1;
        height: 2px;
        background: var(--texture-creator-step-separator);
        margin: 1.45rem 0.5rem 0;
        min-width: 2rem;
    }

    .mobile-step-label {
        display: none;
    }

    @media (max-width: 720px) {
        .slyce-content :deep(.p-steplist) {
            width: 100%;
            justify-content: center;
            padding-bottom: 0.5rem;
        }

        .step-item {
            flex: 0 0 auto;
        }

        .step-label {
            display: none;
        }

        .mobile-step-label {
            display: block;
            text-align: center;
            color: var(--texture-creator-step-title-active);
            font-size: 0.75rem;
            font-weight: 600;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            padding-bottom: 0.75rem;
        }
    }
</style>
