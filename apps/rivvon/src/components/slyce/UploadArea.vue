<script setup>
    import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue';
    import Button from 'primevue/button';
    import Card from 'primevue/card';
    import ProgressBar from 'primevue/progressbar';
    import Message from 'primevue/message';
    import { useGoogleAuth } from '../../composables/shared/useGoogleAuth.js';
    import { importGooglePhotosVideo, openGooglePhotosWindow } from '../../services/googlePhotos.js';

    import { useSlyceStore } from '../../stores/slyceStore';
    import { VIDEO_FILE_ACCEPT } from '../../modules/slyce/videoFile.js';
    const app = useSlyceStore()  // Pinia store

    const props = defineProps({
        photosLaunch: {
            type: Object,
            default: null,
        },
        photosOnly: {
            type: Boolean,
            default: false,
        },
        canResumeFileFlow: {
            type: Boolean,
            default: false,
        }
    });

    const emit = defineEmits(['request-next', 'request-resume-file-flow', 'photos-launch-consumed']);

    const fileInput = ref(null);
    const { isAuthenticated } = useGoogleAuth();
    const importingPhotos = ref(false);
    const photosStatus = ref('');
    const photosError = ref('');
    const photosProgress = ref(null);
    const photosLink = ref(null);
    const photosWaitingSince = ref(null);
    const photosClock = ref(Date.now());
    const photosWaitingSeconds = computed(() => photosWaitingSince.value === null ? null
        : Math.max(0, Math.floor((photosClock.value - photosWaitingSince.value) / 1000)));
    let importController = null;

    function cancelPhotosImport() {
        importController?.abort();
        photosWaitingSince.value = null;
        photosStatus.value = 'Import cancelled.';
    }
    onBeforeUnmount(cancelPhotosImport);
    watch(isAuthenticated, (signedIn) => { if (!signedIn) cancelPhotosImport(); });
    onMounted(() => {
        if (props.photosLaunch) {
            const popup = props.photosLaunch.popup;
            emit('photos-launch-consumed');
            importFromPhotos(popup);
        }
    });

    async function importFromPhotos(popup) {
        if (importingPhotos.value || !isAuthenticated.value) {
            try { popup?.close(); } catch { /* isolated window */ }
            return;
        }
        importingPhotos.value = true;
        photosError.value = '';
        photosProgress.value = null;
        photosWaitingSince.value = null;
        const clock = setInterval(() => { photosClock.value = Date.now(); }, 1000);
        const controller = new AbortController();
        importController = controller;
        // Open while the click still has browser user activation. A visible
        // fallback link supports blocked popups and COOP-isolated auth windows.
        try {
            if (popup === undefined) popup = openGooglePhotosWindow();
            const { file, provenance } = await importGooglePhotosVideo({
                signal: controller.signal, popup,
                onStatus: (value, details) => {
                    photosStatus.value = value;
                    photosClock.value = Date.now();
                    photosWaitingSince.value = ['metadata', 'requesting-video', 'waiting-data'].includes(details?.phase) ? photosClock.value : null;
                },
                onExternalLink: value => { photosLink.value = value; },
                onProgress: ({ received, total }) => {
                    photosProgress.value = total ? Math.min(100, Math.round(received / total * 100)) : null;
                    if (received > 0) {
                        photosWaitingSince.value = null;
                        photosStatus.value = `Downloading video… ${(received / (1024 * 1024)).toFixed(1)} MiB${total ? ` of ${(total / (1024 * 1024)).toFixed(1)} MiB` : ''}`;
                    }
                },
            });
            controller.signal.throwIfAborted();
            if (await app.beginFileWorkflowWithFile(file, provenance)) emit('request-next');
        } catch (error) {
            if (!controller.signal.aborted) photosError.value = error?.message || 'Unable to import this video.';
        } finally {
            clearInterval(clock);
            photosWaitingSince.value = null;
            importController = null;
            importingPhotos.value = false;
        }
    }

    function continuePhotosInWindow() {
        if (photosLink.value) openGooglePhotosWindow(photosLink.value.url);
    }

    function handleFileCardAction() {
        if (props.canResumeFileFlow) {
            emit('request-resume-file-flow');
            return;
        }

        fileInput.value?.click();
    }

    // Add a method to handle the file selection
    const handleFileChange = async () => {
        const files = fileInput.value.files;
        if (files && files.length > 0) {
            const nextFile = files[0];

            if (await app.beginFileWorkflowWithFile(nextFile)) {
                emit('request-next');
            }
        }
    };
</script>

<template>
    <section class="upload-area">

        <div class="source-grid">
            <Card v-if="!photosOnly" class="source-card source-card-file">
                <template #title>
                    <h4 class="flex items-center gap-2 source-card-header">
                        <span class="material-symbols-outlined source-icon">movie</span>
                        <span class="source-card-title">Video File</span>
                    </h4>
                </template>
                <template #content>
                    <span class="source-card-detail">
                        Upload a video, fine-tune settings, then process and save.
                    </span>
                </template>
                <template #footer>
                    <div class="source-actions">
                        <Button
                            type="button"
                            @click="handleFileCardAction"
                            :disabled="importingPhotos"
                            :label="canResumeFileFlow ? 'Continue Video File' : 'Browse Video'"
                        />
                        <Button
                            v-if="canResumeFileFlow"
                            type="button"
                            severity="secondary"
                            @click="fileInput.click()"
                            label="Choose Different Video"
                            :disabled="importingPhotos"
                        />
                    </div>
                </template>
            </Card>

            <Card v-if="isAuthenticated" class="source-card">
                <template #title><h4 class="source-card-title">Google Photos</h4></template>
                <template #content>
                    <span class="source-card-detail">
                        Choose one video from Google Photos, up to 2048 MiB. Rivvon downloads a high-quality copy
                        for processing and saves its source details with your textures. Publishing is a separate action.
                    </span>
                </template>
                <template #footer>
                    <div class="source-actions">
                        <Button v-if="!importingPhotos" :label="photosError ? 'Try Again' : 'Import from Google Photos'" @click="importFromPhotos()" />
                        <Button v-if="photosOnly && canResumeFileFlow" label="Continue Current Video" severity="secondary" :disabled="importingPhotos" @click="emit('request-resume-file-flow')" />
                        <Button v-if="importingPhotos" label="Cancel Import" severity="secondary" @click="cancelPhotosImport" />
                        <Button v-if="photosLink" as="a" :href="photosLink.url" target="_blank" rel="noopener noreferrer" :label="photosLink.label" severity="secondary" @click.prevent="continuePhotosInWindow" />
                    </div>
                    <p v-if="photosStatus" role="status" aria-live="polite" class="source-card-detail">{{ photosStatus }}</p>
                    <p v-if="importingPhotos && photosWaitingSeconds !== null" class="source-card-detail">{{ photosWaitingSeconds }}s elapsed in this step</p>
                    <ProgressBar v-if="importingPhotos" :mode="photosProgress === null ? 'indeterminate' : 'determinate'" :value="photosProgress" aria-label="Google Photos import progress" />
                    <Message v-if="photosError" severity="error" :closable="false">{{ photosError }}</Message>
                </template>
            </Card>

            <Message v-if="photosOnly && !isAuthenticated" severity="info" :closable="false">Sign in to Rivvon to import from Google Photos.</Message>

        </div>

        <p class="source-drop-hint">Drag and drop a video anywhere on this screen to jump straight into the file
            workflow.</p>


        <input
            ref="fileInput"
            type="file"
            id="file-input"
            style="display: none;"
            :accept="VIDEO_FILE_ACCEPT"
            @change="handleFileChange"
        >
    </section>
</template>

<style scoped>
    .upload-area {
        display: flex;
        flex-direction: column;
        gap: 2rem;
        max-width: 450px;
        margin: 0 auto;
        padding: 1rem 0 2rem;
    }

    @media (min-width: 640px) {
        .upload-area {
            padding-top: 2rem;
        }
    }

    .source-copy {
        max-width: 680px;
    }

    .source-kicker {
        margin: 0 0 0.5rem;
        font-size: 0.82rem;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba(120, 170, 255, 0.9);
    }

    .source-title {
        margin: 0;
        color: #f5f7fb;
        font-size: clamp(2rem, 4vw, 3rem);
        line-height: 1.05;
    }

    .source-description {
        margin: 1rem 0 0;
        max-width: 52rem;
        color: rgba(232, 238, 248, 0.76);
        font-size: 1rem;
        line-height: 1.65;
    }

    .source-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 1rem;
    }

    .source-card {
        text-align: left;
    }

    .source-card :deep(.p-card-body) {
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .source-card :deep(.p-card-caption) {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .source-card :deep(.p-card-title) {
        margin: 0;
    }

    .source-card :deep(.p-card-content) {
        display: flex;
        flex: 1;
        padding: 0;
    }

    .source-card :deep(.p-card-footer) {
        padding: 0;
    }


    .source-icon {
        font-size: 2rem;
        color: var(--p-primary-color);
    }

    .source-card-title {
        font-size: 1.25rem;
        font-weight: 600;
    }

    .source-card-detail {
        color: var(--p-text-muted-color);
        font-size: 0.95rem;
        line-height: 1.55;
    }

    .source-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-top: auto;
    }

    .source-drop-hint {
        margin: 0;
        color: rgba(232, 238, 248, 0.52);
        font-size: 0.88rem;
    }

    @media (pointer: coarse) {
        .source-drop-hint {
            display: none;
        }
    }

    @media (max-width: 720px) {
        .source-grid {
            grid-template-columns: 1fr;
        }
    }
</style>
