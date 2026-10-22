import { afterEach, describe, expect, it, vi } from 'vitest';
import { TileManager } from './tileManager.js';

afterEach(() => vi.restoreAllMocks());

describe('KTX2 source ownership', () => {
    function managerWithTransferringLoader() {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const manager = new TileManager();
        manager._ktx2Loader = { parse: vi.fn((buffer, onLoad, onError) => {
            // Model Three.js transferring ownership to its transcoder worker.
            structuredClone(buffer, { transfer: [buffer] });
            manager.retainedPayloadAfterTransfer = manager.zipFiles?.['0.ktx2']?.slice();
            onError(new Error('Stop after worker transfer'));
        }) };
        return manager;
    }
    it('retains loaded source bytes for later preset publication', async () => {
        const manager = managerWithTransferringLoader();
        const bytes = new Uint8Array([1, 2, 3]);
        await manager.loadFromTileRecords({ id: 'local', tile_count: 1, layer_count: 2 }, [{ tile_index: 0, bytes: bytes.buffer }]);
        expect(manager._ktx2Loader.parse).toHaveBeenCalledOnce();
        expect(manager.retainedPayloadAfterTransfer).toEqual(new Uint8Array([1, 2, 3]));
        expect(bytes.byteLength).toBe(3);
    });
    it.each(['buffer', 'view'])('retains realtime %s bytes and respects view offsets', async (kind) => {
        const manager = managerWithTransferringLoader();
        const bytes = new Uint8Array([9, 1, 2, 3, 8]);
        const source = kind === 'view' ? bytes.subarray(1, 4) : bytes.buffer;
        await expect(manager.addTileFromBuffer(source, 0)).rejects.toThrow('Stop after worker transfer');
        expect(bytes).toEqual(new Uint8Array([9, 1, 2, 3, 8]));
        expect(manager._ktx2Loader.parse.mock.calls[0][0].byteLength).toBe(0);
    });
});
