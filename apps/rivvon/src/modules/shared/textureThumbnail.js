import { Ktx2TranscodeWorkerClient } from '../slyce/ktx2TranscodeWorkerClient.js';

/** Match texture creation: the first layer of the first tile, scaled to 512px. */
export async function createTextureThumbnail(tiles) {
    const tile = tiles.find(tile => Number(tile.index ?? tile.tile_index ?? tile.tileIndex) === 0);
    if (!tile?.blob) throw new Error('The first texture tile is unavailable for thumbnail generation.');
    if (!tile.blob.size) throw new Error('The texture tile is empty. Restore or re-upload the original texture before regenerating its thumbnail.');
    const buffer = await tile.blob.arrayBuffer();
    const decoder = new Ktx2TranscodeWorkerClient();
    try {
        await decoder.openFile('thumbnail', buffer);
        const { buffer: rgba, width, height } = await decoder.decodeLayer('thumbnail', 0);
        const source = new OffscreenCanvas(width, height);
        const context = source.getContext('2d');
        if (!context) throw new Error('Unable to create thumbnail canvas.');
        context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
        const scale = Math.min(1, 512 / Math.max(width, height));
        const thumbnail = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
        const thumbnailContext = thumbnail.getContext('2d');
        if (!thumbnailContext) throw new Error('Unable to create thumbnail canvas.');
        thumbnailContext.imageSmoothingEnabled = true;
        thumbnailContext.imageSmoothingQuality = 'high';
        thumbnailContext.drawImage(source, 0, 0, thumbnail.width, thumbnail.height);
        return await thumbnail.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    } finally {
        // Terminating the dedicated worker also releases its Basis file and WASM heap.
        decoder.terminate();
    }
}
