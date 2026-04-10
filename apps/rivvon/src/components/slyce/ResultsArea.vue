<script setup>
    import { computed } from 'vue';
    import { useSlyceStore } from '../../stores/slyceStore';
    import StatusBox from './StatusBox.vue';
    import OutputActions from './OutputActions.vue';
    import TilePreview from './TilePreview.vue';
    import ProgressSpinner from 'primevue/progressspinner';
    import Button from 'primevue/button';

    const app = useSlyceStore();
    const emit = defineEmits(['back', 'reset', 'apply-texture']);

    // Has at least one tile (show preview during processing or when done)
    const hasTiles = computed(() => Object.keys(app.ktx2BlobURLs).length > 0);

    // Processing: has status messages but not all tiles encoded yet
    const isProcessing = computed(() => Object.keys(app.status).length > 0 && !app.isComplete);

    // Active = processing OR has results (keeps components alive across the transition)
    const isActive = computed(() => isProcessing.value || hasTiles.value);

    // Abort processing and go back to settings
    function handleAbort() {
        const confirmed = confirm('Abort processing? Any progress will be lost.');
        if (!confirmed) return;
        app.resetProcessing();
        emit('back');
    }

    // Reset app and return to upload screen
    function handleReset() {
        if (confirm('Are you sure you want to start over? All current results will be cleared.')) {
            app.reset();
            emit('reset');
        }
    }

    // Go back to settings
    function handleBack() {
        emit('back');
    }
</script>

<template>
    <!-- Active: processing in progress or has results -->
    <div
        class="results-panel"
        v-if="isActive"
    >
        <div class="results-sidebar">
            <!-- Processing phase: status -->
            <template v-if="isProcessing">
                <StatusBox />
            </template>

            <!-- Complete phase: output actions (upload, save, download, apply) -->
            <OutputActions
                v-if="app.isComplete"
                @apply-texture="(texture) => emit('apply-texture', texture)"
            />

            <!-- Action bar — always visible, content changes by phase -->
            <div class="sidebar-actions">
                <Button
                    type="button"
                    @click="handleBack"
                    class="action-button action-back"
                    severity="secondary"
                    variant="outlined"
                >
                    <span class="material-symbols-outlined">arrow_back</span>
                    Back
                </Button>

                <Button
                    v-if="isProcessing"
                    type="button"
                    @click="handleAbort"
                    class="action-button action-abort"
                    severity="danger"
                    variant="outlined"
                >
                    <span class="material-symbols-outlined">cancel</span>
                    Abort
                </Button>

                <Button
                    v-if="app.isComplete"
                    type="button"
                    @click="handleReset"
                    class="action-button action-reset"
                    severity="secondary"
                    variant="outlined"
                >
                    <span class="material-symbols-outlined">restart_alt</span>
                    Start Over
                </Button>
            </div>
        </div>
        <div class="results-main">
            <!-- Static tile preview (progressively updated during encoding) -->
            <TilePreview
                v-if="hasTiles"
                :tilePlan="app.tilePlan"
            />
            <!-- No tiles yet — show processing spinner -->
            <div
                v-else
                class="preview-disabled-placeholder"
            >
                <ProgressSpinner
                    style="width: 50px; height: 50px"
                    strokeWidth="4"
                />
                <p>Processing video...</p>
            </div>
        </div>
    </div>
    <!-- No results and not processing -->
    <div
        v-else
        class="results-panel results-placeholder"
    >
        <div class="results-main">
            <p>No results available. Please <a
                    href="#"
                    @click.prevent="emit('back')"
                >go back</a> and process a video to see
                results here.</p>
        </div>
    </div>
</template>

<style scoped>
    .results-panel {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 1rem;
        min-height: 200px;
    }

    @media (min-width: 640px) {
        .results-panel {
            min-height: 300px;
        }
    }

    @media (min-width: 1024px) {
        .results-panel {
            flex-direction: row;
            gap: 1.5rem;
            min-height: 450px;
        }
    }

    .results-sidebar {
        flex: none;
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    @media (min-width: 640px) {
        .results-sidebar {
            flex: 0 0 250px;
            width: auto;
        }
    }

    @media (min-width: 1024px) {
        .results-sidebar {
            flex: 0 0 400px;
        }
    }

    .results-main {
        flex: 1;
    }

    /* -- Action bar -- */
    .sidebar-actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding-top: 0.75rem;
        border-top: 1px solid #333;
    }

    .action-button {
        font-size: 0.85rem;
        min-height: 44px;
    }

    .action-button .material-symbols-outlined {
        font-size: 1.1rem;
    }

    .action-back {
        margin-right: auto;
    }

    .results-placeholder {
        align-items: center;
        justify-content: center;
        color: var(--text-tertiary);
    }

    .results-placeholder a {
        color: #3b82f6;
        text-decoration: underline;
        cursor: pointer;
    }

    .results-placeholder a:hover {
        color: #2563eb;
    }

    .preview-disabled-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        min-height: 120px;
        color: rgba(255, 255, 255, 0.4);
        font-size: 14px;
        background: rgba(15, 15, 15, 0.5);
        border: 1px dashed rgba(255, 255, 255, 0.15);
        border-radius: 0.375rem;
    }

    .preview-disabled-placeholder .material-symbols-outlined {
        font-size: 1.5rem;
    }
</style>
