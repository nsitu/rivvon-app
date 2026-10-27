import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExportYuvConversion } from './exportYuvConversion.js';
import { createGpuYuvConversion } from './gpuYuvConversion.js';

vi.mock('./gpuYuvConversion.js', () => ({ createGpuYuvConversion: vi.fn() }));
const white = Uint8ClampedArray.from({ length: 16 }, () => 255);
let canvas, context, gpu;
beforeEach(() => {
    vi.clearAllMocks();
    context = { getImageData: vi.fn(() => ({ data: white })) };
    canvas = { getContext: vi.fn(() => context) };
    gpu = { readbackBytesPerFrame: 8, convert: vi.fn((_canvas, target) => target.fill(42)), dispose: vi.fn() };
    createGpuYuvConversion.mockReturnValue(gpu);
});
afterEach(() => vi.unstubAllGlobals());

describe('export-only YUV conversion selection', () => {
    it('uses GPU conversion without reading RGBA pixels through Canvas2D', () => {
        const converter = createExportYuvConversion(2, 2, { fullRange: true });
        const target = new Uint8Array(6);
        expect(createGpuYuvConversion).toHaveBeenCalledWith(2, 2, { fullRange: true });
        expect(converter.convert(canvas, target)).toBe(target);
        expect([...target]).toEqual([42,42,42,42,42,42]);
        expect(context.getImageData).not.toHaveBeenCalled();
        expect(converter.info).toEqual({ requestedMethod: 'gpu', method: 'gpu', fallbackReason: null, readbackBytesPerFrame: 8 });
        converter.dispose(); converter.dispose();
        expect(gpu.dispose).toHaveBeenCalledOnce();
        expect(() => converter.convert(canvas, target)).toThrow('disposed');
    });
    it.each([false, true])('uses explicit CPU conversion with fullRange=%s', fullRange => {
        const converter = createExportYuvConversion(2, 2, { method: 'cpu', fullRange });
        expect([...converter.convert(canvas, new Uint8Array(6))]).toEqual([fullRange ? 255 : 235, fullRange ? 255 : 235,
            fullRange ? 255 : 235, fullRange ? 255 : 235, 128, 128]);
        expect(createGpuYuvConversion).not.toHaveBeenCalled();
        expect(converter.info).toMatchObject({ requestedMethod: 'cpu', method: 'cpu', fallbackReason: null, readbackBytesPerFrame: 16 });
    });
    it('records initialization failures and uses CPU pixels', () => {
        createGpuYuvConversion.mockImplementation(() => { throw new Error('WebGL2 disabled'); });
        const converter = createExportYuvConversion(2, 2);
        expect([...converter.convert(canvas, new Uint8Array(6))]).toEqual([235,235,235,235,128,128]);
        expect(converter.info).toMatchObject({ requestedMethod: 'gpu', method: 'cpu', fallbackReason: 'WebGL2 disabled' });
    });
    it('overwrites a failed GPU readback with CPU pixels and stays on CPU for later frames', () => {
        gpu.convert.mockImplementation((_canvas, target) => { target.fill(0); throw new Error('Context lost'); });
        const converter = createExportYuvConversion(2, 2);
        const target = new Uint8Array(6);
        converter.convert(canvas, target); converter.convert(canvas, target); converter.dispose();
        expect([...target]).toEqual([235,235,235,235,128,128]);
        expect(gpu.convert).toHaveBeenCalledOnce(); expect(gpu.dispose).toHaveBeenCalledOnce();
        expect(context.getImageData).toHaveBeenCalledTimes(2);
        expect(converter.info).toMatchObject({ method: 'cpu', fallbackReason: 'Context lost', readbackBytesPerFrame: 16 });
    });
    it('rejects invalid choices and dimensions before allocating GPU resources', () => {
        expect(() => createExportYuvConversion(2, 2, { method: 'wrong' })).toThrow('Unknown');
        expect(() => createExportYuvConversion(3, 2)).toThrow('even');
        expect(createGpuYuvConversion).not.toHaveBeenCalled();
    });
});
