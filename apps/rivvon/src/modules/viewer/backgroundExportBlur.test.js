import { describe, expect, it } from 'vitest';
import { createExportGaussianKernel, createExportGaussianTexture, getExportBlurSigma } from './backgroundExportBlur.js';

describe('export Gaussian convolution', () => {
    it.each([0.005, 0.5, 3, 19, 205, 394])('matches a dense reference at sigma %s, including edges and fine patterns', sigma => {
        const { taps, radius } = createExportGaussianKernel(sigma);
        const signal = Array.from({ length: 257 }, (_, i) => i === 128 ? 1 : (i % 7) / 20);
        const at = i => signal[Math.max(0, Math.min(signal.length - 1, i))];
        const linear = x => at(Math.floor(x)) * (1 - (x - Math.floor(x))) + at(Math.floor(x) + 1) * (x - Math.floor(x));
        for (const x of [0, 1, 32, 127, 128, 129, 254, 256]) {
            let reference = 0, gain = 0;
            for (let i = -radius; i <= radius; i++) {
                const weight = Math.exp(-i * i / (2 * sigma * sigma));
                reference += at(x + i) * weight;
                gain += weight;
            }
            const paired = taps[0].weight * at(x) + taps.slice(1).reduce(
                (sum, tap) => sum + tap.weight * (linear(x + tap.offset) + linear(x - tap.offset)), 0,
            );
            expect(paired).toBeCloseTo(reference / gain, 12);
        }
        expect(taps[0].weight + 2 * taps.slice(1).reduce((s, t) => s + t.weight, 0)).toBeCloseTo(1, 12);
        expect(radius).toBe(Math.ceil(4 * sigma));
    });

    it('preserves the preview variance and scales its width with output resolution', () => {
        const kernel = createExportGaussianKernel(getExportBlurSigma(49 * 10));
        expect(kernel.sigma / 10).toBeCloseTo(getExportBlurSigma(49), 12);
        const denseVariance = Array.from({ length: kernel.radius + 1 }, (_, i) => Math.exp(-0.5 * (i / kernel.sigma) ** 2));
        const gain = denseVariance[0] + 2 * denseVariance.slice(1).reduce((a, b) => a + b, 0);
        const variance = 2 * denseVariance.reduce((s, w, i) => s + w * i * i, 0) / gain;
        expect(Math.sqrt(variance) / kernel.sigma).toBeCloseTo(1, 2);
    });

    it('stores paired offsets and weights without quantizing to eight bits', () => {
        const kernel = createExportGaussianKernel(6);
        const texture = createExportGaussianTexture(kernel);
        expect(texture.image.data).toBeInstanceOf(Float32Array);
        expect(texture.image.width).toBe(kernel.taps.length);
        expect(texture.generateMipmaps).toBe(false);
        kernel.taps.forEach((tap, i) => {
            expect(texture.image.data[i * 4]).toBeCloseTo(tap.offset, 5);
            expect(texture.image.data[i * 4 + 1]).toBeCloseTo(tap.weight, 7);
        });
        texture.dispose();
    });

    it.each([0, -1, NaN, Infinity])('rejects invalid sigma %s', sigma => {
        expect(() => createExportGaussianKernel(sigma)).toThrow(RangeError);
    });
});
