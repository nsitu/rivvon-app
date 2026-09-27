import { describe, expect, it } from 'vitest';
import { BlobSource, Input, MPEG_TS } from 'mediabunny';
import { isVideoFile, VIDEO_FILE_ACCEPT } from './videoFile.js';

describe('video file intake', () => {
    it('includes MTS in the picker accept value', () => {
        expect(VIDEO_FILE_ACCEPT).toContain('.mts');
        expect(VIDEO_FILE_ACCEPT).toContain('video/*');
    });

    it('accepts MTS files when the browser reports a generic MIME type', () => {
        expect(isVideoFile({ name: 'Sony clip.MTS', type: 'application/octet-stream' })).toBe(true);
        expect(isVideoFile({ name: 'Sony clip.mts', type: '' })).toBe(true);
    });

    it('accepts regular browser-reported video files', () => {
        expect(isVideoFile({ name: 'clip.mp4', type: 'video/mp4' })).toBe(true);
    });

    it('does not treat unrelated files as videos', () => {
        expect(isVideoFile({ name: 'notes.mtsx', type: 'application/octet-stream' })).toBe(false);
        expect(isVideoFile({ name: 'notes.txt', type: 'text/plain' })).toBe(false);
        expect(isVideoFile(null)).toBe(false);
    });

    it('recognizes the 192-byte packet layout used by AVCHD-style transport streams', async () => {
        const packetSize = 192;
        const transportPacketSize = 188;
        const bytes = new Uint8Array(packetSize * 3);

        for (let packetIndex = 0; packetIndex < 3; packetIndex += 1) {
            const packetStart = packetIndex * packetSize;
            const transportStart = packetStart + (packetSize - transportPacketSize);
            bytes[transportStart] = 0x47;
            bytes[transportStart + 1] = 0x40;
            bytes[transportStart + 2] = 0x00;
            bytes[transportStart + 3] = 0x10;
        }

        const input = new Input({
            formats: [MPEG_TS],
            source: new BlobSource(new Blob([bytes])),
        });

        await expect(input.getFormat()).resolves.toBe(MPEG_TS);
        input.dispose();
    });
});
