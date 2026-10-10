import { describe, expect, it } from 'vitest';
import { assertSdrMp4, assertSdrSps, inspectMp4Colour, inspectSps, restoreCfrMp4Timing } from './videoColourMetadata.js';

const good = { chromaFormat: 1, bitDepthLuma: 8, bitDepthChroma: 8, width: 320, height: 240,
    fullRange: false, primaries: 1, transfer: 1, matrix: 1 };
describe('colour validation fails closed', () => {
    it('parses a real x264 SPS independently checked with FFmpeg trace_headers', () => {
        const hex = '67640028acb403c0113f2cd404040694000003019000005da83c60ca80';
        const bytes = Uint8Array.from(hex.match(/../g), n => parseInt(n,16));
        expect(inspectSps(bytes)).toMatchObject({ ...good, width:1920, height:1080, profile:100, level:40 });
    });
    it.each([{ fullRange: true }, { matrix: 6 }, { transfer: 13 }, { primaries: 6 }, { bitDepthLuma: 10 }, { chromaFormat: 3 }, { width: 322 }])('rejects a nonconforming SPS %j', change => {
        expect(() => assertSdrSps([{ ...good, ...change }], good)).toThrow('does not conform');
    });
    it('requires SPS and nclx rather than trusting encoder callback metadata', () => {
        expect(() => assertSdrSps([], good)).toThrow();
        expect(() => assertSdrMp4(new Uint8Array(), { ...good, fps: 30, frames: 30 })).toThrow();
    });
    it('rejects malformed boxes and truncated SPS', () => {
        expect(() => inspectMp4Colour(Uint8Array.from([0,0,0,20,109,111,111,118]))).toThrow();
        expect(() => inspectSps(Uint8Array.from([0x67,100]))).toThrow();
    });
});

function box(type, payload) {
    const result = new Uint8Array(payload.length + 8), view = new DataView(result.buffer);
    view.setUint32(0,result.length); result.set([...type].map(c => c.charCodeAt(0)),4); result.set(payload,8);
    return result;
}
function concat(...arrays) { return Uint8Array.from(arrays.flatMap(a => [...a])); }
function clockBox(type, scale, duration) {
    const payload = new Uint8Array(24), view = new DataView(payload.buffer);
    view.setUint32(12,scale); view.setUint32(16,duration); return box(type,payload);
}
describe('CFR loop timing', () => {
    it('repairs a rounded last sample without changing video payload bytes', () => {
        const stts = new Uint8Array(24), view = new DataView(stts.buffer);
        view.setUint32(4,2); view.setUint32(8,1); view.setUint32(12,100000); view.setUint32(16,1); view.setUint32(20,100001);
        const pixels = box('mdat',Uint8Array.from([7,8,9,10]));
        const mp4 = concat(box('moov',concat(clockBox('mvhd',2997000,200001),
            box('trak',box('mdia',concat(clockBox('mdhd',2997000,200001),box('minf',box('stbl',box('stts',stts)))))))),pixels);
        restoreCfrMp4Timing(mp4,{ fps:29.97,frames:2 });
        expect(inspectMp4Colour(mp4)).toMatchObject({ frameCount:2,durationTicks:200000,mediaDurationTicks:200000,movieDurationTicks:200000 });
        expect([...mp4.slice(-pixels.length)]).toEqual([...pixels]);
        expect(() => restoreCfrMp4Timing(mp4,{ fps:29.97,frames:3 })).toThrow();
    });
});
