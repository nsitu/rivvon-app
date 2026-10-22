import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTextureThumbnail } from './textureThumbnail.js';
import { Ktx2TranscodeWorkerClient } from '../slyce/ktx2TranscodeWorkerClient.js';

vi.mock('../slyce/ktx2TranscodeWorkerClient.js', () => ({ Ktx2TranscodeWorkerClient: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe('texture thumbnail generation', () => {
    function setup(width = 1024, height = 512) {
        const decoder = { openFile: vi.fn(async () => {}),
            decodeLayer: vi.fn(async () => ({ width, height, buffer: new ArrayBuffer(width * height * 4) })),
            terminate: vi.fn() };
        vi.mocked(Ktx2TranscodeWorkerClient).mockImplementation(function () { return decoder; });
        const canvases = [];
        vi.stubGlobal('OffscreenCanvas', class {
            constructor(width, height) {
                Object.assign(this, { width, height, context: { putImageData: vi.fn(), drawImage: vi.fn() },
                    convertToBlob: vi.fn(async () => new Blob(['thumbnail'], { type: 'image/jpeg' })) });
                canvases.push(this);
            }
            getContext() { return this.context; }
        });
        vi.stubGlobal('ImageData', class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } });
        return { decoder, canvases };
    }
    it('decodes only layer zero of tile zero and preserves aspect ratio', async () => {
        const { decoder, canvases } = setup();
        const first = new Blob(['first tile']);
        const result = await createTextureThumbnail([{ index: 1, blob: new Blob(['second']) }, { tile_index: 0, blob: first }]);
        expect(new TextDecoder().decode(decoder.openFile.mock.calls[0][1])).toBe('first tile');
        expect(decoder.decodeLayer).toHaveBeenCalledExactlyOnceWith('thumbnail', 0);
        expect(canvases[1]).toMatchObject({ width: 512, height: 256 });
        expect(canvases[1].context.drawImage).toHaveBeenCalledWith(canvases[0], 0, 0, 512, 256);
        expect(result.type).toBe('image/jpeg');
        expect(decoder.terminate).toHaveBeenCalledOnce();
    });
    it('does not upscale small textures', async () => {
        const { canvases } = setup(64, 128);
        await createTextureThumbnail([{ index: 0, blob: new Blob(['tile']) }]);
        expect(canvases[1]).toMatchObject({ width: 64, height: 128 });
    });
    it('rejects missing first tiles without starting a worker', async () => {
        await expect(createTextureThumbnail([{ index: 1, blob: new Blob(['tile']) }])).rejects.toThrow('first texture tile');
        expect(Ktx2TranscodeWorkerClient).not.toHaveBeenCalled();
    });
    it('explains empty legacy uploads without starting the decoder', async () => {
        await expect(createTextureThumbnail([{ index: 0, blob: new Blob([]) }])).rejects.toThrow('texture tile is empty');
        expect(Ktx2TranscodeWorkerClient).not.toHaveBeenCalled();
    });
    it('releases decoder resources after decode or canvas failures', async () => {
        const { decoder } = setup();
        decoder.decodeLayer.mockRejectedValueOnce(new Error('Corrupt tile'));
        await expect(createTextureThumbnail([{ index: 0, blob: new Blob(['tile']) }])).rejects.toThrow('Corrupt tile');
        expect(decoder.terminate).toHaveBeenCalledOnce();
    });
});
