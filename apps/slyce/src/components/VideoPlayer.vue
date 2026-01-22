<script setup>
    import { ref, watch, onMounted, onUnmounted, computed } from 'vue';

    const props = defineProps({
        url: {
            type: String,
            required: true
        },
        /* playbackTime allows the context to pass in 
        a synchronized time for multiple videos */
        playbackTime: {
            type: Number,
            default: null
        },
        isPlaying: {
            type: Boolean,
            default: false
        },
        isPrimary: {
            type: Boolean,
            default: false
        },
        hasControls: {
            type: Boolean,
            default: true
        },
        isMuted: {
            type: Boolean,
            default: true
        }
    });

    const emit = defineEmits(['playback-state-change', 'ready']);

    const videoElement = ref(null);
    const isReady = ref(false);
    const currentTime = ref(0); // New reactive property

    let animationFrame = null;

    // Computed property for current time display
    const currentTimeDisplay = computed(() => {
        return currentTime.value.toFixed(1);
    });


    // Emit playback state 
    // NOTE: this will only be used by the first/primary video
    function emitPlaybackState() {
        if (videoElement.value) {
            emit('playback-state-change', {
                currentTime: videoElement.value.currentTime,
                playing: !videoElement.value.paused
            });
        }
    }

    // Track playback using requestAnimationFrame for smoother updates
    function trackPlayback() {
        if (videoElement.value && !videoElement.value.paused) {
            emitPlaybackState();
        }
        animationFrame = requestAnimationFrame(trackPlayback);
    }

    let timeUpdateInterval = null;

    onMounted(() => {
        if (videoElement.value) {
            videoElement.value.addEventListener('loadedmetadata', () => {
                isReady.value = true;
                emit('ready');
                if (props.isPrimary) {
                    emitPlaybackState();
                    trackPlayback();
                }

                // Only create interval if not already running
                if (!timeUpdateInterval) {
                    timeUpdateInterval = setInterval(() => {
                        if (videoElement.value) {
                            currentTime.value = videoElement.value.currentTime;
                        }
                    }, 100);
                }
            });

            if (props.isPrimary) {
                videoElement.value.addEventListener('play', emitPlaybackState);
                videoElement.value.addEventListener('pause', emitPlaybackState);
            }
        }
    });

    onUnmounted(() => {
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
        }
        if (timeUpdateInterval) {
            clearInterval(timeUpdateInterval);
            timeUpdateInterval = null;
        }
        if (videoElement.value && props.isPrimary) {
            videoElement.value.removeEventListener('loadedmetadata', emitPlaybackState);
            videoElement.value.removeEventListener('play', emitPlaybackState);
            videoElement.value.removeEventListener('pause', emitPlaybackState);
        }
    });

    // Watch for global playback time changes
    watch(
        () => props.playbackTime,
        (newTime) => {
            if (isReady.value && videoElement.value) {
                const timeDifference = Math.abs(videoElement.value.currentTime - newTime);
                // Threshold to prevent minor adjustments
                if (timeDifference > 0.1) {
                    videoElement.value.currentTime = newTime;
                }
            }
        }
    );


    // Watcher for global play/pause commands
    watch(
        () => props.isPlaying,
        (playing) => {
            if (isReady.value && videoElement.value) {
                if (playing && videoElement.value.paused) {
                    handlePlay();
                } else if (!playing && !videoElement.value.paused) {
                    handlePause();
                }
            }
        }
    );

    // Function to handle play action with error handling
    const handlePlay = async () => {
        try {
            await videoElement.value.play();
        } catch (error) {
            console.error('Error playing video:', error);
        }
    };

    // Function to handle pause action
    const handlePause = () => {
        videoElement.value.pause();
    };

    // Expose video element and utility methods for external components
    defineExpose({
        videoElement,
        isReady,
        play: handlePlay,
        pause: handlePause,
        getVideoDimensions: () => {
            const el = videoElement.value;
            if (!el) return { displayWidth: 0, displayHeight: 0, videoWidth: 0, videoHeight: 0 };

            // Use getBoundingClientRect for accurate screen dimensions
            // This correctly handles rotation metadata applied by the browser
            const rect = el.getBoundingClientRect();

            return {
                displayWidth: rect.width,
                displayHeight: rect.height,
                videoWidth: el.videoWidth || 0,
                videoHeight: el.videoHeight || 0
            };
        },
        getCurrentTime: () => videoElement.value?.currentTime || 0,
        getDuration: () => videoElement.value?.duration || 0,
        seek: (time) => {
            if (videoElement.value) {
                videoElement.value.currentTime = time;
            }
        }
    });

</script>
<template>
    <div class="video-container">
        <video
            ref="videoElement"
            v-if="url"
            :src="url"
            :controls="hasControls"
            :muted="isMuted"
            loop
            autoplay
        ></video>
        <!-- <p>{{ currentTimeDisplay }} seconds</p> -->
    </div>
</template>
<style scoped>
    video {
        max-width: 100%;
    }

    .video-container {
        display: flex;
        flex-direction: column;
        align-items: center;
    }
</style>