import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvasVideoExport } from './canvasVideoExport.js';
import { createSdrVideoExport } from './sdrVideoExport.js';
import { inspectMp4Colour } from './videoColourMetadata.js';
import { repairMissingSpsColour } from './repairWebCodecsColour.js';
import { createGpuYuvConversion } from './gpuYuvConversion.js';

const mocks = vi.hoisted(() => ({ outputs: [], sources: [], samples: [], overlay: vi.fn() }));
vi.mock('./sdrVideoExport.js', () => ({ createSdrVideoExport: vi.fn().mockResolvedValue({ software: true }) }));
vi.mock('./videoColourMetadata.js', () => ({ inspectMp4Colour: vi.fn() }));
vi.mock('./repairWebCodecsColour.js', () => ({ repairMissingSpsColour: vi.fn() }));
vi.mock('./gpuYuvConversion.js', () => ({ createGpuYuvConversion: vi.fn() }));
vi.mock('./exportLogoOverlay.js', () => ({ drawExportLogoOverlay: mocks.overlay, loadExportLogoAsset: async () => ({ image: {}, aspectRatio: 1 }) }));
vi.mock('mediabunny', () => ({
    Output: class {
        constructor(options) { this.options = options; this.target = { buffer: new ArrayBuffer(8) }; mocks.outputs.push(this); }
        start = vi.fn(); cancel = vi.fn(); finalize = vi.fn(); addVideoTrack = vi.fn();
    },
    CanvasSource: class {
        constructor(canvas, config) { this.canvas = canvas; this.config = config; mocks.sources.push(this); }
        add = vi.fn();
    },
    VideoSampleSource: class {
        constructor(config) { this.config = config; mocks.sources.push(this); }
        add = vi.fn();
    },
    VideoSample: class {
        constructor(frame) { this.frame = frame; mocks.samples.push(this); }
        close = vi.fn();
    },
    Mp4OutputFormat: class {}, WebMOutputFormat: class {}, BufferTarget: class {},
    QUALITY_VERY_LOW: 'very-low', QUALITY_LOW: 'low', QUALITY_MEDIUM: 'medium', QUALITY_HIGH: 'high', QUALITY_VERY_HIGH: 'very-high',
}));
let frameClose;
beforeEach(() => {
    vi.clearAllMocks(); mocks.outputs.length = 0; mocks.sources.length = 0; mocks.samples.length = 0;
    createGpuYuvConversion.mockImplementation(() => { throw new Error('WebGL2 unavailable'); });
    frameClose = vi.fn();
    vi.stubGlobal('VideoEncoder', class {});
    vi.stubGlobal('VideoFrame', class {
        format = 'RGBA'; colorSpace = { toJSON: () => ({ primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true }) };
        constructor(data, config) {
            this.data = data;
            this.config = config;
            if (config.format) { this.format = config.format; this.colorSpace = { toJSON: () => config.colorSpace }; }
        }
        close = frameClose;
    });
    inspectMp4Colour.mockReturnValue({ container: [{ primaries: 1, transfer: 13, matrix: 1, fullRange: true }], sps: [] });
    repairMissingSpsColour.mockImplementation(async data => ({ data, repair: { status: 'not-needed' } }));
});
afterEach(() => vi.unstubAllGlobals());
const options = { width: 320, height: 240, fps: 30, format: 'mp4', encodingMethod: 'webcodecs' };
describe('encoder selection and final reports', () => {
    it('encodes shader-produced I420 and releases the GPU converter after finalization', async () => {
        const context = yuvContext(), reports = vi.fn();
        context.getImageData = vi.fn(() => { throw new Error('RGBA readback should not run'); });
        const gpu = { readbackBytesPerFrame: 8, convert: vi.fn((_canvas, target) => target.set([235,235,16,16,128,128])), dispose: vi.fn() };
        createGpuYuvConversion.mockReturnValue(gpu);
        const colour = { primaries: 1, transfer: 1, matrix: 1, fullRange: false };
        inspectMp4Colour.mockReturnValue({ container: [colour], sps: [{ ...colour, chromaFormat: 1, bitDepthLuma: 8, bitDepthChroma: 8 }] });
        const writer = await createCanvasVideoExport({}, { ...options, width: 2, height: 2, videoRange: 'limited', onColourMetadata: reports });
        await writer.add(0, 1 / 30); await writer.finalize(); await writer.dispose();
        expect([...mocks.samples[0].frame.data]).toEqual([235,235,16,16,128,128]);
        expect(context.getImageData).not.toHaveBeenCalled();
        expect(gpu.dispose).toHaveBeenCalledOnce();
        expect(reports.mock.calls.at(-1)[0]).toMatchObject({ yuvConversion: { requestedMethod: 'gpu', method: 'gpu' }, verification: { matchesRequestedColour: true } });
    });
    function yuvContext() {
        const rgba = Uint8ClampedArray.from([255,255,255,255, 255,255,255,255, 0,0,0,255, 0,0,0,255]);
        const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn(),
            getContextAttributes: () => ({ colorSpace: 'srgb' }), getImageData: () => ({ data: rgba }) };
        vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
        return context;
    }
    it.each(['limited', 'full'])('encodes real %s I420 pixels and keeps the hardware preference', async videoRange => {
        const context = yuvContext(), reports = vi.fn(), fullRange = videoRange === 'full';
        const colour = { primaries: 1, transfer: 1, matrix: 1, fullRange };
        inspectMp4Colour.mockReturnValue({ container: [colour], sps: [{ ...colour, chromaFormat: 1, bitDepthLuma: 8, bitDepthChroma: 8 }] });
        const writer = await createCanvasVideoExport({}, { ...options, width: 2, height: 2, videoRange, hardwareAcceleration: 'prefer-hardware', onColourMetadata: reports });
        await writer.add(0.5, 1 / 30); await writer.finalize();
        const sample = mocks.samples[0];
        expect([...sample.frame.data]).toEqual(fullRange ? [255,255,0,0,128,128] : [235,235,16,16,128,128]);
        expect(sample.frame.config).toMatchObject({ format: 'I420', timestamp: 500000, duration: 33333, colorSpace: { fullRange, transfer: 'bt709' } });
        expect(mocks.sources[0].config.hardwareAcceleration).toBe('prefer-hardware');
        expect(context.fillRect).toHaveBeenCalledBefore(context.drawImage);
        expect(sample.close).toHaveBeenCalledOnce(); expect(frameClose).toHaveBeenCalledOnce();
        expect(reports.mock.calls.at(-1)[0]).toMatchObject({ videoRange, explicitYuv: true, verification: { matchesRequestedColour: true } });
    });
    it('rejects a backend that returns a different range without marking export complete', async () => {
        yuvContext(); const reports = vi.fn();
        const writer = await createCanvasVideoExport({}, { ...options, width: 2, height: 2, videoRange: 'limited', onColourMetadata: reports });
        await writer.add(0, 1 / 30);
        await expect(writer.finalize()).rejects.toThrow('requested BT.709 limited-range');
        expect(reports.mock.calls.some(([report]) => report.phase === 'complete')).toBe(false);
    });
    it('closes raw frames and samples if the native encoder rejects them', async () => {
        yuvContext();
        const writer = await createCanvasVideoExport({}, { ...options, width: 2, height: 2, videoRange: 'limited' });
        mocks.sources[0].add.mockRejectedValue(new Error('unsupported input'));
        await expect(writer.add(0, 1 / 30)).rejects.toThrow('unsupported input');
        expect(mocks.samples[0].close).toHaveBeenCalledOnce(); expect(frameClose).toHaveBeenCalledOnce();
        await writer.dispose(); expect(mocks.outputs[0].cancel).toHaveBeenCalledOnce();
    });
    it('requires even dimensions for explicit YUV and rejects unknown ranges', async () => {
        await expect(createCanvasVideoExport({}, { ...options, width: 321, videoRange: 'limited' })).rejects.toThrow('even');
        await expect(createCanvasVideoExport({}, { ...options, videoRange: 'wrong' })).rejects.toThrow('Unknown video colour range');
    });
    it('composites the logo before reading and converting YUV pixels, and supports cancellation', async () => {
        const context = yuvContext(), controller = new AbortController();
        const writer = await createCanvasVideoExport({}, { ...options, width: 2, height: 2, videoRange: 'limited', logoOverlayEnabled: true, signal: controller.signal });
        await writer.add(0, 1 / 30);
        expect(context.drawImage).toHaveBeenCalledBefore(mocks.overlay);
        controller.abort(); await writer.dispose();
        await expect(writer.add(1 / 30, 1 / 30)).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.outputs[0].cancel).toHaveBeenCalledOnce();
    });
    it('keeps deterministic software encoding as the MP4 default', async () => {
        const canvas = {};
        await createCanvasVideoExport(canvas, { format: 'mp4' });
        expect(createSdrVideoExport).toHaveBeenCalledWith(canvas, { format: 'mp4' });
        expect(mocks.sources).toHaveLength(0);
    });
    it('restores AVC CanvasSource, captures input/first useful output, and reports missing SPS', async () => {
        const canvas = {}, reports = vi.fn();
        const writer = await createCanvasVideoExport(canvas, { ...options, hardwareAcceleration: 'prefer-hardware', onColourMetadata: reports });
        const source = mocks.sources[0];
        expect(source.canvas).toBe(canvas);
        expect(source.config).toMatchObject({ codec: 'avc', hardwareAcceleration: 'prefer-hardware' });
        await writer.add(0, 1 / 30);
        source.config.onEncoderConfig({ codec: 'avc1.640028', hardwareAcceleration: 'prefer-hardware' });
        source.config.onEncodedPacket(null, { decoderConfig: { codec: 'avc1.640028' } });
        const colour = { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'bt709', fullRange: true };
        source.config.onEncodedPacket(null, { decoderConfig: { codec: 'avc1.640028', colorSpace: colour } });
        source.config.onEncodedPacket(null, { decoderConfig: { colorSpace: { ...colour, fullRange: false } } });
        const blob = await writer.finalize(); await writer.dispose();
        expect(blob.type).toBe('video/mp4');
        expect(reports.mock.calls.at(-1)[0]).toMatchObject({ phase: 'complete', encodingMethod: 'webcodecs',
            videoFrame: { format: 'RGBA' }, decoderConfig: { colorSpace: colour }, verification: { matchesSdrTarget: false } });
        expect(frameClose).toHaveBeenCalledOnce();
        expect(mocks.outputs[0].cancel).not.toHaveBeenCalled();
    });
    it('reports inspection failure while allowing the explicitly chosen native file', async () => {
        inspectMp4Colour.mockImplementation(() => { throw new Error('malformed colour'); });
        const reports = vi.fn();
        const writer = await createCanvasVideoExport({}, { ...options, onColourMetadata: reports });
        await writer.add(0, 1 / 30); await writer.finalize();
        expect(reports.mock.calls.at(-1)[0].verification.warnings.join()).toContain('malformed colour');
        expect(repairMissingSpsColour).not.toHaveBeenCalled();
    });
    it('retains WebM and reports that its bitstream is uninspected', async () => {
        const reports = vi.fn();
        const writer = await createCanvasVideoExport({}, { ...options, format: 'webm', encodingMethod: 'ffmpeg', onColourMetadata: reports });
        expect(mocks.sources[0].config.codec).toBe('vp9');
        await writer.add(0, 1 / 30);
        expect((await writer.finalize()).type).toBe('video/webm');
        expect(inspectMp4Colour).not.toHaveBeenCalled();
        expect(repairMissingSpsColour).not.toHaveBeenCalled();
        expect(reports.mock.calls.at(-1)[0].verification.warnings.join()).toContain('not independently inspected');
    });
    it('returns repaired bytes, preserves an exact original comparison copy, and reports the repair', async () => {
        const repaired = Uint8Array.from([1,2,3]), before = vi.fn(), reports = vi.fn();
        repairMissingSpsColour.mockResolvedValue({ data: repaired, repair: { status: 'added', sampleConversion: false } });
        const writer = await createCanvasVideoExport({}, { ...options, onBeforeSpsRepair: before, onColourMetadata: reports });
        await writer.add(0, 1 / 30); const blob = await writer.finalize();
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(repaired);
        expect((await before.mock.calls[0][0].arrayBuffer()).byteLength).toBe(8);
        expect(repairMissingSpsColour).toHaveBeenCalledWith(expect.any(Uint8Array), expect.objectContaining({ decoderColourSpaces: [] }));
        expect(reports.mock.calls.at(-1)[0].spsRepair).toMatchObject({ status: 'added', sampleConversion: false });
    });
    it('fails export if an attempted repair fails verification', async () => {
        repairMissingSpsColour.mockRejectedValue(new Error('Timing changed'));
        const reports = vi.fn(), writer = await createCanvasVideoExport({}, { ...options, onColourMetadata: reports });
        await writer.add(0, 1 / 30);
        await expect(writer.finalize()).rejects.toThrow('Timing changed');
        expect(reports.mock.calls.some(([report]) => report.phase === 'complete')).toBe(false);
    });
    it.each(['signal', 'dispose'])('cancels the repair stage through %s without returning a completed export', async method => {
        const controller = new AbortController(), reports = vi.fn();
        let started;
        const executing = new Promise(resolve => { started = resolve; });
        repairMissingSpsColour.mockImplementation((_data, { signal }) => new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
            started();
        }));
        const writer = await createCanvasVideoExport({}, { ...options, signal: controller.signal, onColourMetadata: reports });
        await writer.add(0, 1 / 30);
        const rejected = expect(writer.finalize()).rejects.toMatchObject({ name: 'AbortError' });
        await executing;
        if (method === 'signal') controller.abort(); else await writer.dispose();
        await rejected;
        expect(mocks.outputs[0].cancel).not.toHaveBeenCalled();
        expect(reports.mock.calls.some(([report]) => report.phase === 'complete')).toBe(false);
    });
    it('preserves the native logo compositor and cancellation cleanup', async () => {
        const context = { clearRect: vi.fn(), drawImage: vi.fn() }, overlay = { getContext: () => context };
        vi.stubGlobal('document', { createElement: () => overlay });
        const controller = new AbortController(), reports = vi.fn();
        const writer = await createCanvasVideoExport({}, { ...options, logoOverlayEnabled: true, signal: controller.signal, onColourMetadata: reports });
        await writer.add(0, 1 / 30);
        expect(mocks.overlay).toHaveBeenCalledOnce(); expect(mocks.sources[0].canvas).toBe(overlay);
        controller.abort(); await writer.dispose();
        await expect(writer.add(1 / 30, 1 / 30)).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.outputs[0].cancel).toHaveBeenCalledOnce();
        expect(reports.mock.calls.some(([report]) => report.phase === 'complete')).toBe(false);
    });
});
