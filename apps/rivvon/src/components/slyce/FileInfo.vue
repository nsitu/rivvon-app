<script setup>

    // This component embeds a preview of the uploaded video file
    // it also displays metadata about the video 
    // It assumes that the relevant data has been added to the store
    // app.fileURL  a blob URL for the uploaded video file
    // app.fileInfo  an object with metadata about the video file

    import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
    import { useSlyceStore } from '../../stores/slyceStore';
    const app = useSlyceStore()  // Pinia store  

    import { useNiceFormat } from '../../composables/slyce/useNiceFormat';
    const { niceCodec, niceDuration, niceFrameRate, niceBitRate } = useNiceFormat();

    import VideoPlayer from './VideoPlayer.vue';
    import VideoControls from './VideoControls.vue';
    import CropOverlay from './CropOverlay.vue';

    import Accordion from 'primevue/accordion';
    import AccordionPanel from 'primevue/accordionpanel';
    import AccordionHeader from 'primevue/accordionheader';
    import AccordionContent from 'primevue/accordioncontent';

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
        class="file-info-container"
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

        <Accordion class="file-info-accordion">
            <AccordionPanel value="0">
                <AccordionHeader>
                    <span class="accordion-header-text">
                        <span class="material-symbols-outlined">info</span>
                        Video Details
                    </span>
                </AccordionHeader>
                <AccordionContent>
                    <table class="file-info-table">
                        <tbody>
                            <tr>
                                <td class="file-info-label">File Name <span class="material-symbols-outlined">
                                        video_file
                                    </span></td>
                                <td class="file-info-value file-name-value">{{ app.fileInfo?.name }}</td>
                            </tr>

                            <tr>
                                <td class="file-info-label">Codec <span class="material-symbols-outlined">
                                        frame_source
                                    </span></td>
                                <td class="file-info-value">{{ niceCodec(app.fileInfo?.codec_string) }}</td>
                            </tr>
                            <tr class="hide-mobile">
                                <td class="file-info-label">Codec String <span class="material-symbols-outlined">
                                        barcode
                                    </span></td>
                                <td class="file-info-value">{{ app.fileInfo?.codec_string }}</td>
                            </tr>
                            <tr>
                                <td class="file-info-label">Duration <span class="material-symbols-outlined">
                                        timer
                                    </span></td>
                                <td class="file-info-value">{{ niceDuration(app.fileInfo?.duration) }}</td>
                            </tr>
                            <tr>
                                <td class="file-info-label">Frame Rate <span class="material-symbols-outlined">
                                        speed
                                    </span></td>
                                <td class="file-info-value">{{ niceFrameRate(app.fileInfo?.r_frame_rate) }}</td>
                            </tr>
                            <tr>
                                <td class="file-info-label">Frame Count <span class="material-symbols-outlined">
                                        calculate
                                    </span></td>
                                <td class="file-info-value">{{ app.fileInfo?.nb_frames }}</td>
                            </tr>
                            <tr>
                                <td class="file-info-label">Resolution <span class="material-symbols-outlined">
                                        view_compact
                                    </span></td>
                                <td class="file-info-value"><span>{{ app.fileInfo?.width }} x
                                        {{
                                            app.fileInfo?.height }} px</span>
                                </td>
                            </tr>
                            <tr>
                                <td class="file-info-label">Rotation <span class="material-symbols-outlined">
                                        rotate_right
                                    </span></td>
                                <td class="file-info-value"> {{ app.fileInfo?.rotation }}° </td>
                            </tr>
                            <tr class="hide-mobile">
                                <td class="file-info-label">Bit Rate <span class="material-symbols-outlined">
                                        equalizer
                                    </span></td>
                                <td class="file-info-value">{{ niceBitRate(app.fileInfo?.bit_rate) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </AccordionContent>
            </AccordionPanel>
        </Accordion>
    </div>
</template>
<style scoped>
    .file-info-container {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        width: 100%;
        min-width: 0;
        overflow: hidden;
    }

    .video-with-crop {
        position: relative;
        display: flex;
        justify-content: center;
        width: 100%;
        max-width: 100%;
    }

    .file-info-accordion {
        width: 100%;
        margin-top: 0.5rem;
    }

    .accordion-header-text {
        display: flex;
        align-items: center;
        white-space: pre;
        gap: 0.5rem;
        font-weight: 600;
        font-size: 0.875rem;
    }

    .accordion-header-text .material-symbols-outlined {
        font-size: 1.25rem;
    }

    .file-info-table {
        width: 100%;
        font-size: 0.75rem;
        table-layout: fixed;
    }

    @media (min-width: 640px) {
        .file-info-table {
            font-size: 0.8rem;
        }
    }

    @media (min-width: 1280px) {
        .file-info-table {
            font-size: 0.875rem;
        }
    }

    #file-info table {
        background-color: var(--bg-muted);
    }

    #file-info tr {
        border-bottom: 1px solid var(--bg-card);
    }

    /* Responsive table - stacked on mobile */
    @media (max-width: 639px) {

        /* .file-info-table tbody,
        .file-info-table tr,
        .file-info-table td {
            display: block;
            width: 100%;
        } */

        .file-info-table tr {
            margin-bottom: 0.5rem;
            padding-bottom: 0.5rem;
            border-bottom: 1px solid var(--border-muted);
        }

        .file-info-label {
            font-weight: 600;
            margin-bottom: 0.25rem;
            padding: 0 !important;
        }

        .file-info-value {
            padding-left: 1.5rem !important;
        }

        .hide-mobile {
            display: none !important;
        }
    }

    @media (min-width: 640px) {
        .hide-mobile {
            display: table-row;
        }
    }

    .file-info-label {
        display: flex;
        align-items: center;
        justify-content: end;
        gap: 0.5rem;
        padding: 0.25rem 0.5rem 0.25rem 0.5rem;
        white-space: nowrap;
    }

    .file-info-value {
        text-align: left;
        padding: 0.25rem 0.5rem;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
    }

    .file-name-value {
        word-break: break-all;
        white-space: normal;
    }
</style>