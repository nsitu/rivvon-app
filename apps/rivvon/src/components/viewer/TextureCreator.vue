<script setup>
    import { computed, nextTick, ref, watch, watchEffect } from 'vue';
    import { useSlyceStore } from '../../stores/slyceStore';
    import { useRealtimeSlyce } from '../../composables/slyce/useRealtimeSlyce.js';

    import Button from 'primevue/button';
    import UploadArea from '../slyce/UploadArea.vue';
    import SettingsArea from '../slyce/SettingsArea.vue';
    import ResultsArea from '../slyce/ResultsArea.vue';
    import OutputActions from '../slyce/OutputActions.vue';
    import RealtimeSampler from '../slyce/RealtimeSampler.vue';
    import PanelActionBar from '../shared/PanelActionBar.vue';

    import { useTilePlan } from '../../composables/slyce/useTilePlan';
    import { processVideo } from '../../modules/slyce/videoProcessor';

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

    const emit = defineEmits([
        'request-close',
        'request-apply-texture',
        'request-apply-realtime-texture',
        'navigation-state-change',
    ]);

    const slyce = useSlyceStore();
    const realtime = useRealtimeSlyce();
    const { tilePlan } = useTilePlan();

    // Check if processing is in progress
    const isProcessing = computed(() => Object.keys(slyce.status).length > 0);
    const selectedSource = ref(null);
    const cameraStep = ref('1');
    const suppressRealtimeAutoStart = ref(false);
    const outputActionsRef = ref(null);

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
        if (slyce.currentStep === '1') return '2';
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
        return fileDisplayStep.value;
    });
    const currentStepLabel = computed(() => {
        if (stepperValue.value === '2') {
            return selectedSource.value === 'camera' ? 'Setup' : 'Config';
        }

        if (stepperValue.value === '3') {
            return 'Process';
        }

        if (stepperValue.value === '4') {
            return 'Done';
        }

        return '';
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
    const canGoBack = computed(() => {
        if (selectedSource.value === 'camera') {
            return cameraDisplayStep.value !== '2';
        }

        if (selectedSource.value === 'file') {
            return !!slyce.file || Object.keys(slyce.ktx2BlobURLs).length > 0 || slyce.currentStep === '3';
        }

        return false;
    });
    const showFileSettingsFooter = computed(() => (
        selectedSource.value === 'file'
        && slyce.currentStep === '2'
        && Boolean(slyce.file)
    ));
    const showFileResultsFooter = computed(() => (
        selectedSource.value === 'file'
        && slyce.currentStep === '3'
    ));
    const showFileCompletedFooter = computed(() => showFileResultsFooter.value && slyce.isComplete);
    const canProcessVideo = computed(() => (tilePlan.value?.tiles?.length ?? 0) > 0);
    const isFinalizingOutput = computed(() => slyce.isSavingLocally || slyce.isPublishingToCloud);
    const processDisabledReason = computed(() => {
        if (canProcessVideo.value) {
            return '';
        }

        return tilePlan.value?.notices?.find(notice => typeof notice === 'string' && notice.trim())
            || 'Adjust the current settings so at least one tile can be generated before processing.';
    });
    const footerBrowserButtonLabel = computed(() => slyce.publishedCloudRootId ? 'Open My Published' : 'Open Drafts');
    const canOpenTextureBrowser = computed(() => (
        showFileCompletedFooter.value
        && Boolean(slyce.savedLocalTextureId || slyce.publishLocalDraftId || slyce.publishedCloudRootId)
    ));
    const showApplyDraftAction = computed(() => (
        showFileCompletedFooter.value
        && !slyce.publishedCloudRootId
        && Boolean(slyce.savedLocalTextureId)
    ));
    const showRetryLocalSaveAction = computed(() => (
        showFileCompletedFooter.value
        && Boolean(slyce.saveLocalError)
        && !slyce.isSavingLocally
    ));

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

    function handleEmbeddedRealtimeClose() {
        suppressRealtimeAutoStart.value = true;
        emit('request-close');
    }

    function handleRealtimeApply(payload) {
        suppressRealtimeAutoStart.value = true;
        emit('request-apply-realtime-texture', payload);
    }

    const navigationBreadcrumbs = computed(() => {
        const breadcrumbs = ['Create Texture'];

        if (selectedSource.value === 'file') {
            breadcrumbs.push('Video');
        }

        if (selectedSource.value === 'camera') {
            breadcrumbs.push('Camera');
        }

        return breadcrumbs;
    });
    const navigationState = computed(() => {
        if (!props.active) {
            return null;
        }

        return {
            breadcrumbs: navigationBreadcrumbs.value,
            statusLabel: null,
            canGoBack: canGoBack.value,
            canExit: true,
        };
    });

    function isStepActive(value) {
        return Number(value) <= Number(stepperValue.value);
    }

    function handleBackFromSettings(activateCallback) {
        slyce.resetForNewFileSelection();
        activateCallback('2');
    }

    function handleSettingsFooterBack() {
        slyce.resetForNewFileSelection();
    }

    function handleSettingsFooterProcess() {
        if (!canProcessVideo.value) {
            return;
        }

        processVideo({
            file: slyce.file,
            tilePlan: tilePlan.value,
            samplingMode: slyce.samplingAxis,
            config: slyce.config,
            frameCount: slyce.frameCount,
            fileInfo: slyce.fileInfo,
            crossSectionCount: slyce.crossSectionCount,
            crossSectionType: slyce.crossSectionType,
            frameInterpolationFactor: slyce.effectiveInterpolationFactor,
            tileBuilderBackend: slyce.tileBuilderBackend,
        });
    }

    function handleResultsFooterBack() {
        if (isFinalizingOutput.value) {
            return;
        }

        stepBackFromFileResults();
    }

    function handleAbortProcessing() {
        const confirmed = confirm('Abort processing? Any progress will be lost.');
        if (!confirmed) {
            return;
        }

        slyce.resetProcessing();
    }

    function handleStartOver() {
        if (isFinalizingOutput.value) {
            return;
        }

        const confirmed = confirm('Are you sure you want to start over? All current results will be cleared.');
        if (!confirmed) {
            return;
        }

        selectedSource.value = 'file';
        cameraStep.value = '1';
        suppressRealtimeAutoStart.value = false;
        slyce.reset();
    }

    function handleApplyTextureAction() {
        outputActionsRef.value?.applyTexture?.();
    }

    function handleOpenTextureBrowserAction() {
        outputActionsRef.value?.openTextureBrowser?.();
    }

    function handleRetryLocalSave() {
        outputActionsRef.value?.retrySaveLocally?.();
    }

    function stepBackFromFileResults() {
        if (isProcessing.value) {
            const confirmed = confirm(
                'Processing is in progress. Going back will abandon the current process and clear any generated results. Continue?'
            );
            if (!confirmed) return false;
            slyce.resetProcessing();
        }

        slyce.set('currentStep', '2');
        return true;
    }

    // Handle going back from Results with processing check
    function handleBackFromResults(activateCallback) {
        const steppedBack = stepBackFromFileResults();
        if (!steppedBack) {
            return;
        }

        activateCallback('2');
    }

    // Handle reset (Start Over)
    function handleReset(activateCallback) {
        selectedSource.value = 'file';
        cameraStep.value = '1';
        suppressRealtimeAutoStart.value = false;
        slyce.resetForNewFileSelection();
        activateCallback('2');
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

    function handleNavigationBack() {
        if (selectedSource.value === 'camera') {
            if (cameraDisplayStep.value === '2') {
                return false;
            }

            handleCameraStepClick('2');
            return true;
        }

        if (selectedSource.value === 'file') {
            if (slyce.currentStep === '3') {
                return stepBackFromFileResults();
            }

            if (!slyce.file && Object.keys(slyce.ktx2BlobURLs).length === 0) {
                return false;
            }

            slyce.resetForNewFileSelection();
            return true;
        }

        return false;
    }

    function handleNavigationExit() {
        if (selectedSource.value === 'file' && isProcessing.value) {
            const confirmed = confirm(
                'Video processing is in progress. Leaving will cancel the current process and discard any results. Continue?'
            );
            if (!confirmed) {
                return false;
            }

            slyce.resetProcessing();
        }

        if (selectedSource.value === 'camera' && hasRealtimeWork.value) {
            const confirmed = confirm(
                'Current camera capture will be cleared when you leave Create Texture. Continue?'
            );
            if (!confirmed) {
                return false;
            }

            clearRealtimeFlow();
        }

        emit('request-close');
        return true;
    }

    watchEffect(() => {
        const nextNavigationState = navigationState.value;

        emit('navigation-state-change', nextNavigationState
            ? {
                ...nextNavigationState,
                breadcrumbs: [...nextNavigationState.breadcrumbs],
            }
            : null);
    });

    defineExpose({
        handleNavigationBack,
        handleNavigationExit,
    });

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
            slyce.beginFileWorkflowWithFile(file);
        }
    }

    function applyLaunchSource(source) {
        if (!props.active) return;

        if (source === 'camera') {
            if (selectedSource.value !== 'camera') {
                selectWebcamMode();
            }
            return;
        }

        if (selectedSource.value !== 'file') {
            selectFileMode();
            return;
        }

        if (!hasExistingFileFlow.value) {
            slyce.set('currentStep', '1');
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
        <div class="slyce-container viewer-chrome-panel-container">
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
                                >{{ selectedSource === 'camera' ? 'Setup' : 'Config' }}</span>
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
                        <template v-if="selectedSource === 'camera'">
                            <div class="camera-flow-panel">
                                <RealtimeSampler
                                    embedded
                                    :active="true"
                                    :auto-start-camera="!suppressRealtimeAutoStart"
                                    :workflow-phase="cameraWorkflowPhase"
                                    @request-start-capture="handleStartCameraProcessing"
                                    @request-apply="handleRealtimeApply"
                                    @request-close="handleEmbeddedRealtimeClose"
                                />
                            </div>
                        </template>

                        <template v-else>
                            <StepPanel
                                v-slot="{ activateCallback }"
                                value="2"
                            >
                                <UploadArea
                                    v-if="!slyce.file"
                                    :can-resume-file-flow="hasExistingFileFlow"
                                    @request-resume-file-flow="selectFileMode"
                                    @request-next="handleFileSelected"
                                />
                                <SettingsArea
                                    v-else
                                    :show-action-buttons="false"
                                    @request-back="handleBackFromSettings(activateCallback)"
                                />
                            </StepPanel>
                            <StepPanel value="3">
                                <ResultsArea />
                            </StepPanel>
                            <StepPanel value="4">
                                <ResultsArea />
                            </StepPanel>
                        </template>
                    </StepPanels>
                </Stepper>
            </div>

            <PanelActionBar
                v-if="showFileSettingsFooter || showFileResultsFooter"
                class="texture-creator-footer"
            >
                <template
                    v-if="showFileSettingsFooter && !canProcessVideo && processDisabledReason"
                    #leading
                >
                    <p class="texture-creator-footer-note">{{ processDisabledReason }}</p>
                </template>

                <template
                    v-else-if="showFileCompletedFooter"
                    #leading
                >
                    <OutputActions
                        ref="outputActionsRef"
                        :show-inline-actions="false"
                        @request-apply-texture="(texture) => emit('request-apply-texture', texture)"
                    />
                </template>

                <template v-if="showFileSettingsFooter">
                    <Button
                        type="button"
                        severity="secondary"
                        variant="outlined"
                        @click="handleSettingsFooterBack"
                    >
                        <span class="material-symbols-outlined">arrow_back</span>
                        Back
                    </Button>
                    <Button
                        id="process-button-footer"
                        type="button"
                        :disabled="!canProcessVideo"
                        :title="processDisabledReason || null"
                        @click="handleSettingsFooterProcess"
                    >
                        <span class="material-symbols-outlined">play_arrow</span>
                        Process
                    </Button>
                </template>

                <template v-else-if="showFileResultsFooter && !showFileCompletedFooter">
                    <Button
                        type="button"
                        severity="secondary"
                        variant="outlined"
                        @click="handleResultsFooterBack"
                    >
                        <span class="material-symbols-outlined">arrow_back</span>
                        Back
                    </Button>
                    <Button
                        type="button"
                        severity="danger"
                        variant="outlined"
                        @click="handleAbortProcessing"
                    >
                        <span class="material-symbols-outlined">cancel</span>
                        Abort
                    </Button>
                </template>

                <template v-else-if="showFileCompletedFooter">
                    <Button
                        type="button"
                        severity="secondary"
                        variant="outlined"
                        :disabled="isFinalizingOutput"
                        @click="handleResultsFooterBack"
                    >
                        <span class="material-symbols-outlined">arrow_back</span>
                        Back
                    </Button>
                    <Button
                        type="button"
                        severity="secondary"
                        variant="outlined"
                        :disabled="isFinalizingOutput"
                        @click="handleStartOver"
                    >
                        <span class="material-symbols-outlined">restart_alt</span>
                        Start Over
                    </Button>
                    <Button
                        v-if="showRetryLocalSaveAction"
                        type="button"
                        severity="secondary"
                        variant="outlined"
                        @click="handleRetryLocalSave"
                    >
                        <span class="material-symbols-outlined">refresh</span>
                        Retry Save
                    </Button>
                    <Button
                        v-if="canOpenTextureBrowser"
                        type="button"
                        severity="secondary"
                        variant="outlined"
                        @click="handleOpenTextureBrowserAction"
                    >
                        <span class="material-symbols-outlined">folder</span>
                        {{ footerBrowserButtonLabel }}
                    </Button>
                    <Button
                        v-if="showApplyDraftAction"
                        type="button"
                        class="texture-creator-footer-apply-draft"
                        @click="handleApplyTextureAction"
                    >
                        <span class="material-symbols-outlined">check</span>
                        Apply Draft
                    </Button>
                </template>
            </PanelActionBar>
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

    .texture-creator-footer {
        --panel-action-bar-padding: 0.9rem 1.25rem 1rem;
        --panel-action-bar-border-color: rgba(255, 255, 255, 0.1);
        --panel-action-bar-background: rgba(26, 26, 26, 0.96);
        flex-shrink: 0;
    }

    .texture-creator-footer-note {
        margin: 0;
        padding: 0.85rem 1rem;
        border-radius: 0.8rem;
        border: 1px solid rgba(245, 158, 11, 0.28);
        background: rgba(120, 53, 15, 0.2);
        color: rgba(255, 237, 213, 0.92);
        font-size: 0.9rem;
        line-height: 1.45;
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

        .texture-creator-footer {
            --panel-action-bar-gap: 0.5rem;
            --panel-action-bar-button-min-width: 0;
            --panel-action-bar-mobile-basis: 0;
            --panel-action-bar-padding: 0.8rem 1rem 0.95rem;
        }

    }

    @media (max-width: 767px) {
        .texture-creator-footer :deep(.texture-creator-footer-apply-draft) {
            flex: 1 0 100%;
            width: 100%;
        }
    }
</style>
