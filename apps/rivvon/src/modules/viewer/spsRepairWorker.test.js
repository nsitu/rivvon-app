import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExportBlob } from './exportBlob.js';

vi.mock('@ffmpeg/ffmpeg/worker', () => ({}));
vi.mock('./exportBlob.js', () => ({ createExportBlob: vi.fn() }));
let worker, send;
beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks();
    send = vi.fn(); worker = { postMessage: send };
    vi.stubGlobal('self', worker);
    await import('./spsRepairWorker.js');
});
afterEach(() => vi.unstubAllGlobals());

describe('SPS repair worker file responses', () => {
    it('returns binary files as Blobs with the original request ID and no buffer transfer', async () => {
        const bytes = new Uint8Array([1, 2]), blob = new Blob([bytes]);
        createExportBlob.mockResolvedValue(blob);
        worker.postMessage({ id: 12, type: 'READ_FILE', data: bytes }, [bytes.buffer]);
        await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
        expect(createExportBlob).toHaveBeenCalledWith(bytes);
        expect(send).toHaveBeenCalledWith({ id: 12, type: 'READ_FILE', data: blob });
    });
    it('reports packaging errors through FFmpeg rejection messages', async () => {
        createExportBlob.mockRejectedValue(new Error('Storage unavailable'));
        worker.postMessage({ id: 13, type: 'READ_FILE', data: new Uint8Array([1]) });
        await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
        expect(send).toHaveBeenCalledWith({ id: 13, type: 'ERROR', data: 'Error: Storage unavailable' });
    });
    it('forwards logs and text responses unchanged', () => {
        const log = { type: 'LOG', data: { message: 'encoding' } }, text = { id: 14, type: 'READ_FILE', data: 'text' };
        worker.postMessage(log); worker.postMessage(text);
        expect(send.mock.calls).toEqual([[log, undefined], [text, undefined]]);
        expect(createExportBlob).not.toHaveBeenCalled();
    });
});
