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
    <div class="upload-area flex gap-4 items-center justify-center w-auto border-2 border-gray-300 rounded-md p-4">
        <h3 class="flex items-center gap-2 text-xl"><img
                src="/video-upload.svg"
                alt="Upload Video"
            ><span>Upload Video</span></h3>
        <span>Drag/Drop anywhere</span>
        <span>or</span>
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
        min-height: 450px;
        border: 3px dashed #999;
        background: #f6f6f6;
        margin: 3rem;
        transition: border-color 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease;
    }

    #browse-button {
        cursor: pointer;
    }

    .browse-button {
        background-color: #4a4a4a;
        color: white;
        padding: 0.5rem 1rem;
        border: none;
        border-radius: 0;
        font-size: 0.9rem;
        font-weight: 500;
        transition: background-color 0.2s;
    }

    .browse-button:hover {
        background-color: #1a1a1a;
    }
</style>