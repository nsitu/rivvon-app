<script setup>
    import { ref, onMounted, onUnmounted, computed, watch, toValue } from 'vue';

    const props = defineProps({
        videoRef: {
            type: Object,
            default: null
        }
    });

    const isPlaying = ref(false);
    const currentTime = ref(0);
    const duration = ref(0);

    let updateInterval = null;

    // Format time as MM:SS
    const formatTime = (seconds) => {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const formattedCurrentTime = computed(() => formatTime(currentTime.value));
    const formattedDuration = computed(() => formatTime(duration.value));

    // Helper to get the VideoPlayer component instance
    // props.videoRef could be either a ref or the component directly
    const getVideoPlayer = () => {
        const vRef = props.videoRef;
        if (!vRef) return null;

        // Check if it's a Vue ref (has __v_isRef property or _value)
        // Template refs have a .value property that contains the component
        if (vRef.__v_isRef || '_value' in vRef) {
            return vRef.value || null;
        }

        // Otherwise it's the component instance directly
        return vRef;
    };

    // Helper to get the video element safely
    const getVideoElement = () => {
        const videoPlayer = getVideoPlayer();
        if (!videoPlayer) return null;

        // Access the exposed videoElement ref
        const videoEl = videoPlayer.videoElement;
        if (!videoEl) return null;

        // videoElement is a ref, so get its value
        return videoEl.value || videoEl;
    };

    const togglePlay = async () => {
        const video = getVideoElement();
        if (!video) {
            console.warn('VideoControls: No video element available');
            return;
        }

        if (video.paused) {
            try {
                await video.play();
                isPlaying.value = true;
            } catch (error) {
                console.error('Error playing video:', error);
            }
        } else {
            video.pause();
            isPlaying.value = false;
        }
    };

    const seek = (event) => {
        const videoPlayer = getVideoPlayer();
        if (!videoPlayer) return;

        const newTime = parseFloat(event.target.value);
        // Use the exposed seek method
        videoPlayer.seek(newTime);
        currentTime.value = newTime;
    };

    const updateState = () => {
        const videoPlayer = getVideoPlayer();
        if (!videoPlayer) return;

        // Use exposed methods to get current state
        const currTime = videoPlayer.getCurrentTime?.() ?? 0;
        const dur = videoPlayer.getDuration?.() ?? 0;

        currentTime.value = currTime;
        duration.value = dur;

        // Check playing state from the video element
        const video = getVideoElement();
        if (video) {
            isPlaying.value = !video.paused;
        }
    };

    // Watch for videoRef changes and when it becomes ready
    watch(
        () => {
            const vp = getVideoPlayer();
            return vp?.isReady?.value ?? vp?.isReady;
        },
        (ready) => {
            if (ready) {
                updateState();
            }
        },
        { immediate: true }
    );

    onMounted(() => {
        // Poll for video state updates
        updateInterval = setInterval(updateState, 100);
    });

    onUnmounted(() => {
        if (updateInterval) {
            clearInterval(updateInterval);
        }
    });
</script>

<template>
    <div class="video-controls">
        <button
            class="control-button"
            @click="togglePlay"
            :title="isPlaying ? 'Pause' : 'Play'"
        >
            <span class="material-symbols-outlined">
                {{ isPlaying ? 'pause' : 'play_arrow' }}
            </span>
        </button>

        <input
            type="range"
            class="seek-bar"
            :min="0"
            :max="duration || 100"
            :value="currentTime"
            step="0.1"
            @input="seek"
        />

        <span class="time-display">
            {{ formattedCurrentTime }} / {{ formattedDuration }}
        </span>
    </div>
</template>

<style scoped>
    .video-controls {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem;
        background: #1a1a1a;
        border-radius: 0;
        margin-bottom: 1rem;
    }

    .control-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        background: transparent;
        border: none;
        color: #fff;
        cursor: pointer;
        border-radius: 4px;
        transition: background-color 0.15s;
    }

    .control-button:hover {
        background: rgba(255, 255, 255, 0.1);
    }

    .control-button .material-symbols-outlined {
        font-size: 20px;
    }

    .seek-bar {
        flex: 1;
        height: 4px;
        accent-color: #10b981;
        cursor: pointer;
    }

    .time-display {
        color: #aaa;
        font-size: 12px;
        font-family: monospace;
        min-width: 80px;
        text-align: center;
    }
</style>
