import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVideoPreviewThumbnail, videoThumbnailSize } from './videoPreviewThumbnail.js';

const mocks = vi.hoisted(() => ({ init: vi.fn(), dispose: vi.fn(), target: null, options: null }));
vi.mock('mediabunny', () => ({
    ALL_FORMATS: [],
    BlobSource: class {}, UrlSource: class {}, Mp4OutputFormat: class {},
    BufferTarget: class { constructor() { mocks.target = this; } },
    Output: class {},
    Input: class {
        dispose = mocks.dispose;
        async getPrimaryVideoTrack() { return {
            getDisplayWidth: async () => 1080, getDisplayHeight: async () => 1920, computeDuration: async () => 5,
        }; }
    },
    Conversion: { init: mocks.init },
}));
beforeEach(() => {
    vi.stubGlobal('VideoEncoder', class {});
    vi.stubGlobal('VideoDecoder', class {});
    mocks.dispose.mockClear();
    mocks.init.mockReset().mockImplementation(async options => {
        mocks.options = options;
        return { isValid: true, state: 'idle', cancel: vi.fn(), async execute() {
            mocks.target.buffer = new Uint8Array([1, 2, 3]).buffer;
            this.onProgress?.(1); this.state = 'done';
        } };
    });
});
describe('video preview thumbnails', () => {
    it.each([
        [1920, 1080, 360, 202], [1080, 1920, 202, 360], [1080, 1080, 360, 360],
        [32, 24, 32, 24], [361, 360, 360, 360], [720, 3600, 72, 360],
    ])('bounds %s×%s to an AVC-compatible %s×%s', (w, h, width, height) => {
        expect(videoThumbnailSize(w, h)).toEqual({ width, height });
    });
    it('rejects invalid source dimensions', () => {
        expect(() => videoThumbnailSize(0, 100)).toThrow('dimensions');
        expect(() => videoThumbnailSize(Infinity, 100)).toThrow('dimensions');
    });
    it('forces full-length, silent low-bitrate AVC transcoding and reports progress', async () => {
        const onProgress = vi.fn();
        const result = await createVideoPreviewThumbnail(new Blob(['video']), { onProgress });
        expect(result.type).toBe('video/mp4');
        expect(result.size).toBe(3);
        expect(mocks.options).toMatchObject({ tracks: 'primary', audio: { discard: true }, video: {
            codec: 'avc', frameRate: 15, bitrate: 200_000, forceTranscode: true,
            width: 202, height: 360, fit: 'contain', allowTransformationMetadata: false,
        } });
        expect(mocks.options.trim).toBeUndefined();
        expect(onProgress).toHaveBeenCalledWith(1);
        expect(mocks.dispose).toHaveBeenCalledOnce();
    });
    it('reports missing WebCodecs without starting a conversion', async () => {
        vi.stubGlobal('VideoEncoder', undefined);
        await expect(createVideoPreviewThumbnail(new Blob(['video']))).rejects.toThrow('WebCodecs');
        expect(mocks.init).not.toHaveBeenCalled();
    });
    it('disposes input and cancels when the codec is unavailable', async () => {
        const cancel = vi.fn();
        mocks.init.mockResolvedValue({ isValid: false, state: 'idle', cancel });
        await expect(createVideoPreviewThumbnail(new Blob(['video']))).rejects.toThrow('cannot decode');
        expect(mocks.dispose).toHaveBeenCalledOnce();
        expect(cancel).toHaveBeenCalledOnce();
    });
    it('honours cancellation before work begins', async () => {
        const controller = new AbortController(); controller.abort();
        await expect(createVideoPreviewThumbnail(new Blob(['video']), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.init).not.toHaveBeenCalled();
    });
});
