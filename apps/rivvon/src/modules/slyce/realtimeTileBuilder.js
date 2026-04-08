/**
 * RealtimeTileBuilder — Streaming cross-section builder for realtime webcam mode.
 *
 * Maintains a pool of canvas sets. Each tile in progress holds its own canvas set
 * (claimed from the pool). Processes one row per canvas per VideoFrame.
 *
 * Supports two cross-section types:
 *   - "planes": Cosine distribution — each canvas has a fixed sample Y position.
 *   - "waves":  Sine wave distribution — sample Y oscillates per frame.
 *              Requires a known total frame count so the wave completes full cycles.
 *
 * Emits 'complete' when a tile's rows are fully sampled, providing the
 * canvas set so the orchestrator can keep previewing it and later extract
 * RGBA for KTX2 encoding.
 */

import { EventEmitter } from 'events';
import { getCached2dContext } from './samplingRuntime.js';
import { createRealtimeCanvas } from './realtimeCanvasSupport.js';

/** @typedef {OffscreenCanvas|HTMLCanvasElement} RealtimeTileCanvas */

let realtimeTileBuilderIdCounter = 0;

export class RealtimeTileBuilder extends EventEmitter {
    /**
     * @param {Object} options
     * @param {number} options.potResolution      — Square tile resolution (128, 256, 512). Default 256.
     * @param {number} options.crossSectionCount  — Number of cross-section canvases per tile. Default 30.
     * @param {string} options.crossSectionType   — 'planes' or 'waves'. Default 'planes'.
     * @param {number} [options.totalFrames]      — Total frames that will be captured. Required for 'waves'.
     */
    constructor(options = {}) {
        super();
        const {
            potResolution = 256,
            crossSectionCount: requestedCrossSectionCount = 30,
            crossSectionType = 'planes',
            totalFrames = null
        } = options;

        const crossSectionCount = Number.isFinite(requestedCrossSectionCount)
            ? Math.max(1, Math.round(requestedCrossSectionCount))
            : 30;

        this.potResolution = potResolution;
        this.crossSectionCount = crossSectionCount;
        this.crossSectionType = crossSectionType;
        this.debugId = ++realtimeTileBuilderIdCounter;
        this._totalFrames = totalFrames;
        this._stagingCanvas = null;
        this._stagingCtx = null;
        this._loggedLayerDiversity = false;
        this._isDisposed = false;

        // Canvas pool: array of canvas sets available for reuse
        this._canvasPool = [];

        // Current tile being built
        this._currentTileId = 0;
        this._currentRow = 0;
        this._currentCanvasSet = null;

        // Global frame index — increments continuously across tiles.
        // Used by waves mode to track position in the sine cycle.
        this._globalFrameIndex = 0;

        if (crossSectionType === 'planes') {
            // Pre-compute cosine distribution sample indices
            // These don't change per tile — only depend on crossSectionCount
            this._cosineIndices = new Float64Array(crossSectionCount);
            if (crossSectionCount === 1) {
                this._cosineIndices[0] = 0.5;
            } else {
                for (let i = 0; i < crossSectionCount; i++) {
                    const normalizedIndex = (i / (crossSectionCount - 1)) * Math.PI;
                    this._cosineIndices[i] = (Math.cos(normalizedIndex) + 1) / 2;
                }
            }
        } else {
            // Pre-compute per-canvas phase shifts for sine wave distribution
            this._phaseShifts = new Float64Array(crossSectionCount);
            for (let i = 0; i < crossSectionCount; i++) {
                this._phaseShifts[i] = (2 * Math.PI * i) / crossSectionCount;
            }
            this._omega = totalFrames ? (2 * Math.PI) / totalFrames : 0; // angular frequency
        }

        // Claim initial canvas set and start first tile
        this._currentCanvasSet = this.claimCanvasSet();

        console.log(`[RealtimeTileBuilder#${this.debugId}] Using staging canvas for realtime frame sampling`);
    }

    #getSamplingSource(videoFrame, frameWidth, frameHeight) {
        const needsCanvas = !this._stagingCanvas
            || this._stagingCanvas.width !== frameWidth
            || this._stagingCanvas.height !== frameHeight;

        if (needsCanvas) {
            const { canvas, ctx } = createRealtimeCanvas(frameWidth, frameHeight);
            this._stagingCanvas = canvas;
            this._stagingCtx = ctx;
        }

        this._stagingCtx.clearRect(0, 0, frameWidth, frameHeight);
        this._stagingCtx.drawImage(videoFrame, 0, 0, frameWidth, frameHeight);
        return this._stagingCanvas;
    }

    #logLayerDiversity(canvasSet, tileId) {
        if (this._loggedLayerDiversity || !Array.isArray(canvasSet) || canvasSet.length === 0) {
            return;
        }

        const signatures = new Set();

        for (const canvas of canvasSet) {
            const ctx = getCached2dContext(canvas);
            if (!ctx) continue;

            const sampleWidth = Math.min(16, canvas.width);
            const sampleY = Math.max(0, Math.min(canvas.height - 1, Math.floor(canvas.height / 2)));
            const bytes = ctx.getImageData(0, sampleY, sampleWidth, 1).data;
            let hash = 2166136261;

            for (let i = 0; i < bytes.length; i++) {
                hash ^= bytes[i];
                hash = Math.imul(hash, 16777619);
            }

            signatures.add((hash >>> 0).toString(16));
        }

        console.log(`[RealtimeTileBuilder] Tile ${tileId} layer diversity: ${signatures.size}/${canvasSet.length} unique mid-row signatures`);

        this._loggedLayerDiversity = true;
    }

    /**
     * Get a canvas set from the pool, or create a new one.
     * @returns {RealtimeTileCanvas[]} Array of crossSectionCount canvases.
     */
    claimCanvasSet() {
        if (this._canvasPool.length > 0) {
            const set = this._canvasPool.pop();
            // Clear canvases for reuse
            for (const canvas of set) {
                const ctx = getCached2dContext(canvas);
                ctx.clearRect(0, 0, this.potResolution, this.potResolution);
            }
            console.log(`[RealtimeTileBuilder#${this.debugId}] Reusing canvas set from pool (${this._canvasPool.length} remaining).`);
            return set;
        }

        const set = [];
        for (let i = 0; i < this.crossSectionCount; i++) {
            const { canvas: c, ctx } = createRealtimeCanvas(this.potResolution, this.potResolution);

            // Keep the live sampling canvases write-optimised.
            // Full-canvas readback is deferred until tile completion.
            if (!ctx) {
                throw new Error('RealtimeTileBuilder requires a 2D canvas context.');
            }

            ctx.clearRect(0, 0, this.potResolution, this.potResolution);
            set.push(c);
        }
        console.log(`[RealtimeTileBuilder#${this.debugId}] Created new canvas set (${this.crossSectionCount} layers at ${this.potResolution}x${this.potResolution}).`);
        return set;
    }

    /**
     * Return a canvas set to the pool for reuse.
     * Called by the orchestrator when KTX2 encoding completes.
     * @param {RealtimeTileCanvas[]} set
     */
    releaseCanvasSet(set) {
        // Cap pool at 2 sets — more would just accumulate memory
        if (set && set.length === this.crossSectionCount && this._canvasPool.length < 2) {
            this._canvasPool.push(set);
            console.log(`[RealtimeTileBuilder#${this.debugId}] Returned canvas set to pool (pool size ${this._canvasPool.length}).`);
        } else {
            console.warn(`[RealtimeTileBuilder#${this.debugId}] Dropped canvas set instead of pooling.`, {
                hasSet: !!set,
                layerCount: set?.length ?? null,
                expectedLayers: this.crossSectionCount,
                poolSize: this._canvasPool.length,
            });
        }
    }

    /**
     * Process a single video frame. Samples one row per canvas using the
     * configured cross-section type (cosine distribution for planes,
     * sine wave for waves).
     *
     * @param {VideoFrame|ImageBitmap} videoFrame — The frame to sample from.
     *   Caller should NOT close the frame — this method closes it.
     */
    processFrame(videoFrame) {
        const frameHeight = videoFrame.displayHeight || videoFrame.height;
        const frameWidth = videoFrame.displayWidth || videoFrame.width;
        const drawRow = this._currentRow;
        const canvasSet = this._currentCanvasSet;
        const samplingSource = this.#getSamplingSource(videoFrame, frameWidth, frameHeight);

        for (let c = 0; c < this.crossSectionCount; c++) {
            const ctx = getCached2dContext(canvasSet[c]);

            let sampleY;
            if (this.crossSectionType === 'waves') {
                // Sine wave: Y oscillates per frame, phase-shifted per canvas.
                // A full sine cycle spans totalFrames, so the pattern wraps.
                const halfH = frameHeight / 2;
                sampleY = halfH * Math.sin(this._omega * this._globalFrameIndex + this._phaseShifts[c]) + halfH;
                sampleY = Math.max(0, Math.min(frameHeight - 1, sampleY));
            } else {
                // Planes: fixed cosine-distributed sample position per canvas
                sampleY = this._cosineIndices[c] * (frameHeight - 1);
            }

            // Sample a 1px-tall strip from video, draw across the full canvas width at drawRow
            ctx.drawImage(
                samplingSource,
                0, sampleY, frameWidth, 1,       // source: full width, 1px at sampleY
                0, drawRow, this.potResolution, 1 // dest: full tile width, 1px at drawRow
            );
        }

        this._globalFrameIndex++;

        // Close the video frame to release memory
        if (videoFrame.close) {
            videoFrame.close();
        }

        this._currentRow++;

        // Check if tile is complete
        if (this._currentRow >= this.potResolution) {
            const completedTileId = this._currentTileId;
            const completedCanvasSet = this._currentCanvasSet;

            this.#logLayerDiversity(completedCanvasSet, completedTileId);

            // Start next tile immediately with a fresh canvas set
            // (must advance BEFORE emitting — emit is synchronous and
            // the handler reads currentTileId / _currentCanvasSet)
            this._currentTileId++;
            this._currentRow = 0;
            this._currentCanvasSet = this.claimCanvasSet();

            console.log(`[RealtimeTileBuilder#${this.debugId}] Tile ${completedTileId} complete; handing off ${completedCanvasSet.length} canvas layers.`);

            // Emit completion with canvasSet only — the orchestrator
            // extracts RGBA via getImageData after acquiring an encode
            // slot so the expensive readback never blocks the frame loop.
            this.emit('complete', {
                tileId: completedTileId,
                canvasSet: completedCanvasSet
            });
        }
    }

    /** Current tile ID being built. */
    get currentTileId() {
        return this._currentTileId;
    }

    /** Current row within the tile being built (0 to potResolution-1). */
    get currentRow() {
        return this._currentRow;
    }

    /** Tile height (= potResolution). */
    get tileHeight() {
        return this.potResolution;
    }

    /** Global frame index — total frames processed since construction. */
    get globalFrameIndex() {
        return this._globalFrameIndex;
    }

    /** Whether all required frames have been captured (waves mode). */
    get isComplete() {
        return this._totalFrames !== null && this._globalFrameIndex >= this._totalFrames;
    }

    get samplingSourceMode() {
        return 'staging-canvas';
    }

    /**
     * Get the first canvas of the current tile being built.
     * Useful for rendering a live preview in the sampling screen.
     * @returns {RealtimeTileCanvas|null}
     */
    getCurrentPreviewCanvas() {
        return this._currentCanvasSet?.[0] ?? null;
    }

    getDebugInfo() {
        return {
            debugId: this.debugId,
            disposed: this._isDisposed,
            currentTileId: this._currentTileId,
            currentRow: this._currentRow,
            poolSize: this._canvasPool.length,
            hasCurrentCanvasSet: !!this._currentCanvasSet,
        };
    }

    /**
     * Dispose all resources. Called on stop.
     */
    dispose() {
        this._isDisposed = true;
        console.log(`[RealtimeTileBuilder#${this.debugId}] Disposed.`, this.getDebugInfo());
        this._currentCanvasSet = null;
        this._canvasPool = [];
        this._stagingCanvas = null;
        this._stagingCtx = null;
        this.removeAllListeners();
    }
}
