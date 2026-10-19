import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSdrVideoExport } from './sdrVideoExport.js';
import { createSdrEncoderPool } from './sdrEncoderPool.js';
import { restoreCfrMp4Timing, assertSdrMp4 } from './videoColourMetadata.js';

vi.mock('./sdrEncoderPool.js', () => ({ createSdrEncoderPool: vi.fn() }));
vi.mock('./exportColour.js', async importOriginal => ({
    ...await importOriginal(),
    rgbaToBt709I420: (data, _width, _height, target) => { target[0] = data[0]; },
}));
vi.mock('./videoColourMetadata.js', () => ({
    restoreCfrMp4Timing: vi.fn(), assertSdrMp4: vi.fn(() => ({ verified: true })),
}));

let pool, context, nextFrame;
beforeEach(() => {
    vi.clearAllMocks();
    nextFrame = 1;
    context = { getContextAttributes: () => ({ colorSpace: 'srgb' }), fillRect: vi.fn(), drawImage: vi.fn(),
        getImageData: () => ({ data: new Uint8Array([nextFrame++]) }) };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
    pool = { workerLimit: 3, workerCount: 3, check: vi.fn(), dispose: vi.fn(),
        mux: vi.fn(async () => new Uint8Array([1, 2, 3])),
        submit: vi.fn(async (readFrames, frames) => {
            const data = readFrames();
            return { frames, first: data[0], last: data[data.length - data.length / frames], bytes: data.length };
        }) };
    createSdrEncoderPool.mockResolvedValue(pool);
});
afterEach(() => vi.unstubAllGlobals());

describe('pooled SDR canvas export', () => {
    it('submits full and partial batches, drains before verification, and reports worker counts', async () => {
        const onColourMetadata = vi.fn(), onStatus = vi.fn();
        const writer = await createSdrVideoExport({}, { width: 2048, height: 2048, fps: 30,
            totalFrames: 12, onColourMetadata, onStatus, logoOverlayEnabled: false });
        expect(createSdrEncoderPool).toHaveBeenCalledWith(expect.objectContaining({ workerLimit: 3, onStatus }));
        for (let n = 0; n < 12; n++) await writer.add();
        expect(pool.submit).toHaveBeenCalledTimes(2);
        const blob = await writer.finalize();
        expect(await blob.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
        const batches = await Promise.all(pool.submit.mock.results.map(result => result.value));
        expect(batches.map(({ frames, first, last }) => ({ frames, first, last }))).toEqual([
            { frames: 5, first: 1, last: 5 }, { frames: 5, first: 6, last: 10 }, { frames: 2, first: 11, last: 12 },
        ]);
        expect(batches.every(batch => batch.bytes <= 32 * 1024 * 1024)).toBe(true);
        expect(pool.mux).toHaveBeenCalledOnce();
        expect(restoreCfrMp4Timing).toHaveBeenCalledWith(expect.any(Uint8Array), { fps: 30, frames: 12 });
        expect(assertSdrMp4).toHaveBeenCalledWith(expect.any(Uint8Array), { width: 2048, height: 2048, fps: 30, frames: 12 });
        expect(onColourMetadata.mock.calls.at(-1)[0]).toMatchObject({ phase: 'complete', workerCount: 3, workerLimit: 3 });
        expect(pool.dispose).toHaveBeenCalledOnce();
    });

    it('limits short exports to one worker and rejects empty exports', async () => {
        const writer = await createSdrVideoExport({}, { width: 2, height: 2, totalFrames: 1, logoOverlayEnabled: false });
        expect(createSdrEncoderPool).toHaveBeenCalledWith(expect.objectContaining({ workerLimit: 1 }));
        await expect(writer.finalize()).rejects.toThrow('empty video');
        expect(pool.mux).not.toHaveBeenCalled();
        expect(pool.dispose).toHaveBeenCalledOnce();
    });

    it('stops the pool on cancellation and refuses further frames', async () => {
        const controller = new AbortController();
        const writer = await createSdrVideoExport({}, { width: 2, height: 2, totalFrames: 1,
            signal: controller.signal, logoOverlayEnabled: false });
        controller.abort();
        await expect(writer.add()).rejects.toMatchObject({ name: 'AbortError' });
        await expect(writer.finalize()).rejects.toMatchObject({ name: 'AbortError' });
        expect(pool.submit).not.toHaveBeenCalled();
        expect(pool.dispose).toHaveBeenCalledOnce();
    });
});
