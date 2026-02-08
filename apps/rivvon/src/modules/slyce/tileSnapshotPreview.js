/**
 * TileSnapshotPreview — Per-tile canvas snapshot preview
 *
 * Tile.vue owns the <canvas> element and registers it here on mount.
 * This module draws scaled snapshots of TileBuilder's layer 0 canvas
 * directly to those DOM-owned canvases — synchronous drawImage, no Vue
 * reactivity in the hot path, no flicker.
 *
 * After a tile completes, bake() converts the canvas to a static blob URL
 * for persistent display (survives component re-mounts).
 *
 * Usage:
 *   // Tile.vue — on mount:
 *   registerTileCanvas(index, canvasElement);
 *
 *   // videoProcessor — per frame:
 *   preview.snapshot(tileIndex, sourceCanvas);
 *
 *   // videoProcessor — on tile complete:
 *   await preview.bake(tileIndex);
 */

/** Maximum pixel dimension for the preview canvas (longest side) */
const MAX_PREVIEW_DIM = 256;

// ── Module-level canvas registry ──────────────────────────────────────
// Tile.vue registers its <canvas> on mount, unregisters on unmount.
// snapshot() looks up canvases here — no Vue reactivity involved.

/** @type {Map<number, { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D }>} */
const canvasRegistry = new Map();

/**
 * Register a Tile component's canvas for snapshot drawing.
 * Called from Tile.vue onMounted().
 * @param {number} tileIndex
 * @param {HTMLCanvasElement} canvas
 */
export function registerTileCanvas(tileIndex, canvas) {
    const ctx = canvas.getContext('2d');
    canvasRegistry.set(tileIndex, { canvas, ctx });
}

/**
 * Unregister a Tile component's canvas.
 * Called from Tile.vue onBeforeUnmount().
 * @param {number} tileIndex
 */
export function unregisterTileCanvas(tileIndex) {
    canvasRegistry.delete(tileIndex);
}

/** Clear all registrations (e.g. on full reset). */
export function clearCanvasRegistry() {
    canvasRegistry.clear();
}


export class TileSnapshotPreview {

    /**
     * @param {Object} options
     * @param {Object} options.tilePlan - Tile plan object (tiles[], width, height)
     * @param {number} [options.snapshotInterval=3] - Snapshot every Nth frame (1 = every frame)
     */
    constructor({ tilePlan, snapshotInterval = 3 }) {
        this.tilePlan = tilePlan;
        this.snapshotInterval = snapshotInterval;

        // Derive preview dimensions that maintain tile aspect ratio
        const scale = Math.min(
            MAX_PREVIEW_DIM / tilePlan.width,
            MAX_PREVIEW_DIM / tilePlan.height,
            1
        );
        this.previewWidth = Math.round(tilePlan.width * scale);
        this.previewHeight = Math.round(tilePlan.height * scale);

        /** @type {Map<number, string>} Baked blob URLs (after tile completion) */
        this._bakedUrls = new Map();

        // Total frames across all tiles (for progress)
        const lastTile = tilePlan.tiles[tilePlan.tiles.length - 1];
        this.totalFrames = lastTile.end;

        this.framesSeen = 0;
        this.disposed = false;

        /**
         * Callback: invoked when a tile is baked to a blob URL.
         * @type {((tileIndex: number, blobUrl: string) => void)|null}
         */
        this.onBaked = null;
    }

    /**
     * Snapshot a tile's in-progress layer canvas onto its preview canvas.
     * Called after TileBuilder.processFrame(). Internally throttled.
     * Looks up the canvas from the module-level registry (registered by Tile.vue).
     * Direct drawImage — synchronous, no flicker, no Vue reactivity.
     *
     * @param {number} tileIndex - 0-based tile number
     * @param {OffscreenCanvas|HTMLCanvasElement} sourceCanvas - Layer 0 canvas from TileBuilder
     */
    snapshot(tileIndex, sourceCanvas) {
        if (this.disposed) return;

        this.framesSeen++;

        // Throttle: only draw every Nth frame
        if (this.framesSeen % this.snapshotInterval !== 0) return;

        const entry = canvasRegistry.get(tileIndex);
        if (!entry) return;

        const { canvas, ctx } = entry;

        // Size the canvas on first draw (may still be default 300×150)
        if (canvas.width !== this.previewWidth || canvas.height !== this.previewHeight) {
            canvas.width = this.previewWidth;
            canvas.height = this.previewHeight;
        }

        // Scale entire source canvas down to the small preview — synchronous
        ctx.drawImage(
            sourceCanvas,
            0, 0, sourceCanvas.width, sourceCanvas.height,
            0, 0, this.previewWidth, this.previewHeight
        );

        // Make the canvas visible after first successful draw (direct DOM, no Vue)
        if (!canvas.dataset.hasContent) {
            canvas.dataset.hasContent = '1';
        }
    }

    /**
     * Bake a tile's live canvas into a static blob URL.
     * Called when a tile finishes processing.
     *
     * @param {number} tileIndex
     * @returns {Promise<string|null>} The blob URL, or null if canvas not found
     */
    async bake(tileIndex) {
        const entry = canvasRegistry.get(tileIndex);
        if (!entry) return null;

        try {
            const blob = await new Promise((resolve, reject) => {
                entry.canvas.toBlob(
                    b => b ? resolve(b) : reject(new Error('toBlob failed')),
                    'image/png'
                );
            });

            const url = URL.createObjectURL(blob);
            this._bakedUrls.set(tileIndex, url);

            if (this.onBaked) {
                this.onBaked(tileIndex, url);
            }

            return url;
        } catch {
            return null;
        }
    }

    /** Number of tiles that have been drawn to or baked */
    get tileCount() {
        return this._bakedUrls.size;
    }

    /** Revoke all baked blob URLs and release resources */
    dispose() {
        this.disposed = true;
        for (const [, url] of this._bakedUrls) {
            URL.revokeObjectURL(url);
        }
        this._bakedUrls.clear();
        // Don't clear canvasRegistry — Tile.vue manages its own lifecycle
        console.log('[TileSnapshotPreview] Disposed');
    }
}
