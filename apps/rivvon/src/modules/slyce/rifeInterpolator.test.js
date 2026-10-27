import { describe, expect, it, vi } from 'vitest';
import { RIFEInterpolator } from './rifeInterpolator.js';

vi.mock('onnxruntime-web/all', () => ({ env: {} }));
vi.mock('./rifePadding.js', () => ({
    calculateProcessingSize: () => ({ paddedWidth: 1, paddedHeight: 1, scaledWidth: 1, scaledHeight: 1 }),
    createPaddedCanvas: value => value,
    cropToOriginal: value => value,
    resizeImageData: value => value,
}));

describe('RIFE tensor lifetime', () => {
    it.each(['success', 'inference failure', 'readback failure'])('releases unique input/feed/output tensors after %s', async mode => {
        const rife = new RIFEInterpolator();
        const tensor0 = { dispose: vi.fn() }, tensor1 = { dispose: vi.fn() };
        const packed = { dispose: vi.fn() }, output = { dispose: vi.fn() };
        rife.session = { run: vi.fn(async () => {
            if (mode === 'inference failure') throw new Error('Inference failed');
            return { output };
        }) };
        rife.outputNames = ['output'];
        rife.imageDataToTensor = vi.fn().mockReturnValueOnce(tensor0).mockReturnValueOnce(tensor1);
        // Include an alias to exercise identity-based disposal.
        rife.buildFeeds = () => ({ packed, alias: tensor0 });
        rife.tensorToImageData = vi.fn(async () => {
            if (mode === 'readback failure') throw new Error('Readback failed');
            return 'image';
        });
        const promise = rife.interpolateImageData({ width: 1, height: 1 }, { width: 1, height: 1 });
        if (mode === 'success') expect(await promise).toBe('image');
        else await expect(promise).rejects.toThrow('failed');
        for (const tensor of [tensor0, tensor1, packed]) expect(tensor.dispose).toHaveBeenCalledOnce();
        expect(output.dispose).toHaveBeenCalledTimes(mode === 'inference failure' ? 0 : 1);
    });

    it('returns session release so export cleanup can await it', async () => {
        const rife = new RIFEInterpolator();
        const release = vi.fn(async () => 'released');
        rife.session = { release };
        expect(await rife.reset()).toBe('released');
        expect(rife.session).toBeNull();
        expect(release).toHaveBeenCalledOnce();
    });
});
