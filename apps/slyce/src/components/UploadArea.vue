<script setup>
    import { ref } from 'vue';

    import { useAppStore } from '../stores/appStore';
    const app = useAppStore()  // Pinia store

    const fileInput = ref(null);
    // Add a method to handle the file selection
    const handleFileChange = () => {
        const files = fileInput.value.files;
        if (files && files.length > 0) {
            app.set('file', files[0])
            app.set('fileURL', URL.createObjectURL(files[0]))
            app.set('currentTab', '1')
        }
    };
</script>

<template>
    <div class="upload-area">
        <h3 class="flex items-center gap-2 text-xl"><img
                src="/video-upload.svg"
                alt="Upload Video"
            ><span>Upload Video</span></h3>
        <span class="drag-drop-hint">Drag/Drop anywhere</span>
        <span class="drag-drop-hint">or</span>
        <button
            @click=" fileInput.click()"
            class="browse-button"
            id="browse-button"
        >Browse...</button>
        <input
            ref="fileInput"
            type="file"
            id="file-input"
            style="display: none;"
            accept="video/*"
            @change="handleFileChange"
        >
        <div id="file-info">
        </div>
    </div>
</template>

<style scoped>
    .upload-area {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        align-items: center;
        justify-content: center;
        min-height: 200px;
        border: 3px dashed #999;
        background: #f6f6f6;
        margin: 1rem;
        padding: 1.5rem;
        border-radius: 0.375rem;
        transition: border-color 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease;
    }

    @media (min-width: 640px) {
        .upload-area {
            flex-direction: row;
            gap: 1rem;
            min-height: 350px;
            margin: 2rem;
            padding: 1rem;
        }
    }

    @media (min-width: 1024px) {
        .upload-area {
            min-height: 450px;
            margin: 3rem;
        }
    }

    #browse-button {
        cursor: pointer;
    }

    .browse-button {
        background-color: #4a4a4a;
        color: white;
        padding: 0.75rem 1.5rem;
        border: none;
        border-radius: 0;
        font-size: 1rem;
        font-weight: 500;
        transition: background-color 0.2s;
        min-height: 44px;
    }

    @media (min-width: 640px) {
        .browse-button {
            padding: 0.5rem 1rem;
            font-size: 0.9rem;
        }
    }

    .browse-button:hover {
        background-color: #1a1a1a;
    }

    .drag-drop-hint {
        display: none;
    }

    @media (min-width: 640px) {
        .drag-drop-hint {
            display: inline;
        }
    }
</style>