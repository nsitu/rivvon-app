<script setup>
    import { ref, watch, computed } from 'vue';
    import { inferContours, preloadModel } from '../../modules/viewer/contourInference.js';

    const props = defineProps({
        active: {
            type: Boolean,
            default: false
        }
    });

    const emit = defineEmits(['contour-complete']);

    // State
    const status = ref('idle'); // 'idle' | 'loading' | 'processing' | 'done' | 'error'
    const statusMessage = ref('');
    const previewSrc = ref(null);
    const previewCanvas = ref(null);
    const fileInputRef = ref(null);
    const videoRef = ref(null);
    const cameraStream = ref(null);
    const cameraFacing = ref('environment');
    const showCamera = ref(false);
    const pendingPaths = ref([]);
    const pendingSource = ref(null);
    const modelLoading = ref(false);

    // Clean up camera stream and preload model when panel opens/closes
    watch(() => props.active, (active) => {
        if (active) {
            // Preload model when panel opens
            modelLoading.value = true;
            preloadModel()
                .catch(err => console.error('[ContourPanel] Model preload failed:', err))
                .finally(() => {
                    modelLoading.value = false;
                });
        } else {
            stopCamera();
            resetPendingResult();
            previewSrc.value = null;
            setStatus('idle', '');
        }
    });

    function setStatus(s, msg = '') {
        status.value = s;
        statusMessage.value = msg;
    }

    function resetPendingResult() {
        pendingPaths.value = [];
        pendingSource.value = null;
    }

    // -------------------------------------------------------------------------
    // File upload
    // -------------------------------------------------------------------------

    function openFilePicker() {
        fileInputRef.value?.click();
    }

    async function handleFileChange(event) {
        const file = event.target.files?.[0];
        if (!file) return;

        // Reset input so the same file can be re-selected
        event.target.value = '';

        const url = URL.createObjectURL(file);
        await processImageUrl(url);
        URL.revokeObjectURL(url);
    }

    // -------------------------------------------------------------------------
    // Camera capture
    // -------------------------------------------------------------------------

    async function openCamera() {
        setStatus('loading', 'Starting camera…');
        showCamera.value = true;

        try {
            const constraints = {
                video: { facingMode: cameraFacing.value, width: { ideal: 640 }, height: { ideal: 480 } }
            };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            cameraStream.value = stream;

            if (videoRef.value) {
                videoRef.value.srcObject = stream;
                await videoRef.value.play();
            }

            setStatus('idle', '');
        } catch (err) {
            console.error('[ContourPanel] Camera error:', err);
            setStatus('error', `Camera unavailable: ${err.message}`);
            showCamera.value = false;
        }
    }

    function stopCamera() {
        if (cameraStream.value) {
            cameraStream.value.getTracks().forEach(t => t.stop());
            cameraStream.value = null;
        }

        if (videoRef.value) {
            videoRef.value.srcObject = null;
        }

        showCamera.value = false;
    }

    async function switchCamera() {
        stopCamera();
        cameraFacing.value = cameraFacing.value === 'environment' ? 'user' : 'environment';
        await openCamera();
    }

    async function captureFromCamera() {
        if (!videoRef.value || !cameraStream.value) return;

        const video = videoRef.value;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        stopCamera();

        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        await processImageUrl(dataUrl);
    }

    // -------------------------------------------------------------------------
    // Core inference pipeline
    // -------------------------------------------------------------------------

    async function processImageUrl(url) {
        setStatus('loading', 'Loading image…');
        resetPendingResult();
        previewSrc.value = url;

        try {
            const imageData = await loadImageData(url);
            drawPreviewFrame(imageData);
            setStatus('processing', 'Running contour extraction…');

            const { paths, maskWidth, maskHeight } = await inferContours(imageData, {
                maskThreshold: 160,
                minContourPoints: 12,
                simplifyTolerance: 0.35,
            });

            if (paths.length === 0) {
                setStatus('error', 'No foreground contours found. Try a different image.');
                return;
            }

            drawPreviewOverlay(imageData, paths);

            setStatus('done', `Found ${paths.length} contour path${paths.length === 1 ? '' : 's'}.`);
            pendingPaths.value = paths;
            pendingSource.value = {
                pathCount: paths.length,
                pointCount: paths.reduce((n, p) => n + p.length, 0),
                maskWidth,
                maskHeight,
            };
        } catch (err) {
            console.error('[ContourPanel] Inference error:', err);
            setStatus('error', `Processing failed: ${err.message}`);
        }
    }

    function applyContour() {
        if (!pendingPaths.value.length) return;
        emit('contour-complete', {
            points: pendingPaths.value,
            source: pendingSource.value,
        });
    }

    function drawPreviewFrame(imageData) {
        const canvas = previewCanvas.value;
        if (!canvas) return;

        const cw = imageData.width;
        const ch = imageData.height;
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const tmp = document.createElement('canvas');
        tmp.width = cw;
        tmp.height = ch;
        tmp.getContext('2d').putImageData(imageData, 0, 0);
        ctx.drawImage(tmp, 0, 0);
    }

    /**
     * Load an image URL as ImageData (RGBA) via OffscreenCanvas or regular Canvas.
     */
    function loadImageData(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const MAX = 960;
                let w = img.naturalWidth;
                let h = img.naturalHeight;

                if (w > MAX || h > MAX) {
                    const scale = MAX / Math.max(w, h);
                    w = Math.round(w * scale);
                    h = Math.round(h * scale);
                }

                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                resolve(ctx.getImageData(0, 0, w, h));
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = url;
        });
    }

    /**
     * Draw the contour paths as an overlay on the preview canvas.
     * paths are in normalised drawing coords ([-1, 1]); we remap back to canvas space.
     */
    function drawPreviewOverlay(imageData, paths) {
        const canvas = previewCanvas.value;
        if (!canvas) return;

        const cw = imageData.width;
        const ch = imageData.height;
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');

        // Draw source image
        const tmp = document.createElement('canvas');
        tmp.width = cw;
        tmp.height = ch;
        tmp.getContext('2d').putImageData(imageData, 0, 0);
        ctx.drawImage(tmp, 0, 0);

        // Overlay contours — remap normalised coords to canvas pixels.
        // Must mirror inferContours normalisation, which uses source aspect.
        const aspect = (ch > 0) ? (cw / ch) : 1;

        function normToCanvas(nx, ny) {
            const px = ((nx / (aspect >= 1 ? 1 : aspect) + 1) / 2) * cw;
            const py = ((-ny / (aspect >= 1 ? 1 / aspect : 1) + 1) / 2) * ch;
            return { px, py };
        }

        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 2.75;

        for (const path of paths) {
            if (path.length < 2) continue;
            ctx.beginPath();
            const start = normToCanvas(path[0].x, path[0].y);
            ctx.moveTo(start.px, start.py);

            for (let i = 1; i < path.length; i++) {
                const { px, py } = normToCanvas(path[i].x, path[i].y);
                ctx.lineTo(px, py);
            }

            ctx.stroke();
        }
    }

    const isProcessing = computed(() => status.value === 'loading' || status.value === 'processing');
    const hasPendingContour = computed(() => pendingPaths.value.length > 0);
    const isInitializing = computed(() => modelLoading.value);
</script>

<template>
    <div
        class="contour-panel"
        :class="{ active }"
    >
        <div class="contour-container">
            <div class="contour-scroll">
                <!-- Camera live feed -->
                <div
                    v-if="showCamera"
                    class="camera-area"
                >
                    <video
                        ref="videoRef"
                        class="camera-video"
                        autoplay
                        playsinline
                        muted
                    />
                    <div class="camera-controls">
                        <button
                            class="cam-btn"
                            :disabled="isProcessing"
                            @click="captureFromCamera"
                        >
                            <span class="material-symbols-outlined">camera</span>
                            Capture
                        </button>
                        <button
                            class="cam-btn"
                            @click="switchCamera"
                        >
                            <span class="material-symbols-outlined">flip_camera_android</span>
                            Flip
                        </button>
                        <button
                            class="cam-btn"
                            @click="stopCamera"
                        >
                            <span class="material-symbols-outlined">close</span>
                            Cancel
                        </button>
                    </div>
                </div>

                <!-- Main content -->
                <div
                    v-else
                    class="contour-content"
                >
                    <div class="contour-header">
                        <p class="contour-hint">
                            Extract contour lines from the foreground of a photo.
                        </p>
                    </div>

                    <!-- Model loading indicator -->
                    <div
                        v-if="isInitializing"
                        class="status-message"
                    >
                        <span class="material-symbols-outlined spin">progress_activity</span>
                        Loading model…
                    </div>

                    <!-- Action buttons -->
                    <div class="action-row">
                        <button
                            class="action-btn"
                            :disabled="isProcessing || isInitializing"
                            @click="openFilePicker"
                        >
                            <span class="material-symbols-outlined">upload_file</span>
                            Upload Image
                        </button>
                        <button
                            class="action-btn"
                            :disabled="isProcessing || isInitializing"
                            @click="openCamera"
                        >
                            <span class="material-symbols-outlined">photo_camera</span>
                            Use Camera
                        </button>
                    </div>

                    <!-- Status message -->
                    <div
                        v-if="statusMessage"
                        class="status-message"
                        :class="{ 'status-error': status === 'error', 'status-done': status === 'done' }"
                    >
                        <span
                            v-if="isProcessing"
                            class="material-symbols-outlined spin"
                        >progress_activity</span>
                        {{ statusMessage }}
                    </div>

                    <!-- Preview -->
                    <div
                        v-if="previewSrc"
                        class="preview-area"
                    >
                        <canvas
                            ref="previewCanvas"
                            class="preview-canvas"
                        />
                    </div>
                </div>
            </div>

            <div
                v-if="!showCamera && hasPendingContour"
                class="contour-footer"
            >
                <div class="confirm-row">
                    <button
                        class="apply-btn"
                        :disabled="isProcessing"
                        @click="applyContour"
                    >
                        <span class="material-symbols-outlined">check</span>
                        Apply
                    </button>
                </div>
            </div>
        </div>

        <!-- Hidden file input -->
        <input
            ref="fileInputRef"
            type="file"
            accept="image/*"
            style="display: none"
            @change="handleFileChange"
        />
    </div>
</template>

<style scoped>
    .contour-panel {
        --viewer-header-chrome-height: 5.5rem;
        --viewer-bottom-chrome-height: 6.4rem;
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 5;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease;
        display: flex;
        flex-direction: column;
    }

    .contour-panel.active {
        pointer-events: auto;
        opacity: 1;
    }

    .contour-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        background: #1a1a1a;
        padding-top: var(--viewer-header-chrome-height);
        padding-bottom: var(--viewer-bottom-chrome-height);
        overflow: hidden;
    }

    .contour-scroll {
        flex: 1;
        overflow-y: auto;
    }

    .contour-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 1.5rem 1rem;
        gap: 1.25rem;
        flex: 1;
    }

    .contour-header {
        text-align: center;
    }

    .contour-hint {
        color: #aaa;
        font-size: 0.9rem;
        margin: 0;
    }

    .action-row {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
        justify-content: center;
    }

    .action-btn {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.6rem 1.1rem;
        background: #2a2a2a;
        border: 1px solid #444;
        border-radius: 8px;
        color: #e0e0e0;
        font-size: 0.875rem;
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease;
    }

    .action-btn:hover:not(:disabled) {
        background: #3a3a3a;
        border-color: #666;
    }

    .action-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .action-btn .material-symbols-outlined {
        font-size: 1.2rem;
    }

    .status-message {
        color: #aaa;
        font-size: 0.875rem;
        display: flex;
        align-items: center;
        gap: 0.4rem;
    }

    .status-error {
        color: #f88;
    }

    .status-done {
        color: #88f8a0;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .spin {
        animation: spin 1s linear infinite;
        display: inline-block;
    }

    .preview-area {
        max-width: 640px;
        max-height: 50vh;
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid #333;
        display: flex;
        justify-content: center;
        align-items: center;
    }

    .preview-canvas {
        display: block;
        height: auto;
        max-height: 50vh;
        object-fit: contain;
    }

    .confirm-row {
        display: flex;
        justify-content: center;
        width: 100%;
    }

    .contour-footer {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        border-top: 1px solid #374151;
        padding: 1rem 1.25rem;
        background: rgba(0, 0, 0, 0.6);
    }

    .apply-btn {
        box-sizing: border-box;
        width: 100%;
        height: auto;
        padding: 0.75rem 1.5rem;
        border: none;
        border-radius: 0.375rem;
        background: rgba(34, 197, 94, 1);
        color: #ffffff;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        opacity: 0.92;
        transition: opacity 0.3s ease;
    }

    .apply-btn:hover:not(:disabled) {
        opacity: 1;
    }

    .apply-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    /* Camera */
    .camera-area {
        display: flex;
        flex-direction: column;
        align-items: center;
        flex: 1;
        padding-top: 1rem;
        gap: 0.75rem;
    }

    .camera-video {
        width: 100%;
        max-width: 640px;
        border-radius: 8px;
        background: #000;
    }

    .camera-controls {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
        justify-content: center;
    }

    .cam-btn {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.6rem 1rem;
        background: #2a2a2a;
        border: 1px solid #444;
        border-radius: 8px;
        color: #e0e0e0;
        font-size: 0.875rem;
        cursor: pointer;
        transition: background 0.15s ease;
    }

    .cam-btn:hover:not(:disabled) {
        background: #3a3a3a;
    }

    .cam-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .cam-btn .material-symbols-outlined {
        font-size: 1.2rem;
    }
</style>
