<script setup>
    import { computed } from 'vue';
    import { useAppStore } from '../stores/appStore';
    import StatusBox from './StatusBox.vue';
    import DownloadArea from './DownloadArea.vue';
    import VideoGrid from './VideoGrid.vue';
    import TileGridRenderer from './TileGridRenderer.vue';
    import ProgressSpinner from 'primevue/progressspinner';

    const app = useAppStore();

    // Check if there are any tiles available for download
    const hasTiles = computed(() => {
        const blobURLs = app.outputFormat === 'ktx2' ? app.ktx2BlobURLs : app.blobURLs;
        return Object.keys(blobURLs).length > 0;
    });

    // Check if processing is in progress (has status messages but no tiles yet)
    const isProcessing = computed(() => {
        return Object.keys(app.status).length > 0 && !hasTiles.value;
    });

    // Handle playback state changes from the video grid
    function handlePlaybackStateChange({ currentTime, playing }) {
        app.updatePlaybackState({ currentTime, playing });
    }

    // Reset app and return to upload screen
    function handleReset() {
        if (confirm('Are you sure you want to start over? All current results will be cleared.')) {
            app.reset();
        }
    }
</script>

<template>
    <div
        class="results-panel"
        v-if="hasTiles"
    >
        <div class="results-sidebar">
            <StatusBox />
            <button
                @click="handleReset"
                class="reset-button"
            >
                Start Over
            </button>
        </div>
        <div class="results-main">
            <!-- WebM Video Grid -->
            <VideoGrid
                v-if="app.outputFormat === 'webm'"
                :blobURLs="app.blobURLs"
                :outputMode="app.outputMode"
                :playbackTime="app.currentPlaybackTime"
                :isPlaying="app.isPlaying"
                @playback-state-change="handlePlaybackStateChange"
            />

            <!-- KTX2 Three.js Renderer -->
            <TileGridRenderer
                v-else-if="app.outputFormat === 'ktx2'"
                :ktx2BlobURLs="app.ktx2BlobURLs"
                :outputMode="app.outputMode"
            />
        </div>
        <div class="results-download">
            <DownloadArea />
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
                    @click.prevent="app.currentTab = '0'"
                >upload a video</a> and process it to see results here.</p>
        </div>

    </div>
</template>

<style scoped>
    .results-panel {
        display: flex;
        gap: 1.5rem;
        padding: 1rem;
        min-height: 450px;
    }

    .results-sidebar {
        flex: 0 0 300px;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .results-main {
        flex: 1;
    }

    .reset-button {
        padding: 0.75rem 1rem;
        border: 1px solid #e2e8f0;
        border-radius: 0.5rem;
        background: #f8fafc;
        color: #64748b;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        text-align: center;
        width: 100%;
    }

    .reset-button:hover {
        background: #fee2e2;
        border-color: #fca5a5;
        color: #dc2626;
    }

    @media (max-width: 1024px) {
        .results-panel {
            flex-direction: column;
        }

        .results-sidebar {
            flex: none;
            width: 100%;
        }
    }

    .results-placeholder {
        align-items: center;
        justify-content: center;
        color: #64748b;
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
        color: #64748b;
    }
</style>
