import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataArrayTexture, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';
import { createBackgroundExportInterpolation } from './backgroundExportInterpolation.js';
import { getBackgroundLayerFrame } from './backgroundAnimation.js';

afterEach(() => vi.unstubAllGlobals());

function fixture(options = {}) {
    vi.stubGlobal('ImageData', class {
        constructor(data, width, height) { Object.assign(this, { data, width, height }); }
    });
    const image = value => new ImageData(new Uint8ClampedArray([value, value, value, 255]), 1, 1);
    const source = new DataArrayTexture(new Uint8Array(16), 1, 1, 4);
    source.colorSpace = SRGBColorSpace;
    const tileManager = { isZip: true, zipFiles: Object.fromEntries([0, 1, 2].map(i => [`${i}.ktx2`, new Uint8Array([i + 1])])) };
    const openJobs = new Set();
    const decoder = {
        openFile: vi.fn(async id => {
            openJobs.add(id);
            return { width: 1, height: 1, hasAlpha: false, basisFormat: 'uastc' };
        }),
        decodeLayer: vi.fn(async (_id, layer) => ({ width: 1, height: 1, buffer: image(layer).data.buffer })),
        closeFile: vi.fn(async id => openJobs.delete(id)),
        terminate: vi.fn(() => openJobs.clear()),
    };
    const interpolator = { init: vi.fn(), reset: vi.fn(), supportsExplicitTimestep: () => true,
        activeExecutionProvider: 'wasm', interpolateImageData: vi.fn(async () => image(100)) };
    const createInterpolator = vi.fn(async () => interpolator);
    const createDecoder = vi.fn(() => decoder);
    const service = createBackgroundExportInterpolation({ tileManager, createDecoder, createInterpolator, ...options });
    const frame = (overrides = {}) => ({ currentTexture: source, nextTexture: source,
        currentSample: { tileIndex: 0, mirrorX: false }, nextSample: { tileIndex: 1, mirrorX: true },
        currentLayer: 0, nextLayer: 1, layerBlend: 0.25, flowActive: false, ...overrides });
    return { service, decoder, interpolator, createInterpolator, createDecoder, tileManager, frame, source, openJobs, image };
}

describe('background export interpolation', () => {
    it('uses exact fractional timing, preserves source bytes and texture color, and reuses decoded layers and output textures', async () => {
        const { service, decoder, interpolator, tileManager, source, frame } = fixture();
        const result = await service.prepareFrame(frame());
        expect(interpolator.interpolateImageData).toHaveBeenCalledWith(
            expect.objectContaining({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
            expect.objectContaining({ data: new Uint8ClampedArray([1, 1, 1, 255]) }), 0.25);
        expect(result.currentTexture).not.toBe(source);
        expect(result.currentTexture.colorSpace).toBe(source.colorSpace);
        expect(result.currentTexture.image).toMatchObject({ depth: 1, width: 1, height: 1 });
        expect(result).toMatchObject({ currentLayer: 0, nextLayer: 0, layerBlend: 0 });
        expect(result.currentTexture.image.data).toEqual(new Uint8Array([100, 100, 100, 255]));
        expect(decoder.openFile.mock.calls[0][1]).not.toBe(tileManager.zipFiles['0.ktx2'].buffer);
        expect(tileManager.zipFiles['0.ktx2']).toEqual(new Uint8Array([1]));
        const second = await service.prepareFrame(frame({ layerBlend: 0.75 }));
        expect(second.currentTexture).toBe(result.currentTexture);
        expect(decoder.decodeLayer).toHaveBeenCalledTimes(2);
        expect(interpolator.init).toHaveBeenCalledOnce();
        const disposed = vi.fn(); result.currentTexture.addEventListener('dispose', disposed);
        await service.dispose();
        expect(disposed).toHaveBeenCalledOnce();
        expect(decoder.terminate).toHaveBeenCalledOnce();
        expect(interpolator.reset).toHaveBeenCalledOnce();
    });

    it('copies exact endpoints without loading the model, including numerical near-endpoints and static layers', async () => {
        const { service, frame, createInterpolator, decoder } = fixture();
        for (const overrides of [{ layerBlend: 0 }, { layerBlend: 1e-9 }, { layerBlend: 1 - 1e-9 },
            { currentLayer: 2, nextLayer: 2, layerBlend: 0.5 }]) await service.prepareFrame(frame(overrides));
        expect(createInterpolator).not.toHaveBeenCalled();
        expect(decoder.decodeLayer.mock.calls.map(([, layer]) => layer)).toEqual([0, 1, 2]);
        await service.dispose();
    });

    it('generates mipmaps to preserve the source minification behavior', async () => {
        const { service, frame, source } = fixture();
        source.mipmaps = [{}, {}, {}];
        source.minFilter = LinearMipmapLinearFilter;
        const result = await service.prepareFrame(frame());
        expect(result.currentTexture.generateMipmaps).toBe(true);
        expect(result.currentTexture.minFilter).toBe(LinearMipmapLinearFilter);
        await service.dispose();
    });

    it.each([
        ['waves', 0.875, false, 3, 0],
        ['planes', 0.75, false, 2, 1],
        ['waves', 0.125, true, 3, 0],
    ])('preserves %s closing/return/reversed layer ordering', async (variant, progress, reversed, current, next) => {
        const { service, frame, interpolator } = fixture();
        const sample = getBackgroundLayerFrame({ layerCount: 4, variant, progress, reversed });
        await service.prepareFrame(frame(sample));
        const [a, b, timestep] = interpolator.interpolateImageData.mock.calls[0];
        expect([a.data[0], b.data[0], timestep]).toEqual([current, next, 0.5]);
        await service.dispose();
    });

    it('deduplicates mirrored tiles and bounds open containers and layer caches during flow', async () => {
        const { service, frame, decoder, interpolator, openJobs } = fixture();
        const first = await service.prepareFrame(frame({ flowActive: true }));
        expect(first.nextTexture).not.toBe(first.currentTexture);
        expect(interpolator.interpolateImageData).toHaveBeenCalledTimes(2);
        const second = await service.prepareFrame(frame({ flowActive: true, currentLayer: 1, nextLayer: 2,
            currentSample: { tileIndex: 1 }, nextSample: { tileIndex: 2 } }));
        expect(second.currentTexture).toBe(first.currentTexture);
        expect(second.nextTexture).toBe(first.nextTexture);
        expect(decoder.closeFile).toHaveBeenCalledWith('background-0');
        expect(openJobs.size).toBe(2);
        // Tile 1 retains layer 1 and only decodes the new layer 2.
        expect(decoder.decodeLayer.mock.calls.filter(([id]) => id === 'background-1').map(([, layer]) => layer)).toEqual([0, 1, 2]);
        const mirrored = await service.prepareFrame(frame({ flowActive: true, nextSample: { tileIndex: 0, mirrorX: true } }));
        expect(mirrored.currentTexture).toBe(mirrored.nextTexture);
        expect(mirrored.nextSample.mirrorX).toBe(true);
        expect(openJobs.size).toBe(1);
        await service.dispose();
    });

    it('loads bundled tiles with the export signal', async () => {
        const controller = new AbortController();
        const { service, frame, tileManager } = fixture({ signal: controller.signal });
        tileManager.zipFiles = null; tileManager.isZip = false; tileManager.folder = '/tiles-ktx2-waves';
        const fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
        vi.stubGlobal('fetch', fetch);
        await service.prepareFrame(frame());
        expect(fetch).toHaveBeenCalledWith('/tiles-ktx2-waves/0.ktx2', { signal: controller.signal });
        await service.dispose();
    });

    it('rejects missing source bytes and unsupported alpha instead of silently crossfading', async () => {
        const { service, frame, tileManager, decoder } = fixture();
        tileManager.zipFiles = null;
        await expect(service.prepareFrame(frame())).rejects.toThrow('Source KTX2 bytes');
        tileManager.zipFiles = { '0.ktx2': new Uint8Array([1]) };
        decoder.openFile.mockResolvedValueOnce({ hasAlpha: true });
        await expect(service.prepareFrame(frame())).rejects.toThrow('opaque SDR');
        await service.dispose();
        expect(decoder.terminate).toHaveBeenCalledOnce();
    });

    it('observes cancellation after an in-flight prediction and still releases resources', async () => {
        const controller = new AbortController();
        const { service, frame, interpolator, decoder, image } = fixture({ signal: controller.signal });
        interpolator.interpolateImageData.mockImplementationOnce(async () => { controller.abort(); return image(50); });
        await expect(service.prepareFrame(frame())).rejects.toMatchObject({ name: 'AbortError' });
        await service.dispose();
        expect(decoder.terminate).toHaveBeenCalledOnce();
        expect(interpolator.reset).toHaveBeenCalledOnce();
    });
});
