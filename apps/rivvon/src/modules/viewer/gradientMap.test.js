import { describe, expect, it } from 'vitest';

import {
    createGradientMapLut,
    createLegacyDuotoneStops,
    normalizeGradientMapStops,
} from './gradientMap.js';

describe('normalizeGradientMapStops', () => {
    it('clamps, expands colors, and sorts stops while preserving ids', () => {
        expect(normalizeGradientMapStops([
            { id: 'high', position: 1.4, color: '#fff' },
            { id: 'low', position: -1, color: '123456' },
        ])).toEqual([
            { id: 'low', position: 0, color: '#123456' },
            { id: 'high', position: 1, color: '#ffffff' },
        ]);
    });

    it('migrates the previous black-to-selected-color behavior', () => {
        expect(createLegacyDuotoneStops('#57c785')).toEqual([
            { id: 'shadow', position: 0, color: '#000000' },
            { id: 'highlight', position: 1, color: '#57c785' },
        ]);
    });
});

describe('createGradientMapLut', () => {
    it('interpolates stop channels in encoded sRGB space', () => {
        const lut = createGradientMapLut([
            { position: 0, color: '#000000' },
            { position: 0.5, color: '#ff0000' },
            { position: 1, color: '#ffffff' },
        ], 3);

        expect(Array.from(lut)).toEqual([
            0, 0, 0, 255,
            255, 0, 0, 255,
            255, 255, 255, 255,
        ]);
    });

    it('clamps beyond endpoint stop positions', () => {
        const lut = createGradientMapLut([
            { position: 0.25, color: '#123456' },
            { position: 0.75, color: '#abcdef' },
        ], 5);

        expect(Array.from(lut.slice(0, 4))).toEqual([18, 52, 86, 255]);
        expect(Array.from(lut.slice(-4))).toEqual([171, 205, 239, 255]);
    });
});
