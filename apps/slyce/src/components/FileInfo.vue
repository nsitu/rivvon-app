<script setup>

    // This component embeds a preview of the uploaded video file
    // it also displays metadata about the video 
    // It assumes that the relevant data has been added to the store
    // app.fileURL  a blob URL for the uploaded video file
    // app.fileInfo  an object with metadata about the video file

    import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
    import { useAppStore } from '../stores/appStore';
    const app = useAppStore()  // Pinia store  

    import { useNiceFormat } from '../composables/useNiceFormat';
    const { niceCodec, niceDuration, niceFrameRate, niceBitRate } = useNiceFormat();

    import VideoPlayer from './VideoPlayer.vue';
    import VideoControls from './VideoControls.vue';
    import CropOverlay from './CropOverlay.vue';

    const videoPlayerRef = ref(null);
    const videoWithCropRef = ref(null);
    const videoDimensions = ref({ displayWidth: 0, displayHeight: 0 });

    // Update dimensions when video loads or resizes
    let resizeObserver = null;

    const updateDimensions = () => {
        if (videoPlayerRef.value) {
            const dims = videoPlayerRef.value.getVideoDimensions();
            videoDimensions.value = dims;
        }
    };

    // Called when VideoPlayer emits 'ready' event
    const onVideoReady = () => {
        nextTick(() => {
            updateDimensions();
            // Set up resize observer on the container element for more reliable resize detection
            // This catches flex-induced resizes better than observing the video directly
            if (videoWithCropRef.value && !resizeObserver) {
                resizeObserver = new ResizeObserver(updateDimensions);
                resizeObserver.observe(videoWithCropRef.value);
            }
        });
    };

    // Also listen for window resize as a fallback
    const onWindowResize = () => {
        updateDimensions();
    };

    onMounted(() => {
        window.addEventListener('resize', onWindowResize);
    });

    onUnmounted(() => {
        window.removeEventListener('resize', onWindowResize);
        if (resizeObserver) {
            resizeObserver.disconnect();
        }
    });

</script>

<template>
    <div
        class="flex flex-col items-start"
        v-if="app?.fileInfo?.name"
    >
        <div
            ref="videoWithCropRef"
            class="video-with-crop"
        >
            <VideoPlayer
                ref="videoPlayerRef"
                v-if="app.fileURL"
                :url="app.fileURL"
                :hasControls="false"
                @ready="onVideoReady"
            ></VideoPlayer>

            <!-- Crop overlay positioned over video -->
            <CropOverlay
                v-if="app.cropMode && videoDimensions.displayWidth > 0"
                :containerWidth="videoDimensions.displayWidth"
                :containerHeight="videoDimensions.displayHeight"
            />
        </div>

        <!-- Custom controls always shown -->
        <VideoControls
            v-if="app.fileURL"
            :videoRef="videoPlayerRef"
        />

        <table>
            <tbody>
                <tr>
                    <td class="file-info-label whitespace-pre">File Name <span class="material-symbols-outlined">
                            video_file
                        </span></td>
                    <td class="file-info-value file-name-value">{{ app.fileInfo?.name }}</td>
                </tr>

                <tr>
                    <td class="file-info-label whitespace-pre">Codec <span class="material-symbols-outlined">
                            frame_source
                        </span></td>
                    <td class="file-info-value whitespace-pre">{{ niceCodec(app.fileInfo?.codec_string) }}</td>
                </tr>
                <tr>
                    <td class="file-info-label whitespace-pre">Codec String <span class="material-symbols-outlined">
                            barcode
                        </span></td>
                    <td class="file-info-value whitespace-pre">{{ app.fileInfo?.codec_string }}</td>
                </tr>
                <tr>
                    <td class="file-info-label whitespace-pre">Duration <span class="material-symbols-outlined">
                            timer
                        </span></td>
                    <td class="file-info-value whitespace-pre">{{ niceDuration(app.fileInfo?.duration) }}</td>
                </tr>
                <tr>
                    <td class="file-info-label whitespace-pre">Frame Rate <span class="material-symbols-outlined">
                            speed
                        </span></td>
                    <td class="file-info-value whitespace-pre">{{ niceFrameRate(app.fileInfo?.r_frame_rate) }}</td>
                </tr>
                <tr>
                    <td class="file-info-label whitespace-pre">Frame Count <span class="material-symbols-outlined">
                            calculate
                        </span></td>
                    <td class="file-info-value whitespace-pre">{{ app.fileInfo?.nb_frames }}</td>
                </tr>
                <tr>
                    <td class="file-info-label whitespace-pre">Resolution <span class="material-symbols-outlined">
                            view_compact
                        </span></td>
                    <td class="file-info-value whitespace-pre"><span class="whitespace-pre">{{ app.fileInfo?.width }} x
                            {{
                                app.fileInfo?.height }} pixels(w x h)</span>
                    </td>
                </tr>
                <tr>
                    <td class="file-info-label whitespace-pre"> Rotation <span class="material-symbols-outlined">
                            rotate_right
                        </span></td>
                    <td class="file-info-value whitespace-pre"> {{ app.fileInfo?.rotation }} degrees </td>
                </tr>
                <tr>
                    <td class="file-info-label whitespace-pre"> Bit Rate <span class="material-symbols-outlined">
                            equalizer
                        </span></td>
                    <td class="file-info-value whitespace-pre">{{ niceBitRate(app.fileInfo?.bit_rate) }}</td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
<style scoped>

    .video-with-crop {
        position: relative;
        display: inline-block;
    }

    #file-info table {
        background-color: #eee;
    }

    #file-info tr {
        border-bottom: 1px solid #fff;
    }


    .file-info-label {
        display: flex;
        align-items: center;
        justify-content: end;
        gap: 0.5rem;
        padding: 0 0 0 0.5rem;
    }

    .file-info-value {
        text-align: left;
        padding-left: 0rem;
        padding: 0 0.5rem;
    }

    .file-name-value {
        word-break: break-all;
    }
</style>