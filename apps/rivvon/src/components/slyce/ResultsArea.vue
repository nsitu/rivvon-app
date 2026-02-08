<script setup>
    import { computed } from 'vue';
    import { useSlyceStore } from '../../stores/slyceStore';
    import StatusBox from './StatusBox.vue';
    import OutputActions from './OutputActions.vue';
    import TileLinearViewer from './TileLinearViewer.vue';
    import TilePreview from './TilePreview.vue';
    import ProgressSpinner from 'primevue/progressspinner';
    import Select from 'primevue/select';

    const app = useSlyceStore();
    const emit = defineEmits(['back', 'reset', 'apply-texture']);

    // Preview mode options for the dropdown
    const previewOptions = [
        { label: 'Disabled', value: 'disabled' },
        { label: 'Static Preview', value: 'static' },
        { label: 'Animated Preview', value: 'animated' },
    ];

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
            <!-- Processing phase: status + preview controls -->
            <template v-if="isProcessing">
                <StatusBox />
                <div class="preview-toggle">
                    <label class="preview-toggle-label">
                        <span>Preview</span>
                        <Select
                            v-model="app.previewMode"
                            :options="previewOptions"
                            optionLabel="label"
                            optionValue="value"
                            class="preview-select"
                        />
                    </label>
                    <p class="preview-toggle-hint">
                        Disable or use static preview to free resources for faster encoding.
                    </p>
                </div>
            </template>

            <!-- Complete phase: output actions (upload, save, download, apply) -->
            <OutputActions
                v-if="app.isComplete"
                @apply-texture="(texture) => emit('apply-texture', texture)"
            />

            <!-- Action bar — always visible, content changes by phase -->
            <div class="sidebar-actions">
                <button
                    @click="handleBack"
                    class="action-button action-back"
                >
                    <span class="material-symbols-outlined">arrow_back</span>
                    Back
                </button>

                <button
                    v-if="isProcessing"
                    @click="handleAbort"
                    class="action-button action-abort"
                >
                    <span class="material-symbols-outlined">cancel</span>
                    Abort
                </button>

                <button
                    v-if="app.isComplete"
                    @click="handleReset"
                    class="action-button action-reset"
                >
                    <span class="material-symbols-outlined">restart_alt</span>
                    Start Over
                </button>
            </div>
        </div>
        <div class="results-main">
            <!-- Animated: Full Three.js KTX2 viewer (only when tiles exist) -->
            <TileLinearViewer
                v-if="app.previewMode === 'animated' && hasTiles"
                :ktx2BlobURLs="app.ktx2BlobURLs"
                :outputMode="app.outputMode"
            />
            <!-- Static: Tile snapshot thumbnails (progressively updated during encoding) -->
            <TilePreview
                v-else-if="app.previewMode === 'static'"
                :tilePlan="app.tilePlan"
            />
            <!-- Disabled / animated-but-no-tiles-yet -->
            <div
                v-else
                class="preview-disabled-placeholder"
            >
                <template v-if="app.previewMode === 'disabled'">
                    <span class="material-symbols-outlined">visibility_off</span>
                    <span>Preview disabled</span>
                </template>
                <template v-else>
                    <ProgressSpinner
                        style="width: 50px; height: 50px"
                        strokeWidth="4"
                    />
                    <p>Processing video...</p>
                </template>
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
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.5rem 1rem;
        border-radius: 0.5rem;
        font-size: 0.85rem;
        cursor: pointer;
        transition: all 0.2s ease;
        border: none;
        min-height: 44px;
    }

    .action-button .material-symbols-outlined {
        font-size: 1.1rem;
    }

    /* Back — minimal text button, always left-aligned */
    .action-back {
        background: transparent;
        color: #aaa;
        padding-left: 0.5rem;
        margin-right: auto;
        border: 1px solid #555;
    }

    .action-back:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.05);
        border-color: #888;
    }

    /* Abort — outlined warning */
    .action-abort {
        background: transparent;
        color: #e57373;
        border: 1px solid #e57373;
    }

    .action-abort:hover {
        background: rgba(229, 115, 115, 0.1);
    }

    /* Start Over — outlined neutral */
    .action-reset {
        background: transparent;
        color: #aaa;
        border: 1px solid #555;
    }

    .action-reset:hover {
        color: #fff;
        border-color: #888;
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

    .preview-toggle {
        padding: 0.75rem;
        border: 1px solid var(--border-primary);
        border-radius: 0.5rem;
        background: var(--bg-secondary);
    }

    .preview-toggle-label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-weight: 500;
        color: var(--text-secondary);
    }

    .preview-select {
        flex: 1;
        min-width: 0;
    }

    .preview-toggle-hint {
        margin: 0.35rem 0 0 0;
        font-size: 0.75rem;
        color: var(--text-tertiary);
        line-height: 1.3;
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
