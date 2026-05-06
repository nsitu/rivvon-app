<script setup>
    import { ref, watch, computed } from 'vue';
    import Button from 'primevue/button';
    import LoadingIndicator from '../shared/LoadingIndicator.vue';
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
            setStatus('loading', 'Loading model…');

            preloadModel({
                onStatus: ({ message }) => {
                    if (message) {
                        setStatus('loading', message);
                    }
                }
            })
                .then(() => {
                    setStatus('done', 'Model ready for use.');
                })
                .catch(err => {
                    console.error('[ContourPanel] Model preload failed:', err);
                    setStatus('error', `Model load failed: ${err?.message || 'Unknown error'}`);
                })
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
            setStatus('processing', 'Finding contours…');

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

            setStatus('done', `Found ${paths.length} contour${paths.length === 1 ? '' : 's'}.`);
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

    function formatSvgNumber(value) {
        return Number(value.toFixed(5));
    }

    function buildContourSvg(paths) {
        const pathMarkup = paths
            .filter(path => path.length > 1)
            .map(path => {
                const d = path
                    .map((point, index) => {
                        const x = formatSvgNumber(point.x);
                        const y = formatSvgNumber(-point.y);
                        return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
                    })
                    .join(' ');

                return `  <path d="${d}" fill="none" stroke="currentColor" stroke-width="0.01" stroke-linecap="round" stroke-linejoin="round" />`;
            })
            .join('\n');

        return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 2 2">\n${pathMarkup}\n</svg>\n`;
    }

    function downloadContourSvg() {
        if (!pendingPaths.value.length) return;

        const svgText = buildContourSvg(pendingPaths.value);
        const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
        const blobUrl = URL.createObjectURL(blob);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const anchor = document.createElement('a');
        anchor.href = blobUrl;
        anchor.download = `contour-${pendingPaths.value.length}-paths-${timestamp}.svg`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);

        URL.revokeObjectURL(blobUrl);
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
                        <Button
                            type="button"
                            class="cam-button cam-capture"
                            :disabled="isProcessing"
                            @click="captureFromCamera"
                        >
                            <span class="material-symbols-outlined">camera</span>
                            <span>Capture</span>
                        </Button>
                        <Button
                            type="button"
                            class="cam-button cam-flip"
                            severity="secondary"
                            @click="switchCamera"
                        >
                            <span class="material-symbols-outlined">flip_camera_android</span>
                            <span>Flip</span>
                        </Button>
                        <Button
                            type="button"
                            class="cam-button cam-cancel"
                            severity="danger"
                            @click="stopCamera"
                        >
                            <span class="material-symbols-outlined">close</span>
                            <span>Cancel</span>
                        </Button>
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

                    <!-- Action buttons -->
                    <div class="action-row">
                        <Button
                            type="button"
                            :disabled="isProcessing || isInitializing"
                            @click="openFilePicker"
                            class="action-button"
                        >
                            <span class="material-symbols-outlined">upload_file</span>
                            <span class="whitespace-pre">Upload Image</span>
                        </Button>
                        <Button
                            type="button"
                            :disabled="isProcessing || isInitializing"
                            @click="openCamera"
                            class="action-button"
                        >
                            <span class="material-symbols-outlined">photo_camera</span>
                            <span class="whitespace-pre">Use Camera</span>
                        </Button>
                    </div>

                    <!-- Status message -->
                    <LoadingIndicator
                        v-if="statusMessage && !previewSrc && isProcessing"
                        class="status-message status-message--loading"
                        :message="statusMessage"
                    />
                    <div
                        v-else-if="statusMessage && !previewSrc"
                        class="status-message"
                        :class="{ 'status-error': status === 'error', 'status-done': status === 'done' }"
                    >
                        {{ statusMessage }}
                    </div>

                    <!-- Preview -->
                    <div
                        v-if="previewSrc"
                        class="preview-area"
                    >
                        <LoadingIndicator
                            v-if="statusMessage && isProcessing"
                            class="status-message preview-status status-message--loading"
                            :message="statusMessage"
                        />
                        <div
                            v-else-if="statusMessage"
                            class="status-message preview-status"
                            :class="{ 'status-error': status === 'error', 'status-done': status === 'done' }"
                        >{{ statusMessage }}</div>
                        <canvas
                            ref="previewCanvas"
                            class="preview-canvas"
                        />
                    </div>

                    <!-- About Contours info panel -->
                    <div class="about-info">
                        <span class="material-symbols-outlined">info</span>
                        <p>
                            Background removal via <a
                                href="https://github.com/jerrychan7/U2netInBrowser"
                                target="_blank"
                                rel="noopener noreferrer"
                            >U2netInBrowser</a>, an <a
                                href="https://onnxruntime.ai/docs/get-started/with-javascript/web.html"
                                target="_blank"
                                rel="noopener noreferrer"
                            >ONNX Runtime Web</a> version of <a
                                href="https://github.com/xuebinqin/u-2-net"
                                target="_blank"
                                rel="noopener noreferrer"
                            >U²-Net</a>. Contours traced via <a
                                href="https://en.wikipedia.org/wiki/Marching_squares"
                                target="_blank"
                                rel="noopener noreferrer"
                            >Marching Squares</a>.
                        </p>
                    </div>
                </div>
            </div>

            <div
                v-if="!showCamera && hasPendingContour"
                class="contour-footer"
            >
                <div class="confirm-row">
                    <Button
                        class="download-btn"
                        severity="secondary"
                        :disabled="isProcessing"
                        @click="downloadContourSvg"
                    >
                        <span class="material-symbols-outlined">download</span>
                        <span>Download SVG</span>
                    </Button>
                    <Button
                        class="apply-btn"
                        :disabled="isProcessing"
                        @click="applyContour"
                    >
                        <span class="material-symbols-outlined">check</span>
                        <span>Apply</span>
                    </Button>
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

    :deep(.action-button) {
        flex: 1;
        min-width: 140px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
    }

    :deep(.action-button .material-symbols-outlined) {
        font-size: 1.25rem;
    }

    .status-message {
        color: #aaa;
        font-size: 0.875rem;
        display: flex;
        align-items: center;
        gap: 0.4rem;
    }

    .status-message--loading {
        --loading-indicator-direction: row;
        --loading-indicator-gap: 0.4rem;
        --loading-indicator-spinner-size: 1rem;
        --loading-indicator-spinner-border-width: 2px;
        --loading-indicator-text-size: 0.875rem;
    }

    .status-error {
        color: #f88;
    }

    .status-done {
        color: #88f8a0;
    }

    .preview-area {
        position: relative;
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

    .preview-status {
        position: absolute;
        top: 0.5rem;
        left: 0.5rem;
        z-index: 2;
        padding: 0.4rem 0.55rem;
        border-radius: 0.4rem;
        background: rgba(0, 0, 0, 0.62);
        border: 1px solid rgba(255, 255, 255, 0.12);
        backdrop-filter: blur(2px);
        pointer-events: none;
    }

    .contour-footer {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        border-top: 1px solid #374151;
        padding: 1rem 1.25rem;
        background: rgba(0, 0, 0, 0.6);
    }

    .confirm-row {
        display: flex;
        justify-content: center;
        width: 100%;
        gap: 0.75rem;
        flex-wrap: wrap;
    }

    :deep(.download-btn),
    :deep(.apply-btn) {
        flex: 1;
        min-width: 160px;
    }

    /* Camera */
    .camera-area {
        position: relative;
        width: 100%;
        max-width: 640px;
        margin: 1rem auto 0;
        flex: 1;
    }

    .camera-video {
        display: block;
        width: 100%;
        border-radius: 8px;
        background: #000;
    }

    .camera-controls {
        position: absolute;
        inset: 0;
        z-index: 2;
        pointer-events: none;
    }

    :deep(.cam-button) {
        position: absolute;
        display: flex;
        align-items: center;
        gap: 0.4rem;
        justify-content: center;
        min-width: 106px;
        backdrop-filter: blur(3px);
        pointer-events: auto;
    }

    :deep(.cam-button .material-symbols-outlined) {
        font-size: 1.2rem;
    }

    :deep(.cam-cancel) {
        top: 0.75rem;
        right: 0.75rem;
    }

    :deep(.cam-flip) {
        bottom: 0.75rem;
        left: 0.75rem;
    }

    :deep(.cam-capture) {
        bottom: 0.75rem;
        right: 0.75rem;
    }

    .about-info {
        display: flex;
        gap: 0.75rem;
        align-items: flex-start;
        width: 100%;
        max-width: 400px;
        margin-top: 0.75rem;
        padding: 0.75rem 1rem;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .about-info .material-symbols-outlined {
        flex-shrink: 0;
        font-size: 1.25rem;
        color: rgba(255, 255, 255, 0.5);
        margin-top: 0.15rem;
    }

    .about-info p {
        margin: 0;
        font-size: 0.85rem;
        line-height: 1.6;
        color: rgba(255, 255, 255, 0.68);
    }

    .about-info a {
        color: rgba(255, 255, 255, 0.75);
        text-decoration: underline;
        transition: color 0.2s ease;
    }

    .about-info a:hover {
        color: rgba(255, 255, 255, 0.95);
    }
</style>
