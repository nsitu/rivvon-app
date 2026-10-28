import { describe, expect, it } from 'vitest';
import { getBackgroundTextureCoverScale } from './backgroundTextures.js';

describe('static background cover fit', () => {
    it.each([
        [2000, 1000, 2, [1, 1]],
        [2000, 1000, 1, [0.5, 1]],
        [2000, 1000, 0.5, [0.25, 1]],
        [1000, 2000, 2, [1, 0.25]],
        [1000, 1000, 2, [1, 0.5]],
        [1000, 1000, 0.5, [0.5, 1]],
    ])('preserves %s × %s image proportions at surface aspect %s', (width, height, aspect, expected) => {
        const scale = getBackgroundTextureCoverScale(width, height, aspect);
        expect(scale).toEqual(expected);
        // The visible image region must have the same aspect as the surface,
        // and at least one image axis remains entirely visible (cover, no bars).
        expect(width * scale[0] / (height * scale[1])).toBeCloseTo(aspect);
        expect(Math.max(...scale)).toBe(1);
    });

    it.each([
        [undefined, undefined, 1], [0, 100, 1], [100, 0, 1], [-100, -100, 1],
        [Infinity, 100, 1], [100, Infinity, 1], [100, 100, NaN], [100, 100, 0],
    ])('keeps UVs finite while image or surface dimensions are unavailable', (...dimensions) => {
        expect(getBackgroundTextureCoverScale(...dimensions)).toEqual([1, 1]);
    });
});
