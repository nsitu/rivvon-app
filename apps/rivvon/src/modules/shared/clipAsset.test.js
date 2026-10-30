import { describe, expect, it } from 'vitest';
import { inspectClipInput, getClipInputFormats } from '../../../../../packages/shared-types/src/clipAsset.js';

function input({ codec = 'hevc', config = { codec: 'hev1.1.6.L120.90' }, mimeType = 'video/mp4', ...overrides } = {}) {
    const track = { displayWidth: 1920, displayHeight: 1080, codedWidth: 1920, codedHeight: 1080, rotation: 0,
        getCodec: async () => codec, getDecoderConfig: async () => config, getFirstTimestamp: async () => 5,
        computeDuration: async () => 17, computePacketStats: async () => ({ averagePacketRate: 30 }), ...overrides };
    return { canRead: async () => true, getFormat: async () => ({ name: 'Detected format', mimeType }), getPrimaryVideoTrack: async () => track };
}
describe('clip media metadata validation', () => {
    it.each(['hevc', 'vp9', 'av1', 'avc'])('uses the detected %s track without an H.264/profile allowlist', async codec => {
        const metadata = await inspectClipInput(input({ codec, config: { codec, colorSpace: { transfer: 'smpte2084', primaries: 'bt2020' } } }));
        expect(metadata).toMatchObject({ codec, duration: 12, firstTimestamp: 5, mimeType: 'video/mp4' });
    });
    it('rejects unreadable files, missing video tracks and unrecognized codecs', async () => {
        await expect(inspectClipInput({ ...input(), canRead: async () => false })).rejects.toThrow('could not open');
        await expect(inspectClipInput({ ...input(), getPrimaryVideoTrack: async () => null })).rejects.toThrow('readable video track');
        await expect(inspectClipInput(input({ codec: null, config: null }))).rejects.toThrow('identify the video codec');
    });
    it('retains dimension, duration and finite-timing budgets', async () => {
        await expect(inspectClipInput(input({ displayWidth: 4096 }))).rejects.toThrow('3840');
        await expect(inspectClipInput(input({ computeDuration: async () => 100 }))).rejects.toThrow('60 seconds');
        await expect(inspectClipInput(input({ getFirstTimestamp: async () => NaN }))).rejects.toThrow('60 seconds');
    });
    it('accepts 3840-square clips and still checks coded dimensions', async () => {
        await expect(inspectClipInput(input({ displayWidth: 3840, displayHeight: 3840, codedWidth: 3840, codedHeight: 3840 })))
            .resolves.toMatchObject({ width: 3840, height: 3840 });
        await expect(inspectClipInput(input({ codedHeight: 3841 }))).rejects.toThrow('3840');
    });
    it('excludes playlists and audio-only formats from uploaded video containers', () => {
        const formats = [{ mimeType: 'video/webm' }, { mimeType: 'video/MP2T' }, { mimeType: 'audio/wav' }, { mimeType: 'application/vnd.apple.mpegurl' }];
        expect(getClipInputFormats(formats)).toEqual(formats.slice(0, 2));
    });
});
