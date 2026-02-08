/**
 * ScanlinePreview — Lightweight per-tile snapshot preview
 *
 * Instead of drawing individual scanlines, this periodically snapshots the
 * first layer (canvas 0) of each tile's OffscreenCanvas as TileBuilder is
 * assembling it. Each tile gets a small preview canvas that shows a scaled-
 * down copy of the in-progress texture — like a developing photograph.
 *
 * Advantages over the old per-scanline approach:
 * - No sampling-mode / cross-section math — TileBuilder already did the work
 * - One drawImage call that the browser downscales natively
 * - Preview canvas is fixed & small (max 256px) regardless of frame count
 * - The preview shows the actual texture, not an abstract cross-section
 */

/** Maximum pixel dimension for the preview canvas (longest side) */
const MAX_PREVIEW_DIM = 256;

export class ScanlinePreview {

    /**
     * @param {Object} options
     * @param {Object} options.tilePlan - Tile plan object (tiles[], width, height)
     * @param {number} [options.snapshotInterval=3] - Draw every Nth frame (1 = every frame)
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

        /** @type {Map<number, { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D }>} */
        this.tiles = new Map();

        // Total frames across all tiles (for progress counter)
        const lastTile = tilePlan.tiles[tilePlan.tiles.length - 1];
        this.totalFrames = lastTile.end;

        this.framesSeen = 0;       // global frame counter
        this.container = null;
        this.disposed = false;

        /** Callback invoked when a new tile preview canvas is created */
        this.onTileCreated = null;
    }

    /**
     * Set the container element. Preview canvases are appended here lazily.
     * @param {HTMLElement} container
     */
    init(container) {
        this.container = container;
        console.log(
            `[ScanlinePreview] Initialized — ${this.tilePlan.tiles.length} tiles, ` +
            `preview ${this.previewWidth}×${this.previewHeight}, interval=${this.snapshotInterval}`
        );
    }

    /**
     * Get or create the small preview canvas for a tile.
     * @param {number} tileIndex
     * @returns {{ canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D }}
     */
    _getOrCreateTile(tileIndex) {
        if (this.tiles.has(tileIndex)) {
            return this.tiles.get(tileIndex);
        }

        const canvas = document.createElement('canvas');
        canvas.width = this.previewWidth;
        canvas.height = this.previewHeight;
        canvas.dataset.tile = tileIndex;

        canvas.style.imageRendering = 'pixelated';
        canvas.style.borderRadius = '0.25rem';
        canvas.style.boxShadow = '0 2px 12px rgba(0, 0, 0, 0.3)';
        canvas.style.width = '100%';
        canvas.style.height = 'auto';

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, this.previewWidth, this.previewHeight);

        const entry = { canvas, ctx };
        this.tiles.set(tileIndex, entry);

        if (this.container) {
            this.container.appendChild(canvas);
        }
        if (this.onTileCreated) {
            this.onTileCreated(tileIndex, canvas);
        }

        console.log(`[ScanlinePreview] Created tile ${tileIndex} preview: ${this.previewWidth}×${this.previewHeight}`);
        return entry;
    }

    /**
     * Snapshot a tile's in-progress layer canvas onto its preview canvas.
     * Called after TileBuilder.processFrame() so the source is up-to-date.
     * Internally throttled by snapshotInterval.
     *
     * @param {number} tileIndex - 0-based tile number
     * @param {OffscreenCanvas|HTMLCanvasElement} sourceCanvas - The layer 0 canvas from TileBuilder
     */
    snapshot(tileIndex, sourceCanvas) {
        if (this.disposed) return;

        this.framesSeen++;

        // Throttle: only draw every Nth frame
        if (this.framesSeen % this.snapshotInterval !== 0) return;

        const tile = this._getOrCreateTile(tileIndex);

        // Scale entire source canvas down to the small preview
        tile.ctx.drawImage(
            sourceCanvas,
            0, 0, sourceCanvas.width, sourceCanvas.height,
            0, 0, this.previewWidth, this.previewHeight
        );
    }

    /** Number of tile previews created so far */
    get tileCount() {
        return this.tiles.size;
    }

    /** Remove all canvases from DOM and release resources */
    dispose() {
        this.disposed = true;
        for (const [, entry] of this.tiles) {
            if (entry.canvas?.parentNode) {
                entry.canvas.parentNode.removeChild(entry.canvas);
            }
        }
        this.tiles.clear();
        this.container = null;
        console.log('[ScanlinePreview] Disposed');
    }
}
