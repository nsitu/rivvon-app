// src/composables/viewer/useSceneExport.js
// Scene export: PNG image, legacy WebM video, and frame-accurate MP4/WebM via WebCodecs

/**
 * Provides image and video export capabilities for the Three.js scene.
 *
 * @param {Object} ctx  - Shared context refs from useThreeSetup
 * @param {Object} deps - Cross-composable dependencies
 * @param {Function} deps.pauseRenderLoop  - Pause the live render loop during export
 * @param {Function} deps.resumeRenderLoop - Resume the live render loop after export
 */
export function useSceneExport(ctx, deps = {}) {

    /**
     * Export the current scene as a PNG image
     * @param {string} filename - Optional filename (default: 'rivvon-export.png')
     */
    function exportImage(filename = 'rivvon-export.png') {
        if (!ctx.renderer.value || !ctx.scene.value || !ctx.camera.value) {
            console.error('[ThreeSetup] Cannot export image - not initialized');
            return;
        }

        try {
            // Force a render to ensure the latest frame is captured
            ctx.renderer.value.render(ctx.scene.value, ctx.camera.value);

            // Get the canvas data URL
            const canvas = ctx.renderer.value.domElement;
            const dataURL = canvas.toDataURL('image/png');

            // Create a download link and trigger download
            const link = document.createElement('a');
            link.download = filename;
            link.href = dataURL;
            link.click();

            console.log('[ThreeSetup] Image exported:', filename);
        } catch (error) {
            console.error('[ThreeSetup] Failed to export image:', error);
        }
    }

    /**
     * Export the current scene as a video clip using MediaRecorder (legacy)
     * @param {Object} options - Export options
     * @param {number} options.duration - Duration in seconds (default: 5)
     * @param {number} options.fps - Frames per second (default: 30)
     * @param {string} options.filename - Output filename (default: 'rivvon-export.webm')
     * @param {Function} options.onProgress - Progress callback receiving value 0-1
     * @param {Function} options.onStart - Called when recording starts
     * @param {Function} options.onComplete - Called when recording completes with blob
     * @returns {Promise<Blob>} The recorded video blob
     */
    async function exportVideoLegacy(options = {}) {
        const {
            duration = 5,
            fps = 30,
            filename = 'rivvon-export.webm',
            onProgress = null,
            onStart = null,
            onComplete = null
        } = options;

        if (!ctx.renderer.value || !ctx.scene.value || !ctx.camera.value) {
            console.error('[ThreeSetup] Cannot export video - not initialized');
            return null;
        }

        const canvas = ctx.renderer.value.domElement;
        const stream = canvas.captureStream(fps);

        // Check for codec support - prefer VP9 for better quality
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
            ? 'video/webm;codecs=vp9'
            : 'video/webm';

        const recorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: 8000000 // 8 Mbps for good quality
        });

        const chunks = [];

        console.log(`[ThreeSetup] Starting video export: ${duration}s at ${fps}fps, codec: ${mimeType}`);

        return new Promise((resolve, reject) => {
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunks.push(e.data);
                }
            };

            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: mimeType });
                const url = URL.createObjectURL(blob);

                // Trigger download
                const link = document.createElement('a');
                link.download = filename;
                link.href = url;
                link.click();

                // Clean up
                setTimeout(() => URL.revokeObjectURL(url), 1000);

                console.log('[ThreeSetup] Video exported:', filename, `(${(blob.size / 1024 / 1024).toFixed(2)} MB)`);

                if (onComplete) onComplete(blob);
                resolve(blob);
            };

            recorder.onerror = (event) => {
                console.error('[ThreeSetup] Video export failed:', event.error);
                reject(event.error);
            };

            // Start recording
            recorder.start(100); // Collect data every 100ms for smoother progress
            if (onStart) onStart();

            // Progress tracking
            const startTime = performance.now();
            const durationMs = duration * 1000;

            const progressInterval = setInterval(() => {
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / durationMs, 1);
                if (onProgress) onProgress(progress);
            }, 100);

            // Stop after duration
            setTimeout(() => {
                clearInterval(progressInterval);
                if (recorder.state === 'recording') {
                    recorder.stop();
                }
                if (onProgress) onProgress(1);
            }, durationMs);
        });
    }

    /**
     * Render a single frame at a precise synthetic time.
     * Used by the frame-accurate video export pipeline.
     * Advances animation state by deltaSec and renders at the given wave time.
     *
     * @param {number} waveTime - Elapsed time in seconds (for undulation phase)
     * @param {number} deltaSec - Time step since last frame (for texture cycling)
     */
    function renderFrameAtTime(waveTime, deltaSec) {
        if (!ctx.renderer.value || !ctx.scene.value || !ctx.camera.value) return;

        // 1. Advance texture layer cycling + flow with deterministic delta
        if (ctx.tileManager.value?.tickDeterministic) {
            ctx.tileManager.value.tickDeterministic(deltaSec);
        }

        // 2. Swap texture pairs if flow offset crossed threshold
        if (ctx.ribbonSeries.value?.updateFlowMaterials) {
            ctx.ribbonSeries.value.updateFlowMaterials();
        }

        // 3. Update wave undulation at the exact synthetic time
        if (ctx.ribbonSeries.value) {
            ctx.ribbonSeries.value.update(waveTime);
        }

        // 4. Render
        ctx.renderer.value.render(ctx.scene.value, ctx.camera.value);
    }

    /**
     * Frame-accurate video export using WebCodecs via mediabunny.
     * Pauses the live render loop, resizes the renderer, renders each frame
     * under a synthetic clock, encodes via CanvasSource, and restores state.
     *
     * @param {Object} options
     * @param {number} options.width - Output width in pixels (default: 1920)
     * @param {number} options.height - Output height in pixels (default: 1080)
     * @param {number} options.fps - Frames per second (default: 30)
     * @param {string} options.format - 'mp4' | 'webm' (default: 'mp4')
     * @param {number|null} options.duration - Duration in seconds, or null for auto (one seamless loop)
     * @param {string} options.filename - Output filename
     * @param {Function} options.onProgress - Progress callback (0-1)
     * @param {Function} options.onStatus - Status text callback
     * @param {AbortSignal} options.signal - Optional AbortSignal to cancel export
     * @param {string} options.cameraMovement - 'none' | 'cinematic'
     * @param {string} options.quality - 'very-low' | 'low' | 'medium' | 'high' | 'very-high' (default: 'high')
     * @returns {Promise<Blob|null>} The encoded video blob, or null on cancel
     */
    async function exportVideo(options = {}) {
        const {
            width = 1920,
            height = 1080,
            fps = 30,
            format = 'mp4',
            duration = null,
            filename = null,
            onProgress = null,
            onStatus = null,
            signal = null,
            cameraMovement = 'none',
            quality = 'high'
        } = options;

        if (!ctx.renderer.value || !ctx.scene.value || !ctx.camera.value || !ctx.tileManager.value) {
            console.error('[ThreeSetup] Cannot export video — not initialized');
            return null;
        }

        // Lazy-import mediabunny to keep it tree-shaken out of the main bundle
        const MB = await import('mediabunny');

        // Check WebCodecs support
        if (typeof VideoEncoder === 'undefined') {
            throw new Error('WebCodecs API is not available in this browser. Use Chrome 94+, Edge 94+, or Firefox 130+.');
        }

        // --- Determine codec ---
        let OutputFormat, codec;
        if (format === 'webm') {
            OutputFormat = MB.WebMOutputFormat;
            codec = 'vp9';
        } else {
            OutputFormat = MB.Mp4OutputFormat;
            codec = 'avc';
        }

        // --- Calculate duration ---
        const loopDuration = ctx.tileManager.value.getSeamlessLoopDuration?.() || 3.0;
        // When cinematic is active and no explicit duration, use the cinematic timeline duration.
        // Note: exportDuration may be updated later by prepareForExport if auto-ROIs are generated.
        let exportDuration;
        if (duration != null) {
            exportDuration = duration;
        } else if (cameraMovement === 'cinematic' && ctx.cinematicCamera.hasROIs.value) {
            exportDuration = ctx.cinematicCamera.getLoopDuration();
        } else {
            exportDuration = loopDuration;
        }
        const deltaSec = 1 / fps;

        // --- Save current state ---
        const savedWidth = ctx.renderer.value.domElement.width;
        const savedHeight = ctx.renderer.value.domElement.height;
        const savedAspect = ctx.camera.value.aspect;
        const savedPixelRatio = ctx.renderer.value.getPixelRatio();
        const savedCameraPos = ctx.camera.value.position.clone();
        const savedCameraQuat = ctx.camera.value.quaternion.clone();

        // --- Cinematic camera setup for export ---
        let cinematicReady = false;
        if (cameraMovement === 'cinematic') {
            const inst = ctx.cinematicCamera.getInstance();
            if (inst) {
                // Pass ribbonSeries so auto-ROIs can be generated if none exist
                cinematicReady = inst.prepareForExport(ctx.ribbonSeries.value);
                if (cinematicReady) {
                    // Re-compute duration from the (possibly auto-generated) timeline
                    if (duration == null) {
                        exportDuration = inst.getLoopDuration();
                    }
                    console.log(`[ThreeSetup] Cinematic camera export: ${inst.roiCount} ROIs, ${inst.getLoopDuration().toFixed(1)}s loop`);
                }
            }
            if (!cinematicReady) {
                console.warn('[ThreeSetup] Cinematic camera requested but no ROIs — camera will stay fixed');
            }
        }

        // Compute total frames (after cinematic setup which may have updated exportDuration)
        const totalFrames = Math.ceil(exportDuration * fps);

        console.log(`[ThreeSetup] Frame-accurate export: ${totalFrames} frames, ${exportDuration.toFixed(2)}s @ ${fps}fps, ${format}/${codec}, ${width}×${height}`);
        if (onStatus) onStatus(`Preparing ${format.toUpperCase()} export…`);

        // --- Pause live render loop ---
        deps.pauseRenderLoop?.();

        try {
            // --- Resize renderer for export ---
            ctx.renderer.value.setPixelRatio(1); // Exact pixel output
            ctx.renderer.value.setSize(width, height);
            ctx.camera.value.aspect = width / height;
            ctx.camera.value.updateProjectionMatrix();

            // Disable orbit control damping during export
            if (ctx.controls.value) ctx.controls.value.enabled = false;

            // --- Reset animation to t=0 ---
            ctx.tileManager.value.resetAnimationState();

            // --- Create mediabunny output ---
            const output = new MB.Output({
                format: new OutputFormat(),
                target: new MB.BufferTarget()
            });

            // Map quality preset to mediabunny subjective quality constants
            const qualityMap = {
                'very-low': MB.QUALITY_VERY_LOW,
                'low': MB.QUALITY_LOW,
                'medium': MB.QUALITY_MEDIUM,
                'high': MB.QUALITY_HIGH,
                'very-high': MB.QUALITY_VERY_HIGH,
            };
            const bitrate = qualityMap[quality] ?? MB.QUALITY_HIGH;

            const videoSource = new MB.CanvasSource(ctx.renderer.value.domElement, {
                codec,
                bitrate
            });
            output.addVideoTrack(videoSource);

            await output.start();

            if (onStatus) onStatus(`Encoding ${totalFrames} frames…`);

            // --- Frame loop ---
            for (let frame = 0; frame < totalFrames; frame++) {
                // Check for cancellation
                if (signal?.aborted) {
                    console.log('[ThreeSetup] Export cancelled by user');
                    await output.finalize();
                    return null;
                }

                const t = frame * deltaSec;

                // --- Cinematic camera animation ---
                if (cinematicReady) {
                    ctx.cinematicCamera.getInstance().updateAtTime(t);
                }

                // Render this frame at the exact synthetic time
                renderFrameAtTime(t, deltaSec);

                // Feed the rendered frame to mediabunny
                await videoSource.add(t, deltaSec);

                // Report progress
                if (onProgress) onProgress((frame + 1) / totalFrames);
            }

            // --- Finalize ---
            if (onStatus) onStatus('Finalizing…');
            await output.finalize();

            const buffer = output.target.buffer;
            const mimeType = format === 'webm' ? 'video/webm' : 'video/mp4';
            const blob = new Blob([buffer], { type: mimeType });

            console.log(`[ThreeSetup] Export complete: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);

            // --- Auto-download if filename provided ---
            if (filename) {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.download = filename;
                link.href = url;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 5000);
            }

            return blob;
        } finally {
            // --- Restore renderer state ---
            ctx.renderer.value.setPixelRatio(savedPixelRatio);
            ctx.renderer.value.setSize(
                savedWidth / savedPixelRatio,
                savedHeight / savedPixelRatio
            );
            ctx.camera.value.aspect = savedAspect;
            ctx.camera.value.updateProjectionMatrix();

            if (ctx.controls.value) ctx.controls.value.enabled = true;

            // Restore camera position and orientation
            ctx.camera.value.position.copy(savedCameraPos);
            ctx.camera.value.quaternion.copy(savedCameraQuat);

            // Reset animation state back so live view starts clean
            ctx.tileManager.value.resetAnimationState();

            // Resume live render loop
            deps.resumeRenderLoop?.();
        }
    }

    /**
     * Get export metadata for the UI (cycle duration, available codecs, etc.)
     * @returns {Object} Export info
     */
    function getExportInfo() {
        const tm = ctx.tileManager.value;
        return {
            seamlessLoopDuration: tm?.getSeamlessLoopDuration?.() ?? 3.0,
            layerCyclePeriod: tm?.getLayerCyclePeriod?.() ?? 1.0,
            undulationPeriod: tm?.getOptimalUndulationPeriod?.(3.0) ?? 3.0,
            layerCount: tm?.getLayerCount?.() ?? 0,
            fps: tm?.getFps?.() ?? 30,
            flowEnabled: tm?.isFlowEnabled?.() ?? false,
            flowSpeed: tm?.getFlowSpeed?.() ?? 0,
            tileCount: tm?.getTileCount?.() ?? 0,
            hasWebCodecs: typeof VideoEncoder !== 'undefined',
            hasROIs: ctx.cinematicCamera.hasROIs.value,
            cinematicDuration: ctx.cinematicCamera.getLoopDuration()
        };
    }

    return {
        exportImage,
        exportVideoLegacy,
        exportVideo,
        renderFrameAtTime,
        getExportInfo
    };
}
