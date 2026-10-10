import { describe, expect, it } from 'vitest';
import { getSdrEncodeArgs, getSdrBitrate, rgbaToBt709I420, srgbToBt709, validateSdrDimensions } from './exportColour.js';
import { createColourChartRgba } from './colourTestChart.js';

const patch = rgb => rgbaToBt709I420(Uint8Array.from([...rgb,255, ...rgb,255, ...rgb,255, ...rgb,255]), 2, 2);
describe('real sRGB → BT.709 limited conversion', () => {
    it('maps black/white to video endpoints with neutral chroma', () => {
        expect([...patch([0,0,0])]).toEqual([16,16,16,16,128,128]);
        expect([...patch([255,255,255])]).toEqual([235,235,235,235,128,128]);
    });
    it('uses 709 rather than 601 luma coefficients for saturated primaries', () => {
        expect([...patch([255,0,0])]).toEqual([63,63,63,63,102,240]);
        expect([...patch([0,255,0])]).toEqual([173,173,173,173,42,26]);
        expect([...patch([0,0,255])]).toEqual([32,32,32,32,240,118]);
    });
    it('converts the transfer function instead of merely labelling sRGB samples', () => {
        expect(srgbToBt709(0)).toBe(0);
        expect(srgbToBt709(1)).toBeCloseTo(1);
        expect(srgbToBt709(128 / 255)).toBeCloseTo(0.4523, 3);
        expect(patch([128,128,128])[0]).toBe(115); // retagging would produce 126
        const ramp = Array.from({ length: 256 }, (_, n) => patch([n,n,n])[0]);
        expect(ramp.every((v, n) => !n || v >= ramp[n - 1])).toBe(true);
    });
    it('rejects odd dimensions without changing their size', () => {
        expect(() => validateSdrDimensions(321, 240, 30)).toThrow('even');
        expect(() => validateSdrDimensions(320, 241, 30)).toThrow('even');
    });
    it('retains Mediabunny quality targets and specifies the encoder input explicitly', () => {
        expect(getSdrBitrate(1920, 1080, 'very-high')).toBe(12_000_000);
        expect(getSdrBitrate(1920, 1080, 'medium')).toBe(3_000_000);
        const args = getSdrEncodeArgs({ width: 1280, height: 720, fps: 30, frames: 10 });
        expect(args).toContain('yuv420p'); expect(args).toContain('libx264'); expect(args).toContain('tv');
    });
    it('generates the same chart with known source values each time', () => {
        const rgba = createColourChartRgba(320, 240);
        expect(rgba).toEqual(createColourChartRgba(320, 240));
        expect([...rgba.slice(0,4)]).toEqual([255,255,255,255]);
        expect([...rgba.slice(240 * 4,240 * 4 + 4)]).toEqual([0,0,255,255]);
    });
});
