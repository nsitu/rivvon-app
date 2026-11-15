import { describe, expect, it } from 'vitest';
import { inspectAv1ColourObus } from './av1ColourMetadata.js';

// Real libaom packets, independently checked with FFmpeg trace_headers. The
// declared fixture uses av1_metadata to explicitly signal 709/709/709.
const declaredAv1 = '12000a0d00000002afff9b5f2202020208320d1000a800000240000003d2c6e4';
const bytes = hex => Uint8Array.from(hex.match(/../g) ?? [], n => parseInt(n, 16));
describe('independent AV1 colour inspection', () => {
    it('reads sequence headers while skipping delimiter and coded frame OBUs', () => {
        expect(inspectAv1ColourObus(bytes(declaredAv1))).toEqual([{ profile: 0, width: 64, height: 64,
            primaries: 1, transfer: 1, matrix: 1, fullRange: false, chromaFormat: 1, bitDepthLuma: 8, bitDepthChroma: 8 }]);
    });
    it.each([[false, '12000a0d00000002afff9b5f2204040208320d1000a800000240000003d2c6e4'],
        [true, '12000a0d00000002afff9b5f2204040308320d1000a80000024000002c2f9880']])('preserves unspecified transfer/primaries and actual full-range flag %s', (fullRange, hex) => {
        expect(inspectAv1ColourObus(bytes(hex))[0]).toMatchObject({ primaries: 2, transfer: 2, matrix: 1, fullRange });
    });
    it.each(['0a8001', '0a0100', '8a00', '0a8080808080808080', '0e00'])('rejects malformed/truncated OBUs %s', hex => {
        expect(() => inspectAv1ColourObus(bytes(hex))).toThrow(/AV1/);
    });
    it('does not claim a sequence declaration when packets have none', () => {
        expect(inspectAv1ColourObus(bytes('1200320100'))).toEqual([]);
    });
});
