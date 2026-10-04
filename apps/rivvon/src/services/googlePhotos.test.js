import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectVideoMime, importedVideoFilename, importGooglePhotosVideo, openGooglePhotosWindow, pollingMilliseconds, readVideoDownload } from './googlePhotos.js';

describe('Google Photos video transfer', () => {
    it('names the actual transcode separately from the source MOV filename', () => {
        expect(importedVideoFilename('folder/original.MOV', 'video/mp4')).toBe('original.mp4');
        expect(importedVideoFilename('', 'video/webm')).toBe('google-photos-video.webm');
        expect(() => importedVideoFilename('photo.jpg', 'image/jpeg')).toThrow();
    });
    it('detects an MP4 container even with an octet-stream response', async () => {
        expect(await detectVideoMime(new Blob([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])]), 'application/octet-stream')).toBe('video/mp4');
    });
    it('reports byte progress when Content-Length is unavailable', async () => {
        const progress = [];
        const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } }));
        const blob = await readVideoDownload(response, { onProgress: value => progress.push(value) });
        expect(blob.size).toBe(3);
        expect(progress).toEqual([{ received: 0, total: null }, { received: 3, total: null }]);
    });
    it('uses the forwarded Google size when Workers cannot supply Content-Length', async () => {
        const progress = [];
        const response = new Response(new Uint8Array([1, 2, 3]), { headers: { 'X-Rivvon-Video-Length': '3' } });
        await readVideoDownload(response, { onProgress: value => progress.push(value) });
        expect(progress).toEqual([{ received: 0, total: 3 }, { received: 3, total: 3 }]);
    });
    it('rejects an oversized forwarded size before reading the stream', async () => {
        const cancel = vi.fn();
        const progress = vi.fn();
        const response = new Response(new ReadableStream({ cancel }), { headers: { 'X-Rivvon-Video-Length': '5' } });
        await expect(readVideoDownload(response, { maxBytes: 4, onProgress: progress })).rejects.toThrow('2048 MiB');
        expect(cancel).toHaveBeenCalled();
        expect(progress).not.toHaveBeenCalled();
    });
    it('enforces the byte limit on unknown-length streams and cancels upstream', async () => {
        let cancelled = false;
        const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(5)); }, cancel() { cancelled = true; } }));
        await expect(readVideoDownload(response, { maxBytes: 4 })).rejects.toThrow('2048 MiB');
        expect(cancelled).toBe(true);
    });
    it('rejects an empty stream and an aborted transfer', async () => {
        await expect(readVideoDownload(new Response(new Uint8Array()))).rejects.toThrow('empty');
        const controller = new AbortController();
        controller.abort();
        await expect(readVideoDownload(new Response('video'), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    });
    it('honors a zero Google polling timeout', () => {
        expect(pollingMilliseconds('0s')).toBe(0);
        expect(pollingMilliseconds('3.5s')).toBe(3500);
        expect(pollingMilliseconds(undefined, 10000)).toBe(10000);
    });
});

describe('Google Photos import workflow', () => {
    const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
    const selection = { id: 'selection', pickerUri: 'https://photos.google.com/picker/selection', mediaItemsSet: false,
        pollingConfig: { pollInterval: '1s', timeoutIn: '30s' } };
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    it('requests a centered popup synchronously from the initiating click', () => {
        const open = vi.fn().mockReturnValue({});
        vi.stubGlobal('window', { open, screen: { availWidth: 1920, availHeight: 1080 }, screenX: 0, screenY: 0, outerWidth: 1200, outerHeight: 1000 });
        openGooglePhotosWindow();
        expect(open).toHaveBeenCalledWith('about:blank', '_blank', 'popup=yes,width=960,height=800,left=120,top=100');
    });

    it('uses the callback-created session after consent without opening another window or creating another session', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValueOnce(json({ connected: false }))
            .mockResolvedValueOnce(json({ connected: true, pickerSession: { ...selection, mediaItemsSet: true } }))
            .mockResolvedValueOnce(json({ provenance: { originalFilename: 'video.mov' } }))
            .mockResolvedValueOnce(new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { headers: { 'Content-Type': 'video/mp4' } }))
            .mockResolvedValueOnce(json({ success: true }));
        vi.stubGlobal('fetch', fetchMock);
        const video = { videoWidth: 1920, videoHeight: 1080, duration: 3, removeAttribute: vi.fn(), load: vi.fn(),
            set src(value) { queueMicrotask(() => this.onloadedmetadata?.()); } };
        vi.stubGlobal('document', { createElement: () => video });
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:video');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const destinations = [];
        const links = [];
        // Simulate losing the opener handle when Google applies COOP.
        const popup = { closed: false, location: { set href(value) { destinations.push(value); popup.closed = true; } }, close: vi.fn() };
        const result = importGooglePhotosVideo({ popup, signal: new AbortController().signal, onExternalLink: value => links.push(value) });
        await vi.advanceTimersByTimeAsync(1500);
        expect((await result).file.name).toBe('video.mp4');
        expect(destinations).toHaveLength(1);
        expect(new URL(destinations[0]).searchParams.get('picker')).toBe('1');
        expect(links.every(link => link === null)).toBe(true);
        expect(fetchMock.mock.calls.some(([, options]) => options.method === 'POST')).toBe(false);
    });

    it('polls selection, validates the download, and cleans up before returning the video', async () => {
        vi.useFakeTimers();
        const provenance = { provider: 'google-photos', originalFilename: 'original.mov', mediaItemId: 'source-id' };
        const fetchMock = vi.fn().mockResolvedValueOnce(json({ connected: true }))
            .mockResolvedValueOnce(json(selection)).mockResolvedValueOnce(json({ ...selection, mediaItemsSet: true }))
            .mockResolvedValueOnce(json({ provenance }))
            .mockResolvedValueOnce(new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { headers: { 'Content-Type': 'application/octet-stream' } }))
            .mockResolvedValueOnce(json({ success: true }));
        vi.stubGlobal('fetch', fetchMock);
        const video = { videoWidth: 1920, videoHeight: 1080, duration: 3, removeAttribute: vi.fn(), load: vi.fn(),
            set src(value) { queueMicrotask(() => this.onloadedmetadata?.()); } };
        vi.stubGlobal('document', { createElement: () => video });
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-video');
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const popup = { closed: false, location: {}, close: vi.fn() };
        const phases = [];
        const result = importGooglePhotosVideo({ popup, signal: new AbortController().signal,
            onStatus: (_, details) => { if (details?.phase) phases.push(details.phase); } });
        await vi.advanceTimersByTimeAsync(1000);
        const imported = await result;
        expect(imported.file.name).toBe('original.mp4');
        expect(imported.file.type).toBe('video/mp4');
        expect(imported.provenance).toEqual(provenance);
        expect(phases).toEqual(['metadata', 'requesting-video', 'waiting-data']);
        expect(popup.location.href).toBe(`${selection.pickerUri}/autoclose`);
        expect(fetchMock.mock.calls.at(-1)).toMatchObject(['https://api.rivvon.ca/api/auth/photos/sessions/selection', { method: 'DELETE', credentials: 'include' }]);
        expect(popup.close).toHaveBeenCalled();
        expect(revoke).toHaveBeenCalledWith('blob:test-video');
    });

    it('surfaces denied consent without creating a picker session', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValueOnce(json({ connected: false }))
            .mockResolvedValueOnce(json({ connected: false, error: 'Google Photos permission was declined.' }));
        vi.stubGlobal('fetch', fetchMock);
        const links = [];
        const result = expect(importGooglePhotosVideo({ signal: new AbortController().signal,
            onExternalLink: value => links.push(value) })).rejects.toThrow('declined');
        await vi.advanceTimersByTimeAsync(1500);
        await result;
        expect(links[0].label).toBe('Continue with Google');
        expect(links.at(-1)).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('retains a continuation fallback when the old API finishes consent without staging a picker', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const fetchMock = vi.fn().mockResolvedValueOnce(json({ connected: false }))
            .mockResolvedValueOnce(json({ connected: true })).mockResolvedValueOnce(json(selection))
            .mockResolvedValueOnce(json({ success: true }));
        vi.stubGlobal('fetch', fetchMock);
        const popup = { closed: false, location: { set href(value) { popup.closed = true; } }, close: vi.fn() };
        const links = [];
        const result = expect(importGooglePhotosVideo({ popup, signal: controller.signal, onExternalLink: value => {
            links.push(value);
            if (value?.label === 'Open Google Photos') controller.abort();
        } })).rejects.toMatchObject({ name: 'AbortError' });
        await vi.advanceTimersByTimeAsync(1500);
        await result;
        expect(links).toContainEqual({ url: `${selection.pickerUri}/autoclose`, label: 'Open Google Photos' });
        expect(fetchMock.mock.calls[2][1].method).toBe('POST');
    });

    it('deletes the picker session with a fresh signal after cancellation', async () => {
        const controller = new AbortController();
        const fetchMock = vi.fn().mockResolvedValueOnce(json({ connected: true }))
            .mockResolvedValueOnce(json(selection)).mockResolvedValueOnce(json({ success: true }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(importGooglePhotosVideo({ signal: controller.signal,
            onExternalLink: value => { if (value?.label === 'Open Google Photos') controller.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
        const cleanup = fetchMock.mock.calls.at(-1)[1];
        expect(cleanup.method).toBe('DELETE');
        expect(cleanup.signal).not.toBe(controller.signal);
        expect(cleanup.signal.aborted).toBe(false);
    });
});
