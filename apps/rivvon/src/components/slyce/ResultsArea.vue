<script setup>
    import { computed } from 'vue';
    import { useSlyceStore } from '../../stores/slyceStore';
    import StatusBox from './StatusBox.vue';
    import TilePreview from './TilePreview.vue';

    const app = useSlyceStore();

    // Show the static tile summary as soon as a processing plan exists.
    const hasTilePlan = computed(() => (app.tilePlan?.tiles?.length ?? 0) > 0);

    // Has at least one encoded tile result.
    const hasEncodedTiles = computed(() => Object.keys(app.ktx2BlobURLs).length > 0);

    // Processing: has status messages but not all tiles encoded yet
    const isProcessing = computed(() => Object.keys(app.status).length > 0 && !app.isComplete);

    // Active = processing OR has results (keeps components alive across the transition)
    const isActive = computed(() => isProcessing.value || hasTilePlan.value || hasEncodedTiles.value);
</script>

<template>
    <!-- Active: processing in progress or has results -->
    <div
        class="results-panel"
        :class="{ 'results-panel-processing': isProcessing }"
        v-if="isActive"
    >
        <div
            v-if="isProcessing"
            class="results-sidebar"
        >
            <StatusBox />
        </div>
        <div class="results-main">
            <!-- Static tile summary and preview, visible as soon as the tile plan exists. -->
            <TilePreview
                v-if="hasTilePlan"
                :tilePlan="app.tilePlan"
                :showTileStatuses="true"
            />
        </div>
    </div>
    <!-- No results and not processing -->
    <div
        v-else
        class="results-panel results-placeholder"
    >
        <div class="results-main">
            <p>No results available yet.</p>
        </div>
    </div>
</template>

<style scoped>
    .results-panel {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 0;
        min-height: 200px;
    }

    @media (min-width: 640px) {
        .results-panel {
            padding: 1rem;
            min-height: 300px;
        }
    }

    @media (min-width: 1024px) {
        .results-panel.results-panel-processing {
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
        min-height: 0;
        overflow-y: auto;
    }

    .results-placeholder {
        align-items: center;
        justify-content: center;
        color: var(--text-tertiary);
    }

    .preview-disabled-placeholder {
        min-height: 120px;
        color: rgba(255, 255, 255, 0.4);
        background: rgba(15, 15, 15, 0.5);
        border: 1px dashed rgba(255, 255, 255, 0.15);
        border-radius: 0.375rem;
        --loading-indicator-gap: 0.5rem;
        --loading-indicator-spinner-size: 50px;
        --loading-indicator-spinner-border-width: 4px;
        --loading-indicator-text-size: 14px;
    }
</style>
