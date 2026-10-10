import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSlyceStore } from '../../stores/slyceStore.js';
import { TileSnapshotPreview, registerTileCanvas, clearCanvasRegistry } from './tileSnapshotPreview.js';

const tilePlan = { width: 256, height: 256, tiles: [{ start: 1, end: 10 }] };

beforeEach(() => {
    setActivePinia(createPinia());
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
    clearCanvasRegistry();
    vi.restoreAllMocks();
});

describe('tile previews across canceled workflows', () => {
    it.each(['resetProcessing', 'resetForNewFileSelection', 'reset'])('%s clears baked and live previews', async (reset) => {
        const ctx = { drawImage: vi.fn(), clearRect: vi.fn() };
        const canvas = { width: 256, height: 256, dataset: {}, getContext: () => ctx,
            toBlob: callback => callback(new Blob(['preview'])) };
        registerTileCanvas(0, canvas);
        const store = useSlyceStore();
        const preview = new TileSnapshotPreview({ tilePlan, snapshotInterval: 1 });
        preview.onBaked = (index, url) => store.setTilePreviewUrl(index, url);
        store.tileSnapshotPreview = preview;
        store.tilePlan = tilePlan;
        preview.snapshot(0, canvas);
        await preview.bake(0);
        store.status = { 'Processing Error': 'Video processing aborted.' };
        expect(canvas.dataset.hasContent).toBe('1');

        store[reset]();

        expect(preview.disposed).toBe(true);
        expect(store.tileSnapshotPreview).toBeNull();
        expect(store.tilePreviewUrls).toEqual({});
        expect(store.tilePlan).toEqual({});
        expect(store.status).toEqual({});
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
        expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 256, 256);
        expect(canvas.dataset.hasContent).toBeUndefined();

        // A still-mounted canvas stays registered for the next video.
        const nextPreview = new TileSnapshotPreview({ tilePlan, snapshotInterval: 1 });
        nextPreview.snapshot(0, canvas);
        expect(canvas.dataset.hasContent).toBe('1');
        expect(ctx.drawImage).toHaveBeenCalledTimes(2);
    });

    it('does not publish a bake that finishes after cancellation', async () => {
        let finishBake;
        registerTileCanvas(0, { getContext: () => ({}), toBlob: callback => { finishBake = callback; } });
        const preview = new TileSnapshotPreview({ tilePlan });
        preview.onBaked = vi.fn();
        const pendingBake = preview.bake(0);
        preview.dispose();
        finishBake(new Blob(['old preview']));

        expect(await pendingBake).toBeNull();
        expect(preview.onBaked).not.toHaveBeenCalled();
        expect(URL.createObjectURL).not.toHaveBeenCalled();
        expect(await preview.bake(0)).toBeNull();
    });
});
