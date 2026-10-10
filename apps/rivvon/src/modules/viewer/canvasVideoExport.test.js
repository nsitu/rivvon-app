import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvasVideoExport } from './canvasVideoExport.js';
import { createSdrVideoExport } from './sdrVideoExport.js';
import { inspectMp4Colour } from './videoColourMetadata.js';
import { repairMissingSpsColour } from './repairWebCodecsColour.js';

const mocks = vi.hoisted(() => ({ outputs: [], sources: [], overlay: vi.fn() }));
vi.mock('./sdrVideoExport.js', () => ({ createSdrVideoExport: vi.fn().mockResolvedValue({ software: true }) }));
vi.mock('./videoColourMetadata.js', () => ({ inspectMp4Colour: vi.fn() }));
vi.mock('./repairWebCodecsColour.js', () => ({ repairMissingSpsColour: vi.fn() }));
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
    Mp4OutputFormat: class {}, WebMOutputFormat: class {}, BufferTarget: class {},
    QUALITY_VERY_LOW: 'very-low', QUALITY_LOW: 'low', QUALITY_MEDIUM: 'medium', QUALITY_HIGH: 'high', QUALITY_VERY_HIGH: 'very-high',
}));
let frameClose;
beforeEach(() => {
    vi.clearAllMocks(); mocks.outputs.length = 0; mocks.sources.length = 0;
    frameClose = vi.fn();
    vi.stubGlobal('VideoEncoder', class {});
    vi.stubGlobal('VideoFrame', class {
        format = 'RGBA'; colorSpace = { toJSON: () => ({ primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true }) };
        close = frameClose;
    });
    inspectMp4Colour.mockReturnValue({ container: [{ primaries: 1, transfer: 13, matrix: 1, fullRange: true }], sps: [] });
    repairMissingSpsColour.mockImplementation(async data => ({ data, repair: { status: 'not-needed' } }));
});
afterEach(() => vi.unstubAllGlobals());
const options = { width: 320, height: 240, fps: 30, format: 'mp4', encodingMethod: 'webcodecs' };
describe('encoder selection and final reports', () => {
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
