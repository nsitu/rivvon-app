<script setup>
    import { computed, ref } from 'vue';
    import { useSlyceStore } from '../../stores/slyceStore';
    import { useViewerStore } from '../../stores/viewerStore';

    import UploadArea from '../slyce/UploadArea.vue';
    import SettingsArea from '../slyce/SettingsArea.vue';
    import ResultsArea from '../slyce/ResultsArea.vue';

    import Stepper from 'primevue/stepper';
    import StepList from 'primevue/steplist';
    import Step from 'primevue/step';
    import StepPanels from 'primevue/steppanels';
    import StepPanel from 'primevue/steppanel';

    const props = defineProps({
        active: {
            type: Boolean,
            default: false
        }
    });

    const emit = defineEmits(['close', 'apply-texture']);

    const slyce = useSlyceStore();
    const viewer = useViewerStore();

    // Check if processing is in progress
    const isProcessing = computed(() => Object.keys(slyce.status).length > 0);

    // Store activate callback for external navigation
    const activateStep = ref(null);

    // Handle going back from Results with processing check
    function handleBackFromResults(activateCallback) {
        if (isProcessing.value) {
            const confirmed = confirm(
                'Processing is in progress. Going back will abandon the current process and clear any generated results. Continue?'
            );
            if (!confirmed) return;
            slyce.resetProcessing();
        }
        activateCallback('2');
    }

    // Handle reset (Start Over)
    function handleReset(activateCallback) {
        activateCallback('1');
    }

    /**
     * Guard stepper header clicks. If we're on step 3 and processing is active,
     * confirm before navigating away (which cancels the process).
     */
    function handleStepClick(activateCallback, targetStep) {
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
            slyce.set('file', file);
            slyce.set('fileURL', URL.createObjectURL(file));
            slyce.set('currentStep', '2');
        }
    }
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
                    :value="slyce.currentStep"
                    linear
                >
                    <StepList>
                        <Step
                            v-slot="{ activateCallback, value, a11yAttrs }"
                            asChild
                            value="1"
                        >
                            <div
                                class="step-item"
                                v-bind="a11yAttrs.root"
                            >
                                <button
                                    class="step-button"
                                    :class="{ active: value <= slyce.currentStep }"
                                    @click="handleStepClick(activateCallback, '1')"
                                    v-bind="a11yAttrs.header"
                                >
                                    <span class="material-symbols-outlined">video_camera_back_add</span>
                                </button>
                                <div class="step-separator"></div>
                            </div>
                        </Step>
                        <Step
                            v-slot="{ activateCallback, value, a11yAttrs }"
                            asChild
                            value="2"
                        >
                            <div
                                class="step-item"
                                v-bind="a11yAttrs.root"
                            >
                                <button
                                    class="step-button"
                                    :class="{ active: value <= slyce.currentStep }"
                                    @click="handleStepClick(activateCallback, '2')"
                                    v-bind="a11yAttrs.header"
                                >
                                    <span class="material-symbols-outlined">settings</span>
                                </button>
                                <div class="step-separator"></div>
                            </div>
                        </Step>
                        <Step
                            v-slot="{ activateCallback, value, a11yAttrs }"
                            asChild
                            value="3"
                        >
                            <div
                                class="step-item step-item-last"
                                v-bind="a11yAttrs.root"
                            >
                                <button
                                    class="step-button"
                                    :class="{ active: value <= slyce.currentStep }"
                                    @click="activateCallback"
                                    v-bind="a11yAttrs.header"
                                >
                                    <span class="material-symbols-outlined">done_outline</span>
                                </button>
                            </div>
                        </Step>
                    </StepList>
                    <StepPanels>
                        <StepPanel
                            v-slot="{ activateCallback }"
                            value="1"
                        >
                            <UploadArea @next="activateCallback('2')" />
                        </StepPanel>
                        <StepPanel
                            v-slot="{ activateCallback }"
                            value="2"
                        >
                            <SettingsArea @back="activateCallback('1')" />
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
    }

    /* Override PrimeVue stepper styling for dark theme */
    .slyce-content :deep(.p-stepper) {
        background: transparent;
    }

    .slyce-content :deep(.p-steplist) {
        background: transparent;
        justify-content: center;
        padding: 0 0 1rem 0;
        max-width: 360px;
        margin: 0 auto;
        gap: 0;
    }

    .slyce-content :deep(.p-step) {
        background: transparent;
        color: #888;
        padding: 0;
    }

    /* Custom step item layout */
    .step-item {
        display: flex;
        flex-direction: row;
        align-items: center;
        flex: 1;
        gap: 0;
    }

    .step-item-last {
        flex: 0;
    }

    .step-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 3rem;
        height: 3rem;
        border-radius: 50%;
        border: 2px solid #555;
        background: #333;
        color: #888;
        cursor: pointer;
        transition: all 0.2s ease;
        flex-shrink: 0;
    }

    .step-button:hover {
        border-color: #777;
        background: #444;
    }

    .step-button.active {
        background: #4caf50;
        color: #fff;
        border-color: #4caf50;
    }

    .step-button .material-symbols-outlined {
        font-size: 1.25rem;
    }

    .step-separator {
        flex: 1;
        height: 2px;
        background: #555;
        margin: 0 0.5rem;
        min-width: 2rem;
    }

    .slyce-content :deep(.p-step-number) {
        background: #333;
        color: #888;
        border-color: #555;
    }

    .slyce-content :deep(.p-step-active .p-step-number) {
        background: #4caf50;
        color: #fff;
        border-color: #4caf50;
    }

    .slyce-content :deep(.p-step-title) {
        color: #888;
    }

    .slyce-content :deep(.p-step-active .p-step-title) {
        color: #fff;
    }

    .slyce-content :deep(.p-steppanels) {
        background: transparent;
        padding: 24px 0;
    }

    .slyce-content :deep(.p-steppanel) {
        padding: 0;
    }

    .slyce-content :deep(.p-stepper-separator) {
        background: #555;
    }
</style>
