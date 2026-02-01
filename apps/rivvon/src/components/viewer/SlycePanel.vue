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

    const emit = defineEmits(['close']);

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
        activateCallback('1');
    }

    // Handle reset (Start Over)
    function handleReset(activateCallback) {
        activateCallback('0');
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
            slyce.set('currentStep', '1');
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
                        <Step value="0">Add Video</Step>
                        <Step value="1">Settings</Step>
                        <Step value="2">Results</Step>
                    </StepList>
                    <StepPanels>
                        <StepPanel
                            v-slot="{ activateCallback }"
                            value="0"
                        >
                            <UploadArea @next="activateCallback('1')" />
                        </StepPanel>
                        <StepPanel
                            v-slot="{ activateCallback }"
                            value="1"
                        >
                            <SettingsArea @back="activateCallback('0')" />
                        </StepPanel>
                        <StepPanel
                            v-slot="{ activateCallback }"
                            value="2"
                        >
                            <ResultsArea
                                @back="handleBackFromResults(activateCallback)"
                                @reset="handleReset(activateCallback)"
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
    }

    .slyce-content :deep(.p-step) {
        background: transparent;
        color: #888;
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
