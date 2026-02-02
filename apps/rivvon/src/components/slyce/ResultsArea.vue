<script setup>
    import { computed } from 'vue';
    import { useSlyceStore } from '../../stores/slyceStore';
    import StatusBox from './StatusBox.vue';
    import DownloadArea from './DownloadArea.vue';
    import TileLinearViewer from './TileLinearViewer.vue';
    // import TileGridRenderer from './TileGridRenderer.vue'; // Available for 3D grid view if needed
    import ProgressSpinner from 'primevue/progressspinner';

    const app = useSlyceStore();
    const emit = defineEmits(['back', 'reset', 'apply-texture']);

    // Check if there are any tiles available for download
    const hasTiles = computed(() => {
        return Object.keys(app.ktx2BlobURLs).length > 0;
    });

    // Check if processing is in progress (has status messages but no tiles yet)
    const isProcessing = computed(() => {
        return Object.keys(app.status).length > 0 && !hasTiles.value;
    });

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
    <div
        class="results-panel"
        v-if="hasTiles"
    >
        <div class="results-sidebar">
            <StatusBox />
            <div class="sidebar-buttons">
                <button
                    @click="handleBack"
                    class="back-button"
                >
                    <span class="material-symbols-outlined">arrow_back</span>
                    Back
                </button>
                <button
                    @click="handleReset"
                    class="reset-button"
                >
                    Start Over
                </button>
            </div>
            <DownloadArea @apply-texture="(texture) => emit('apply-texture', texture)" />
        </div>
        <div class="results-main">
            <!-- Linear KTX2 Viewer (document-like layout) -->
            <TileLinearViewer
                :ktx2BlobURLs="app.ktx2BlobURLs"
                :outputMode="app.outputMode"
            />
        </div>

    </div>
    <!-- Processing in progress - show spinner and status -->
    <div
        v-else-if="isProcessing"
        class="results-panel"
    >
        <div class="results-sidebar">
            <StatusBox />
        </div>
        <div class="results-main results-processing">
            <ProgressSpinner
                style="width: 50px; height: 50px"
                strokeWidth="4"
            />
            <p>Processing video...</p>
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
                >go back</a> and process a video to see results here.</p>
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
            flex: 0 0 300px;
        }
    }

    .results-main {
        flex: 1;
    }

    .reset-button {
        padding: 0.75rem 1rem;
        border: 1px solid var(--border-primary);
        border-radius: 0.5rem;
        background: var(--bg-secondary);
        color: var(--text-tertiary);
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        text-align: center;
        width: 100%;
        min-height: 44px;
    }

    .reset-button:hover {
        background: #fee2e2;
        border-color: #fca5a5;
        color: #dc2626;
    }

    .sidebar-buttons {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .back-button {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        background: transparent;
        border: 1px solid #555;
        color: #888;
        font-size: 0.9rem;
        cursor: pointer;
        transition: all 0.2s;
    }

    .back-button:hover {
        background: rgba(255, 255, 255, 0.05);
        color: #fff;
        border-color: #888;
    }

    .back-button .material-symbols-outlined {
        font-size: 1.1rem;
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

    .results-processing {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        color: var(--text-tertiary);
    }
</style>
