import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVideoPreviewThumbnail } from '../modules/viewer/videoPreviewThumbnail.js';
import { publishVideoBlob } from './videoService.js';

vi.mock('../modules/viewer/videoPreviewThumbnail.js', () => ({ createVideoPreviewThumbnail: vi.fn() }));
const calls = [];
beforeEach(() => {
    calls.length = 0;
    createVideoPreviewThumbnail.mockReset().mockResolvedValue(new Blob(['preview'], { type: 'video/mp4' }));
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
        calls.push([url, options]);
        return new Response(JSON.stringify(url.endsWith('/video') ? { videoId: 'published', uploadUrl: 'https://upload.example', uploadHeaders: {} } : {}));
    }));
    vi.stubGlobal('XMLHttpRequest', class {
        upload = { addEventListener() {} };
        listeners = {};
        status = 200;
        open() {} setRequestHeader() {} getResponseHeader() { return ''; }
        addEventListener(name, listener) { this.listeners[name] = listener; }
        send() { this.listeners.load(); }
    });
});
describe('gallery publication thumbnails', () => {
    it('generates and uploads a video preview by default before completing publication', async () => {
        const blob = new Blob(['video'], { type: 'video/mp4' });
        await publishVideoBlob({ blob, thumbnailBlob: new Blob(['poster'], { type: 'image/webp' }) });
        expect(createVideoPreviewThumbnail).toHaveBeenCalledWith(blob, expect.any(Object));
        expect(calls.map(([url]) => new URL(url).pathname)).toEqual([
            '/video', '/video/published/thumbnail', '/video/published/video-thumbnail', '/video/published/complete',
        ]);
        expect(calls[2][1].headers['Content-Type']).toBe('video/mp4');
    });
    it('does not create a remote record if encoding fails', async () => {
        createVideoPreviewThumbnail.mockRejectedValue(new Error('Unsupported codec'));
        await expect(publishVideoBlob({ blob: new Blob(['video']) })).rejects.toThrow('Unsupported codec');
        expect(fetch).not.toHaveBeenCalled();
    });
    it('removes partial publication when preview upload fails', async () => {
        fetch.mockImplementation(async (url, options) => {
            calls.push([url, options]);
            return new Response(JSON.stringify(url.endsWith('/video') ? { videoId: 'published', uploadUrl: 'https://upload.example' } : { error: 'Upload failed' }),
                { status: url.endsWith('/video-thumbnail') ? 500 : 200 });
        });
        await expect(publishVideoBlob({ blob: new Blob(['video']) })).rejects.toThrow('Upload failed');
        expect(calls.at(-1)[1].method).toBe('DELETE');
        expect(calls.some(([url]) => url.endsWith('/complete'))).toBe(false);
    });
});
