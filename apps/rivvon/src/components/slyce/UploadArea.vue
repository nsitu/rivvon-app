<script setup>
    import { ref } from 'vue';

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
        <div class="source-copy">
            <h2 class="source-title">Choose a video source.</h2>
            <p class="source-description">
                Start from a video file for full control, or sample from your camera for a realtime flow.
            </p>
        </div>

        <div class="source-grid">
            <div class="source-card source-card-file">
                <span class="material-symbols-outlined source-icon">movie</span>
                <span class="source-card-title">Video File</span>
                <span class="source-card-detail">
                    Upload a video, fine-tune settings, then process and save.
                </span>
                <div class="source-actions">
                    <button
                        class="source-primary-btn"
                        @click="handleFileCardAction"
                    >
                        {{ canResumeFileFlow ? 'Continue Video File' : 'Browse Video' }}
                    </button>
                    <button
                        v-if="canResumeFileFlow"
                        class="source-secondary-btn"
                        @click="fileInput.click()"
                    >
                        Choose Different Video
                    </button>
                </div>
            </div>

            <button
                class="source-card source-card-camera"
                @click="emit('choose-camera')"
            >
                <span class="material-symbols-outlined source-icon">camera_video</span>
                <span class="source-card-title">Camera</span>
                <span class="source-card-detail">
                    Capture from the camera, sample live, and save the result.
                </span>
                <span class="camera-cta">Open Camera</span>
            </button>
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
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.85rem;
        min-height: 16rem;
        padding: 1.5rem;
        border-radius: 1.4rem;
        border: 1px solid rgba(129, 140, 248, 0.18);
        background:
            radial-gradient(circle at top right, rgba(96, 165, 250, 0.16), transparent 40%),
            linear-gradient(160deg, rgba(19, 25, 39, 0.98), rgba(12, 18, 30, 0.98));
        color: #f8fbff;
        text-align: left;
        transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
    }

    .source-card-camera {
        cursor: pointer;
        border: 1px solid rgba(129, 140, 248, 0.18);
    }

    .source-card:hover {
        transform: translateY(-2px);
        border-color: rgba(96, 165, 250, 0.45);
        box-shadow: 0 18px 36px rgba(0, 0, 0, 0.26);
    }

    .source-icon {
        font-size: 2rem;
        color: #8ec5ff;
    }

    .source-card-title {
        font-size: 1.25rem;
        font-weight: 600;
    }

    .source-card-detail {
        color: rgba(232, 238, 248, 0.78);
        font-size: 0.95rem;
        line-height: 1.55;
    }

    .source-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-top: auto;
    }

    .source-primary-btn,
    .source-secondary-btn {
        min-height: 44px;
        border-radius: 999px;
        border: 1px solid transparent;
        padding: 0.7rem 1rem;
        font-size: 0.92rem;
        cursor: pointer;
        transition: background-color 0.2s ease, border-color 0.2s ease;
    }

    .source-primary-btn {
        background: #2563eb;
        color: #fff;
    }

    .source-primary-btn:hover {
        background: #1d4ed8;
    }

    .source-secondary-btn {
        background: rgba(255, 255, 255, 0.06);
        color: #f8fbff;
        border-color: rgba(255, 255, 255, 0.14);
    }

    .source-secondary-btn:hover {
        background: rgba(255, 255, 255, 0.12);
    }

    .camera-cta {
        margin-top: auto;
        font-size: 0.92rem;
        font-weight: 600;
        color: #8ec5ff;
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