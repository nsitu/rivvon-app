import * as THREE from 'three';

// Match the variance of the preview's 17-tap kernel. Repeating that kernel
// divides its radius by sqrt(passCount), so its total variance stays constant.
const PREVIEW_WEIGHTS = [0.1032, 0.1000, 0.0910, 0.0779, 0.0626, 0.0472, 0.0335, 0.0223, 0.0140];
const PREVIEW_GAIN = PREVIEW_WEIGHTS[0] + 2 * PREVIEW_WEIGHTS.slice(1).reduce((a, b) => a + b, 0);
const PREVIEW_VARIANCE = 2 * PREVIEW_WEIGHTS.slice(1).reduce(
    (sum, weight, i) => sum + weight * ((i + 1) / 8) ** 2, 0,
) / PREVIEW_GAIN;

export function getExportBlurSigma(radius) {
    return radius * Math.sqrt(PREVIEW_VARIANCE);
}

export function createExportGaussianKernel(sigma) {
    if (!Number.isFinite(sigma) || sigma <= 0) {
        throw new RangeError('Background blur sigma must be finite and positive.');
    }
    const radius = Math.ceil(4 * sigma);
    const weights = Array.from({ length: radius + 1 }, (_, i) => Math.exp(-0.5 * (i / sigma) ** 2));
    const gain = weights[0] + 2 * weights.slice(1).reduce((a, b) => a + b, 0);
    const taps = [{ offset: 0, weight: weights[0] / gain }];
    // A bilinear lookup combines two adjacent texels with their exact Gaussian
    // weights. Every texel in the support is covered; no stretched sample gaps.
    for (let i = 1; i <= radius; i += 2) {
        const first = weights[i];
        const second = weights[i + 1] || 0;
        if (first + second === 0) continue; // Tiny exports can underflow both tails.
        taps.push({ offset: i + second / (first + second), weight: (first + second) / gain });
    }
    return { sigma, radius, taps };
}

export function createExportGaussianTexture(kernel) {
    const data = new Float32Array(kernel.taps.length * 4);
    kernel.taps.forEach(({ offset, weight }, i) => {
        data[i * 4] = offset;
        data[i * 4 + 1] = weight;
    });
    const texture = new THREE.DataTexture(data, kernel.taps.length, 1, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
}
