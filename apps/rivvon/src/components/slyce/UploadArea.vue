<script setup>
    import { ref } from 'vue';
    import Button from 'primevue/button';
    import Card from 'primevue/card';

    import { useSlyceStore } from '../../stores/slyceStore';
    const app = useSlyceStore()  // Pinia store

    const props = defineProps({
        canResumeFileFlow: {
            type: Boolean,
            default: false,
        }
    });

    const emit = defineEmits(['next', 'resume-file-flow', 'choose-camera']);

    const fileInput = ref(null);

    function handleFileCardAction() {
        if (props.canResumeFileFlow) {
            emit('resume-file-flow');
            return;
        }

        fileInput.value?.click();
    }

    // Add a method to handle the file selection
    const handleFileChange = () => {
        const files = fileInput.value.files;
        if (files && files.length > 0) {
            app.set('file', files[0])
            app.set('fileURL', URL.createObjectURL(files[0]))
            emit('next');
        }
    };
</script>

<template>
    <section class="upload-area">

        <div class="source-grid">
            <Card class="source-card source-card-file">
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
                            :label="canResumeFileFlow ? 'Continue Video File' : 'Browse Video'"
                        />
                        <Button
                            v-if="canResumeFileFlow"
                            type="button"
                            severity="secondary"
                            @click="fileInput.click()"
                            label="Choose Different Video"
                        />
                    </div>
                </template>
            </Card>

            <Card class="source-card source-card-camera">
                <template #title>
                    <h4 class="flex items-center gap-2 source-card-header">
                        <span class="material-symbols-outlined source-icon">camera_video</span>
                        <span class="source-card-title">Camera</span>
                    </h4>
                </template>
                <template #content>
                    <span class="source-card-detail">
                        Capture from the camera, sample live, and save the result.
                    </span>
                </template>
                <template #footer>
                    <Button
                        type="button"
                        @click="emit('choose-camera')"
                        label="Open Camera"
                    />
                </template>
            </Card>

        </div>

        <p class="source-drop-hint">Drag and drop a video anywhere on this screen to jump straight into the file
            workflow.</p>

        <input
            ref="fileInput"
            type="file"
            id="file-input"
            style="display: none;"
            accept="video/*"
            @change="handleFileChange"
        >
    </section>
</template>

<style scoped>
    .upload-area {
        display: flex;
        flex-direction: column;
        gap: 2rem;
        max-width: 920px;
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
        grid-template-columns: repeat(2, minmax(0, 1fr));
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

    @media (max-width: 720px) {
        .source-grid {
            grid-template-columns: 1fr;
        }
    }
</style>