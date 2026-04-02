<script setup>
    import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
    import { useRoute, useRouter } from 'vue-router';
    import LocalSaveStatus from './LocalSaveStatus.vue';
    import { useRealtimeSlyce } from '../../composables/slyce/useRealtimeSlyce.js';

    const props = defineProps({
        active: {
            type: Boolean,
            default: false
        },
        embedded: {
            type: Boolean,
            default: false
        },
        autoStartCamera: {
            type: Boolean,
            default: false
        },
        workflowPhase: {
            type: String,
            default: 'full'
        }
    });

    const emit = defineEmits(['close', 'apply', 'start-capture']);

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
    let boundVideoElement = null;

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

    function detachVideoPreview(element = boundVideoElement) {
        if (!element) return;
        try {
            element.pause();
        } catch {
            // No-op: pausing an already-disposed preview is fine.
        }
        if (element.srcObject) {
            element.srcObject = null;
        }
        if (boundVideoElement === element) {
            boundVideoElement = null;
        }
    }

    function syncVideoPreview() {
        const video = videoRef.value;

        if (!video || !showWebcamPreview.value || !realtime.cameraStream.value) {
            if (video) {
                detachVideoPreview(video);
            }
            return;
        }

        if (boundVideoElement && boundVideoElement !== video) {
            detachVideoPreview(boundVideoElement);
        }

        boundVideoElement = video;

        if (video.srcObject !== realtime.cameraStream.value) {
            video.srcObject = realtime.cameraStream.value;
        }

        const playPromise = video.play?.();
        if (playPromise?.catch) {
            playPromise.catch(() => {
                // Autoplay can race with camera rebinds; the next phase change retries.
            });
        }
    }

    // Start/stop draw loop with capture state
    watch(() => realtime.isCapturing.value, (capturing) => {
        if (capturing) {
            startDrawLoop();
        } else {
            stopDrawLoop();
        }
    });

    // Also bind when video element mounts (stream may already be available)
    async function ensureCameraStarted() {
        if (!props.autoStartCamera || realtime.isCameraActive.value) return;

        try {
            await realtime.startCamera();
        } catch (error) {
            console.error('[RealtimeSampler] Failed to auto-start camera:', error);
        }
    }

    onMounted(() => {
        void ensureCameraStarted();
        syncVideoPreview();
    });

    // Can apply if there are completed KTX2 buffers, not capturing, and no tiles still encoding
    const canApply = computed(() =>
        !realtime.isCapturing.value
        && realtime.encodingTiles.value === 0
        && realtime.completedKtx2Buffers.value.length > 0
    );

    const completedTileCount = computed(() => realtime.completedKtx2Buffers.value.length);
    const textureSetLabel = computed(() => {
        const count = completedTileCount.value;
        return count > 0 ? `${count}-tile texture set` : 'texture set';
    });

    const localSaveInProgressDetail = computed(() =>
        `This ${textureSetLabel.value} is being saved locally on this device.`
    );

    const localSaveSuccessDetail = computed(() =>
        `This ${textureSetLabel.value} is stored locally on this device, so you can return to it later without recapturing.`
    );

    const doneSaveState = computed(() => {
        if (realtime.isSavingLocally.value) return 'saving';
        if (realtime.saveLocalError.value) return 'error';
        if (realtime.savedLocalTextureId.value) return 'success';
        return 'pending';
    });

    const doneSummaryTitle = computed(() => {
        if (doneSaveState.value === 'success') return 'Texture Saved';
        if (doneSaveState.value === 'saving') return 'Saving Texture Locally';
        if (doneSaveState.value === 'error') return 'Local Save Needs Attention';
        return 'Preparing Local Save';
    });

    const doneSummaryDetail = computed(() => {
        if (doneSaveState.value === 'success') {
            return `Your ${textureSetLabel.value} is processed and stored locally on this device. You can reopen it later without recapturing.`;
        }
        if (doneSaveState.value === 'saving') {
            return `Processing is complete. Your ${textureSetLabel.value} is being saved locally on this device now.`;
        }
        if (doneSaveState.value === 'error') {
            return `Processing is complete, but local save failed for this ${textureSetLabel.value}. Retry if you want to keep it on this device for later.`;
        }
        return `Processing is complete. Your ${textureSetLabel.value} is ready, and local saving on this device will begin next.`;
    });

    const doneSummaryMeta = computed(() => {
        if (doneSaveState.value === 'saving' && realtime.saveLocalProgress.value) {
            return realtime.saveLocalProgress.value;
        }
        return '';
    });

    const showDoneSummary = computed(() => isFinishedPhase.value && canApply.value);

    const showLocalSaveStatus = computed(() =>
        !isFinishedPhase.value && props.workflowPhase !== 'setup' && !realtime.isCapturing.value && (
            realtime.isSavingLocally.value
            || !!realtime.saveLocalError.value
            || !!realtime.savedLocalTextureId.value
        )
    );

    const isSetupPhase = computed(() => props.workflowPhase === 'setup');
    const isProcessingPhase = computed(() => props.workflowPhase === 'processing');
    const isFinishedPhase = computed(() => props.workflowPhase === 'finished');
    const isFullPhase = computed(() => props.workflowPhase === 'full');
    const showWebcamPreview = computed(() => !isFinishedPhase.value && (!props.embedded || !isProcessingPhase.value));

    watch(videoRef, (nextVideo, previousVideo) => {
        if (previousVideo && previousVideo !== nextVideo) {
            detachVideoPreview(previousVideo);
        }
        syncVideoPreview();
    }, { flush: 'post' });

    watch([
        () => realtime.cameraStream.value,
        showWebcamPreview,
    ], () => {
        syncVideoPreview();
    }, { flush: 'post' });

    watch(() => props.workflowPhase, async (phase) => {
        if (!props.embedded) return;

        if (phase === 'finished') {
            if (!realtime.isCapturing.value && realtime.isCameraActive.value) {
                realtime.stopCamera();
            }
            return;
        }

        if ((phase === 'setup' || phase === 'processing') && props.autoStartCamera && !realtime.isCameraActive.value) {
            await ensureCameraStarted();
        }
    });

    // Live tile display size (matches actual tile pixel dimensions)
    const tileSizePx = computed(() => realtime.potResolution.value + 'px');

    // Status text (migrated from RealtimeControls.vue)
    const statusText = computed(() => {
        if (!realtime.isCapturing.value) {
            if (isSetupPhase.value) {
                if (realtime.isCameraActive.value && realtime.cameraFrameRate.value) {
                    return `Camera ${Math.round(realtime.cameraFrameRate.value)}fps`;
                }
                return 'Ready';
            }

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

    const activeCameraLabel = computed(() =>
        realtime.cameraFacingMode.value === 'environment' ? 'Rear Camera' : 'Front Camera'
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
        if (isSetupPhase.value) {
            emit('start-capture');
            return;
        }

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

    function handleOpenTextureLibrary() {
        router.push({ path: route.path, query: { ...route.query, textures: 'local' } });
        emit('close');
    }

    // Cleanup on unmount
    onUnmounted(() => {
        detachVideoPreview();
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
        :class="{ active: active, embedded: embedded }"
    >
        <div
            class="realtime-container"
            :class="{ embedded: embedded }"
        >
            <!-- Main content area -->
            <div
                class="realtime-content"
                :class="{ embedded: embedded }"
            >
                <!-- Status bar -->
                <div
                    v-if="!isFinishedPhase"
                    class="status-bar"
                >
                    <span class="status-text">{{ statusText }}</span>
                </div>

                <div
                    v-if="perfSummary && !isSetupPhase && !isFinishedPhase"
                    class="perf-bar"
                >
                    {{ perfSummary }}
                </div>

                <div
                    v-if="showDoneSummary"
                    class="done-summary"
                    :class="`is-${doneSaveState}`"
                >
                    <p class="done-summary-kicker">Processing Complete</p>
                    <h2 class="done-summary-title">{{ doneSummaryTitle }}</h2>
                    <p class="done-summary-detail">{{ doneSummaryDetail }}</p>
                    <p
                        v-if="doneSummaryMeta"
                        class="done-summary-meta"
                    >{{ doneSummaryMeta }}</p>
                    <div
                        v-if="doneSaveState === 'error'"
                        class="done-summary-actions"
                    >
                        <button
                            class="done-summary-retry-btn"
                            @click="handleRetryLocalSave"
                        >
                            <span class="material-symbols-outlined">refresh</span>
                            Retry Save
                        </button>
                    </div>
                </div>

                <LocalSaveStatus
                    v-else-if="showLocalSaveStatus"
                    :is-saving-locally="realtime.isSavingLocally.value"
                    :save-local-progress="realtime.saveLocalProgress.value"
                    :save-local-error="realtime.saveLocalError.value"
                    :saved-local-texture-id="realtime.savedLocalTextureId.value"
                    :saving-detail="localSaveInProgressDetail"
                    success-title="Texture Saved"
                    :success-detail="localSaveSuccessDetail"
                    @retry="handleRetryLocalSave"
                />

                <!-- Webcam + Preview area -->
                <div class="preview-area">
                    <!-- Live webcam feed + live tile side by side -->
                    <div
                        v-if="!isFinishedPhase"
                        class="capture-section"
                    >
                        <div
                            v-if="showWebcamPreview"
                            class="webcam-section"
                        >
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
                            v-if="realtime.isCapturing.value && !isSetupPhase"
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
                        v-if="realtime.gridTiles.value.length > 0 && !isSetupPhase"
                        class="tile-grid"
                    >
                        <div
                            v-for="(tile, index) in realtime.gridTiles.value"
                            :key="tile.id"
                            class="tile-preview"
                        >
                            <canvas :ref="(el) => drawTilePreview(el, tile.canvas)" />
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
                    v-if="showFpsWarning && !isSetupPhase"
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
                <div
                    v-if="isSetupPhase || isFullPhase"
                    class="controls-bar"
                >
                    <div
                        v-if="isFullPhase"
                        class="control-field control-field-compact"
                    >
                        <span class="control-label">Capture</span>
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
                    </div>

                    <!-- Camera flip -->
                    <div class="control-field control-field-compact">
                        <span class="control-label">Active Camera</span>
                        <button
                            class="ctrl-btn"
                            :disabled="!realtime.isCameraActive.value"
                            @click="realtime.toggleCamera"
                        >
                            <span class="material-symbols-outlined">cameraswitch</span>
                            <span class="btn-label">{{ activeCameraLabel }}</span>
                        </button>
                    </div>

                    <!-- Camera resolution -->
                    <label class="control-field">
                        <span class="control-label">Camera Resolution</span>
                        <select
                            class="ctrl-select"
                            :value="realtime.cameraResolution.value"
                            :disabled="realtime.isCapturing.value"
                            aria-label="Camera resolution"
                            @change="realtime.setResolution($event.target.value)"
                        >
                            <option value="240p">240p</option>
                            <option value="480p">480p</option>
                            <option value="720p">720p</option>
                        </select>
                    </label>

                    <!-- Tile resolution -->
                    <label class="control-field">
                        <span class="control-label">Tile Resolution</span>
                        <select
                            class="ctrl-select"
                            :value="realtime.potResolution.value"
                            :disabled="realtime.isCapturing.value"
                            aria-label="Tile resolution"
                            @change="realtime.setPotResolution(Number($event.target.value))"
                        >
                            <option :value="128">128²</option>
                            <option :value="256">256²</option>
                            <option :value="512">512²</option>
                        </select>
                    </label>

                    <label class="control-field control-field-narrow">
                        <span class="control-label">Layers Per Tile</span>
                        <input
                            :value="realtime.crossSectionCount.value"
                            class="ctrl-number"
                            type="number"
                            inputmode="numeric"
                            :min="realtime.minCrossSectionCount"
                            :max="realtime.maxCrossSectionCount"
                            step="1"
                            :disabled="realtime.isCapturing.value"
                            aria-label="Layers per tile"
                            @change="handleLayerCountChange"
                            @blur="handleLayerCountChange"
                        />
                    </label>

                    <!-- Cross-section type toggle -->
                    <div class="control-field control-field-wide">
                        <span class="control-label">Sampling Mode</span>
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
                    </div>

                    <!-- Max tiles slider (planes mode only) -->
                    <div
                        v-if="realtime.crossSectionType.value === 'planes'"
                        class="control-field slider-field"
                    >
                        <span class="control-label">Max Tile Count</span>
                        <span class="control-value">{{ realtime.maxTiles.value }} tiles</span>
                        <input
                            type="range"
                            min="4"
                            max="32"
                            step="1"
                            :value="realtime.maxTiles.value"
                            :disabled="realtime.isCapturing.value"
                            aria-label="Maximum tile count"
                            @input="realtime.setMaxTiles(Number($event.target.value))"
                        />
                    </div>

                    <!-- Target tile count (waves mode) -->
                    <div
                        v-if="realtime.crossSectionType.value === 'waves'"
                        class="control-field slider-field"
                    >
                        <span class="control-label">Target Tile Count</span>
                        <span class="control-value">{{ realtime.targetTileCount.value }} tiles</span>
                        <input
                            type="range"
                            min="1"
                            max="16"
                            step="1"
                            :value="realtime.targetTileCount.value"
                            :disabled="realtime.isCapturing.value"
                            aria-label="Target tile count"
                            @input="realtime.setTargetTileCount(Number($event.target.value))"
                        />
                        <span
                            v-if="!realtime.isCapturing.value && estimatedDuration !== null"
                            class="control-hint"
                        >
                            Approx. {{ formatDuration(estimatedDuration) }} at {{ estimatedFps }}fps
                        </span>
                    </div>
                </div>

                <div
                    v-if="isSetupPhase"
                    class="setup-action-bar"
                >
                    <button
                        class="primary-action-btn"
                        :disabled="!realtime.isCameraActive.value"
                        @click="handleStart"
                    >
                        <span class="material-symbols-outlined">videocam</span>
                        Start Capture
                    </button>
                </div>

                <div
                    v-else-if="isProcessingPhase && realtime.isCapturing.value"
                    class="setup-action-bar"
                >
                    <button
                        class="primary-action-btn danger"
                        @click="handleStop"
                    >
                        <span class="material-symbols-outlined">stop_circle</span>
                        Stop Capture
                    </button>
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
                    </button><button
                        v-if="realtime.savedLocalTextureId.value"
                        class="action-btn library-btn"
                        @click="handleOpenTextureLibrary"
                    >
                        <span class="material-symbols-outlined">grid_view</span>
                        Open in Library
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

    .realtime-panel.embedded {
        position: static;
        inset: auto;
        z-index: auto;
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

    .realtime-container.embedded {
        background: transparent;
        padding-top: 0;
        padding-bottom: 0;
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

    .realtime-content.embedded {
        max-width: 920px;
        padding: 0;
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

    .done-summary {
        width: 100%;
        padding: 0;
        text-align: left;
        align-self: stretch;
    }

    .done-summary-kicker {
        margin: 0;
        color: rgba(232, 238, 248, 0.56);
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
    }

    .done-summary-title {
        margin: 0.35rem 0 0;
        color: #f8fbff;
        font-size: clamp(1.55rem, 2.6vw, 2.2rem);
        line-height: 1.05;
    }

    .done-summary-detail {
        margin: 0.9rem 0 0;
        max-width: 54rem;
        color: rgba(232, 238, 248, 0.8);
        font-size: 0.98rem;
        line-height: 1.65;
    }

    .done-summary-meta {
        margin: 0.75rem 0 0;
        color: rgba(232, 238, 248, 0.58);
        font-size: 0.82rem;
        font-weight: 500;
    }

    .done-summary-actions {
        display: flex;
        justify-content: flex-start;
        margin-top: 1rem;
    }

    .done-summary-retry-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        min-height: 44px;
        padding: 0.7rem 1rem;
        border: 1px solid rgba(248, 113, 113, 0.34);
        border-radius: 999px;
        background: rgba(248, 113, 113, 0.12);
        color: #fee2e2;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease;
    }

    .done-summary-retry-btn:hover {
        background: rgba(248, 113, 113, 0.18);
        border-color: rgba(248, 113, 113, 0.46);
    }

    .done-summary.is-error .done-summary-kicker,
    .done-summary.is-error .done-summary-meta {
        color: rgba(252, 165, 165, 0.72);
    }

    .done-summary.is-error .done-summary-title {
        color: #fff1f2;
    }

    .setup-action-bar {
        display: flex;
        justify-content: center;
        width: 100%;
        padding-top: 0.25rem;
    }

    .primary-action-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.55rem;
        min-height: 48px;
        padding: 0.8rem 1.2rem;
        border-radius: 999px;
        border: none;
        background: #2563eb;
        color: #fff;
        font-size: 0.95rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease;
    }

    .primary-action-btn:hover:not(:disabled) {
        background: #1d4ed8;
    }

    .primary-action-btn:disabled {
        opacity: 0.45;
        cursor: default;
    }

    .primary-action-btn.danger {
        background: #dc2626;
    }

    .primary-action-btn.danger:hover:not(:disabled) {
        background: #b91c1c;
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
        align-items: flex-end;
        gap: 12px;
        flex-wrap: wrap;
        justify-content: center;
    }

    .control-field {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.35rem;
        min-width: 140px;
    }

    .control-field-narrow {
        min-width: 120px;
    }

    .control-field-wide {
        min-width: 168px;
    }

    .control-field-compact {
        min-width: 0;
    }

    .control-label {
        font-size: 0.76rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(232, 238, 248, 0.72);
    }

    .control-value,
    .control-hint {
        font-size: 0.8rem;
        line-height: 1.35;
    }

    .control-value {
        color: rgba(255, 255, 255, 0.92);
        font-weight: 500;
    }

    .control-hint {
        color: rgba(232, 238, 248, 0.58);
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

    .control-field-compact .ctrl-btn {
        min-height: 38px;
    }

    .ctrl-select {
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        color: white;
        padding: 6px 8px;
        font-size: 13px;
        cursor: pointer;
        width: 100%;
    }

    .ctrl-select:disabled {
        opacity: 0.4;
        cursor: default;
    }

    .ctrl-select option {
        color: #111827;
        background: #ffffff;
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

    .slider-field input[type='range'] {
        width: 100%;
        accent-color: #64b5f6;
    }

    /* Action buttons */
    .action-bar {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
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

    .library-btn {
        background: #2563eb;
        color: white;
    }

    .library-btn:hover {
        background: #1d4ed8;
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
