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
 * Emits 'complete' when a tile's rows are fully sampled, providing both the
 * canvas set (for continued preview display) and extracted RGBA images
 * (for KTX2 encoding).
 */

import { EventEmitter } from 'events';

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
            crossSectionCount = 30,
            crossSectionType = 'planes',
            totalFrames = null
        } = options;

        this.potResolution = potResolution;
        this.crossSectionCount = crossSectionCount;
        this.crossSectionType = crossSectionType;
        this._totalFrames = totalFrames;

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
            for (let i = 0; i < crossSectionCount; i++) {
                const normalizedIndex = (i / (crossSectionCount - 1)) * Math.PI;
                this._cosineIndices[i] = (Math.cos(normalizedIndex) + 1) / 2;
            }
        } else {
            // Pre-compute per-canvas phase shifts for sine wave distribution
            this._phaseShifts = new Float64Array(crossSectionCount);
            for (let i = 0; i < crossSectionCount; i++) {
                this._phaseShifts[i] = (2 * Math.PI * i) / crossSectionCount;
            }
            this._omega = (2 * Math.PI) / totalFrames; // angular frequency
        }

        // Claim initial canvas set and start first tile
        this._currentCanvasSet = this.claimCanvasSet();
    }

    /**
     * Get a canvas set from the pool, or create a new one.
     * @returns {OffscreenCanvas[]} Array of crossSectionCount canvases.
     */
    claimCanvasSet() {
        if (this._canvasPool.length > 0) {
            const set = this._canvasPool.pop();
            // Clear canvases for reuse
            for (const canvas of set) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, this.potResolution, this.potResolution);
            }
            return set;
        }

        // Create new set — use regular HTMLCanvasElement so Three.js
        // can upload them as textures via texImage2D (OffscreenCanvas is
        // not reliably supported as a THREE.Texture source).
        const set = [];
        for (let i = 0; i < this.crossSectionCount; i++) {
            const c = document.createElement('canvas');
            c.width = this.potResolution;
            c.height = this.potResolution;
            // Acquire 2D context immediately so WebGPU's
            // copyExternalImageToTexture can extract valid image data
            // when this canvas is used as a texture source.
            c.getContext('2d').clearRect(0, 0, this.potResolution, this.potResolution);
            set.push(c);
        }
        return set;
    }

    /**
     * Return a canvas set to the pool for reuse.
     * Called by the orchestrator when KTX2 encoding completes.
     * @param {OffscreenCanvas[]} set
     */
    releaseCanvasSet(set) {
        if (set && set.length === this.crossSectionCount) {
            this._canvasPool.push(set);
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

        for (let c = 0; c < this.crossSectionCount; c++) {
            const ctx = canvasSet[c].getContext('2d');

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
                videoFrame,
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

            // Extract RGBA data for KTX2 encoding
            const images = completedCanvasSet.map(canvas => {
                const ctx = canvas.getContext('2d');
                const imageData = ctx.getImageData(0, 0, this.potResolution, this.potResolution);
                return {
                    rgba: imageData.data,
                    width: this.potResolution,
                    height: this.potResolution
                };
            });

            // Start next tile immediately with a fresh canvas set
            // (must advance BEFORE emitting — emit is synchronous and
            // the handler reads currentTileId / _currentCanvasSet)
            this._currentTileId++;
            this._currentRow = 0;
            this._currentCanvasSet = this.claimCanvasSet();

            // Emit completion — orchestrator gets both canvasSet (for preview)
            // and images (for KTX2 encoding)
            this.emit('complete', {
                tileId: completedTileId,
                canvasSet: completedCanvasSet,
                images
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

    /**
     * Get the first canvas of the current tile being built.
     * Useful for rendering a live preview in the sampling screen.
     * @returns {HTMLCanvasElement|null}
     */
    getCurrentPreviewCanvas() {
        return this._currentCanvasSet?.[0] ?? null;
    }

    /**
     * Dispose all resources. Called on stop.
     */
    dispose() {
        this._currentCanvasSet = null;
        this._canvasPool = [];
        this.removeAllListeners();
    }
}
