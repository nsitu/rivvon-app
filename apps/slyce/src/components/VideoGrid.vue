<template>
    <!-- Video Grid - Pure rendering component for WebM tiles -->
    <div :class="parentContainerClasses">
        <div
            v-for="(blobURL, tileNumber) in blobURLs"
            :key="tileNumber"
            :class="videoPlayerContainerClasses"
        >
            <VideoPlayer
                :url="blobURL"
                :playbackTime="playbackTime"
                :isPlaying="isPlaying"
                :isPrimary="tileNumber === '0'"
                :hasControls="false"
                @playback-state-change="handlePlaybackStateChange"
                :aria-label="`Video Tile ${tileNumber}`"
                class="w-full h-auto rounded-md"
            />
        </div>
    </div>
</template>

<script setup>
    import { computed } from 'vue';
    import VideoPlayer from './VideoPlayer.vue';

    // Props
    const props = defineProps({
        blobURLs: {
            type: Object,
            required: true
        },
        outputMode: {
            type: String,
            required: true,
            validator: (value) => ['columns', 'rows'].includes(value)
        },
        playbackTime: {
            type: Number,
            default: 0
        },
        isPlaying: {
            type: Boolean,
            default: false
        }
    });

    // Emit playback state changes
    const emit = defineEmits(['playback-state-change']);

    // Computed property for the parent container's classes
    const parentContainerClasses = computed(() => {
        return props.outputMode === 'columns'
            ? 'flex flex-row flex-wrap gap-4 justify-start'
            : 'flex flex-col gap-4';
    });

    // Computed property for each video-player-container's classes
    const videoPlayerContainerClasses = computed(() => {
        return props.outputMode === 'columns'
            ? 'w-full sm:w-1/2 md:w-1/3 lg:w-1/4' // Responsive widths for columns
            : 'w-full'; // Full width for rows
    });

    // Handle playback state changes from the primary video
    function handlePlaybackStateChange(state) {
        emit('playback-state-change', state);
    }
</script>

<style scoped>

    /* Ensure videos are responsive */
    .video-player {
        max-width: 100%;
        height: auto;
        border-radius: 0.375rem;
    }
</style>
