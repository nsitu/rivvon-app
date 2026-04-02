<script setup>
    import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
    import { useRoute, useRouter } from 'vue-router';
    import LocalSaveStatus from './LocalSaveStatus.vue';
    import { useRealtimeSlyce } from '../../composables/slyce/useRealtimeSlyce.js';

    const props = defineProps({
        active: {
            type: Boolean,
            default: false
        }
    });

    const emit = defineEmits(['close', 'apply']);

    const realtime = useRealtimeSlyce();
    const router = useRouter();
    const route = useRoute();
    const CANVAS_2D_CTX_CACHE_KEY = '__rivvonRealtime2dCtx';

    // Template ref for the live webcam video element
    const videoRef = ref(null);

    // Template ref for the live tile preview canvas
    const liveCanvasRef = ref(null);

    // rAF-based draw loop for live tile preview (no Vue reactivity in hot path)
    let drawLoopId = null;

    // Track source canvas identity to detect tile reset
    let lastSource = null;
    let lastDest = null;
    let liveCanvasCtx = null;

    function getCached2dContext(canvas) {
        let ctx = canvas?.[CANVAS_2D_CTX_CACHE_KEY] ?? null;
        if (!ctx && canvas?.getContext) {
            ctx = canvas.getContext('2d');
            if (ctx) {
                canvas[CANVAS_2D_CTX_CACHE_KEY] = ctx;
            }
        }
        return ctx;
    }

    function drawTilePreview(element, sourceCanvas) {
        if (!element || !sourceCanvas) return;

        if (element.width !== sourceCanvas.width || element.height !== sourceCanvas.height) {
            element.width = sourceCanvas.width;
            element.height = sourceCanvas.height;
        }

        const ctx = getCached2dContext(element);
        if (!ctx) return;
        ctx.drawImage(sourceCanvas, 0, 0);
    }

    function startDrawLoop() {
        function draw() {
            const source = realtime.currentPreviewCanvas.value;
            const dest = liveCanvasRef.value;
            if (source && dest) {
                if (dest !== lastDest) {
                    liveCanvasCtx = getCached2dContext(dest);
                    lastDest = dest;
                }

                if (dest.width !== source.width || dest.height !== source.height) {
                    dest.width = source.width;
                    dest.height = source.height;
                    liveCanvasCtx = getCached2dContext(dest);
                }

                if (liveCanvasCtx) {
                    const previewStart = performance.now();

                    // When the source canvas object changes, a new tile has started —
                    // clear the display canvas so no stale pixels remain.
                    if (source !== lastSource) {
                        liveCanvasCtx.clearRect(0, 0, dest.width, dest.height);
                        lastSource = source;
                    }

                    liveCanvasCtx.drawImage(source, 0, 0);
                    realtime.recordPreviewFrame(performance.now() - previewStart);
                }
            }
            drawLoopId = requestAnimationFrame(draw);
        }
        lastSource = null;
        lastDest = null;
        liveCanvasCtx = null;
        drawLoopId = requestAnimationFrame(draw);
    }

    function stopDrawLoop() {
        if (drawLoopId !== null) {
            cancelAnimationFrame(drawLoopId);
            drawLoopId = null;
        }
        lastDest = null;
        liveCanvasCtx = null;
    }

    // Start/stop draw loop with capture state
    watch(() => realtime.isCapturing.value, (capturing) => {
        if (capturing) {
            startDrawLoop();
        } else {
            stopDrawLoop();
        }
    });

    // Bind camera stream to video element when it becomes available
    watch(() => realtime.cameraStream.value, (stream) => {
        if (videoRef.value && stream) {
            videoRef.value.srcObject = stream;
        }
    });

    // Also bind when video element mounts (stream may already be available)
    onMounted(() => {
        if (videoRef.value && realtime.cameraStream.value) {
            videoRef.value.srcObject = realtime.cameraStream.value;
        }
    });

    // Can apply if there are completed KTX2 buffers, not capturing, and no tiles still encoding
    const canApply = computed(() =>
        !realtime.isCapturing.value
        && realtime.encodingTiles.value === 0
        && realtime.completedKtx2Buffers.value.length > 0
    );

    const showLocalSaveStatus = computed(() =>
        !realtime.isCapturing.value && (
            realtime.isSavingLocally.value
            || !!realtime.saveLocalError.value
            || !!realtime.savedLocalTextureId.value
        )
    );

    // Live tile display size (matches actual tile pixel dimensions)
    const tileSizePx = computed(() => realtime.potResolution.value + 'px');

    // Status text (migrated from RealtimeControls.vue)
    const statusText = computed(() => {
        if (!realtime.isCapturing.value) {
            const count = realtime.completedKtx2Buffers.value.length;
            if (count > 0) return `${count} tile${count > 1 ? 's' : ''} ready`;
            if (realtime.isCameraActive.value && realtime.cameraFrameRate.value) {
                return `Camera ${Math.round(realtime.cameraFrameRate.value)}fps`;
            }
            return 'Ready';
        }
        const enc = realtime.encodingTiles.value > 0
            ? ` | Encoding ${realtime.encodingTiles.value}`
            : '';
        const countdown = realtime.crossSectionType.value === 'waves' && realtime.countdownSeconds.value !== null
            ? ` | ${formatDuration(realtime.countdownSeconds.value)} remaining`
            : '';
        return `Tile ${realtime.completedTiles.value}/${realtime.crossSectionType.value === 'waves' ? realtime.targetTileCount.value : realtime.maxTiles.value} | Row ${realtime.currentRow.value}/${realtime.tileHeight.value} | ${realtime.fps.value} fps${enc}${countdown}`;
    });

    const perfSummary = computed(() => {
        const stats = realtime.perfStats.value;
        const parts = [];

        if (stats.frameIntervalMs > 0) {
            parts.push(`Frame ${stats.frameIntervalMs.toFixed(1)}ms`);
        }
        if (stats.samplingMs > 0) {
            parts.push(`Sample ${stats.samplingMs.toFixed(1)}ms/frame`);
        }
        if (stats.previewMs > 0) {
            parts.push(`Preview ${stats.previewMs.toFixed(1)}ms/raf`);
        }
        if (stats.readbackMs > 0) {
            parts.push(`Readback ${stats.readbackMs.toFixed(1)}ms/tile`);
        }
        if (stats.encodeQueueMs > 0) {
            parts.push(`Queue ${stats.encodeQueueMs.toFixed(1)}ms/tile`);
        }
        if (stats.encodeMs > 0) {
            parts.push(`Encode ${stats.encodeMs.toFixed(1)}ms/tile`);
        }

        return parts.join(' | ');
    });

    // Estimated duration for waves mode (before capture starts)
    const estimatedDuration = computed(() => {
        if (realtime.crossSectionType.value !== 'waves') return null;
        const fps = realtime.cameraFrameRate.value || 30;
        return realtime.totalFrames.value / fps;
    });

    const estimatedFps = computed(() =>
        realtime.cameraFrameRate.value ? Math.round(realtime.cameraFrameRate.value) : 30
    );

    // FPS drop warning: show when capture FPS falls below 50% of camera FPS
    const nextLowerResolution = computed(() => {
        const current = realtime.potResolution.value;
        if (current === 512) return 256;
        if (current === 256) return 128;
        return null;
    });

    const showFpsWarning = computed(() => {
        if (!realtime.isCapturing.value) return false;
        if (!nextLowerResolution.value) return false;
        const captureFps = realtime.fps.value;
        const cameraFps = realtime.cameraFrameRate.value || 30;
        // Wait until FPS is measured (non-zero) and below 50% of camera rate
        return captureFps > 0 && captureFps < cameraFps * 0.5;
    });

    async function handleDowngrade() {
        const target = nextLowerResolution.value;
        if (!target) return;
        realtime.stopRealtime();
        realtime.setPotResolution(target);
        await realtime.startRealtime();
    }

    function handleLayerCountChange(event) {
        realtime.setCrossSectionCount(event.target.valueAsNumber);
    }

    function formatDuration(seconds) {
        if (seconds <= 0) return '0s';
        const m = Math.floor(seconds / 60);
        const s = Math.ceil(seconds % 60);
        return m > 0 ? `${m}m ${s}s` : `${s}s`;
    }

    function handleStart() {
        realtime.startRealtime();
    }

    function handleStop() {
        realtime.stopRealtime();
    }

    function handleApply() {
        emit('apply');
    }

    function handleDiscard() {
        realtime.discardResults();
    }

    function handleRetryLocalSave() {
        realtime.persistResultsLocally(true);
    }

    function handleOpenTextureBrowser() {
        router.push({ path: route.path, query: { ...route.query, textures: 'local' } });
        emit('close');
    }

    function handleClose() {
        if (realtime.isCapturing.value) {
            realtime.stopRealtime();
        }
        realtime.stopCamera();
        emit('close');
    }

    // Cleanup on unmount
    onUnmounted(() => {
        stopDrawLoop();
        if (realtime.isCapturing.value) {
            realtime.stopRealtime();
        }
        realtime.stopCamera();
    });
</script>

<template>
    <div
        class="realtime-panel"
        :class="{ active: active }"
    >
        <div class="realtime-container">
            <!-- Close button -->
            <button
                class="close-btn"
                @click="handleClose"
            >
                <span class="material-symbols-outlined">close</span>
            </button>

            <!-- Main content area -->
            <div class="realtime-content">
                <!-- Status bar -->
                <div class="status-bar">
                    <span class="status-text">{{ statusText }}</span>
                </div>

                <div
                    v-if="perfSummary"
                    class="perf-bar"
                >
                    {{ perfSummary }}
                </div>

                <LocalSaveStatus
                    v-if="showLocalSaveStatus"
                    :is-saving-locally="realtime.isSavingLocally.value"
                    :save-local-progress="realtime.saveLocalProgress.value"
                    :save-local-error="realtime.saveLocalError.value"
                    :saved-local-texture-id="realtime.savedLocalTextureId.value"
                    success-detail="Upload or export later from the Texture Browser."
                    @retry="handleRetryLocalSave"
                >
                    <template #success-actions>
                        <button
                            class="save-status-btn"
                            @click="handleOpenTextureBrowser"
                        >
                            Open Browser
                        </button>
                    </template>
                </LocalSaveStatus>

                <!-- Webcam + Preview area -->
                <div class="preview-area">
                    <!-- Live webcam feed + live tile side by side -->
                    <div class="capture-section">
                        <div class="webcam-section">
                            <video
                                ref="videoRef"
                                autoplay
                                playsinline
                                muted
                                class="webcam-video"
                            />
                            <span
                                v-if="realtime.isCameraActive.value"
                                class="overlay-label live-label"
                            >Live</span>
                        </div>

                        <!-- Live tile being sampled (prominent, actual pixel size) -->
                        <div
                            v-if="realtime.isCapturing.value"
                            class="live-tile-section"
                        >
                            <canvas
                                ref="liveCanvasRef"
                                class="live-tile-canvas"
                                :style="{ width: tileSizePx, height: tileSizePx }"
                            />
                            <span class="overlay-label sampling-label">Sampling</span>
                            <span class="tile-progress-text">
                                Row {{ realtime.currentRow.value }}/{{ realtime.tileHeight.value }}
                            </span>
                        </div>
                    </div>

                    <!-- Unified tile grid: encoding + completed -->
                    <div
                        v-if="realtime.gridTiles.value.length > 0"
                        class="tile-grid"
                    >
                        <div
                            v-for="(tile, index) in realtime.gridTiles.value"
                            :key="tile.id"
                            class="tile-preview"
                        >
                            <canvas
                                :ref="(el) => drawTilePreview(el, tile.canvas)"
                            />
                            <div
                                v-if="tile.status === 'encoding'"
                                class="tile-encoding-overlay"
                                :style="{ background: `linear-gradient(to right, transparent ${Math.round((tile.layer / (tile.layerTotal || 1)) * 100)}%, rgba(0,0,0,0.55) ${Math.round((tile.layer / (tile.layerTotal || 1)) * 100)}%)` }"
                            >
                                <span class="overlay-label encoding-label">Encoding</span>
                                <span class="encoding-progress">{{ tile.layer }}/{{ tile.layerTotal }}</span>
                            </div>
                            <template v-else>
                                <span class="overlay-label ready-label">Ready</span>
                                <span class="tile-index">{{ index }}</span>
                            </template>
                        </div>
                    </div>
                </div>

                <!-- FPS drop warning -->
                <div
                    v-if="showFpsWarning"
                    class="fps-warning"
                >
                    <span class="material-symbols-outlined warning-icon">warning</span>
                    <span>Processing at {{ realtime.fps.value }}fps — too slow for {{ realtime.potResolution.value }}²
                        tiles</span>
                    <button
                        class="downgrade-btn"
                        @click="handleDowngrade"
                    >
                        Switch to {{ nextLowerResolution }}²
                    </button>
                </div>

                <!-- Controls -->
                <div class="controls-bar">
                    <!-- Start / Stop -->
                    <button
                        class="ctrl-btn"
                        :class="{ recording: realtime.isCapturing.value }"
                        @click="realtime.isCapturing.value ? handleStop() : handleStart()"
                    >
                        <span class="material-symbols-outlined">
                            {{ realtime.isCapturing.value ? 'stop_circle' : 'videocam' }}
                        </span>
                        <span class="btn-label">{{ realtime.isCapturing.value ? 'Stop' : 'Start' }}</span>
                    </button>

                    <!-- Camera flip -->
                    <button
                        class="ctrl-btn"
                        :disabled="!realtime.isCameraActive.value"
                        @click="realtime.toggleCamera"
                    >
                        <span class="material-symbols-outlined">cameraswitch</span>
                        <span class="btn-label">Flip</span>
                    </button>

                    <!-- Camera resolution -->
                    <select
                        class="ctrl-select"
                        :value="realtime.cameraResolution.value"
                        :disabled="realtime.isCapturing.value"
                        @change="realtime.setResolution($event.target.value)"
                    >
                        <option value="240p">240p</option>
                        <option value="480p">480p</option>
                        <option value="720p">720p</option>
                    </select>

                    <!-- Tile resolution -->
                    <select
                        class="ctrl-select"
                        :value="realtime.potResolution.value"
                        :disabled="realtime.isCapturing.value"
                        @change="realtime.setPotResolution(Number($event.target.value))"
                    >
                        <option :value="128">128²</option>
                        <option :value="256">256²</option>
                        <option :value="512">512²</option>
                    </select>

                    <label class="number-group">
                        <span>Layers</span>
                        <input
                            :value="realtime.crossSectionCount.value"
                            class="ctrl-number"
                            type="number"
                            inputmode="numeric"
                            :min="realtime.minCrossSectionCount"
                            :max="realtime.maxCrossSectionCount"
                            step="1"
                            :disabled="realtime.isCapturing.value"
                            @change="handleLayerCountChange"
                            @blur="handleLayerCountChange"
                        />
                    </label>

                    <!-- Cross-section type toggle -->
                    <div class="type-toggle">
                        <button
                            class="type-btn"
                            :class="{ active: realtime.crossSectionType.value === 'planes' }"
                            :disabled="realtime.isCapturing.value"
                            @click="realtime.setCrossSectionType('planes')"
                        >
                            Planes
                        </button>
                        <button
                            class="type-btn"
                            :class="{ active: realtime.crossSectionType.value === 'waves' }"
                            :disabled="realtime.isCapturing.value"
                            @click="realtime.setCrossSectionType('waves')"
                        >
                            Waves
                        </button>
                    </div>

                    <!-- Max tiles slider (planes mode only) -->
                    <div
                        v-if="realtime.crossSectionType.value === 'planes'"
                        class="slider-group"
                    >
                        <label>Max tiles: {{ realtime.maxTiles.value }}</label>
                        <input
                            type="range"
                            min="4"
                            max="32"
                            step="1"
                            :value="realtime.maxTiles.value"
                            :disabled="realtime.isCapturing.value"
                            @input="realtime.setMaxTiles(Number($event.target.value))"
                        />
                    </div>

                    <!-- Target tile count (waves mode) -->
                    <div
                        v-if="realtime.crossSectionType.value === 'waves'"
                        class="slider-group"
                    >
                        <label>Target tiles: {{ realtime.targetTileCount.value }}</label>
                        <input
                            type="range"
                            min="1"
                            max="16"
                            step="1"
                            :value="realtime.targetTileCount.value"
                            :disabled="realtime.isCapturing.value"
                            @input="realtime.setTargetTileCount(Number($event.target.value))"
                        />
                    </div>

                    <!-- Estimated duration (waves mode, before capture) -->
                    <span
                        v-if="realtime.crossSectionType.value === 'waves' && !realtime.isCapturing.value && estimatedDuration !== null"
                        class="duration-estimate"
                    >
                        ≈ {{ formatDuration(estimatedDuration) }} @ {{ estimatedFps }}fps
                    </span>
                </div>

                <!-- Action buttons (Apply / Discard) -->
                <div
                    v-if="canApply"
                    class="action-bar"
                >
                    <button
                        class="action-btn apply-btn"
                        @click="handleApply"
                    >
                        <span class="material-symbols-outlined">check_circle</span>
                        Apply to Ribbon
                    </button>
                    <button
                        class="action-btn discard-btn"
                        :disabled="realtime.isSavingLocally.value"
                        @click="handleDiscard"
                    >
                        <span class="material-symbols-outlined">delete</span>
                        Discard
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .realtime-panel {
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

    .realtime-panel.active {
        pointer-events: auto;
        opacity: 1;
    }

    .realtime-container {
        position: relative;
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        background: #1a1a1a;
        padding-top: 5.5rem;
        padding-bottom: 5.5rem;
    }

    .close-btn {
        position: absolute;
        top: 6rem;
        right: 1rem;
        z-index: 10;
        background: rgba(255, 255, 255, 0.12);
        border: none;
        border-radius: 50%;
        width: 2.5rem;
        height: 2.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        cursor: pointer;
        transition: background 0.15s;
    }

    .close-btn:hover {
        background: rgba(255, 255, 255, 0.22);
    }

    .realtime-content {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1.25rem;
        width: 100%;
        max-width: 720px;
        margin: 0 auto;
    }

    /* Status bar */
    .status-bar {
        text-align: center;
        font-variant-numeric: tabular-nums;
        color: rgba(255, 255, 255, 0.9);
        font-size: 14px;
    }

    .perf-bar {
        text-align: center;
        font-variant-numeric: tabular-nums;
        color: rgba(255, 255, 255, 0.6);
        font-size: 12px;
    }

    .save-status-btn {
        padding: 0.5rem 0.9rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.08);
        color: #f4f7ff;
        cursor: pointer;
        font-size: 0.82rem;
        pointer-events: auto;
    }

    .save-status-btn:hover {
        background: rgba(255, 255, 255, 0.14);
    }

    /* Preview area */
    .preview-area {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        width: 100%;
        align-items: center;
    }

    .capture-section {
        display: flex;
        gap: 1rem;
        align-items: flex-start;
        justify-content: center;
        width: 100%;
        flex-wrap: wrap;
    }

    .webcam-section {
        position: relative;
        width: 100%;
        max-width: 400px;
        border-radius: 12px;
        overflow: hidden;
        background: #000;
    }

    .webcam-video {
        display: block;
        width: 100%;
        height: auto;
        object-fit: cover;
    }

    /* Live tile preview (prominent, actual pixel size) */
    .live-tile-section {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
    }

    .live-tile-canvas {
        border-radius: 8px;
        border: 2px solid rgba(100, 181, 246, 0.6);
        background: #222;
        image-rendering: pixelated;
    }

    .tile-progress-text {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.6);
        font-variant-numeric: tabular-nums;
    }

    /* Tile preview grid */
    .tile-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: center;
        width: 100%;
    }

    .tile-preview {
        position: relative;
        width: 80px;
        height: 80px;
        border-radius: 6px;
        overflow: hidden;
        background: #333;
    }

    .tile-preview canvas {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .tile-index {
        position: absolute;
        bottom: 2px;
        right: 4px;
        font-size: 10px;
        color: rgba(255, 255, 255, 0.6);
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
    }

    .tile-encoding-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        padding: 2px 4px;
        transition: background 0.3s linear;
    }

    .encoding-progress {
        font-size: 10px;
        color: rgba(255, 255, 255, 0.7);
        font-variant-numeric: tabular-nums;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
        align-self: flex-end;
    }

    /* Overlay status labels */
    .overlay-label {
        font-size: 9px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 1px 4px;
        border-radius: 3px;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
        line-height: 1.4;
    }

    .live-label {
        position: absolute;
        top: 6px;
        left: 6px;
        background: rgba(244, 67, 54, 0.7);
        color: white;
    }

    .sampling-label {
        position: absolute;
        top: 4px;
        left: 4px;
        background: rgba(100, 181, 246, 0.7);
        color: white;
    }

    .encoding-label {
        background: rgba(255, 183, 77, 0.7);
        color: white;
    }

    .ready-label {
        position: absolute;
        top: 2px;
        left: 4px;
        background: rgba(76, 175, 80, 0.7);
        color: white;
    }

    /* Controls bar */
    .controls-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: center;
    }

    .ctrl-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        background: rgba(255, 255, 255, 0.12);
        border: none;
        border-radius: 8px;
        padding: 8px 14px;
        color: white;
        cursor: pointer;
        font-size: 13px;
        transition: background 0.15s;
    }

    .ctrl-btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.22);
    }

    .ctrl-btn:disabled {
        opacity: 0.4;
        cursor: default;
    }

    .ctrl-btn.recording {
        background: rgba(244, 67, 54, 0.6);
    }

    .ctrl-btn .material-symbols-outlined {
        font-size: 18px;
    }

    .btn-label {
        white-space: nowrap;
    }

    .ctrl-select {
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        color: white;
        padding: 6px 8px;
        font-size: 13px;
        cursor: pointer;
    }

    .ctrl-select:disabled {
        opacity: 0.4;
        cursor: default;
    }

    .number-group {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 84px;
    }

    .number-group span {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.7);
    }

    .ctrl-number {
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        color: white;
        padding: 6px 8px;
        font-size: 13px;
        width: 100%;
    }

    .ctrl-number:disabled {
        opacity: 0.4;
        cursor: default;
    }

    .slider-group {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 100px;
    }

    .slider-group label {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.7);
    }

    .slider-group input[type='range'] {
        width: 100%;
        accent-color: #64b5f6;
    }

    /* Action buttons */
    .action-bar {
        display: flex;
        gap: 12px;
        justify-content: center;
        padding-top: 0.5rem;
    }

    .action-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        border: none;
        border-radius: 8px;
        padding: 10px 20px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s;
    }

    .action-btn .material-symbols-outlined {
        font-size: 20px;
    }

    .action-btn:disabled {
        opacity: 0.45;
        cursor: default;
    }

    .apply-btn {
        background: #4caf50;
        color: white;
    }

    .apply-btn:hover {
        background: #43a047;
    }

    .discard-btn {
        background: rgba(255, 255, 255, 0.12);
        color: rgba(255, 255, 255, 0.8);
    }

    .discard-btn:hover {
        background: rgba(255, 255, 255, 0.22);
    }

    /* Planes/Waves toggle */
    .type-toggle {
        display: flex;
        border-radius: 6px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .type-btn {
        background: rgba(255, 255, 255, 0.06);
        border: none;
        color: rgba(255, 255, 255, 0.6);
        padding: 6px 12px;
        font-size: 13px;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
    }

    .type-btn:first-child {
        border-right: 1px solid rgba(255, 255, 255, 0.15);
    }

    .type-btn.active {
        background: rgba(100, 181, 246, 0.3);
        color: #64b5f6;
    }

    .type-btn:hover:not(:disabled):not(.active) {
        background: rgba(255, 255, 255, 0.12);
    }

    .type-btn:disabled {
        opacity: 0.4;
        cursor: default;
    }

    /* Duration estimate label */
    .duration-estimate {
        font-size: 12px;
        color: rgba(255, 183, 77, 0.8);
        white-space: nowrap;
    }

    /* FPS drop warning */
    .fps-warning {
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(244, 67, 54, 0.2);
        border: 1px solid rgba(244, 67, 54, 0.5);
        border-radius: 8px;
        padding: 8px 14px;
        font-size: 13px;
        color: rgba(255, 255, 255, 0.9);
        flex-wrap: wrap;
        justify-content: center;
    }

    .warning-icon {
        font-size: 18px;
        color: #ff8a65;
    }

    .downgrade-btn {
        background: rgba(255, 255, 255, 0.15);
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 6px;
        color: white;
        padding: 4px 12px;
        font-size: 13px;
        cursor: pointer;
        transition: background 0.15s;
        white-space: nowrap;
    }

    .downgrade-btn:hover {
        background: rgba(255, 255, 255, 0.25);
    }
</style>
