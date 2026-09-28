import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { BlobSource, EncodedPacketSink, Input, MPEG_TS, MP4 } from 'mediabunny';
import { annexBNalus, inspectSonyAvchd, parseAvchdSps } from './sonyAvchd.js';
import { getInterlacedSource, getVideoProcessingFile } from './videoPreview.js';

const fixture = new URL('../../../../../00023.MTS', import.meta.url);

describe('Sony A7 AVCHD field recognition', () => {
    it('recognizes all 480 field pairs and exposes the 960 progressive samples', async () => {
        const file = new File([await readFile(fixture)], '00023.MTS');
        const input = new Input({ formats: [MPEG_TS], source: new BlobSource(file) });
        try {
            const track = await input.getPrimaryVideoTrack();
            const profile = await inspectSonyAvchd(track);
            expect(profile).toMatchObject({ width: 1920, height: 1080, decodedFrameCount: 480, frameCount: 960 });
            expect(profile.origin).toBeCloseTo(1.0333666667, 8);
            expect(profile.duration).toBeCloseTo(16.016, 8);
            const first = await new EncodedPacketSink(track).getFirstPacket();
            const sequence = [...annexBNalus(first.data)].find(nal => (nal[0] & 31) === 7);
            expect(parseAvchdSps(sequence)).toMatchObject({ profile: 100, level: 40, chroma: 1, lumaDepth: 8, chromaDepth: 8, frameOnly: 0, width: 1920, height: 1080 });
        } finally { input.dispose(); }
        const preview = await getVideoProcessingFile(file);
        expect(preview.type).toBe('video/mp4');
        const remux = new Input({ formats: [MP4], source: new BlobSource(preview) });
        try {
            const track = await remux.getPrimaryVideoTrack();
            expect(track.codedHeight).toBe(1080);
            expect(await track.computeDuration()).toBeCloseTo(16.016, 5);
            expect((await track.computePacketStats()).packetCount).toBe(960);
        } finally { remux.dispose(); }
        expect(getInterlacedSource(preview)?.file).toBe(file);
        expect(getInterlacedSource(preview)?.profile.frameCount).toBe(960);
        expect(await getVideoProcessingFile(file)).toBe(preview);
        expect(getInterlacedSource(new File(['unrelated'], 'other.mp4'))).toBeNull();
    });

    it('parses both Annex B start-code lengths without merging field access units', () => {
        expect([...annexBNalus(Uint8Array.from([0, 0, 0, 1, 103, 1, 0, 0, 1, 104, 2]))].map(n => [...n]))
            .toEqual([[103, 1], [104, 2]]);
    });

    it('rejects truncated SPS headers instead of treating them as supported video', () => {
        expect(() => parseAvchdSps(Uint8Array.from([103, 100]))).toThrow('Truncated');
    });

    it('rejects incomplete field pairs and unsupported cadence', async () => {
        const input = new Input({ formats: [MPEG_TS], source: new BlobSource(new Blob([await readFile(fixture)])) });
        try {
            const track = await input.getPrimaryVideoTrack();
            const packets = [];
            for await (const packet of new EncodedPacketSink(track).packets()) packets.push(packet);
            const mock = vi.spyOn(EncodedPacketSink.prototype, 'packets');
            try {
                mock.mockImplementation(async function* () { yield* packets.slice(0, -1); });
                await expect(inspectSonyAvchd(track)).rejects.toThrow('not supported');
                mock.mockImplementation(async function* () {
                    for (const packet of packets) yield packet.clone({ timestamp: packet.timestamp * 1.2 });
                });
                await expect(inspectSonyAvchd(track)).rejects.toThrow('not supported');
                mock.mockImplementation(async function* () {
                    yield packets[0]; yield packets[0]; yield* packets.slice(2);
                });
                await expect(inspectSonyAvchd(track)).rejects.toThrow('not supported');
            } finally { mock.mockRestore(); }
        } finally { input.dispose(); }
    });
});
