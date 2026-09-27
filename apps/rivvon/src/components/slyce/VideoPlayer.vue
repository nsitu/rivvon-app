<script setup>
    import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
    import { isTransportStreamFile } from '../../modules/slyce/videoFile.js';
    import { remuxTransportStreamToMp4 } from '../../modules/slyce/videoPreview.js';

    const props = defineProps({
        url: {
            type: String,
            required: true
        },
        sourceFile: {
            type: Object,
            default: null,
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
    const playbackUrl = ref(props.url);
    const isReady = ref(false);
    const currentTime = ref(0); // New reactive property
    const isPreparingPreview = ref(false);
    const previewError = ref(null);

    let previewUrl = null;
    let previewRequestId = 0;
    let hasAttemptedTransportStreamPreview = false;

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

    function revokePreviewUrl() {
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            previewUrl = null;
        }
    }

    async function handleVideoError() {
        if (
            !isTransportStreamFile(props.sourceFile)
            || hasAttemptedTransportStreamPreview
            || !videoElement.value
        ) {
            return;
        }

        hasAttemptedTransportStreamPreview = true;
        isPreparingPreview.value = true;
        previewError.value = null;
        const requestId = ++previewRequestId;

        try {
            const previewBlob = await remuxTransportStreamToMp4(props.sourceFile);
            if (requestId !== previewRequestId || !videoElement.value) {
                return;
            }

            revokePreviewUrl();
            previewUrl = URL.createObjectURL(previewBlob);
            playbackUrl.value = previewUrl;
        } catch (error) {
            if (requestId === previewRequestId) {
                previewError.value = error?.message || 'Unable to create a browser preview for this MTS file.';
                console.error('Unable to remux transport stream preview:', error);
            }
        } finally {
            if (requestId === previewRequestId) {
                isPreparingPreview.value = false;
            }
        }
    }

    function handleLoadedMetadata() {
        isReady.value = true;
        emit('ready');
        if (props.isPrimary) {
            emitPlaybackState();
            trackPlayback();
        }

        if (!timeUpdateInterval) {
            timeUpdateInterval = setInterval(() => {
                if (videoElement.value) {
                    currentTime.value = videoElement.value.currentTime;
                }
            }, 100);
        }
    }

    watch(
        () => [props.url, props.sourceFile],
        ([url]) => {
            previewRequestId += 1;
            revokePreviewUrl();
            playbackUrl.value = url;
            hasAttemptedTransportStreamPreview = false;
            isPreparingPreview.value = false;
            previewError.value = null;
            isReady.value = false;
            currentTime.value = 0;
        },
    );

    onMounted(() => {
        if (videoElement.value) {
            videoElement.value.addEventListener('loadedmetadata', handleLoadedMetadata);
            videoElement.value.addEventListener('error', handleVideoError);

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
        previewRequestId += 1;
        revokePreviewUrl();
        if (videoElement.value) {
            videoElement.value.removeEventListener('loadedmetadata', handleLoadedMetadata);
            videoElement.value.removeEventListener('error', handleVideoError);
        }
        if (videoElement.value && props.isPrimary) {
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
            if (isTransportStreamFile(props.sourceFile)) {
                await handleVideoError();
            } else {
                console.error('Error playing video:', error);
            }
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
            if (!el) {
                return {
                    displayWidth: 0,
                    displayHeight: 0,
                    videoWidth: 0,
                    videoHeight: 0,
                    left: 0,
                    top: 0
                };
            }

            // Use getBoundingClientRect for accurate screen dimensions
            // This correctly handles rotation metadata applied by the browser
            const rect = el.getBoundingClientRect();

            return {
                displayWidth: rect.width,
                displayHeight: rect.height,
                left: rect.left,
                top: rect.top,
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
            :src="playbackUrl"
            :controls="hasControls"
            :muted="isMuted"
            loop
            autoplay
        ></video>
        <p v-if="isPreparingPreview" class="video-preview-status" role="status">
            Preparing MTS preview…
        </p>
        <p v-else-if="previewError" class="video-preview-status video-preview-error" role="alert">
            {{ previewError }} Texture processing may still be available.
        </p>
        <!-- <p>{{ currentTimeDisplay }} seconds</p> -->
    </div>
</template>
<style scoped>
    video {
        max-width: 100%;
        max-height: var(--video-preview-max-height, 80vh);
        object-fit: contain;
        width: auto;
        height: auto;
        display: block;
    }

    .video-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        max-height: var(--video-preview-max-height, 80vh);
        width: 100%;
    }

    .video-preview-status {
        margin: 0.5rem 0;
        color: var(--p-text-muted-color);
        font-size: 0.82rem;
        text-align: center;
    }

    .video-preview-error {
        color: var(--p-red-400, #f87171);
    }
</style>
