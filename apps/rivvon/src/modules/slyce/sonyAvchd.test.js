import { describe, expect, it } from 'vitest';
import { annexBNalus, parseAvchdSps } from './sonyAvchd.js';

describe('Sony A7 AVCHD field recognition', () => {
    it('parses both Annex B start-code lengths without merging field access units', () => {
        expect([...annexBNalus(Uint8Array.from([0, 0, 0, 1, 103, 1, 0, 0, 1, 104, 2]))].map(n => [...n]))
            .toEqual([[103, 1], [104, 2]]);
    });

    it('rejects truncated SPS headers instead of treating them as supported video', () => {
        expect(() => parseAvchdSps(Uint8Array.from([103, 100]))).toThrow('Truncated');
    });

});
