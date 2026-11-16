import { describe, expect, it } from 'vitest';
import { getSdrEncodeArgs, getSdrBitrate, rgbaToBt709I420, srgbToBt709, validateSdrDimensions } from './exportColour.js';
import { createColourChartRgba } from './colourTestChart.js';

const patch = rgb => rgbaToBt709I420(Uint8Array.from([...rgb,255, ...rgb,255, ...rgb,255, ...rgb,255]), 2, 2);
describe('real sRGB → BT.709 limited conversion', () => {
    it('maps black/white to video endpoints with neutral chroma', () => {
        expect([...patch([0,0,0])]).toEqual([16,16,16,16,128,128]);
        expect([...patch([255,255,255])]).toEqual([235,235,235,235,128,128]);
    });
    it('converts full-range pixel values instead of changing the range label', () => {
        const fullPatch = rgb => rgbaToBt709I420(Uint8Array.from(Array(4).fill([...rgb,255]).flat()), 2, 2, undefined, { fullRange: true });
        expect([...fullPatch([0,0,0])]).toEqual([0,0,0,0,128,128]);
        expect([...fullPatch([255,255,255])]).toEqual([255,255,255,255,128,128]);
        expect([...fullPatch([255,0,0])]).toEqual([54,54,54,54,99,255]);
        expect(fullPatch([128,128,128])[0]).toBe(115);
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
    it('shares resolution-aware bitrate targets with size estimates and specifies the encoder input explicitly', () => {
        expect(getSdrBitrate(1920, 1080, 'very-high')).toBe(12_000_000);
        expect(getSdrBitrate(1920, 1080, 'medium')).toBe(3_000_000);
        expect(getSdrBitrate(2160, 2160, 'very-high')).toBe(25_928_000);
        const args = getSdrEncodeArgs({ width: 1280, height: 720, fps: 30, frames: 10 });
        expect(args).toContain('yuv420p'); expect(args).toContain('libx264'); expect(args).toContain('tv');
    });
    it('generates the same chart with known source values each time', () => {
        const rgba = createColourChartRgba(320, 240);
        expect(rgba).toEqual(createColourChartRgba(320, 240));
        expect([...rgba.slice(0,4)]).toEqual([255,255,255,255]);
        expect([...rgba.slice(240 * 4,240 * 4 + 4)]).toEqual([0,0,255,255]);
    });
    it('passes numeric bitrate and QP directly to x264 without mixing rate control modes', () => {
        const options = { width: 1920, height: 1080, fps: 30, frames: 30 };
        const vbr = getSdrEncodeArgs({ ...options, bitrateMode: 'variable', bitrate: 14_000_000 });
        expect(vbr.slice(vbr.indexOf('-b:v'), vbr.indexOf('-b:v') + 2)).toEqual(['-b:v', '14000000']);
        expect(vbr).not.toContain('-qp');
        const qp = getSdrEncodeArgs({ ...options, bitrateMode: 'quantizer', quantizer: 0 });
        expect(qp.slice(qp.indexOf('-qp'), qp.indexOf('-qp') + 2)).toEqual(['-qp', '0']);
        expect(qp).not.toContain('-b:v');
    });
    it.each([0, 23.5, 51])('passes CRF %s and x264 preset without bitrate or QP flags', crf => {
        const args = getSdrEncodeArgs({ width: 1280, height: 720, fps: 30, frames: 30, bitrateMode: 'crf', crf, encoderPreset: 'slow' });
        expect(args.slice(args.indexOf('-crf'), args.indexOf('-crf') + 2)).toEqual(['-crf', String(crf)]);
        expect(args.slice(args.indexOf('-preset'), args.indexOf('-preset') + 2)).toEqual(['-preset', 'slow']);
        expect(args).not.toContain('-qp'); expect(args).not.toContain('-b:v');
    });
});
