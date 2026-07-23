import * as THREE from 'three';
import { acquireKTX2Loader, releaseKTX2Loader } from '../slyce/sharedKTX2Loader.js';
import { createLazyLoader } from '../shared/lazyLoader.js';
import { getClonedDecodedTexture, rememberDecodedTexture } from '../shared/decodedTextureCache.js';
import { getCachedTextureTiles, getOrFetchTextureTiles } from '../../services/sessionTextureCache.js';

const loadJSZipModule = createLazyLoader(() => import('jszip').then(module => module.default));

const loadWebGPUModule = createLazyLoader(() => import('three/webgpu'));

const loadTSLModule = createLazyLoader(() => import('three/tsl'));

// Default texture ID from CDN (used when no source specified)
export const DEFAULT_TEXTURE_ID = 'wv-ywyV14qYSbrzgYga4l';
const CAP_ALPHA_AA_SCALE = 0.7;
const CAP_ALPHA_MIN_AA = 1 / 4096;
const TRANSPARENT_SHADOWS_LUMA_MIN = 0.2;
const TRANSPARENT_SHADOWS_LUMA_MAX = 0.5;
const PEAK_TROUGH_FADE_START = 0.65;
const PEAK_TROUGH_FADE_END = 1.0;
const PEAK_TROUGH_MIN_ALPHA = 0.0;
const DEFAULT_EDGE_NOISE_TRANSPARENCY_MAX = 0.5;
const MAX_EDGE_NOISE_TRANSPARENCY = 0.5;
const DEFAULT_EDGE_DRIFT_ENABLED = false;
const DEFAULT_EDGE_NOISE_PATTERN_LENGTH = 0.5;
const MIN_EDGE_NOISE_PATTERN_LENGTH = 0.1;
const MAX_EDGE_NOISE_PATTERN_LENGTH = 2;
const DEFAULT_FILMSTRIP_STYLE_ENABLED = false;
const DEFAULT_FILMSTRIP_GAP_LENGTH = 0.4;
const MIN_FILMSTRIP_GAP_LENGTH = 0.05;
const MAX_FILMSTRIP_GAP_LENGTH = 2;
const DEFAULT_FILMSTRIP_HOLE_LENGTH = 0.4;
const MIN_FILMSTRIP_HOLE_LENGTH = 0.05;
const MAX_FILMSTRIP_HOLE_LENGTH = 1;
const DEFAULT_FILMSTRIP_APERTURE = 0.45;
const MIN_FILMSTRIP_APERTURE = 0.1;
const MAX_FILMSTRIP_APERTURE = 0.95;
const DEFAULT_FILMSTRIP_HOLE_ROUNDEDNESS = 0.7;
const MIN_FILMSTRIP_HOLE_ROUNDEDNESS = 0;
const MAX_FILMSTRIP_HOLE_ROUNDEDNESS = 1;
const FILMSTRIP_EDGE_BAND_WIDTH = 0.18;
const FILMSTRIP_AA_SCALE = 1.5;
const FILMSTRIP_MIN_AA = 0.001;
const EDGE_NOISE_TIME_CELLS = 5;
const EDGE_NOISE_AA_SCALE = 1.5;
const EDGE_NOISE_MIN_AA = 0.001;

const CAP_ALPHA_GLSL = /* glsl */`
                float computeCapSignedDistance(float style, vec2 capUv) {
                    if (style < 0.5) {
                        return 1.0;
                    }

                    if (style < 1.5) {
                        float circleDistance = 0.5 - length(capUv - vec2(0.5, 0.5));
                        return max(circleDistance, capUv.x - 0.5);
                    }

                    if (style < 2.5) {
                        return capUv.x * 0.5 - abs(capUv.y - 0.5);
                    }

                    float centerWeight = 1.0 - abs(capUv.y * 2.0 - 1.0);
                    float biteBoundary = 0.05 + 0.26 * centerWeight;
                    return capUv.x - biteBoundary;
                }

                float computeCapAlpha(vec2 startCapUv, vec2 endCapUv, float startStyle, float endStyle) {
                    float startSignedDistance = computeCapSignedDistance(startStyle, startCapUv);
                    float endSignedDistance = computeCapSignedDistance(endStyle, endCapUv);
                    float signedDistance = min(startSignedDistance, endSignedDistance);
                    float aa = max(fwidth(signedDistance) * ${CAP_ALPHA_AA_SCALE.toFixed(1)}, ${CAP_ALPHA_MIN_AA});
                    return smoothstep(-aa, aa, signedDistance);
                }
`;

const PEAK_TROUGH_MASK_GLSL = /* glsl */`
                float computePeakTroughMask(
                    float temporalUv,
                    float tileIndex,
                    float tileCount,
                    float layerIndex,
                    float layerCount,
                    float fadeStart,
                    float fadeEnd,
                    float enabled
                ) {
                    if (enabled < 0.5 || tileCount < 1.0 || layerCount < 1.0) {
                        return 0.0;
                    }

                    float globalProgress = (tileIndex + clamp(temporalUv, 0.0, 1.0)) / tileCount;
                    float layerPhase = layerIndex / layerCount;
                    float extremity = abs(sin(6.28318530718 * (globalProgress + layerPhase)));
                    return smoothstep(fadeStart, max(fadeEnd, fadeStart + 0.0001), extremity);
                }
`;

const PEAK_TROUGH_BLUR_GLSL = /* glsl */`
                vec3 samplePeakTroughBlur(
                    sampler2DArray texArray,
                    vec2 sampleUv,
                    float layerIndex,
                    float strength
                ) {
                    vec2 textureDimensions = vec2(textureSize(texArray, 0).xy);
                    // Treat the toolbar value as strength rather than a literal
                    // texel radius so high settings can intentionally erase detail.
                    float radius = max(strength * strength * 2.0, 1.0);
                    float maxMipLevel = floor(log2(max(textureDimensions.x, textureDimensions.y)));
                    float blurMipLevel = clamp(floor(log2(radius) + 1.0), 0.0, maxMipLevel);
                    vec2 offset = radius / max(textureDimensions, vec2(1.0));
                    vec2 halfOffset = offset * 0.5;
                    vec3 color = textureLod(texArray, vec3(sampleUv, layerIndex), blurMipLevel).rgb * 0.08;

                    color += textureLod(texArray, vec3(sampleUv + vec2(-halfOffset.x, 0.0), layerIndex), blurMipLevel).rgb * 0.10;
                    color += textureLod(texArray, vec3(sampleUv + vec2( halfOffset.x, 0.0), layerIndex), blurMipLevel).rgb * 0.10;
                    color += textureLod(texArray, vec3(sampleUv + vec2(0.0, -halfOffset.y), layerIndex), blurMipLevel).rgb * 0.10;
                    color += textureLod(texArray, vec3(sampleUv + vec2(0.0,  halfOffset.y), layerIndex), blurMipLevel).rgb * 0.10;

                    color += textureLod(texArray, vec3(sampleUv + vec2(-offset.x, -offset.y), layerIndex), blurMipLevel).rgb * 0.08;
                    color += textureLod(texArray, vec3(sampleUv + vec2( offset.x, -offset.y), layerIndex), blurMipLevel).rgb * 0.08;
                    color += textureLod(texArray, vec3(sampleUv + vec2(-offset.x,  offset.y), layerIndex), blurMipLevel).rgb * 0.08;
                    color += textureLod(texArray, vec3(sampleUv + vec2( offset.x,  offset.y), layerIndex), blurMipLevel).rgb * 0.08;

                    color += textureLod(texArray, vec3(sampleUv + vec2(-offset.x, 0.0), layerIndex), blurMipLevel).rgb * 0.05;
                    color += textureLod(texArray, vec3(sampleUv + vec2( offset.x, 0.0), layerIndex), blurMipLevel).rgb * 0.05;
                    color += textureLod(texArray, vec3(sampleUv + vec2(0.0, -offset.y), layerIndex), blurMipLevel).rgb * 0.05;
                    color += textureLod(texArray, vec3(sampleUv + vec2(0.0,  offset.y), layerIndex), blurMipLevel).rgb * 0.05;

                    return color;
                }
`;

const EDGE_NOISE_GLSL = /* glsl */`
                const float EDGE_NOISE_TIME_CELLS = ${EDGE_NOISE_TIME_CELLS.toFixed(1)};

                float edgeNoiseHash(vec3 p) {
                    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
                }

                float edgeNoiseFade(float t) {
                    return t * t * (3.0 - 2.0 * t);
                }

                float edgeNoiseValueLattice(float x, float y, float seed) {
                    float x0 = floor(x);
                    float y0 = floor(y);
                    float xf = fract(x);
                    float yf = fract(y);
                    float y0Wrapped = mod(y0, EDGE_NOISE_TIME_CELLS);
                    float y1Wrapped = mod(y0 + 1.0, EDGE_NOISE_TIME_CELLS);

                    float h00 = edgeNoiseHash(vec3(x0, y0Wrapped, seed));
                    float h10 = edgeNoiseHash(vec3(x0 + 1.0, y0Wrapped, seed));
                    float h01 = edgeNoiseHash(vec3(x0, y1Wrapped, seed));
                    float h11 = edgeNoiseHash(vec3(x0 + 1.0, y1Wrapped, seed));
                    float ux = edgeNoiseFade(xf);
                    float uy = edgeNoiseFade(yf);

                    return mix(mix(h00, h10, ux), mix(h01, h11, ux), uy);
                }

                float edgeNoiseValue(float edgeNoiseU, float phase, float edgeSide, float spatialFrequency) {
                    float x = edgeNoiseU * spatialFrequency;
                    float y = phase * EDGE_NOISE_TIME_CELLS + edgeSide * 1.731;
                    float seed = 17.0 + edgeSide * 23.0;
                    float baseNoise = edgeNoiseValueLattice(x, y, seed);
                    float detailNoise = edgeNoiseValueLattice(x * 2.13 + 19.17, y * 2.0 + 7.31, seed + 41.0);

                    return clamp(baseNoise * 0.74 + detailNoise * 0.26, 0.0, 1.0);
                }

                float computeEdgeNoiseAlpha(vec2 uv, float edgeNoiseU, float maxCutWidth, float phase, float spatialFrequency, float mirrorShape) {
                    if (maxCutWidth <= 0.0001) {
                        return 1.0;
                    }

                    float edgeSide = step(0.5, uv.y);
                    float sampleEdgeSide = mix(edgeSide, 0.0, step(0.5, mirrorShape));
                    float noiseSignal = edgeNoiseValue(edgeNoiseU, phase, sampleEdgeSide, spatialFrequency);
                    float edgeDistance = min(uv.y, 1.0 - uv.y);
                    float cutWidth = maxCutWidth * noiseSignal;
                    float aa = max(fwidth(edgeDistance) * ${EDGE_NOISE_AA_SCALE.toFixed(1)}, ${EDGE_NOISE_MIN_AA});
                    return smoothstep(cutWidth, cutWidth + aa, edgeDistance);
                }
`;

const FILMSTRIP_GLSL = /* glsl */`
                float computeRoundedRectSignedDistance(vec2 point, vec2 halfSize, float radius) {
                    vec2 safeHalfSize = max(halfSize, vec2(0.0001));
                    float safeRadius = clamp(radius, 0.0, min(safeHalfSize.x, safeHalfSize.y));
                    vec2 innerHalfSize = max(safeHalfSize - vec2(safeRadius), vec2(0.0001));
                    vec2 q = abs(point) - innerHalfSize;
                    vec2 qMax = max(q, vec2(0.0));
                    float outside = length(qMax) - safeRadius;
                    float inside = min(max(q.x, q.y), 0.0);
                    return outside + inside;
                }

                float computeFilmstripAlpha(vec2 uv, float edgeNoiseU, float enabled, float gapLength, float holeLength, float aperture, float roundedness) {
                    if (enabled < 0.5) {
                        return 1.0;
                    }

                    float safeGapLength = max(gapLength, 0.0001);
                    float safeHoleLength = clamp(holeLength, ${MIN_FILMSTRIP_HOLE_LENGTH.toFixed(2)}, ${MAX_FILMSTRIP_HOLE_LENGTH.toFixed(2)});
                    float holeAperture = clamp(aperture, ${MIN_FILMSTRIP_APERTURE.toFixed(2)}, ${MAX_FILMSTRIP_APERTURE.toFixed(2)});
                    float holeRoundedness = clamp(roundedness, 0.0, 1.0);
                    float cycleLength = safeHoleLength + safeGapLength;
                    float edgeDistance = min(uv.y, 1.0 - uv.y);
                    float bandWidth = ${FILMSTRIP_EDGE_BAND_WIDTH.toFixed(2)};
                    float localX = (fract(edgeNoiseU / max(cycleLength, 0.0001)) - 0.5) * cycleLength;
                    float localY = edgeDistance - bandWidth * 0.5;
                    float halfWidth = max(0.01, safeHoleLength * 0.5);
                    float halfHeight = bandWidth * (0.18 + holeAperture * 0.38);
                    float radius = min(halfWidth, halfHeight) * holeRoundedness * 0.95;
                    float holeDistance = computeRoundedRectSignedDistance(vec2(localX, localY), vec2(halfWidth, halfHeight), radius);
                    float aa = max(fwidth(holeDistance) * ${FILMSTRIP_AA_SCALE.toFixed(1)}, ${FILMSTRIP_MIN_AA});
                    float holeMask = 1.0 - smoothstep(-aa, aa, holeDistance);
                    return 1.0 - holeMask;
                }
`;

function normalizeEdgeNoiseTransparencyMax(value) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return DEFAULT_EDGE_NOISE_TRANSPARENCY_MAX;
    }

    return Math.min(MAX_EDGE_NOISE_TRANSPARENCY, Math.max(0, parsed));
}

function normalizeEdgeNoisePatternLength(value) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return DEFAULT_EDGE_NOISE_PATTERN_LENGTH;
    }

    return Math.min(MAX_EDGE_NOISE_PATTERN_LENGTH, Math.max(MIN_EDGE_NOISE_PATTERN_LENGTH, parsed));
}

function normalizeFilmstripGapLength(value) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return DEFAULT_FILMSTRIP_GAP_LENGTH;
    }

    return Math.min(MAX_FILMSTRIP_GAP_LENGTH, Math.max(MIN_FILMSTRIP_GAP_LENGTH, parsed));
}

function normalizeFilmstripHoleLength(value) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return DEFAULT_FILMSTRIP_HOLE_LENGTH;
    }

    return Math.min(MAX_FILMSTRIP_HOLE_LENGTH, Math.max(MIN_FILMSTRIP_HOLE_LENGTH, parsed));
}

function normalizeFilmstripAperture(value) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return DEFAULT_FILMSTRIP_APERTURE;
    }

    return Math.min(MAX_FILMSTRIP_APERTURE, Math.max(MIN_FILMSTRIP_APERTURE, parsed));
}

function normalizeFilmstripHoleRoundedness(value) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return DEFAULT_FILMSTRIP_HOLE_ROUNDEDNESS;
    }

    return Math.min(MAX_FILMSTRIP_HOLE_ROUNDEDNESS, Math.max(MIN_FILMSTRIP_HOLE_ROUNDEDNESS, parsed));
}

function normalizeSceneContrast(value) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return 1.0;
    }

    return Math.min(2.0, Math.max(0.0, parsed));
}

function normalizeSceneSaturation(value) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return 1.0;
    }

    return Math.min(2.0, Math.max(0.0, parsed));
}

const SCENE_COLOR_ADJUST_GLSL = /* glsl */`
                vec3 applySceneColorAdjustments(vec3 color, float contrast, float saturation) {
                    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
                    vec3 saturated = mix(vec3(luminance), color, saturation);
                    return (saturated - 0.5) * contrast + 0.5;
                }
`;

function createSceneColorAdjustmentNode(threeTSL, colorNode, contrastUniform, saturationUniform) {
    const { vec3, dot, mix } = threeTSL;
    const luminance = dot(colorNode, vec3(0.2126, 0.7152, 0.0722));
    const saturated = mix(vec3(luminance, luminance, luminance), colorNode, saturationUniform);
    return saturated.sub(vec3(0.5)).mul(contrastUniform).add(vec3(0.5));
}

function edgeNoisePatternLengthToFrequency(value) {
    return 1 / normalizeEdgeNoisePatternLength(value);
}

function createEdgeNoiseAlphaNode(threeTSL, baseUV, edgeNoiseU, maxUniform, phaseUniform, spatialFrequencyUniform, mirrorUniform) {
    const { float, vec3, dot, floor, fract, min, mix, mod, smoothstep } = threeTSL;
    const fade = (value) => value.mul(value).mul(float(3.0).sub(value.mul(float(2.0))));
    const hash = (x, y, seed) => fract(dot(vec3(x, y, seed), vec3(127.1, 311.7, 74.7)).sin().mul(float(43758.5453123)));
    const valueNoise = (x, y, seed) => {
        const x0 = floor(x);
        const y0 = floor(y);
        const xf = fract(x);
        const yf = fract(y);
        const y0Wrapped = mod(y0, float(EDGE_NOISE_TIME_CELLS));
        const y1Wrapped = mod(y0.add(float(1.0)), float(EDGE_NOISE_TIME_CELLS));
        const h00 = hash(x0, y0Wrapped, seed);
        const h10 = hash(x0.add(float(1.0)), y0Wrapped, seed);
        const h01 = hash(x0, y1Wrapped, seed);
        const h11 = hash(x0.add(float(1.0)), y1Wrapped, seed);
        const ux = fade(xf);
        const uy = fade(yf);

        return mix(mix(h00, h10, ux), mix(h01, h11, ux), uy);
    };
    const edgeNoiseValue = (edgeSide) => {
        const x = edgeNoiseU.mul(spatialFrequencyUniform);
        const y = phaseUniform.mul(float(EDGE_NOISE_TIME_CELLS)).add(edgeSide.mul(float(1.731)));
        const seed = float(17.0).add(edgeSide.mul(float(23.0)));
        const baseNoise = valueNoise(x, y, seed);
        const detailNoise = valueNoise(
            x.mul(float(2.13)).add(float(19.17)),
            y.mul(float(2.0)).add(float(7.31)),
            seed.add(float(41.0))
        );

        return baseNoise.mul(float(0.74)).add(detailNoise.mul(float(0.26))).max(float(0.0)).min(float(1.0));
    };

    const edgeSide = baseUV.y.greaterThanEqual(float(0.5)).select(float(1.0), float(0.0));
    const sampleEdgeSide = mirrorUniform.greaterThanEqual(float(0.5)).select(float(0.0), edgeSide);
    const noiseSignal = edgeNoiseValue(sampleEdgeSide);
    const edgeDistance = min(baseUV.y, float(1.0).sub(baseUV.y));
    const cutWidth = maxUniform.mul(noiseSignal);
    const aa = edgeDistance.fwidth().mul(float(EDGE_NOISE_AA_SCALE)).max(float(EDGE_NOISE_MIN_AA));
    const edgeAlpha = smoothstep(cutWidth, cutWidth.add(aa), edgeDistance);

    return maxUniform.lessThanEqual(float(0.0001)).select(float(1.0), edgeAlpha);
}

function createFilmstripAlphaNode(threeTSL, baseUV, edgeNoiseU, enabledUniform, gapLengthUniform, holeLengthUniform, apertureUniform, roundednessUniform) {
    const { float, vec2, abs, max, min, fract, smoothstep, length } = threeTSL;
    const safeGapLength = gapLengthUniform.max(float(0.0001));
    const safeHoleLength = holeLengthUniform.max(float(MIN_FILMSTRIP_HOLE_LENGTH)).min(float(MAX_FILMSTRIP_HOLE_LENGTH));
    const holeAperture = apertureUniform.max(float(MIN_FILMSTRIP_APERTURE)).min(float(MAX_FILMSTRIP_APERTURE));
    const holeRoundedness = roundednessUniform.max(float(0.0)).min(float(1.0));
    const cycleLength = safeHoleLength.add(safeGapLength);
    const edgeDistance = min(baseUV.y, float(1.0).sub(baseUV.y));
    const bandWidth = float(FILMSTRIP_EDGE_BAND_WIDTH);
    const localX = fract(edgeNoiseU.div(cycleLength.max(float(0.0001)))).sub(float(0.5)).mul(cycleLength);
    const localY = edgeDistance.sub(bandWidth.mul(float(0.5)));
    const halfWidth = safeHoleLength.mul(float(0.5)).max(float(0.01));
    const halfHeight = bandWidth.mul(float(0.18).add(holeAperture.mul(float(0.38))));
    const radius = min(halfWidth, halfHeight).mul(holeRoundedness).mul(float(0.95));
    const innerHalfX = max(halfWidth.sub(radius), float(0.0001));
    const innerHalfY = max(halfHeight.sub(radius), float(0.0001));
    const q = vec2(
        abs(localX).sub(innerHalfX),
        abs(localY).sub(innerHalfY)
    );
    const qMax = vec2(
        max(q.x, float(0.0)),
        max(q.y, float(0.0))
    );
    const outside = length(qMax).sub(radius);
    const inside = min(max(q.x, q.y), float(0.0));
    const holeDistance = outside.add(inside);
    const aa = holeDistance.fwidth().mul(float(FILMSTRIP_AA_SCALE)).max(float(FILMSTRIP_MIN_AA));
    const holeMask = float(1.0).sub(smoothstep(aa.negate(), aa, holeDistance));
    const filmstripAlpha = float(1.0).sub(holeMask);

    return enabledUniform.greaterThan(float(0.5)).select(filmstripAlpha, float(1.0));
}

function createCapAlphaNode(threeTSL, baseUV) {
    const { attribute, float, vec2, abs, length, min, max, smoothstep } = threeTSL;
    const startStyle = attribute('capStartStyle', 'float');
    const endStyle = attribute('capEndStyle', 'float');
    const capStartU = attribute('capStartU', 'float');
    const capEndU = attribute('capEndU', 'float');

    const capSignedDistance = (style, capUv) => {
        const roundedCircleDistance = float(0.5).sub(length(vec2(
            capUv.x.sub(float(0.5)),
            capUv.y.sub(float(0.5))
        )));
        const roundedSignedDistance = max(roundedCircleDistance, capUv.x.sub(float(0.5)));
        const pointedSignedDistance = capUv.x.mul(float(0.5)).sub(abs(capUv.y.sub(float(0.5))));
        const centerWeight = float(1.0).sub(abs(capUv.y.mul(float(2.0)).sub(float(1.0))));
        const swallowBoundary = float(0.05).add(centerWeight.mul(float(0.26)));
        const swallowSignedDistance = capUv.x.sub(swallowBoundary);
        const shapedDistance = style.lessThan(float(1.5)).select(
            roundedSignedDistance,
            style.lessThan(float(2.5)).select(pointedSignedDistance, swallowSignedDistance)
        );

        return style.lessThan(float(0.5)).select(float(1.0), shapedDistance);
    };

    const startSignedDistance = capSignedDistance(startStyle, vec2(capStartU, baseUV.y));
    const endSignedDistance = capSignedDistance(endStyle, vec2(capEndU, baseUV.y));
    const signedDistance = min(startSignedDistance, endSignedDistance);
    const aa = signedDistance.fwidth().mul(float(CAP_ALPHA_AA_SCALE)).max(float(CAP_ALPHA_MIN_AA));

    return smoothstep(aa.negate(), aa, signedDistance);
}

function positiveModulo(value, modulus) {
    if (modulus <= 0) return 0;
    return ((value % modulus) + modulus) % modulus;
}

function normalizeRepeatMode(mode) {
    if (mode === 'mirrorTile') {
        return 'mirrorTile';
    }

    return 'wrap';
}

function createPeakTroughMaskNode(
    threeTSL,
    temporalUV,
    tileIndex,
    tileCount,
    layerIndex,
    layerCount,
    fadeStartUniform,
    fadeEndUniform,
    enabledUniform
) {
    const { float, abs, smoothstep } = threeTSL;
    const safeTileCount = float(Math.max(1, tileCount));
    const safeLayerCount = float(Math.max(1, layerCount));
    const globalProgress = temporalUV
        .max(float(0.0))
        .min(float(1.0))
        .add(float(tileIndex))
        .div(safeTileCount);
    const layerPhase = layerIndex.div(safeLayerCount);
    const extremity = abs(globalProgress.add(layerPhase).mul(float(Math.PI * 2)).sin());
    const safeFadeEnd = fadeEndUniform.max(fadeStartUniform.add(float(0.0001)));
    const mask = smoothstep(fadeStartUniform, safeFadeEnd, extremity);

    return enabledUniform.greaterThan(float(0.5)).select(mask, float(0.0));
}

function getTextureDimensions(textureValue) {
    const image = textureValue?.image || textureValue?.source?.data || null;
    const baseMip = Array.isArray(textureValue?.mipmaps)
        ? textureValue.mipmaps[0]
        : null;
    const width = Number(image?.width || baseMip?.width);
    const height = Number(image?.height || baseMip?.height);
    const safeWidth = Number.isFinite(width) && width > 0 ? width : 1;
    const safeHeight = Number.isFinite(height) && height > 0 ? height : 1;
    const mipCount = Array.isArray(textureValue?.mipmaps)
        ? textureValue.mipmaps.length
        : 0;
    const generatedMipLevel = textureValue?.generateMipmaps !== false
        ? Math.floor(Math.log2(Math.max(safeWidth, safeHeight)))
        : 0;

    return {
        width: safeWidth,
        height: safeHeight,
        maxMipLevel: mipCount > 1 ? mipCount - 1 : generatedMipLevel,
    };
}

function createPeakTroughBlurredColorNode(
    threeTSL,
    {
        sampledColor,
        peakTroughMask,
        blurEnabledUniform,
        blurAmountUniform,
        layerUniform,
        currentTexture,
        currentUv,
        nextTexture = null,
        nextUv = null,
        useNext = null,
    }
) {
    const { Fn, If, float, vec2, vec4, mix, texture, log2, floor } = threeTSL;

    const sampleBlur = (textureValue, sampleUv) => {
        const { width, height, maxMipLevel } = getTextureDimensions(textureValue);
        // Match the WebGL strength curve and prefilter through lower mips before
        // taking the wide neighborhood samples.
        const radius = blurAmountUniform
            .mul(blurAmountUniform)
            .mul(float(2.0))
            .max(float(1.0));
        const blurMipLevel = floor(log2(radius).add(float(1.0)))
            .max(float(0.0))
            .min(float(maxMipLevel));
        const offset = vec2(
            radius.mul(float(1 / width)),
            radius.mul(float(1 / height))
        );
        const halfOffset = offset.mul(float(0.5));
        const sampleAt = (uvOffset, weight) => texture(
            textureValue,
            sampleUv.add(uvOffset)
        )
            .depth(layerUniform)
            .level(blurMipLevel)
            .rgb
            .mul(float(weight));

        return sampleAt(vec2(float(0), float(0)), 0.08)
            .add(sampleAt(vec2(halfOffset.x.negate(), float(0)), 0.10))
            .add(sampleAt(vec2(halfOffset.x, float(0)), 0.10))
            .add(sampleAt(vec2(float(0), halfOffset.y.negate()), 0.10))
            .add(sampleAt(vec2(float(0), halfOffset.y), 0.10))
            .add(sampleAt(vec2(offset.x.negate(), offset.y.negate()), 0.08))
            .add(sampleAt(vec2(offset.x, offset.y.negate()), 0.08))
            .add(sampleAt(vec2(offset.x.negate(), offset.y), 0.08))
            .add(sampleAt(vec2(offset.x, offset.y), 0.08))
            .add(sampleAt(vec2(offset.x.negate(), float(0)), 0.05))
            .add(sampleAt(vec2(offset.x, float(0)), 0.05))
            .add(sampleAt(vec2(float(0), offset.y.negate()), 0.05))
            .add(sampleAt(vec2(float(0), offset.y), 0.05));
    };

    return Fn(() => {
        const outputColor = sampledColor.toVar();

        If(
            blurEnabledUniform.greaterThan(float(0.5))
                .and(peakTroughMask.greaterThan(float(0.0001))),
            () => {
                const blurredColor = vec4(outputColor).toVar();

                if (nextTexture && nextUv && useNext) {
                    If(useNext, () => {
                        blurredColor.rgb.assign(
                            sampleBlur(nextTexture, nextUv)
                        );
                    }).Else(() => {
                        blurredColor.rgb.assign(
                            sampleBlur(currentTexture, currentUv)
                        );
                    });
                } else {
                    blurredColor.rgb.assign(
                        sampleBlur(currentTexture, currentUv)
                    );
                }

                outputColor.rgb.assign(
                    mix(outputColor.rgb, blurredColor.rgb, peakTroughMask)
                );
            }
        );

        return outputColor;
    })();
}

function resolveMirrorY(materialOptions = null) {
    return !!materialOptions?.orientationMirrorY;
}

function bigintAbs(value) {
    return value < 0n ? -value : value;
}

function bigintGcd(a, b) {
    let left = bigintAbs(a);
    let right = bigintAbs(b);

    while (right !== 0n) {
        const remainder = left % right;
        left = right;
        right = remainder;
    }

    return left || 1n;
}

function bigintLcm(a, b) {
    if (a === 0n || b === 0n) {
        return 0n;
    }

    return bigintAbs((a / bigintGcd(a, b)) * b);
}

function reduceFraction(numerator, denominator) {
    if (denominator === 0n) {
        return null;
    }

    if (numerator === 0n) {
        return { numerator: 0n, denominator: 1n };
    }

    const sign = denominator < 0n ? -1n : 1n;
    const normalizedNumerator = numerator * sign;
    const normalizedDenominator = denominator * sign;
    const divisor = bigintGcd(normalizedNumerator, normalizedDenominator);

    return {
        numerator: normalizedNumerator / divisor,
        denominator: normalizedDenominator / divisor,
    };
}

function fractionToNumber(fraction) {
    if (!fraction) {
        return 0;
    }

    return Number(fraction.numerator) / Number(fraction.denominator);
}

function multiplyFractionByInteger(fraction, multiplier) {
    if (!fraction) {
        return null;
    }

    return reduceFraction(fraction.numerator * multiplier, fraction.denominator);
}

function lcmFractions(fractions) {
    if (!Array.isArray(fractions) || fractions.length === 0) {
        return null;
    }

    let numeratorLcm = 1n;
    let denominatorGcd = fractions[0].denominator;

    for (const fraction of fractions) {
        if (!fraction) {
            continue;
        }

        numeratorLcm = bigintLcm(numeratorLcm, fraction.numerator);
        denominatorGcd = bigintGcd(denominatorGcd, fraction.denominator);
    }

    return reduceFraction(numeratorLcm, denominatorGcd);
}

function numberToFraction(value, maxDecimals = 6) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return null;
    }

    if (numeric === 0) {
        return { numerator: 0n, denominator: 1n };
    }

    const fixed = Math.abs(numeric).toFixed(maxDecimals);
    const trimmed = fixed.includes('.')
        ? fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
        : fixed;
    const [wholePart, fractionalPart = ''] = trimmed.split('.');
    const denominator = 10n ** BigInt(fractionalPart.length);
    const numerator = BigInt(`${wholePart}${fractionalPart}` || '0') * (numeric < 0 ? -1n : 1n);

    return reduceFraction(numerator, denominator);
}

export class TileManager {
    constructor(options = {}) {
        const {
            source = null, // null means load from CDN using DEFAULT_TEXTURE_ID
            renderer = null,
            rendererType = 'webgl',
            tileCount = 32,
            rotate90 = false,
            flipVertical = false,
            repeatMode = 'mirrorTile',
            flowAlignmentEnabled = true,
            layerAnimationEnabled = true,
            layerAnimationReversed = false,
            edgeDriftEnabled = DEFAULT_EDGE_DRIFT_ENABLED,
            edgeNoiseTransparencyMax = DEFAULT_EDGE_NOISE_TRANSPARENCY_MAX,
            edgeNoisePatternLength = DEFAULT_EDGE_NOISE_PATTERN_LENGTH,
            edgeNoiseMirrored = false,
            filmstripStyleEnabled = DEFAULT_FILMSTRIP_STYLE_ENABLED,
            filmstripGapLength = DEFAULT_FILMSTRIP_GAP_LENGTH,
            filmstripHoleLength = DEFAULT_FILMSTRIP_HOLE_LENGTH,
            filmstripAperture = DEFAULT_FILMSTRIP_APERTURE,
            filmstripHoleRoundedness = DEFAULT_FILMSTRIP_HOLE_ROUNDEDNESS,
            contrast = 1.0,
            saturation = 1.0,
            onProgress = null // Callback for progress updates: (stage, current, total) => {}
        } = options;

        // Progress callback
        this.onProgress = onProgress;

        // General
        this.tileCount = tileCount;
        this.tileSize = 512;
        this.loadedCount = 0;
        this.renderer = renderer;
        this.rendererType = rendererType; // Store renderer type for material creation

        // JPG path
        this.tiles = [];

        // KTX2 path
        this.materials = [];
        this.mirroredMaterials = new Map();
        this.arrayTextures = []; // Raw array textures for dual-texture flow materials
        this.ephemeralStaticMaterials = []; // Unique per-segment masked materials

        // Check if source is a zip file
        this.isZip = typeof source === 'string' && source.endsWith('.zip');
        // Use GitHub Releases for large zip files, local path for others
        this.zipUrl = this.isZip ? this.#getZipUrl(source) : null;
        this.zipFiles = null; // Will store extracted files as { '0.ktx2': Uint8Array, ... }
        this.metadata = null; // Will store parsed metadata.json from zip

        // If source is null, we'll load from CDN in loadAllTiles()
        this.loadFromCDN = source === null;

        this.isKTX2 = source === null || (typeof source === 'string' && (source.startsWith('ktx2') || source.endsWith('.zip')));
        // For zip files, variant will be determined from metadata.json after extraction
        // For folder-based sources, check the path for 'planes' vs 'waves'
        // For CDN loading (source === null), variant will be set later from texture set metadata
        this.variant = this.isKTX2 && !this.isZip && source !== null
            ? (source.endsWith('planes') || source.includes('planes') ? 'planes' : 'waves')
            : null;
        this.folder = this.isKTX2 && !this.isZip && source !== null
            ? (this.variant === 'planes' ? './tiles-ktx2-planes' : './tiles-ktx2-waves')
            : './tiles-numbered';

        // Cycling state (KTX2 only)
        this.sharedLayerUniform = { value: 0 };
        this.sharedRotateUniform = { value: rotate90 ? 1 : 0 };
        this.sharedFlipVerticalUniform = { value: flipVertical ? 1 : 0 };
        this.edgeDriftEnabled = !!edgeDriftEnabled;
        this.edgeNoiseTransparencyMax = normalizeEdgeNoiseTransparencyMax(edgeNoiseTransparencyMax);
        this.edgeNoisePatternLength = normalizeEdgeNoisePatternLength(edgeNoisePatternLength);
        this.edgeNoiseMirrored = !!edgeNoiseMirrored;
        this.filmstripStyleEnabled = !!filmstripStyleEnabled;
        this.filmstripGapLength = normalizeFilmstripGapLength(filmstripGapLength);
        this.filmstripHoleLength = normalizeFilmstripHoleLength(filmstripHoleLength);
        this.filmstripAperture = normalizeFilmstripAperture(filmstripAperture);
        this.filmstripHoleRoundedness = normalizeFilmstripHoleRoundedness(filmstripHoleRoundedness);
        this.sharedEdgeNoiseMaxUniform = { value: this.#getEffectiveEdgeNoiseMax() };
        this.sharedEdgeNoiseSpatialFrequencyUniform = { value: edgeNoisePatternLengthToFrequency(this.edgeNoisePatternLength) };
        this.sharedEdgeNoiseMirrorUniform = { value: this.edgeNoiseMirrored ? 1.0 : 0.0 };
        this.sharedEdgeNoisePhaseUniform = { value: 0.0 };
        this.sharedFilmstripEnabledUniform = { value: this.filmstripStyleEnabled ? 1.0 : 0.0 };
        this.sharedFilmstripGapLengthUniform = { value: this.filmstripGapLength };
        this.sharedFilmstripHoleLengthUniform = { value: this.filmstripHoleLength };
        this.sharedFilmstripApertureUniform = { value: this.filmstripAperture };
        this.sharedFilmstripRoundednessUniform = { value: this.filmstripHoleRoundedness };
        this.sceneContrast = normalizeSceneContrast(contrast);
        this.sceneSaturation = normalizeSceneSaturation(saturation);
        this.sharedContrastUniform = { value: this.sceneContrast };
        this.sharedSaturationUniform = { value: this.sceneSaturation };
        this.currentLayer = 0;
        this.layerCount = 0;
        this.direction = 1; // for ping-pong in planes mode
        this.fps = 30; // fixed cadence
        this.lastFrameTime = 0;
        this.layerAnimationEnabled = !!layerAnimationEnabled;
        this.layerAnimationReversed = !!layerAnimationReversed;
        this.rotate90 = !!rotate90;
        this.flipVertical = !!flipVertical;
        this.repeatMode = normalizeRepeatMode(repeatMode);

        // Flow animation state (continuous dual-texture approach)
        // Forward flow uses a fractional offset in [0, 1); reverse flow uses
        // (-1, 0]. Crossing a whole tile is handled by wrapFlowOffset().
        this.sharedFlowOffsetUniform = { value: 0.0 };
        this.flowOffset = 0.0;         // Current signed fractional offset within the active tile pair
        this.tileFlowOffset = 0;       // Current base tile offset (integer)
        this.flowSpeed = -0.25;          // Tiles per second (negative and positive imply opposite direciotn. )
        this.requestedFlowSpeed = Math.abs(this.flowSpeed);
        this.flowDirection = this.flowSpeed < 0 ? -1 : 1;
        this.flowEnabled = false;       // Can be toggled
        this.flowMaterials = [];       // Active dual-texture materials currently bound in the scene
        this.flowMaterialCache = new Map();
        this.flowAlignmentEnabled = !!flowAlignmentEnabled;
        this.flowAlignmentInfo = null;

        // WebGPU material mode: 'node' (NodeMaterial) or 'basic' (MeshBasicMaterial)
        // Can be set externally (e.g., via URL param) before loading tiles.
        this.webgpuMaterialMode = options.webgpuMaterialMode || 'node';

        // Current texture set metadata (for CDN-loaded textures)
        this.currentTextureSet = null;
        this.lastLoadError = null;
        this.expectedLayerCount = 0;
        this.textureSourceLabel = 'default';
        this.decodedTileDepths = [];
        this.decodedTileKinds = [];
        this.decodedTileLayerSources = [];

        this._ktx2Loader = null;
        this._webgpuDeps = null;
        this._activeFlowMaterialSet = new Set();

        // Per-frame callback
        this._onTick = null;
        this._onLayerChange = null;
        this._lastNotifiedLayer = 0;
        this._layerChangeCount = 0;
        this._lastLayerChangeTimeMs = 0;

        this.#syncFlowSpeedAlignment();
    }

    /**
     * Get the thumbnail URL for the currently loaded texture set
     * @returns {string|null} Thumbnail URL or null if not available
     */
    getThumbnailUrl() {
        return this.currentTextureSet?.thumbnail_url || null;
    }

    /**
     * Set a callback for progress updates (for CDN loading)
     * @param {Function} callback - (stage, current, total) => {}
     */
    setProgressCallback(callback) {
        this.onProgress = callback;
    }

    /**
     * Set a callback for discrete layer changes.
     * @param {Function|null} callback - (layerIndex) => {}
     */
    setLayerChangeCallback(callback) {
        this._onLayerChange = typeof callback === 'function' ? callback : null;
        this._lastNotifiedLayer = Math.max(0, Math.min(this.currentLayer, Math.max(0, this.layerCount - 1))) | 0;
    }

    async loadAllTiles() {
        // If loading from CDN (no local source specified), fetch from API
        if (this.loadFromCDN) {
            console.log(`[TileManager] Loading default texture from CDN: ${DEFAULT_TEXTURE_ID}`);
            // Import fetchTextureSet dynamically to avoid circular dependency
            const { fetchTextureSet } = await import('../../services/textureService.js');

            try {
                if (this.onProgress) {
                    this.onProgress('downloading', 0, 1);
                }

                const textureSet = await fetchTextureSet(DEFAULT_TEXTURE_ID);

                if (!textureSet || !textureSet.tiles || textureSet.tiles.length === 0) {
                    throw new Error('No tiles found in default texture set');
                }

                console.log(`[TileManager] Fetched default texture set: ${textureSet.tiles.length} tiles`);

                // Store texture set metadata for thumbnail access
                this.currentTextureSet = textureSet;

                const success = await this.loadFromRemote(textureSet, this.onProgress);
                return success;
            } catch (error) {
                console.error('[TileManager] Failed to load default texture from CDN:', error);
                // Fall through to local loading as fallback
                this.loadFromCDN = false;
                this.isKTX2 = false;
            }
        }

        // If using zip, extract files first
        if (this.isZip) {
            const extracted = await this.#extractZipFile();
            if (!extracted) {
                console.warn('[TileManager] Failed to extract zip file, falling back to JPG textures');
                this.isKTX2 = false;
                this.isZip = false;
            }
        }

        if (this.isKTX2) {
            const ok = await this.#initKTX2();
            if (!ok) {
                console.warn('[TileManager] Falling back to JPG textures');
                this.isKTX2 = false;
            }
        }

        // Report initial building progress
        if (this.onProgress) {
            this.onProgress('building', 0, this.tileCount);
        }

        const promises = [];
        for (let i = 0; i < this.tileCount; i++) {
            const promise = (this.isKTX2 ? this.#loadKTX2Tile(i) : this.#loadJPGTile(i)).then(result => {
                // Report progress after each tile is loaded
                if (this.onProgress) {
                    this.onProgress('building', i + 1, this.tileCount);
                }
                return result;
            });
            promises.push(promise);
        }

        const results = await Promise.all(promises);

        if (this.isKTX2) {
            this.materials = results;
            console.log(`[TileManager] Loaded ${this.materials.length} KTX2 materials, layerCount=${this.layerCount}`);
            return this.materials;
        } else {
            this.tiles = results;
            console.log(`[TileManager] Loaded ${this.tiles.length} JPG textures`);
            return this.tiles;
        }
    }

    // Map zip filenames to their URLs (GitHub Releases for large files)
    // Note: GitHub Releases doesn't support CORS, so we use a proxy for cross-origin requests
    #getZipUrl(source) {
        const GITHUB_RELEASES = {
            'skating-512.zip': 'https://github.com/nsitu/rivvon/releases/download/textures/skating-512.zip'
        };

        const releaseUrl = GITHUB_RELEASES[source];
        if (releaseUrl) {
            // Check if we're on the same origin (local dev) or need CORS proxy
            const isLocalDev = window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1';

            if (isLocalDev) {
                // Local development can use the URL directly (or local file)
                return `./${source}`;
            }

            // For production (GitHub Pages), use corsproxy.io to bypass CORS
            return `https://corsproxy.io/?${encodeURIComponent(releaseUrl)}`;
        }

        // Fall back to local path
        return `./${source}`;
    }

    async #extractZipFile() {
        try {
            console.log(`[TileManager] Fetching zip file: ${this.zipUrl}`);

            // Report downloading stage
            if (this.onProgress) {
                this.onProgress('downloading', 0, 1);
            }

            const response = await fetch(this.zipUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch zip file: ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            console.log(`[TileManager] Zip file fetched, size: ${arrayBuffer.byteLength} bytes`);

            const JSZip = await loadJSZipModule();
            const zip = new JSZip();
            const zipData = await zip.loadAsync(arrayBuffer);

            // Extract and parse metadata.json if present
            const metadataFile = zipData.file('metadata.json');
            if (metadataFile) {
                try {
                    const metadataText = await metadataFile.async('text');
                    this.metadata = JSON.parse(metadataText);

                    // Determine variant from metadata
                    const crossSectionType = this.metadata?.settings?.crossSectionType;
                    if (crossSectionType) {
                        this.variant = crossSectionType; // 'planes' or 'waves'
                        console.log(`[TileManager] Variant set from metadata: ${this.variant}`);
                    }
                } catch (error) {
                    console.warn('[TileManager] Failed to parse metadata.json:', error);
                }
            } else {
                console.warn('[TileManager] No metadata.json found in zip, defaulting to "waves" variant');
                this.variant = 'waves'; // Default fallback
            }

            // Count ktx2 files first
            const ktx2Files = [];
            zipData.forEach((relativePath, file) => {
                if (relativePath.endsWith('.ktx2')) {
                    ktx2Files.push({ relativePath, file });
                }
            });

            const totalFiles = ktx2Files.length;
            console.log(`[TileManager] Found ${totalFiles} KTX2 files to extract`);

            // Extract all ktx2 files into memory with progress tracking
            this.zipFiles = {};
            let extractedCount = 0;

            // Report initial extraction progress
            if (this.onProgress) {
                this.onProgress('extracting', 0, totalFiles);
            }

            for (const { relativePath, file } of ktx2Files) {
                const data = await file.async('uint8array');
                this.zipFiles[relativePath] = data;
                extractedCount++;

                // Report progress after each file
                if (this.onProgress) {
                    this.onProgress('extracting', extractedCount, totalFiles);
                }
            }

            console.log(`[TileManager] Extracted ${Object.keys(this.zipFiles).length} KTX2 files from zip`);
            return true;
        } catch (error) {
            console.error('[TileManager] Failed to extract zip file:', error);
            return false;
        }
    }

    async #initKTX2() {
        // For WebGL: Require WebGL2 for sampler2DArray
        if (this.rendererType === 'webgl') {
            const gl2 = document.createElement('canvas').getContext('webgl2');
            if (!gl2) {
                console.warn('[TileManager] WebGL2 not available; cannot use KTX2 array textures');
                return false;
            }
        }

        if (this.rendererType === 'webgpu') {
            await this.#ensureWebGPUMaterialDeps();
        }

        try {
            // Use the shared KTX2Loader (ref-counted singleton)
            if (this.renderer) {
                this._ktx2Loader = acquireKTX2Loader(this.renderer);
                console.log(`[TileManager] KTX2 support detected for ${this.rendererType}`);
            } else {
                // Best-effort: create a temporary renderer to detect support
                const tempRenderer = new THREE.WebGLRenderer({ antialias: false });
                this._ktx2Loader = acquireKTX2Loader(tempRenderer);
                tempRenderer.dispose();
            }
            return true;
        } catch (err) {
            console.error('[TileManager] Failed to initialize KTX2Loader:', err);
            return false;
        }
    }

    async #ensureWebGPUMaterialDeps() {
        if (this.rendererType !== 'webgpu') {
            return null;
        }

        if (!this._webgpuDeps) {
            const [threeWebGPU, threeTSL] = await Promise.all([
                loadWebGPUModule(),
                loadTSLModule(),
            ]);

            this._webgpuDeps = {
                threeWebGPU,
                threeTSL,
            };
        }

        return this._webgpuDeps;
    }

    #getWebGPUMaterialDeps() {
        if (!this._webgpuDeps) {
            throw new Error('WebGPU material dependencies not initialized');
        }

        return this._webgpuDeps;
    }

    #forEachStaticMaterial(visitor) {
        this.materials.forEach(material => {
            if (material) visitor(material);
        });
        this.mirroredMaterials.forEach(material => {
            if (material) visitor(material);
        });
        this.ephemeralStaticMaterials.forEach(material => {
            if (material) visitor(material);
        });
    }

    #disposeMaterialExtras(material) {
        if (!material?._ownedCapTextures?.length) {
            return;
        }

        for (const texture of material._ownedCapTextures) {
            texture?.dispose?.();
        }

        material._ownedCapTextures = [];
    }

    #decorateTransparentShadowsMaterial(material, hasCapMask) {
        if (!material) {
            return material;
        }

        material._transparentShadowsCapMask = hasCapMask;
        material._transparentShadowsOriginalState = {
            transparent: material.transparent,
            depthWrite: material.depthWrite,
            alphaToCoverage: material.alphaToCoverage,
        };

        return material;
    }

    #buildFlowMaterialCacheKey(currentSample, nextSample, materialOptions = null) {
        const mirrorY = resolveMirrorY(materialOptions);

        return [
            this.flowDirection < 0 ? 'rev' : 'fwd',
            currentSample.tileIndex,
            currentSample.mirrorX ? 1 : 0,
            nextSample.tileIndex,
            nextSample.mirrorX ? 1 : 0,
            mirrorY ? 1 : 0,
        ].join(':');
    }

    #syncFlowMaterialDynamicState(material) {
        if (!material) {
            return;
        }

        if (material._layerUniform) {
            material._layerUniform.value = this.sharedLayerUniform.value;
        }
        if (material._rotateUniform) {
            material._rotateUniform.value = this.sharedRotateUniform.value;
        }
        if (material._flipVerticalUniform) {
            material._flipVerticalUniform.value = this.sharedFlipVerticalUniform.value;
        }
        if (material._flowOffsetUniform) {
            material._flowOffsetUniform.value = this.sharedFlowOffsetUniform.value;
        }
        if (material._edgeNoiseMaxUniform) {
            material._edgeNoiseMaxUniform.value = this.sharedEdgeNoiseMaxUniform.value;
        }
        if (material._edgeNoiseSpatialFrequencyUniform) {
            material._edgeNoiseSpatialFrequencyUniform.value = this.sharedEdgeNoiseSpatialFrequencyUniform.value;
        }
        if (material._edgeNoiseMirrorUniform) {
            material._edgeNoiseMirrorUniform.value = this.sharedEdgeNoiseMirrorUniform.value;
        }
        if (material._edgeNoisePhaseUniform) {
            material._edgeNoisePhaseUniform.value = this.sharedEdgeNoisePhaseUniform.value;
        }
        if (material._filmstripEnabledUniform) {
            material._filmstripEnabledUniform.value = this.sharedFilmstripEnabledUniform.value;
        }
        if (material._filmstripGapLengthUniform) {
            material._filmstripGapLengthUniform.value = this.sharedFilmstripGapLengthUniform.value;
        }
        if (material._filmstripHoleLengthUniform) {
            material._filmstripHoleLengthUniform.value = this.sharedFilmstripHoleLengthUniform.value;
        }
        if (material._filmstripApertureUniform) {
            material._filmstripApertureUniform.value = this.sharedFilmstripApertureUniform.value;
        }
        if (material._filmstripRoundednessUniform) {
            material._filmstripRoundednessUniform.value = this.sharedFilmstripRoundednessUniform.value;
        }
        if (material._contrastUniform) {
            material._contrastUniform.value = this.sharedContrastUniform.value;
        }
        if (material._saturationUniform) {
            material._saturationUniform.value = this.sharedSaturationUniform.value;
        }
        this.#syncEdgeNoiseMaterialState(material);
    }

    #syncEdgeNoiseMaterialState(material) {
        if (!material) {
            return;
        }

        const alphaToCoverage = !!material._hasCapMask || this.#hasEdgeAlphaEffects();
        if (material._transparentShadowsOriginalState) {
            material._transparentShadowsOriginalState.alphaToCoverage = alphaToCoverage;
        }

        if (material._transparentShadowsUniform?.value === 1) {
            return;
        }

        if (material.alphaToCoverage !== alphaToCoverage) {
            material.alphaToCoverage = alphaToCoverage;
            material.needsUpdate = true;
        }
    }

    #syncSceneColorAdjustmentUniforms() {
        if (this.rendererType !== 'webgpu') {
            return;
        }

        const syncMaterial = (material) => {
            if (!material) {
                return;
            }

            if (material._contrastUniform) {
                material._contrastUniform.value = this.sharedContrastUniform.value;
            }

            if (material._saturationUniform) {
                material._saturationUniform.value = this.sharedSaturationUniform.value;
            }
        };

        this.#forEachStaticMaterial(syncMaterial);
        for (const material of this.flowMaterials) {
            syncMaterial(material);
        }
    }

    #syncEdgeNoiseUniforms({ phaseOnly = false } = {}) {
        const syncMaterial = (material) => {
            if (!material) return;

            if (!phaseOnly && material._edgeNoiseMaxUniform) {
                material._edgeNoiseMaxUniform.value = this.sharedEdgeNoiseMaxUniform.value;
            }
            if (!phaseOnly && material._edgeNoiseSpatialFrequencyUniform) {
                material._edgeNoiseSpatialFrequencyUniform.value = this.sharedEdgeNoiseSpatialFrequencyUniform.value;
            }
            if (!phaseOnly && material._edgeNoiseMirrorUniform) {
                material._edgeNoiseMirrorUniform.value = this.sharedEdgeNoiseMirrorUniform.value;
            }
            if (!phaseOnly && material._filmstripEnabledUniform) {
                material._filmstripEnabledUniform.value = this.sharedFilmstripEnabledUniform.value;
            }
            if (!phaseOnly && material._filmstripGapLengthUniform) {
                material._filmstripGapLengthUniform.value = this.sharedFilmstripGapLengthUniform.value;
            }
            if (!phaseOnly && material._filmstripHoleLengthUniform) {
                material._filmstripHoleLengthUniform.value = this.sharedFilmstripHoleLengthUniform.value;
            }
            if (!phaseOnly && material._filmstripApertureUniform) {
                material._filmstripApertureUniform.value = this.sharedFilmstripApertureUniform.value;
            }
            if (!phaseOnly && material._filmstripRoundednessUniform) {
                material._filmstripRoundednessUniform.value = this.sharedFilmstripRoundednessUniform.value;
            }
            if (material._edgeNoisePhaseUniform) {
                material._edgeNoisePhaseUniform.value = this.sharedEdgeNoisePhaseUniform.value;
            }
            if (!phaseOnly) {
                this.#syncEdgeNoiseMaterialState(material);
            }
        };

        if (this.rendererType === 'webgpu' || !phaseOnly) {
            this.#forEachStaticMaterial(syncMaterial);
            for (const material of this.flowMaterials) {
                syncMaterial(material);
            }
        }
    }

    #getEffectiveEdgeNoiseMax() {
        return this.edgeDriftEnabled ? this.edgeNoiseTransparencyMax : 0;
    }

    #hasEdgeAlphaEffects() {
        return this.#getEffectiveEdgeNoiseMax() > 0 || this.filmstripStyleEnabled;
    }

    #getEdgeNoiseCyclePeriod() {
        // Use the same short, layer-aligned cadence as ribbon undulation so
        // the edge pattern visibly travels while still landing on a clean loop.
        const undulationPeriod = this.getOptimalUndulationPeriod?.(3.0);
        if (Number.isFinite(undulationPeriod) && undulationPeriod > 0) {
            return undulationPeriod;
        }

        const layerCyclePeriod = this.getLayerCyclePeriod?.();
        if (Number.isFinite(layerCyclePeriod) && layerCyclePeriod > 0) {
            return layerCyclePeriod;
        }

        return 3.0;
    }

    #trackActiveFlowMaterial(material) {
        if (!material || this._activeFlowMaterialSet.has(material)) {
            return material;
        }

        this.#syncFlowMaterialDynamicState(material);
        this._activeFlowMaterialSet.add(material);
        this.flowMaterials.push(material);
        return material;
    }

    #disposeFlowMaterial(material) {
        this.#disposeMaterialExtras(material);
        material?.dispose?.();
    }

    #disposeFlowMaterialCache() {
        this.clearFlowMaterials();

        this.flowMaterialCache.forEach((material) => {
            this.#disposeFlowMaterial(material);
        });

        this.flowMaterialCache.clear();
    }

    clearFlowMaterialCache() {
        this.#disposeFlowMaterialCache();
    }

    clearEphemeralStaticMaterials() {
        this.ephemeralStaticMaterials.forEach(material => {
            this.#disposeMaterialExtras(material);
            material?.dispose?.();
        });
        this.ephemeralStaticMaterials = [];
    }

    #resolveRepeatSample(effectiveIndex) {
        if (this.tileCount <= 0) {
            return { isGap: false, tileIndex: 0, mirrorX: false, cycleIndex: 0 };
        }

        if (this.repeatMode === 'wrap') {
            const tileIndex = positiveModulo(effectiveIndex, this.tileCount);
            return { isGap: false, tileIndex, mirrorX: false, cycleIndex: tileIndex };
        }

        const cycleLength = this.getEffectiveTileCount();
        const cycleIndex = positiveModulo(effectiveIndex, cycleLength);

        if (cycleIndex < this.tileCount) {
            return { isGap: false, tileIndex: cycleIndex, mirrorX: false, cycleIndex };
        }

        return {
            isGap: false,
            tileIndex: cycleLength - 1 - cycleIndex,
            mirrorX: true,
            cycleIndex,
        };
    }

    #createArrayMaterial(arrayTexture, options = {}) {
        if (this.rendererType === 'webgpu') {
            return this.#createArrayMaterialWebGPU(arrayTexture, options);
        } else {
            return this.#createArrayMaterialWebGL(arrayTexture, options);
        }
    }

    /**
     * Create a dual-texture material for smooth flow animation (WebGL).
     * Samples from two adjacent tiles and uses flowOffset to slide between them.
     * @param {THREE.DataArrayTexture} textureCurrent - Current tile's array texture
     * @param {THREE.DataArrayTexture} textureNext - Next tile's array texture
     * @returns {THREE.ShaderMaterial} Dual-texture material
     */
    #createDualTextureMaterialWebGL(textureCurrent, textureNext, options = {}) {
        const layerCount = textureCurrent.image?.depth || 1;
        const currentTileIndex = Number(options.currentTileIndex) || 0;
        const nextTileIndex = Number(options.nextTileIndex) || 0;
        const mirrorCurrent = options.mirrorCurrent ? 1 : 0;
        const mirrorNext = options.mirrorNext ? 1 : 0;
        const mirrorY = options.mirrorY ? 1 : 0;
        const reverseFlow = this.flowDirection < 0;
        const hasCapMask = true;

        const material = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: {
                uTexArrayCurrent: { value: textureCurrent },
                uTexArrayNext: { value: textureNext },
                uLayer: this.sharedLayerUniform,
                uLayerCount: { value: layerCount },
                uRotate90: this.sharedRotateUniform,
                uFlipVertical: this.sharedFlipVerticalUniform,
                uMirrorCurrent: { value: mirrorCurrent },
                uMirrorNext: { value: mirrorNext },
                uMirrorY: { value: mirrorY },
                uFlowOffset: this.sharedFlowOffsetUniform,
                uPeakTroughTransparency: { value: 0 },
                uPeakTroughBlur: { value: 0 },
                uPeakTroughBlurAmount: { value: 4 },
                uPeakTroughGradientStart: { value: PEAK_TROUGH_FADE_START },
                uPeakTroughGradientEnd: { value: PEAK_TROUGH_FADE_END },
                uTileCount: { value: Math.max(1, this.tileCount) },
                uCurrentTileIndex: { value: currentTileIndex },
                uNextTileIndex: { value: nextTileIndex },
                uTransparentShadows: { value: 0 },
                uTransparentHighlights: { value: 0 },
                uTransparentShadowsThresholdMin: { value: TRANSPARENT_SHADOWS_LUMA_MIN },
                uTransparentShadowsThresholdMax: { value: TRANSPARENT_SHADOWS_LUMA_MAX },
                uContrast: this.sharedContrastUniform,
                uSaturation: this.sharedSaturationUniform,
                uEdgeNoiseMax: this.sharedEdgeNoiseMaxUniform,
                uEdgeNoiseSpatialFrequency: this.sharedEdgeNoiseSpatialFrequencyUniform,
                uEdgeNoiseMirror: this.sharedEdgeNoiseMirrorUniform,
                uEdgeNoisePhase: this.sharedEdgeNoisePhaseUniform,
                uFilmstripEnabled: this.sharedFilmstripEnabledUniform,
                uFilmstripGapLength: this.sharedFilmstripGapLengthUniform,
                uFilmstripHoleLength: this.sharedFilmstripHoleLengthUniform,
                uFilmstripAperture: this.sharedFilmstripApertureUniform,
                uFilmstripRoundedness: this.sharedFilmstripRoundednessUniform,
            },
            vertexShader: /* glsl */`
                in float edgeNoiseU;
                in float maskV;
                in float capStartStyle;
                in float capEndStyle;
                in float capStartU;
                in float capEndU;
                out vec2 vUv;
                out float vEdgeNoiseU;
                out float vMaskV;
                out float vCapStartStyle;
                out float vCapEndStyle;
                out float vCapStartU;
                out float vCapEndU;
                void main() {
                    vUv = uv;
                    vEdgeNoiseU = edgeNoiseU;
                    vMaskV = maskV;
                    vCapStartStyle = capStartStyle;
                    vCapEndStyle = capEndStyle;
                    vCapStartU = capStartU;
                    vCapEndU = capEndU;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                precision highp float;
                precision highp sampler2DArray;
                in vec2 vUv;
                in float vEdgeNoiseU;
                in float vMaskV;
                in float vCapStartStyle;
                in float vCapEndStyle;
                in float vCapStartU;
                in float vCapEndU;
                uniform sampler2DArray uTexArrayCurrent;
                uniform sampler2DArray uTexArrayNext;
                uniform int uLayer;
                uniform float uLayerCount;
                uniform int uRotate90;
                uniform int uFlipVertical;
                uniform int uMirrorCurrent;
                uniform int uMirrorNext;
                uniform int uMirrorY;
                uniform float uFlowOffset;
                uniform float uPeakTroughTransparency;
                uniform float uPeakTroughBlur;
                uniform float uPeakTroughBlurAmount;
                uniform float uPeakTroughGradientStart;
                uniform float uPeakTroughGradientEnd;
                uniform float uTileCount;
                uniform float uCurrentTileIndex;
                uniform float uNextTileIndex;
                uniform int uTransparentShadows;
                uniform int uTransparentHighlights;
                uniform float uTransparentShadowsThresholdMin;
                uniform float uTransparentShadowsThresholdMax;
                uniform float uContrast;
                uniform float uSaturation;
                uniform float uEdgeNoiseMax;
                uniform float uEdgeNoiseSpatialFrequency;
                uniform float uEdgeNoiseMirror;
                uniform float uEdgeNoisePhase;
                uniform float uFilmstripEnabled;
                uniform float uFilmstripGapLength;
                uniform float uFilmstripHoleLength;
                uniform float uFilmstripAperture;
                uniform float uFilmstripRoundedness;
                out vec4 outColor;

${CAP_ALPHA_GLSL}
${PEAK_TROUGH_MASK_GLSL}
${PEAK_TROUGH_BLUR_GLSL}
${EDGE_NOISE_GLSL}
${FILMSTRIP_GLSL}
${SCENE_COLOR_ADJUST_GLSL}

                void main() {
                    vec2 maskUv = vec2(vUv.x, vMaskV);
                    // Apply flow offset to U coordinate (slides along ribbon)
                    float shiftedU = vUv.x + uFlowOffset;
                    float nextShiftedU = ${reverseFlow ? 'shiftedU + 1.0' : 'shiftedU - 1.0'};
                    bool mirrorV = (uFlipVertical == 1) != (uMirrorY == 1);
                    float sampleV = mirrorV ? (1.0 - vUv.y) : vUv.y;

                    vec2 currentDerivUV = vec2(
                        (uMirrorCurrent == 1) ? (1.0 - shiftedU) : shiftedU,
                        sampleV
                    );
                    vec2 nextBaseUV = vec2(nextShiftedU, sampleV);
                    vec2 nextDerivUV = vec2(
                        (uMirrorNext == 1) ? (1.0 - nextBaseUV.x) : nextBaseUV.x,
                        nextBaseUV.y
                    );
                    
                    // Compute derivatives from the CONTINUOUS shifted UV before
                    // branching, so the GPU gets correct mip-level selection across
                    // the seam where shiftedU crosses 1.0.  Without this, adjacent
                    // fragments in different branches produce a ~1.0 UV jump that
                    // selects a very high (blurry) mip level, causing a visible
                    // dotted-line seam on mobile GPUs (iPad WebGL).
                    vec2 uvCurrentRot_d = (uRotate90 == 1)
                        ? vec2(currentDerivUV.y, 1.0 - currentDerivUV.x)
                        : currentDerivUV;
                    vec2 flippedCurrent_d = vec2(uvCurrentRot_d.x, 1.0 - uvCurrentRot_d.y);
                    vec2 dPdxCurrent = dFdx(flippedCurrent_d);
                    vec2 dPdyCurrent = dFdy(flippedCurrent_d);

                    vec2 uvNextRot_d = (uRotate90 == 1)
                        ? vec2(nextDerivUV.y, 1.0 - nextDerivUV.x)
                        : nextDerivUV;
                    vec2 flippedNext_d = vec2(uvNextRot_d.x, 1.0 - uvNextRot_d.y);
                    vec2 dPdxNext = dFdx(flippedNext_d);
                    vec2 dPdyNext = dFdy(flippedNext_d);
                    
                    vec2 sampleUVCurrent = vec2(shiftedU, sampleV);
                    sampleUVCurrent.x = (uMirrorCurrent == 1) ? (1.0 - sampleUVCurrent.x) : sampleUVCurrent.x;
                    vec2 uvRCurrent = (uRotate90 == 1) ? vec2(sampleUVCurrent.y, 1.0 - sampleUVCurrent.x) : sampleUVCurrent;
                    vec2 flippedUvCurrent = vec2(uvRCurrent.x, 1.0 - uvRCurrent.y);
                    vec4 texColorCurrent = textureGrad(uTexArrayCurrent, vec3(flippedUvCurrent, float(uLayer)), dPdxCurrent, dPdyCurrent);

                    vec2 sampleUVNext = vec2(nextShiftedU, sampleV);
                    sampleUVNext.x = (uMirrorNext == 1) ? (1.0 - sampleUVNext.x) : sampleUVNext.x;
                    vec2 uvRNext = (uRotate90 == 1) ? vec2(sampleUVNext.y, 1.0 - sampleUVNext.x) : sampleUVNext;
                    vec2 flippedUvNext = vec2(uvRNext.x, 1.0 - uvRNext.y);
                    vec4 texColorNext = textureGrad(uTexArrayNext, vec3(flippedUvNext, float(uLayer)), dPdxNext, dPdyNext);

                    vec4 texColor = ${reverseFlow
                        ? 'shiftedU < 0.0 ? texColorNext : texColorCurrent'
                        : 'shiftedU >= 1.0 ? texColorNext : texColorCurrent'};
                    float peakTroughEffectEnabled = max(uPeakTroughTransparency, uPeakTroughBlur);
                    float peakTroughMaskCurrent = computePeakTroughMask(
                        flippedUvCurrent.y,
                        uCurrentTileIndex,
                        uTileCount,
                        float(uLayer),
                        float(uLayerCount),
                        uPeakTroughGradientStart,
                        uPeakTroughGradientEnd,
                        peakTroughEffectEnabled
                    );
                    float peakTroughMaskNext = computePeakTroughMask(
                        flippedUvNext.y,
                        uNextTileIndex,
                        uTileCount,
                        float(uLayer),
                        float(uLayerCount),
                        uPeakTroughGradientStart,
                        uPeakTroughGradientEnd,
                        peakTroughEffectEnabled
                    );
                    float peakTroughMask = ${reverseFlow
                        ? 'shiftedU < 0.0 ? peakTroughMaskNext : peakTroughMaskCurrent'
                        : 'shiftedU >= 1.0 ? peakTroughMaskNext : peakTroughMaskCurrent'};

                    if (uPeakTroughBlur > 0.5 && peakTroughMask > 0.0001) {
                        vec3 blurredColor = ${reverseFlow
                            ? `shiftedU < 0.0
                                ? samplePeakTroughBlur(uTexArrayNext, flippedUvNext, float(uLayer), uPeakTroughBlurAmount)
                                : samplePeakTroughBlur(uTexArrayCurrent, flippedUvCurrent, float(uLayer), uPeakTroughBlurAmount)`
                            : `shiftedU >= 1.0
                                ? samplePeakTroughBlur(uTexArrayNext, flippedUvNext, float(uLayer), uPeakTroughBlurAmount)
                                : samplePeakTroughBlur(uTexArrayCurrent, flippedUvCurrent, float(uLayer), uPeakTroughBlurAmount)`};
                        texColor.rgb = mix(texColor.rgb, blurredColor, peakTroughMask);
                    }
                    texColor.a *= mix(1.0, ${PEAK_TROUGH_MIN_ALPHA.toFixed(1)}, peakTroughMask * uPeakTroughTransparency);

                    texColor.a *= computeCapAlpha(vec2(vCapStartU, vMaskV), vec2(vCapEndU, vMaskV), vCapStartStyle, vCapEndStyle);
                    texColor.a *= computeEdgeNoiseAlpha(maskUv, vEdgeNoiseU, uEdgeNoiseMax, uEdgeNoisePhase, uEdgeNoiseSpatialFrequency, uEdgeNoiseMirror);
                    texColor.a *= computeFilmstripAlpha(maskUv, vEdgeNoiseU, uFilmstripEnabled, uFilmstripGapLength, uFilmstripHoleLength, uFilmstripAperture, uFilmstripRoundedness);
                    if ((vCapStartStyle > 0.5 || vCapEndStyle > 0.5 || uEdgeNoiseMax > 0.0001 || uFilmstripEnabled > 0.5) && texColor.a <= 0.001) discard;

                    if (uTransparentShadows == 1) {
                        float luminance = dot(texColor.rgb, vec3(0.2126, 0.7152, 0.0722));
                        float alphaScale = clamp(
                            (luminance - uTransparentShadowsThresholdMin)
                                / max(uTransparentShadowsThresholdMax - uTransparentShadowsThresholdMin, 0.00001),
                            0.0,
                            1.0
                        );
                        if (uTransparentHighlights == 1) {
                            alphaScale = 1.0 - alphaScale;
                        }
                        texColor.a *= alphaScale;
                    }

                    outColor = vec4(applySceneColorAdjustments(texColor.rgb, uContrast, uSaturation), texColor.a);
                }
            `,
            // Cap masks are cutouts, not translucent surfaces. Keep them in the
            // normal depth pipeline so nearby ribbon geometry can occlude them
            // consistently, and rely on alpha-to-coverage for edge smoothing.
            transparent: false,
            depthWrite: true,
            alphaToCoverage: hasCapMask,
            side: THREE.DoubleSide
        });

        // Store texture references for swapping
        material._textureCurrent = textureCurrent;
        material._textureNext = textureNext;
        material.defaultAttributeValues = {
            ...(material.defaultAttributeValues || {}),
            capStartStyle: [0],
            capEndStyle: [0],
            capStartU: [1],
            capEndU: [1],
            maskV: [0.5],
        };
        material._hasCapMask = hasCapMask;
        material._transparentShadowsUniform = material.uniforms.uTransparentShadows;
        material._transparentHighlightsUniform = material.uniforms.uTransparentHighlights;
        material._transparentShadowsMinUniform = material.uniforms.uTransparentShadowsThresholdMin;
        material._transparentShadowsMaxUniform = material.uniforms.uTransparentShadowsThresholdMax;
        material._peakTroughTransparencyUniform = material.uniforms.uPeakTroughTransparency;
        material._peakTroughBlurUniform = material.uniforms.uPeakTroughBlur;
        material._peakTroughBlurAmountUniform = material.uniforms.uPeakTroughBlurAmount;
        material._peakTroughGradientStartUniform = material.uniforms.uPeakTroughGradientStart;
        material._peakTroughGradientEndUniform = material.uniforms.uPeakTroughGradientEnd;
        material._edgeNoiseMaxUniform = material.uniforms.uEdgeNoiseMax;
        material._edgeNoiseSpatialFrequencyUniform = material.uniforms.uEdgeNoiseSpatialFrequency;
        material._edgeNoiseMirrorUniform = material.uniforms.uEdgeNoiseMirror;
        material._edgeNoisePhaseUniform = material.uniforms.uEdgeNoisePhase;
        material._filmstripEnabledUniform = material.uniforms.uFilmstripEnabled;
        material._filmstripGapLengthUniform = material.uniforms.uFilmstripGapLength;
        material._filmstripHoleLengthUniform = material.uniforms.uFilmstripHoleLength;
        material._filmstripApertureUniform = material.uniforms.uFilmstripAperture;
        material._filmstripRoundednessUniform = material.uniforms.uFilmstripRoundedness;
        material.alphaToCoverage = hasCapMask || this.#hasEdgeAlphaEffects();

        return this.#decorateTransparentShadowsMaterial(material, hasCapMask);
    }

    /**
     * Create a dual-texture material for smooth flow animation (WebGPU).
     * @param {THREE.DataArrayTexture} textureCurrent - Current tile's array texture
     * @param {THREE.DataArrayTexture} textureNext - Next tile's array texture
     * @returns {THREE_WEBGPU.NodeMaterial} Dual-texture material
     */
    #createDualTextureMaterialWebGPU(textureCurrent, textureNext, options = {}) {
        const { threeWebGPU, threeTSL } = this.#getWebGPUMaterialDeps();
        const { NodeMaterial } = threeWebGPU;
        const { texture, uniform, uv, attribute, float, vec2, vec3, vec4, dot, mix } = threeTSL;
        const layerCount = textureCurrent.image?.depth || 1;
        const currentTileIndex = Number(options.currentTileIndex) || 0;
        const nextTileIndex = Number(options.nextTileIndex) || 0;
        const reverseFlow = this.flowDirection < 0;
        const hasCapMask = true;

        // Create uniforms
        const layerUniform = uniform(this.sharedLayerUniform.value);
        const rotateUniform = uniform(this.sharedRotateUniform.value);
        const flipVerticalUniform = uniform(this.sharedFlipVerticalUniform.value);
        const mirrorCurrentUniform = uniform(options.mirrorCurrent ? 1 : 0);
        const mirrorNextUniform = uniform(options.mirrorNext ? 1 : 0);
        const mirrorYUniform = uniform(options.mirrorY ? 1 : 0);
        const flowOffsetUniform = uniform(this.sharedFlowOffsetUniform.value);
        const peakTroughTransparencyUniform = uniform(0);
        const peakTroughBlurUniform = uniform(0);
        const peakTroughBlurAmountUniform = uniform(float(4));
        const peakTroughGradientStartUniform = uniform(float(PEAK_TROUGH_FADE_START));
        const peakTroughGradientEndUniform = uniform(float(PEAK_TROUGH_FADE_END));
        const transparentShadowsUniform = uniform(0);
        const transparentHighlightsUniform = uniform(0);
        const transparentShadowsMinUniform = uniform(float(TRANSPARENT_SHADOWS_LUMA_MIN));
        const transparentShadowsMaxUniform = uniform(float(TRANSPARENT_SHADOWS_LUMA_MAX));
        const edgeNoiseMaxUniform = uniform(float(this.sharedEdgeNoiseMaxUniform.value));
        const edgeNoiseSpatialFrequencyUniform = uniform(float(this.sharedEdgeNoiseSpatialFrequencyUniform.value));
        const edgeNoiseMirrorUniform = uniform(float(this.sharedEdgeNoiseMirrorUniform.value));
        const edgeNoisePhaseUniform = uniform(float(this.sharedEdgeNoisePhaseUniform.value));
        const filmstripEnabledUniform = uniform(float(this.sharedFilmstripEnabledUniform.value));
        const filmstripGapLengthUniform = uniform(float(this.sharedFilmstripGapLengthUniform.value));
        const filmstripHoleLengthUniform = uniform(float(this.sharedFilmstripHoleLengthUniform.value));
        const filmstripApertureUniform = uniform(float(this.sharedFilmstripApertureUniform.value));
        const filmstripRoundednessUniform = uniform(float(this.sharedFilmstripRoundednessUniform.value));
        const contrastUniform = uniform(float(this.sharedContrastUniform.value));
        const saturationUniform = uniform(float(this.sharedSaturationUniform.value));
        const transparentShadowsSpan = transparentShadowsMaxUniform
            .sub(transparentShadowsMinUniform)
            .max(float(0.00001));

        const baseUV = uv();
        const edgeNoiseU = attribute('edgeNoiseU', 'float');
        const maskUV = vec2(baseUV.x, attribute('maskV', 'float'));
        
        // Apply flow offset
        const shiftedU = baseUV.x.add(flowOffsetUniform);
        const nextShiftedU = reverseFlow ? shiftedU.add(1.0) : shiftedU.sub(1.0);
        const mirroredV = float(1).sub(baseUV.y);
        const sampledV = flipVerticalUniform.equal(1)
            .select(
                mirrorYUniform.equal(1).select(baseUV.y, mirroredV),
                mirrorYUniform.equal(1).select(mirroredV, baseUV.y)
            );
        
        // Create two UV sets
        const uvCurrent = vec2(
            mirrorCurrentUniform.equal(1).select(float(1).sub(shiftedU), shiftedU),
            sampledV
        );
        const uvNext = vec2(
            mirrorNextUniform.equal(1).select(float(1).sub(nextShiftedU), nextShiftedU),
            sampledV
        );
        
        // Apply rotation and flip for current
        const rotatedCurrent = rotateUniform.equal(1).select(
            vec2(uvCurrent.y, float(1).sub(uvCurrent.x)),
            uvCurrent
        );
        const finalUVCurrent = vec2(rotatedCurrent.x, float(1).sub(rotatedCurrent.y));
        
        // Apply rotation and flip for next
        const rotatedNext = rotateUniform.equal(1).select(
            vec2(uvNext.y, float(1).sub(uvNext.x)),
            uvNext
        );
        const finalUVNext = vec2(rotatedNext.x, float(1).sub(rotatedNext.y));
        
        // Sample both textures
        const colorCurrent = texture(textureCurrent, finalUVCurrent).depth(layerUniform);
        const colorNext = texture(textureNext, finalUVNext).depth(layerUniform);
        
        const sampledColor = reverseFlow
            ? shiftedU.lessThan(float(0.0)).select(colorNext, colorCurrent)
            : shiftedU.greaterThanEqual(1.0).select(colorNext, colorCurrent);
        const peakTroughEffectEnabled = peakTroughTransparencyUniform.max(peakTroughBlurUniform);
        const peakTroughMaskCurrent = createPeakTroughMaskNode(
            threeTSL,
            finalUVCurrent.y,
            currentTileIndex,
            this.tileCount,
            layerUniform,
            layerCount,
            peakTroughGradientStartUniform,
            peakTroughGradientEndUniform,
            peakTroughEffectEnabled
        );
        const peakTroughMaskNext = createPeakTroughMaskNode(
            threeTSL,
            finalUVNext.y,
            nextTileIndex,
            this.tileCount,
            layerUniform,
            layerCount,
            peakTroughGradientStartUniform,
            peakTroughGradientEndUniform,
            peakTroughEffectEnabled
        );
        const useNextTexture = reverseFlow
            ? shiftedU.lessThan(float(0.0))
            : shiftedU.greaterThanEqual(1.0);
        const peakTroughMask = useNextTexture.select(
            peakTroughMaskNext,
            peakTroughMaskCurrent
        );
        const effectColor = createPeakTroughBlurredColorNode(threeTSL, {
            sampledColor,
            peakTroughMask,
            blurEnabledUniform: peakTroughBlurUniform,
            blurAmountUniform: peakTroughBlurAmountUniform,
            layerUniform,
            currentTexture: textureCurrent,
            currentUv: finalUVCurrent,
            nextTexture: textureNext,
            nextUv: finalUVNext,
            useNext: useNextTexture,
        });
        const peakTroughAlpha = mix(
            float(1.0),
            float(PEAK_TROUGH_MIN_ALPHA),
            peakTroughMask.mul(peakTroughTransparencyUniform)
        );

        const capAlpha = createCapAlphaNode(threeTSL, maskUV);

        const edgeNoiseAlpha = createEdgeNoiseAlphaNode(
            threeTSL,
            maskUV,
            edgeNoiseU,
            edgeNoiseMaxUniform,
            edgeNoisePhaseUniform,
            edgeNoiseSpatialFrequencyUniform,
            edgeNoiseMirrorUniform
        );
        const filmstripAlpha = createFilmstripAlphaNode(
            threeTSL,
            maskUV,
            edgeNoiseU,
            filmstripEnabledUniform,
            filmstripGapLengthUniform,
            filmstripHoleLengthUniform,
            filmstripApertureUniform,
            filmstripRoundednessUniform
        );
        const finalColor = hasCapMask
            ? vec4(effectColor.rgb, effectColor.a.mul(peakTroughAlpha).mul(capAlpha).mul(edgeNoiseAlpha).mul(filmstripAlpha))
            : vec4(effectColor.rgb, effectColor.a.mul(peakTroughAlpha).mul(edgeNoiseAlpha).mul(filmstripAlpha));
        const luminance = dot(finalColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        const transparencyFactor = luminance.sub(transparentShadowsMinUniform)
            .div(transparentShadowsSpan)
            .max(float(0.0))
            .min(float(1.0));
        const mappedTransparencyFactor = transparentHighlightsUniform.equal(1).select(
            float(1.0).sub(transparencyFactor),
            transparencyFactor
        );
        const mappedTransparencyAlpha = finalColor.a.mul(mappedTransparencyFactor);
        const outputColor = transparentShadowsUniform.equal(1).select(
            vec4(finalColor.rgb, mappedTransparencyAlpha),
            finalColor
        );
        const adjustedOutputColor = vec4(
            createSceneColorAdjustmentNode(threeTSL, outputColor.rgb, contrastUniform, saturationUniform),
            outputColor.a
        );

        const material = new NodeMaterial();
        material.colorNode = adjustedOutputColor;
        material.transparent = false;
        material.depthWrite = true;
        material.alphaToCoverage = hasCapMask || this.#hasEdgeAlphaEffects();
        material.side = THREE.DoubleSide;

        // Store references for updates
        material._layerUniform = layerUniform;
        material._rotateUniform = rotateUniform;
        material._flipVerticalUniform = flipVerticalUniform;
        material._flowOffsetUniform = flowOffsetUniform;
        material._textureCurrent = textureCurrent;
        material._textureNext = textureNext;
        material.defaultAttributeValues = {
            ...(material.defaultAttributeValues || {}),
            capStartStyle: [0],
            capEndStyle: [0],
            capStartU: [1],
            capEndU: [1],
            maskV: [0.5],
        };
        material._hasCapMask = hasCapMask;
        material._transparentShadowsUniform = transparentShadowsUniform;
        material._transparentHighlightsUniform = transparentHighlightsUniform;
        material._transparentShadowsMinUniform = transparentShadowsMinUniform;
        material._transparentShadowsMaxUniform = transparentShadowsMaxUniform;
        material._peakTroughTransparencyUniform = peakTroughTransparencyUniform;
        material._peakTroughBlurUniform = peakTroughBlurUniform;
        material._peakTroughBlurAmountUniform = peakTroughBlurAmountUniform;
        material._peakTroughGradientStartUniform = peakTroughGradientStartUniform;
        material._peakTroughGradientEndUniform = peakTroughGradientEndUniform;
        material._edgeNoiseMaxUniform = edgeNoiseMaxUniform;
        material._edgeNoiseSpatialFrequencyUniform = edgeNoiseSpatialFrequencyUniform;
        material._edgeNoiseMirrorUniform = edgeNoiseMirrorUniform;
        material._edgeNoisePhaseUniform = edgeNoisePhaseUniform;
        material._filmstripEnabledUniform = filmstripEnabledUniform;
        material._filmstripGapLengthUniform = filmstripGapLengthUniform;
        material._filmstripHoleLengthUniform = filmstripHoleLengthUniform;
        material._filmstripApertureUniform = filmstripApertureUniform;
        material._filmstripRoundednessUniform = filmstripRoundednessUniform;
        material._contrastUniform = contrastUniform;
        material._saturationUniform = saturationUniform;

        return this.#decorateTransparentShadowsMaterial(material, hasCapMask);
    }

    /**
     * Create a dual-texture material for a specific segment.
     * @param {number} segmentIndex - The segment's base tile index
     * @returns {THREE.Material} Dual-texture material for smooth flow
     */
    createFlowMaterial(segmentIndex, materialOptions = null) {
        if (!this.isKTX2 || this.arrayTextures.length === 0) {
            return this.getMaterial(segmentIndex, materialOptions);
        }

        const basePos = segmentIndex + this.tileFlowOffset;
        const flowStep = this.flowDirection < 0 ? -1 : 1;
        const currentSample = this.resolveSegmentToTile(basePos);
        const nextSample = this.resolveSegmentToTile(basePos + flowStep);

        const currentTileIdx = currentSample.tileIndex;
        const nextTileIdx = nextSample.tileIndex;

        const textureCurrent = this.arrayTextures[currentTileIdx];
        const textureNext = this.arrayTextures[nextTileIdx];
        const cacheKey = this.#buildFlowMaterialCacheKey(currentSample, nextSample, materialOptions);
        const mirrorY = resolveMirrorY(materialOptions);

        if (cacheKey) {
            const cachedMaterial = this.flowMaterialCache.get(cacheKey);
            if (cachedMaterial) {
                return this.#trackActiveFlowMaterial(cachedMaterial);
            }
        }

        if (!textureCurrent || !textureNext) {
            console.warn(`[TileManager] Missing textures for flow material: ${currentTileIdx}, ${nextTileIdx}`);
            return this.getMaterial(segmentIndex, materialOptions);
        }

        let material;
        if (this.rendererType === 'webgpu') {
            material = this.#createDualTextureMaterialWebGPU(textureCurrent, textureNext, {
                currentTileIndex: currentTileIdx,
                nextTileIndex: nextTileIdx,
                mirrorCurrent: currentSample.mirrorX,
                mirrorNext: nextSample.mirrorX,
                mirrorY,
                ...materialOptions,
            });
        } else {
            material = this.#createDualTextureMaterialWebGL(textureCurrent, textureNext, {
                currentTileIndex: currentTileIdx,
                nextTileIndex: nextTileIdx,
                mirrorCurrent: currentSample.mirrorX,
                mirrorNext: nextSample.mirrorX,
                mirrorY,
                ...materialOptions,
            });
        }

        // Track this material for uniform updates
        if (material) {
            material._flowMaterialReusable = !!cacheKey;

            if (cacheKey) {
                this.flowMaterialCache.set(cacheKey, material);
            }

            this.#trackActiveFlowMaterial(material);
        }

        return material;
    }

    /**
     * Get a raw array texture by index.
     * @param {number} index - Tile index
     * @returns {THREE.DataArrayTexture|null} The array texture or null
     */
    getArrayTexture(index) {
        return this.arrayTextures[index % this.tileCount] || null;
        return this.arrayTextures[index % this.tileCount] || null;
    }

    /**
     * Clear the currently active flow-material bindings.
     * Reusable cached flow materials are retained for future wraps.
     */
    clearFlowMaterials() {
        this.flowMaterials.forEach(material => {
            if (!material?._flowMaterialReusable) {
                this.#disposeFlowMaterial(material);
            }
        });
        this.flowMaterials = [];
        this._activeFlowMaterialSet.clear();
    }

    #createArrayMaterialWebGL(arrayTexture, options = {}) {
        const layerCount = arrayTexture.image?.depth || 1;
        const tileIndex = Number(options.tileIndex) || 0;
        const mirrorX = options.mirrorX ? 1 : 0;
        const mirrorY = options.mirrorY ? 1 : 0;
        const hasCapMask = true;

        const material = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: {
                uTexArray: { value: arrayTexture },
                uLayer: this.sharedLayerUniform,
                uLayerCount: { value: layerCount },
                uRotate90: this.sharedRotateUniform,
                uFlipVertical: this.sharedFlipVerticalUniform,
                uMirrorX: { value: mirrorX },
                uMirrorY: { value: mirrorY },
                uPeakTroughTransparency: { value: 0 },
                uPeakTroughBlur: { value: 0 },
                uPeakTroughBlurAmount: { value: 4 },
                uPeakTroughGradientStart: { value: PEAK_TROUGH_FADE_START },
                uPeakTroughGradientEnd: { value: PEAK_TROUGH_FADE_END },
                uTileCount: { value: Math.max(1, this.tileCount) },
                uTileIndex: { value: tileIndex },
                uTransparentShadows: { value: 0 },
                uTransparentHighlights: { value: 0 },
                uTransparentShadowsThresholdMin: { value: TRANSPARENT_SHADOWS_LUMA_MIN },
                uTransparentShadowsThresholdMax: { value: TRANSPARENT_SHADOWS_LUMA_MAX },
                uContrast: this.sharedContrastUniform,
                uSaturation: this.sharedSaturationUniform,
                uEdgeNoiseMax: this.sharedEdgeNoiseMaxUniform,
                uEdgeNoiseSpatialFrequency: this.sharedEdgeNoiseSpatialFrequencyUniform,
                uEdgeNoiseMirror: this.sharedEdgeNoiseMirrorUniform,
                uEdgeNoisePhase: this.sharedEdgeNoisePhaseUniform,
                uFilmstripEnabled: this.sharedFilmstripEnabledUniform,
                uFilmstripGapLength: this.sharedFilmstripGapLengthUniform,
                uFilmstripHoleLength: this.sharedFilmstripHoleLengthUniform,
                uFilmstripAperture: this.sharedFilmstripApertureUniform,
                uFilmstripRoundedness: this.sharedFilmstripRoundednessUniform,
            },
            vertexShader: /* glsl */`
                in float edgeNoiseU;
                in float maskV;
                in float capStartStyle;
                in float capEndStyle;
                in float capStartU;
                in float capEndU;
                out vec2 vUv;
                out float vEdgeNoiseU;
                out float vMaskV;
                out float vCapStartStyle;
                out float vCapEndStyle;
                out float vCapStartU;
                out float vCapEndU;
                void main() {
                    vUv = uv;
                    vEdgeNoiseU = edgeNoiseU;
                    vMaskV = maskV;
                    vCapStartStyle = capStartStyle;
                    vCapEndStyle = capEndStyle;
                    vCapStartU = capStartU;
                    vCapEndU = capEndU;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                precision highp float;
                precision highp sampler2DArray;
                in vec2 vUv;
                in float vEdgeNoiseU;
                in float vMaskV;
                in float vCapStartStyle;
                in float vCapEndStyle;
                in float vCapStartU;
                in float vCapEndU;
                uniform sampler2DArray uTexArray;
                uniform int uLayer;
                uniform float uLayerCount;
                uniform int uRotate90;
                uniform int uFlipVertical;
                uniform int uMirrorX;
                uniform int uMirrorY;
                uniform float uPeakTroughTransparency;
                uniform float uPeakTroughBlur;
                uniform float uPeakTroughBlurAmount;
                uniform float uPeakTroughGradientStart;
                uniform float uPeakTroughGradientEnd;
                uniform float uTileCount;
                uniform float uTileIndex;
                uniform int uTransparentShadows;
                uniform int uTransparentHighlights;
                uniform float uTransparentShadowsThresholdMin;
                uniform float uTransparentShadowsThresholdMax;
                uniform float uContrast;
                uniform float uSaturation;
                uniform float uEdgeNoiseMax;
                uniform float uEdgeNoiseSpatialFrequency;
                uniform float uEdgeNoiseMirror;
                uniform float uEdgeNoisePhase;
                uniform float uFilmstripEnabled;
                uniform float uFilmstripGapLength;
                uniform float uFilmstripHoleLength;
                uniform float uFilmstripAperture;
                uniform float uFilmstripRoundedness;
                out vec4 outColor;

${CAP_ALPHA_GLSL}
${PEAK_TROUGH_MASK_GLSL}
${PEAK_TROUGH_BLUR_GLSL}
${EDGE_NOISE_GLSL}
${FILMSTRIP_GLSL}
${SCENE_COLOR_ADJUST_GLSL}

                void main() {
                    vec2 maskUv = vec2(vUv.x, vMaskV);
                    bool mirrorV = (uFlipVertical == 1) != (uMirrorY == 1);
                    float sampleV = mirrorV ? (1.0 - vUv.y) : vUv.y;
                    vec2 sampleUV = vec2((uMirrorX == 1) ? (1.0 - vUv.x) : vUv.x, sampleV);
                    // Optionally rotate by 90 degrees (clockwise)
                    vec2 uvR = (uRotate90 == 1) ? vec2(sampleUV.y, 1.0 - sampleUV.x) : sampleUV;
                    
                    // Flip V to match texture orientation
                    vec2 flippedUv = vec2(uvR.x, 1.0 - uvR.y);
                    vec2 uvDx = dFdx(flippedUv);
                    vec2 uvDy = dFdy(flippedUv);
                    vec4 texColor = textureGrad(uTexArray, vec3(flippedUv, float(uLayer)), uvDx, uvDy);
                    float peakTroughEffectEnabled = max(uPeakTroughTransparency, uPeakTroughBlur);
                    float peakTroughMask = computePeakTroughMask(
                        flippedUv.y,
                        uTileIndex,
                        uTileCount,
                        float(uLayer),
                        uLayerCount,
                        uPeakTroughGradientStart,
                        uPeakTroughGradientEnd,
                        peakTroughEffectEnabled
                    );
                    if (uPeakTroughBlur > 0.5 && peakTroughMask > 0.0001) {
                        vec3 blurredColor = samplePeakTroughBlur(
                            uTexArray,
                            flippedUv,
                            float(uLayer),
                            uPeakTroughBlurAmount
                        );
                        texColor.rgb = mix(texColor.rgb, blurredColor, peakTroughMask);
                    }
                    texColor.a *= mix(1.0, ${PEAK_TROUGH_MIN_ALPHA.toFixed(1)}, peakTroughMask * uPeakTroughTransparency);
                    texColor.a *= computeCapAlpha(vec2(vCapStartU, vMaskV), vec2(vCapEndU, vMaskV), vCapStartStyle, vCapEndStyle);
                    texColor.a *= computeEdgeNoiseAlpha(maskUv, vEdgeNoiseU, uEdgeNoiseMax, uEdgeNoisePhase, uEdgeNoiseSpatialFrequency, uEdgeNoiseMirror);
                    texColor.a *= computeFilmstripAlpha(maskUv, vEdgeNoiseU, uFilmstripEnabled, uFilmstripGapLength, uFilmstripHoleLength, uFilmstripAperture, uFilmstripRoundedness);
                    if ((vCapStartStyle > 0.5 || vCapEndStyle > 0.5 || uEdgeNoiseMax > 0.0001 || uFilmstripEnabled > 0.5) && texColor.a <= 0.001) discard;

                    if (uTransparentShadows == 1) {
                        float luminance = dot(texColor.rgb, vec3(0.2126, 0.7152, 0.0722));
                        float alphaScale = clamp(
                            (luminance - uTransparentShadowsThresholdMin)
                                / max(uTransparentShadowsThresholdMax - uTransparentShadowsThresholdMin, 0.00001),
                            0.0,
                            1.0
                        );
                        if (uTransparentHighlights == 1) {
                            alphaScale = 1.0 - alphaScale;
                        }
                    outColor = vec4(applySceneColorAdjustments(texColor.rgb, uContrast, uSaturation), texColor.a);
                    }
                    outColor = texColor;
                }
            `,
            transparent: false,
            depthWrite: true,
            alphaToCoverage: hasCapMask,
            side: THREE.DoubleSide
        });

        material._hasCapMask = hasCapMask;
        material._transparentShadowsUniform = material.uniforms.uTransparentShadows;
        material._transparentHighlightsUniform = material.uniforms.uTransparentHighlights;
        material._transparentShadowsMinUniform = material.uniforms.uTransparentShadowsThresholdMin;
        material._transparentShadowsMaxUniform = material.uniforms.uTransparentShadowsThresholdMax;
        material._peakTroughTransparencyUniform = material.uniforms.uPeakTroughTransparency;
        material._peakTroughBlurUniform = material.uniforms.uPeakTroughBlur;
        material._peakTroughBlurAmountUniform = material.uniforms.uPeakTroughBlurAmount;
        material._peakTroughGradientStartUniform = material.uniforms.uPeakTroughGradientStart;
        material._peakTroughGradientEndUniform = material.uniforms.uPeakTroughGradientEnd;
        material._edgeNoiseMaxUniform = material.uniforms.uEdgeNoiseMax;
        material._edgeNoiseSpatialFrequencyUniform = material.uniforms.uEdgeNoiseSpatialFrequency;
        material._edgeNoiseMirrorUniform = material.uniforms.uEdgeNoiseMirror;
        material._edgeNoisePhaseUniform = material.uniforms.uEdgeNoisePhase;
        material._filmstripEnabledUniform = material.uniforms.uFilmstripEnabled;
        material._filmstripGapLengthUniform = material.uniforms.uFilmstripGapLength;
        material._filmstripHoleLengthUniform = material.uniforms.uFilmstripHoleLength;
        material._filmstripApertureUniform = material.uniforms.uFilmstripAperture;
        material._filmstripRoundednessUniform = material.uniforms.uFilmstripRoundedness;
        material.defaultAttributeValues = {
            ...(material.defaultAttributeValues || {}),
            capStartStyle: [0],
            capEndStyle: [0],
            capStartU: [1],
            capEndU: [1],
            maskV: [0.5],
        };
        material.alphaToCoverage = hasCapMask || this.#hasEdgeAlphaEffects();

        return this.#decorateTransparentShadowsMaterial(material, hasCapMask);
    }

    #createArrayMaterialWebGPU(arrayTexture, options = {}) {
        const { threeWebGPU, threeTSL } = this.#getWebGPUMaterialDeps();
        const { NodeMaterial } = threeWebGPU;
        const { texture, uniform, uv, attribute, float, vec2, vec3, vec4, dot, mix } = threeTSL;
        const layerCount = arrayTexture.image?.depth || 1;
        const tileIndex = Number(options.tileIndex) || 0;
        const hasCapMask = true;

        // Simple fallback path: use a non-array texture in a MeshBasicMaterial
        // for debugging, instead of the KTX2 array texture.
        if (this.webgpuMaterialMode === 'basic') {
            const debugTex = new THREE.CanvasTexture(Object.assign(
                document.createElement('canvas'),
                {
                    width: 2,
                    height: 2
                }
            ));
            const ctx = debugTex.image.getContext('2d');
            ctx.fillStyle = '#ff00ff';
            ctx.fillRect(0, 0, 2, 2);
            debugTex.needsUpdate = true;

            const basicMat = new THREE.MeshBasicMaterial({
                map: debugTex,
                side: THREE.DoubleSide
            });

            console.log('[TileManager] WebGPU BASIC debug material created (non-array texture)', {
                layerCount,
                textureDepth: arrayTexture.image?.depth,
                textureFormat: arrayTexture.format
            });

            return basicMat;
        }

        // Create uniforms for layer and rotation
        const layerUniform = uniform(this.sharedLayerUniform.value);
        const rotateUniform = uniform(this.sharedRotateUniform.value);
        const flipVerticalUniform = uniform(this.sharedFlipVerticalUniform.value);
        const mirrorUniform = uniform(options.mirrorX ? 1 : 0);
        const mirrorYUniform = uniform(options.mirrorY ? 1 : 0);
        const transparentShadowsUniform = uniform(0);
        const peakTroughTransparencyUniform = uniform(0);
        const peakTroughBlurUniform = uniform(0);
        const peakTroughBlurAmountUniform = uniform(float(4));
        const peakTroughGradientStartUniform = uniform(float(PEAK_TROUGH_FADE_START));
        const peakTroughGradientEndUniform = uniform(float(PEAK_TROUGH_FADE_END));
        const transparentHighlightsUniform = uniform(0);
        const transparentShadowsMinUniform = uniform(float(TRANSPARENT_SHADOWS_LUMA_MIN));
        const transparentShadowsMaxUniform = uniform(float(TRANSPARENT_SHADOWS_LUMA_MAX));
        const edgeNoiseMaxUniform = uniform(float(this.sharedEdgeNoiseMaxUniform.value));
        const edgeNoiseSpatialFrequencyUniform = uniform(float(this.sharedEdgeNoiseSpatialFrequencyUniform.value));
        const edgeNoiseMirrorUniform = uniform(float(this.sharedEdgeNoiseMirrorUniform.value));
        const edgeNoisePhaseUniform = uniform(float(this.sharedEdgeNoisePhaseUniform.value));
        const filmstripEnabledUniform = uniform(float(this.sharedFilmstripEnabledUniform.value));
        const filmstripGapLengthUniform = uniform(float(this.sharedFilmstripGapLengthUniform.value));
        const filmstripHoleLengthUniform = uniform(float(this.sharedFilmstripHoleLengthUniform.value));
        const filmstripApertureUniform = uniform(float(this.sharedFilmstripApertureUniform.value));
        const filmstripRoundednessUniform = uniform(float(this.sharedFilmstripRoundednessUniform.value));
        const contrastUniform = uniform(float(this.sharedContrastUniform.value));
        const saturationUniform = uniform(float(this.sharedSaturationUniform.value));
        const transparentShadowsSpan = transparentShadowsMaxUniform
            .sub(transparentShadowsMinUniform)
            .max(float(0.00001));

        // Get base UV coordinates
        const baseUV = uv();
        const edgeNoiseU = attribute('edgeNoiseU', 'float');
        const maskUV = vec2(baseUV.x, attribute('maskV', 'float'));
        const mirroredV = float(1).sub(baseUV.y);
        const sampledV = flipVerticalUniform.equal(1)
            .select(
                mirrorYUniform.equal(1).select(baseUV.y, mirroredV),
                mirrorYUniform.equal(1).select(mirroredV, baseUV.y)
            );
        const sampleUV = vec2(
            mirrorUniform.equal(1).select(float(1).sub(baseUV.x), baseUV.x),
            sampledV
        );

        // Step 1: Optionally rotate by 90 degrees clockwise
        // Rotation: (x, y) → (y, 1 - x)
        // Using TSL's select() for conditional: condition.select(valueIfTrue, valueIfFalse)
        const rotatedUV = rotateUniform.equal(1).select(
            // If rotate is enabled: create vec2(y, 1-x)
            vec2(sampleUV.y, float(1).sub(sampleUV.x)),
            // If rotate is disabled: keep original UV
            sampleUV
        );

        // Step 2: Flip V coordinate to match texture orientation
        const finalUV = vec2(
            rotatedUV.x,
            float(1).sub(rotatedUV.y)
        );

        // Create NodeMaterial with texture array sampling using .depth()
        const material = new NodeMaterial();
        const sampledColor = texture(arrayTexture, finalUV).depth(layerUniform);
        const peakTroughEffectEnabled = peakTroughTransparencyUniform.max(peakTroughBlurUniform);
        const peakTroughMask = createPeakTroughMaskNode(
            threeTSL,
            finalUV.y,
            tileIndex,
            this.tileCount,
            layerUniform,
            layerCount,
            peakTroughGradientStartUniform,
            peakTroughGradientEndUniform,
            peakTroughEffectEnabled
        );
        const effectColor = createPeakTroughBlurredColorNode(threeTSL, {
            sampledColor,
            peakTroughMask,
            blurEnabledUniform: peakTroughBlurUniform,
            blurAmountUniform: peakTroughBlurAmountUniform,
            layerUniform,
            currentTexture: arrayTexture,
            currentUv: finalUV,
        });
        const peakTroughAlpha = mix(
            float(1.0),
            float(PEAK_TROUGH_MIN_ALPHA),
            peakTroughMask.mul(peakTroughTransparencyUniform)
        );
        const capAlpha = createCapAlphaNode(threeTSL, maskUV);

        const edgeNoiseAlpha = createEdgeNoiseAlphaNode(
            threeTSL,
            maskUV,
            edgeNoiseU,
            edgeNoiseMaxUniform,
            edgeNoisePhaseUniform,
            edgeNoiseSpatialFrequencyUniform,
            edgeNoiseMirrorUniform
        );
        const filmstripAlpha = createFilmstripAlphaNode(
            threeTSL,
            maskUV,
            edgeNoiseU,
            filmstripEnabledUniform,
            filmstripGapLengthUniform,
            filmstripHoleLengthUniform,
            filmstripApertureUniform,
            filmstripRoundednessUniform
        );
        const finalColor = hasCapMask
            ? vec4(effectColor.rgb, effectColor.a.mul(peakTroughAlpha).mul(capAlpha).mul(edgeNoiseAlpha).mul(filmstripAlpha))
            : vec4(effectColor.rgb, effectColor.a.mul(peakTroughAlpha).mul(edgeNoiseAlpha).mul(filmstripAlpha));
        const luminance = dot(finalColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        const transparencyFactor = luminance.sub(transparentShadowsMinUniform)
            .div(transparentShadowsSpan)
            .max(float(0.0))
            .min(float(1.0));
        const mappedTransparencyFactor = transparentHighlightsUniform.equal(1).select(
            float(1.0).sub(transparencyFactor),
            transparencyFactor
        );
        const mappedTransparencyAlpha = finalColor.a.mul(mappedTransparencyFactor);

        const outputColor = hasCapMask
            ? transparentShadowsUniform.equal(1).select(
                vec4(finalColor.rgb, mappedTransparencyAlpha),
                finalColor
            )
            : transparentShadowsUniform.equal(1).select(
                vec4(finalColor.rgb, mappedTransparencyAlpha),
                finalColor
            );
        material.colorNode = vec4(
            createSceneColorAdjustmentNode(threeTSL, outputColor.rgb, contrastUniform, saturationUniform),
            outputColor.a
        );
        material.transparent = false;
        material.depthWrite = true;
        material.alphaToCoverage = hasCapMask || this.#hasEdgeAlphaEffects();
        material.side = THREE.DoubleSide;

        // Store references to uniforms for updates
        material._layerUniform = layerUniform;
        material._rotateUniform = rotateUniform;
        material._flipVerticalUniform = flipVerticalUniform;
        material._mirrorUniform = mirrorUniform;
        material._hasCapMask = hasCapMask;
        material._transparentShadowsUniform = transparentShadowsUniform;
        material._transparentHighlightsUniform = transparentHighlightsUniform;
        material._transparentShadowsMinUniform = transparentShadowsMinUniform;
        material._transparentShadowsMaxUniform = transparentShadowsMaxUniform;
        material._peakTroughTransparencyUniform = peakTroughTransparencyUniform;
        material._peakTroughBlurUniform = peakTroughBlurUniform;
        material._peakTroughBlurAmountUniform = peakTroughBlurAmountUniform;
        material._peakTroughGradientStartUniform = peakTroughGradientStartUniform;
        material._peakTroughGradientEndUniform = peakTroughGradientEndUniform;
        material._edgeNoiseMaxUniform = edgeNoiseMaxUniform;
        material._edgeNoiseSpatialFrequencyUniform = edgeNoiseSpatialFrequencyUniform;
        material._edgeNoiseMirrorUniform = edgeNoiseMirrorUniform;
        material._edgeNoisePhaseUniform = edgeNoisePhaseUniform;
        material._filmstripEnabledUniform = filmstripEnabledUniform;
        material._filmstripGapLengthUniform = filmstripGapLengthUniform;
        material._filmstripHoleLengthUniform = filmstripHoleLengthUniform;
        material._filmstripApertureUniform = filmstripApertureUniform;
        material._filmstripRoundednessUniform = filmstripRoundednessUniform;
        material._contrastUniform = contrastUniform;
        material._saturationUniform = saturationUniform;
        material.defaultAttributeValues = {
            ...(material.defaultAttributeValues || {}),
            capStartStyle: [0],
            capEndStyle: [0],
            capStartU: [1],
            capEndU: [1],
            maskV: [0.5],
        };

        console.log('[TileManager] WebGPU material created:', {
            layerCount,
            textureDepth: arrayTexture.image?.depth,
            textureFormat: arrayTexture.format,
            rotate90: this.rotate90
        });

        return this.#decorateTransparentShadowsMaterial(material, hasCapMask);
    }

    /**
     * Toggle WebGPU material mode between 'node' (NodeMaterial) and 'basic' (MeshBasicMaterial).
     * This only affects newly created materials; existing meshes keep their current material.
     */
    setWebGPUMaterialMode(mode) {
        if (mode !== 'node' && mode !== 'basic') return;
        if (this.rendererType !== 'webgpu') return;

        if (this.webgpuMaterialMode !== mode) {
            console.log('[TileManager] Switching WebGPU material mode to', mode);
        }
        this.webgpuMaterialMode = mode;
    }

    #getDecodedTextureCacheKey() {
        return this.currentTextureSet?.id || null;
    }

    #registerDecodedArrayTexture(arrayTexture, tileIndex, label = 'Tile') {
        arrayTexture.flipY = false;
        arrayTexture.generateMipmaps = false;
        const hasMips = Array.isArray(arrayTexture.mipmaps) && arrayTexture.mipmaps.length > 1;
        arrayTexture.minFilter = hasMips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
        arrayTexture.magFilter = THREE.LinearFilter;
        arrayTexture.wrapS = THREE.ClampToEdgeWrapping;
        arrayTexture.wrapT = THREE.ClampToEdgeWrapping;

        if (this.rendererType === 'webgl') {
            arrayTexture.colorSpace = THREE.LinearSRGBColorSpace;
        }

        const rawDepth = Number(arrayTexture.image?.depth) || 0;
        const isCompressedArrayTexture = arrayTexture?.isCompressedArrayTexture === true;
        const canUseExpectedLayerCount = isCompressedArrayTexture
            && this.expectedLayerCount > 1
            && rawDepth <= 1;
        const depth = canUseExpectedLayerCount
            ? this.expectedLayerCount
            : (rawDepth > 0 ? rawDepth : 1);

        this.decodedTileDepths[tileIndex] = rawDepth > 0 ? rawDepth : null;
        this.decodedTileKinds[tileIndex] = isCompressedArrayTexture
            ? 'compressed-array'
            : (arrayTexture?.isCompressedTexture ? 'compressed' : (arrayTexture?.constructor?.name || 'unknown'));
        this.decodedTileLayerSources[tileIndex] = canUseExpectedLayerCount
            ? 'metadata-fallback'
            : (rawDepth > 0 ? 'decoded' : 'default');

        if (canUseExpectedLayerCount) {
            console.warn(
                `[TileManager] ${label} ${tileIndex} reported depth ${rawDepth || 'n/a'}; using expected metadata layer_count=${this.expectedLayerCount}`
            );
        }

        if (this.layerCount === 0) {
            this.layerCount = depth;
            this.currentLayer = 0;
            this.direction = 1;
            this.sharedLayerUniform.value = 0;
            this.#syncFlowSpeedAlignment();
        } else if (depth !== this.layerCount) {
            console.warn(`[TileManager] ${label} ${tileIndex} depth (${depth}) != layerCount (${this.layerCount}); will clamp when cycling`);
        }

        this.arrayTextures[tileIndex] = arrayTexture;
        return this.#createArrayMaterial(arrayTexture, { tileIndex });
    }

    async #loadKTX2Tile(index) {
        return new Promise((resolve, reject) => {
            if (!this._ktx2Loader) {
                reject(new Error('KTX2Loader not initialized'));
                return;
            }

            const cachedTexture = getClonedDecodedTexture(this.#getDecodedTextureCacheKey(), this.rendererType, index);
            if (cachedTexture) {
                try {
                    const material = this.#registerDecodedArrayTexture(cachedTexture, index, 'Cached tile');
                    resolve(material);
                    return;
                } catch (error) {
                    cachedTexture.dispose?.();
                    console.warn(`[TileManager] Failed to reuse decoded cache for tile ${index}, falling back to parse`, error);
                }
            }

            // If loading from zip, use the extracted data
            if (this.isZip && this.zipFiles) {
                const filename = `${index}.ktx2`;
                const fileData = this.zipFiles[filename];

                if (!fileData) {
                    console.error(`[TileManager] File ${filename} not found in zip`);
                    const fallback = new THREE.MeshBasicMaterial({ color: new THREE.Color(`hsl(${index * 11}, 70%, 50%)`) });
                    resolve(fallback);
                    return;
                }

                // Parse the KTX2 file from the Uint8Array buffer
                this._ktx2Loader.parse(
                    fileData.buffer,
                    (arrayTexture) => {
                        const material = this.#registerDecodedArrayTexture(arrayTexture, index);
                        rememberDecodedTexture(this.#getDecodedTextureCacheKey(), this.rendererType, index, arrayTexture);
                        resolve(material);
                    },
                    (error) => {
                        console.error(`[TileManager] Failed to parse KTX2 tile ${index} from zip:`, error);
                        console.error(`[TileManager] Error details:`, {
                            message: error?.message,
                            stack: error?.stack,
                            name: error?.name,
                            errorString: String(error)
                        });
                        // Create a fallback solid-color material to keep app running
                        const fallback = new THREE.MeshBasicMaterial({ color: new THREE.Color(`hsl(${index * 11}, 70%, 50%)`) });
                        resolve(fallback);
                    }
                );
            } else {
                // Loading from folder (original behavior)
                const url = `${this.folder}/${index}.ktx2`;
                this._ktx2Loader.load(
                    url,
                    (arrayTexture) => {
                        const material = this.#registerDecodedArrayTexture(arrayTexture, index);
                        rememberDecodedTexture(this.#getDecodedTextureCacheKey(), this.rendererType, index, arrayTexture);
                        resolve(material);
                    },
                    undefined,
                    (error) => {
                        console.error(`[TileManager] Failed to load KTX2 tile ${index}:`, error);
                        console.error(`[TileManager] Error details:`, {
                            message: error?.message,
                            stack: error?.stack,
                            name: error?.name,
                            errorString: String(error)
                        });
                        // Create a fallback solid-color material to keep app running
                        const fallback = new THREE.MeshBasicMaterial({ color: new THREE.Color(`hsl(${index * 11}, 70%, 50%)`) });
                        resolve(fallback);
                    }
                );
            }
        });
    }

    async #loadJPGTile(index) {
        return new Promise((resolve, reject) => {
            const loader = new THREE.TextureLoader();
            loader.load(
                `./tiles-numbered/${index}.jpg`,
                (texture) => {
                    texture.wrapS = THREE.RepeatWrapping;
                    texture.wrapT = THREE.RepeatWrapping;
                    texture.minFilter = THREE.LinearFilter;
                    texture.magFilter = THREE.LinearFilter;

                    // Set color space for WebGL to match WebGPU brightness
                    if (this.rendererType === 'webgl') {
                        texture.colorSpace = THREE.LinearSRGBColorSpace;
                    }

                    resolve(texture);
                },
                undefined,
                (error) => {
                    console.error(`Failed to load tile ${index}:`, error);
                    // Create a fallback colored texture
                    const canvas = document.createElement('canvas');
                    canvas.width = canvas.height = this.tileSize;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = `hsl(${index * 11}, 70%, 50%)`;
                    ctx.fillRect(0, 0, this.tileSize, this.tileSize);
                    const fallbackTexture = new THREE.CanvasTexture(canvas);
                    resolve(fallbackTexture);
                }
            );
        });
    }

    getTile(index) {
        if (this.tileCount <= 0) return undefined;
        const sample = this.resolveSegmentToTile(index);
        const tile = this.tiles[positiveModulo(sample.tileIndex, this.tileCount)];
        // console.log('[TileManager] getTile', index, {
        //     tileExists: !!tile,
        //     totalTiles: this.tiles.length
        // });
        return tile;
    }

    getMaterial(index, materialOptions = null) {
        if (!this.isKTX2) return undefined;
        const sample = this.resolveSegmentToTile(index);
        const baseMaterial = this.materials[sample.tileIndex];
        const mirrorX = !!sample.mirrorX;
        const mirrorY = resolveMirrorY(materialOptions);

        if ((!mirrorX && !mirrorY) || !baseMaterial) {
            return baseMaterial;
        }

        const mirrorKey = `${sample.tileIndex}:${mirrorX ? 1 : 0}:${mirrorY ? 1 : 0}`;
        let mirroredMaterial = this.mirroredMaterials.get(mirrorKey);
        if (!mirroredMaterial) {
            const arrayTexture = this.arrayTextures[sample.tileIndex];
            if (!arrayTexture) {
                return baseMaterial;
            }

            mirroredMaterial = this.#createArrayMaterial(arrayTexture, {
                tileIndex: sample.tileIndex,
                mirrorX,
                mirrorY,
            });
            this.mirroredMaterials.set(mirrorKey, mirroredMaterial);
        }

        return mirroredMaterial;
    }

    /**
     * Return the tile count used for material wrapping.
     */
    getEffectiveTileCount() {
        if (this.tileCount <= 0) return 0;
        if (this.repeatMode === 'mirrorTile') {
            return this.tileCount * 2;
        }

        if (this.repeatMode === 'bounce') {
            return this.tileCount > 1 ? (this.tileCount * 2 - 2) : 1;
        }

        return this.tileCount;
    }

    getTileSequence(startIndex, count) {
        const sequence = [];
        for (let i = 0; i < count; i++) {
            sequence.push(this.getTile(startIndex + i));
        }
        return sequence;
    }

    /**
     * Resolve an effective segment index to a tile index.
     * @param {number} effectiveIndex - segmentIndex + tileFlowOffset
     * @returns {{ isGap: boolean, tileIndex: number, mirrorX: boolean, cycleIndex: number }}
     */
    resolveSegmentToTile(effectiveIndex) {
        return this.#resolveRepeatSample(effectiveIndex);
    }

    /**
     * Get or create the appropriate material for a ribbon segment, accounting
     * for flow state.
     * This is the single source of truth for segment → material mapping.
     * @param {number} globalSegmentIndex - Global segment index across the ribbon
     * @param {boolean} flowActive - Whether flow animation is currently active
     * @returns {THREE.Material} The material to assign to the mesh segment
     */
    getOrCreateMaterialForSegment(globalSegmentIndex, flowActive, materialOptions = null) {
        // Use dual-texture shader when flow animation is active.
        if (flowActive) {
            return this.createFlowMaterial(globalSegmentIndex, materialOptions);
        }

        // Normal: no flow
        const textureIndex = globalSegmentIndex + this.getTileFlowOffset();
        return this.getMaterial(textureIndex, materialOptions);
    }

    getLayerCount() {
        return this.layerCount || 0;
    }

    getLayerDebugInfo() {
        const decodedDepths = this.decodedTileDepths
            .filter((value) => Number.isFinite(value) && value > 0)
            .sort((left, right) => left - right);
        const uniqueDecodedDepths = [...new Set(decodedDepths)];
        const parsedTextureCount = this.arrayTextures.filter(Boolean).length;
        const arrayTextureCount = this.decodedTileKinds.filter((kind) => kind === 'compressed-array').length;
        const nonArrayTextureCount = this.decodedTileKinds.filter(Boolean).length - arrayTextureCount;
        const metadataFallbackCount = this.decodedTileLayerSources
            .filter((source) => source === 'metadata-fallback')
            .length;

        return {
            textureSourceLabel: this.textureSourceLabel || 'default',
            variant: this.variant || 'unknown',
            expectedLayerCount: this.expectedLayerCount || Number(this.currentTextureSet?.layer_count) || 0,
            resolvedLayerCount: this.layerCount || 0,
            decodedDepths: uniqueDecodedDepths,
            parsedTextureCount,
            arrayTextureCount,
            nonArrayTextureCount,
            metadataFallbackCount,
            currentLayer: this.currentLayer,
            layerCycleFrame: this.#getCurrentLayerCycleFrame(),
            layerCycleFrameCount: this.#getLayerSequenceFrameCount(),
            direction: this.direction,
            layerAnimationEnabled: this.layerAnimationEnabled,
            layerAnimationReversed: this.layerAnimationReversed,
            layerChangeCount: this._layerChangeCount,
            lastLayerChangeAgeMs: this._lastLayerChangeTimeMs
                ? Math.max(0, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - this._lastLayerChangeTimeMs)
                : null,
        };
    }

    #getLayerSequenceFrameCount() {
        if (this.layerCount <= 1) {
            return 0;
        }

        return this.variant === 'waves'
            ? this.layerCount
            : (2 * (this.layerCount - 1));
    }

    #getCurrentLayerCycleFrame() {
        const frameCount = this.#getLayerSequenceFrameCount();
        if (frameCount <= 0) {
            return 0;
        }

        if (this.variant === 'waves') {
            return positiveModulo(this.currentLayer, frameCount);
        }

        if (this.direction < 0) {
            return (this.layerCount - 1) + ((this.layerCount - 1) - this.currentLayer);
        }

        return this.currentLayer;
    }

    #applyLayerCycleFrame(cycleFrame) {
        const frameCount = this.#getLayerSequenceFrameCount();
        if (frameCount <= 0) {
            this.currentLayer = 0;
            this.direction = 1;
            return false;
        }

        const normalizedFrame = positiveModulo(cycleFrame, frameCount);

        if (this.variant === 'waves') {
            this.currentLayer = positiveModulo(normalizedFrame, this.layerCount);
            this.direction = 1;
            return true;
        }

        if (normalizedFrame <= this.layerCount - 1) {
            this.currentLayer = normalizedFrame;
            this.direction = normalizedFrame >= this.layerCount - 1 ? -1 : 1;
            return true;
        }

        this.currentLayer = frameCount - normalizedFrame;
        this.direction = -1;
        return true;
    }

    #stepLayerCycle() {
        const frameCount = this.#getLayerSequenceFrameCount();
        if (frameCount <= 0) {
            return false;
        }

        const step = this.layerAnimationReversed ? -1 : 1;
        const nextFrame = positiveModulo(this.#getCurrentLayerCycleFrame() + step, frameCount);
        return this.#applyLayerCycleFrame(nextFrame);
    }

    #notifyLayerChange(layerIndex) {
        const normalizedLayer = Math.max(0, Math.min(layerIndex, Math.max(0, this.layerCount - 1))) | 0;

        if (this._lastNotifiedLayer === normalizedLayer) {
            return;
        }

        this._lastNotifiedLayer = normalizedLayer;
        this._layerChangeCount += 1;
        this._lastLayerChangeTimeMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this._onLayerChange?.(normalizedLayer);
    }

    #syncCurrentLayerUniforms() {
        const clamped = Math.max(0, Math.min(this.currentLayer, Math.max(0, this.layerCount - 1))) | 0;
        this.sharedLayerUniform.value = clamped;

        if (this.rendererType === 'webgpu') {
            this.#forEachStaticMaterial(material => {
                if (material?._layerUniform) {
                    material._layerUniform.value = clamped;
                }
            });
            for (const material of this.flowMaterials) {
                if (material?._layerUniform) {
                    material._layerUniform.value = clamped;
                }
            }
        }

        this.#notifyLayerChange(clamped);

        return clamped;
    }

    #syncFlowOffsetUniforms() {
        this.sharedFlowOffsetUniform.value = this.flowOffset;

        if (this.rendererType === 'webgpu') {
            for (const material of this.flowMaterials) {
                if (material?._flowOffsetUniform) {
                    material._flowOffsetUniform.value = this.flowOffset;
                }
            }
        }
    }

    #syncEdgeNoisePhase(nowMs) {
        const period = this.#getEdgeNoiseCyclePeriod();
        const nowSeconds = Number(nowMs) / 1000;
        const phase = Number.isFinite(nowSeconds) && period > 0
            ? positiveModulo(nowSeconds / period, 1)
            : 0;

        this.sharedEdgeNoisePhaseUniform.value = phase;
        this.#syncEdgeNoiseUniforms({ phaseOnly: true });
    }

    setLayerAnimationEnabled(enabled) {
        const nextEnabled = !!enabled;
        if (this.layerAnimationEnabled === nextEnabled) {
            return false;
        }

        this.layerAnimationEnabled = nextEnabled;
        this.currentLayer = 0;
        this.direction = 1;
        this.lastFrameTime = 0;
        this._deterministicAccum = 0;
        this.#syncCurrentLayerUniforms();
        this.#syncFlowSpeedAlignment();
        return true;
    }

    isLayerAnimationEnabled() {
        return this.layerAnimationEnabled;
    }

    setLayerAnimationReversed(reversed) {
        const nextReversed = !!reversed;
        if (this.layerAnimationReversed === nextReversed) {
            return false;
        }

        this.layerAnimationReversed = nextReversed;
        return true;
    }

    isLayerAnimationReversed() {
        return this.layerAnimationReversed;
    }

    getLayerCycleFrameCount() {
        if (!this.layerAnimationEnabled) {
            return 0;
        }

        return this.#getLayerSequenceFrameCount();
    }

    getLayerCycleProgress() {
        const frameCount = this.#getLayerSequenceFrameCount();
        if (frameCount <= 0) {
            return 0;
        }

        return this.#getCurrentLayerCycleFrame() / frameCount;
    }

    setLayerCycleProgress(progressTurns) {
        const frameCount = this.#getLayerSequenceFrameCount();
        if (frameCount <= 0) {
            return false;
        }

        const normalizedTurns = Number.isFinite(progressTurns)
            ? positiveModulo(progressTurns, 1)
            : 0;
        const cycleFrame = Math.floor(normalizedTurns * frameCount + 1e-9);

        this.#applyLayerCycleFrame(cycleFrame);

        this.#syncCurrentLayerUniforms();
        return true;
    }

    #getLayerCycleFraction() {
        const frameCount = this.getLayerCycleFrameCount();
        if (frameCount <= 0) {
            return null;
        }

        const fpsFraction = numberToFraction(this.getFps());
        if (!fpsFraction || fpsFraction.numerator <= 0n) {
            return null;
        }

        return reduceFraction(BigInt(frameCount) * fpsFraction.denominator, fpsFraction.numerator);
    }

    #getUndulationCycleFraction(targetPeriod = 3.0) {
        const layerCycleFraction = this.#getLayerCycleFraction();
        if (!layerCycleFraction) {
            return null;
        }

        const layerCyclePeriod = fractionToNumber(layerCycleFraction);
        if (layerCyclePeriod <= 0) {
            return null;
        }

        const cycleMultiple = Math.max(1, Math.round(targetPeriod / layerCyclePeriod));
        return multiplyFractionByInteger(layerCycleFraction, BigInt(cycleMultiple));
    }

    #getFlowCycleFraction() {
        const effectiveTileCount = this.getEffectiveTileCount();
        if (effectiveTileCount <= 0 || this.flowSpeed === 0) {
            return null;
        }

        const layerCycleFraction = this.#getLayerCycleFraction();
        if (this.flowAlignmentEnabled && this.flowAlignmentInfo?.cycleMultiple && layerCycleFraction) {
            return multiplyFractionByInteger(layerCycleFraction, BigInt(this.flowAlignmentInfo.cycleMultiple));
        }

        const speedFraction = numberToFraction(Math.abs(this.flowSpeed));
        if (!speedFraction || speedFraction.numerator === 0n) {
            return null;
        }

        return reduceFraction(BigInt(effectiveTileCount) * speedFraction.denominator, speedFraction.numerator);
    }

    #syncFlowSpeedAlignment() {
        const requestedMagnitude = Math.abs(Number(this.requestedFlowSpeed ?? this.flowSpeed));
        if (!Number.isFinite(requestedMagnitude) || requestedMagnitude === 0) {
            this.flowSpeed = 0;
            this.flowAlignmentInfo = {
                enabled: this.flowAlignmentEnabled,
                canAlign: false,
                aligned: false,
                requestedSpeed: 0,
                appliedSpeed: 0,
                textureCyclePeriod: 0,
                flowCyclePeriod: 0,
                cycleMultiple: null,
            };
            return;
        }

        const sign = this.flowDirection < 0 ? -1 : 1;
        const effectiveTileCount = this.getEffectiveTileCount();
        const layerCycleFraction = this.#getLayerCycleFraction();
        const textureCyclePeriod = fractionToNumber(layerCycleFraction);
        const canAlign = this.flowAlignmentEnabled && effectiveTileCount > 0 && textureCyclePeriod > 0;

        if (!canAlign) {
            this.flowSpeed = sign * requestedMagnitude;
            this.flowAlignmentInfo = {
                enabled: this.flowAlignmentEnabled,
                canAlign: false,
                aligned: false,
                requestedSpeed: requestedMagnitude,
                appliedSpeed: requestedMagnitude,
                textureCyclePeriod,
                flowCyclePeriod: effectiveTileCount > 0 ? (effectiveTileCount / requestedMagnitude) : 0,
                cycleMultiple: null,
            };
            return;
        }

        const rawCycleMultiple = effectiveTileCount / (requestedMagnitude * textureCyclePeriod);
        const cycleMultiple = Math.max(1, Math.round(rawCycleMultiple));
        const alignedSpeedFraction = reduceFraction(
            BigInt(effectiveTileCount) * layerCycleFraction.denominator,
            BigInt(cycleMultiple) * layerCycleFraction.numerator,
        );
        const appliedSpeed = fractionToNumber(alignedSpeedFraction);
        const flowCyclePeriod = textureCyclePeriod * cycleMultiple;

        this.flowSpeed = sign * appliedSpeed;
        this.flowAlignmentInfo = {
            enabled: true,
            canAlign: true,
            aligned: Math.abs(appliedSpeed - requestedMagnitude) >= 1e-4,
            requestedSpeed: requestedMagnitude,
            appliedSpeed,
            textureCyclePeriod,
            flowCyclePeriod,
            cycleMultiple,
        };
    }

    /**
     * Get the layer cycling FPS
     * @returns {number} Frames per second for layer cycling
     */
    getFps() {
        return this.fps || 30;
    }

    /**
     * Get the layer cycle period (time to complete one full animation cycle)
     * Accounts for different cycling modes:
     * - 'waves': wraps around (0 → layerCount-1 → 0), cycle = layerCount frames
     * - 'planes': ping-pong (0 → layerCount-1 → 0), cycle = 2*(layerCount-1) frames
     * @returns {number} Cycle period in seconds
     */
    getLayerCyclePeriod() {
        const layerCycleFraction = this.#getLayerCycleFraction();
        return layerCycleFraction ? fractionToNumber(layerCycleFraction) : 0;
    }

    /**
     * Get the optimal undulation period for smooth wave animation.
     * Finds the nearest multiple of the layer cycle period to a target duration,
     * ensuring the undulation and texture cycling eventually sync up.
     * @param {number} targetPeriod - Target period in seconds (default 3.0)
     * @returns {number} Optimal period in seconds (multiple of layer cycle)
     */
    getOptimalUndulationPeriod(targetPeriod = 3.0) {
        const undulationFraction = this.#getUndulationCycleFraction(targetPeriod);
        return undulationFraction ? fractionToNumber(undulationFraction) : targetPeriod;
    }

    tick(nowMs, { suppressLayerAnimation = false, suppressFlowAnimation = false } = {}) {
        if (!this.isKTX2) return;

        if (this.lastFrameTime === 0) this.lastFrameTime = nowMs;
        const elapsed = nowMs - this.lastFrameTime;
        const elapsedSec = elapsed / 1000;

        this.#syncEdgeNoisePhase(nowMs);

        // --- Flow animation (continuous dual-texture approach) ---
        if (!suppressFlowAnimation && this.flowEnabled && this.flowSpeed !== 0) {
            // Accumulate fractional offset based on elapsed time
            // Let flowOffset exceed 1.0 - wrapping is handled by updateFlowMaterials()
            // to avoid 1-frame glitches when texture pairs are swapped
            this.flowOffset += this.flowSpeed * elapsedSec;
            this.#syncFlowOffsetUniforms();
        }

        // --- Layer cycling animation (frame-rate limited) ---
        if (this.layerCount <= 1 || !this.layerAnimationEnabled || suppressLayerAnimation) {
            this.lastFrameTime = nowMs;
            // Still fire per-frame callback so preview textures update even
            // before the first KTX2 tile sets layerCount.
            if (this._onTick) {
                this._onTick(this.currentLayer);
            }
            return;
        }

        const frameInterval = 1000 / this.fps;

        if (elapsed >= frameInterval) {
            this.lastFrameTime = nowMs;

            this.#stepLayerCycle();

            // Update shared uniform (clamped)
            this.#syncCurrentLayerUniforms();
        }

        // Fire per-frame callback (e.g. preview texture updates)
        if (this._onTick) {
            this._onTick(this.currentLayer);
        }
    }

    /**
     * Enable or disable a 90-degree UV rotation for KTX2 materials to adjust tile alignment.
     * @param {boolean} flag
     */
    setRotate90(flag) {
        this.rotate90 = !!flag;
        this.sharedRotateUniform.value = this.rotate90 ? 1 : 0;

        // For WebGPU, also update TSL uniform nodes
        if (this.rendererType === 'webgpu') {
            this.#forEachStaticMaterial(material => {
                if (material._rotateUniform) {
                    material._rotateUniform.value = this.rotate90 ? 1 : 0;
                }
            });
        }
    }

    /**
     * Flip or restore the vertical sampling orientation for all texture materials.
     * @param {boolean} flag
     */
    setVerticalFlip(flag) {
        this.flipVertical = !!flag;
        this.sharedFlipVerticalUniform.value = this.flipVertical ? 1 : 0;

        if (this.rendererType === 'webgpu') {
            this.#forEachStaticMaterial(material => {
                if (material._flipVerticalUniform) {
                    material._flipVerticalUniform.value = this.flipVertical ? 1 : 0;
                }
            });

            for (const material of this.flowMaterials) {
                if (material?._flipVerticalUniform) {
                    material._flipVerticalUniform.value = this.flipVertical ? 1 : 0;
                }
            }
        }
    }

    /**
     * Set a ribbon-local contrast multiplier for the current scene-filter spike.
     * @param {number} value 0..2
     */
    setContrast(value) {
        const nextValue = normalizeSceneContrast(value);
        if (this.sceneContrast === nextValue) {
            return false;
        }

        this.sceneContrast = nextValue;
        this.sharedContrastUniform.value = nextValue;
        this.#syncSceneColorAdjustmentUniforms();
        return true;
    }

    /**
     * Set a ribbon-local saturation multiplier for the current scene-filter spike.
     * @param {number} value 0..2
     */
    setSaturation(value) {
        const nextValue = normalizeSceneSaturation(value);
        if (this.sceneSaturation === nextValue) {
            return false;
        }

        this.sceneSaturation = nextValue;
        this.sharedSaturationUniform.value = nextValue;
        this.#syncSceneColorAdjustmentUniforms();
        return true;
    }

    /**
     * Set the maximum shader edge-noise cut-in as a fraction of total ribbon width.
     * @param {number} value 0..0.5
     */
    setEdgeNoiseTransparencyMax(value) {
        const nextValue = normalizeEdgeNoiseTransparencyMax(value);
        if (this.edgeNoiseTransparencyMax === nextValue) {
            return false;
        }

        this.edgeNoiseTransparencyMax = nextValue;
        this.sharedEdgeNoiseMaxUniform.value = this.#getEffectiveEdgeNoiseMax();
        this.#syncEdgeNoiseUniforms();
        return true;
    }

    /**
     * Set whether Edge Drift affects ribbon-edge transparency.
     * @param {boolean} enabled
     */
    setEdgeDriftEnabled(enabled) {
        const nextValue = !!enabled;
        if (this.edgeDriftEnabled === nextValue) {
            return false;
        }

        this.edgeDriftEnabled = nextValue;
        this.sharedEdgeNoiseMaxUniform.value = this.#getEffectiveEdgeNoiseMax();
        this.#syncEdgeNoiseUniforms();
        return true;
    }

    /**
     * Set the edge-noise pattern length in ribbon segments per full loop.
     * @param {number} value 0.1..2
     */
    setEdgeNoisePatternLength(value) {
        const nextValue = normalizeEdgeNoisePatternLength(value);
        if (this.edgeNoisePatternLength === nextValue) {
            return false;
        }

        this.edgeNoisePatternLength = nextValue;
        this.sharedEdgeNoiseSpatialFrequencyUniform.value = edgeNoisePatternLengthToFrequency(nextValue);
        this.#syncEdgeNoiseUniforms();
        return true;
    }

    /**
     * Set whether the same edge-noise shape is used on both ribbon edges.
     * @param {boolean} enabled
     */
    setEdgeNoiseMirrored(enabled) {
        const nextValue = !!enabled;
        if (this.edgeNoiseMirrored === nextValue) {
            return false;
        }

        this.edgeNoiseMirrored = nextValue;
        this.sharedEdgeNoiseMirrorUniform.value = nextValue ? 1.0 : 0.0;
        this.#syncEdgeNoiseUniforms();
        return true;
    }

    /**
     * Set whether Filmstrip Style edge holes are active.
     * @param {boolean} enabled
     */
    setFilmstripStyleEnabled(enabled) {
        const nextValue = !!enabled;
        if (this.filmstripStyleEnabled === nextValue) {
            return false;
        }

        this.filmstripStyleEnabled = nextValue;
        this.sharedFilmstripEnabledUniform.value = nextValue ? 1.0 : 0.0;
        this.#syncEdgeNoiseUniforms();
        return true;
    }

    /**
     * Set filmstrip gap length in ribbon-segment units.
     * @param {number} value 0.05..2
     */
    setFilmstripGapLength(value) {
        const nextValue = normalizeFilmstripGapLength(value);
        if (this.filmstripGapLength === nextValue) {
            return false;
        }

        this.filmstripGapLength = nextValue;
        this.sharedFilmstripGapLengthUniform.value = nextValue;
        this.#syncEdgeNoiseUniforms();
        return true;
    }

    /**
     * Set filmstrip hole length.
     * @param {number} value 0.05..2
     */
    setFilmstripHoleLength(value) {
        const nextValue = normalizeFilmstripHoleLength(value);
        if (this.filmstripHoleLength === nextValue) {
            return false;
        }

        this.filmstripHoleLength = nextValue;
        this.sharedFilmstripHoleLengthUniform.value = nextValue;
        this.#syncEdgeNoiseUniforms();
        return true;
    }

    /**
     * Set filmstrip aperture.
     * @param {number} value 0.1..0.95
     */
    setFilmstripAperture(value) {
        const nextValue = normalizeFilmstripAperture(value);
        if (this.filmstripAperture === nextValue) {
            return false;
        }

        this.filmstripAperture = nextValue;
        this.sharedFilmstripApertureUniform.value = nextValue;
        this.#syncEdgeNoiseUniforms();
        return true;
    }

    /**
     * Set filmstrip hole roundedness.
     * @param {number} value 0..1
     */
    setFilmstripHoleRoundedness(value) {
        const nextValue = normalizeFilmstripHoleRoundedness(value);
        if (this.filmstripHoleRoundedness === nextValue) {
            return false;
        }

        this.filmstripHoleRoundedness = nextValue;
        this.sharedFilmstripRoundednessUniform.value = nextValue;
        this.#syncEdgeNoiseUniforms();
        return true;
    }

    /**
     * Set the tile repeat mode.
     * @param {string} mode - 'wrap' | 'bounce' | 'mirrorTile'
     * @returns {boolean} Whether the mode changed
     */
    setRepeatMode(mode) {
        const nextMode = normalizeRepeatMode(mode);
        if (nextMode === this.repeatMode) {
            return false;
        }

        this.repeatMode = nextMode;
        const nextCycleLength = Math.max(1, this.getEffectiveTileCount());
        this.tileFlowOffset = positiveModulo(this.tileFlowOffset, nextCycleLength);
        this._lastCheckedTileOffset = this.tileFlowOffset;
        this.#syncFlowSpeedAlignment();

        console.log(`[TileManager] Repeat mode set to ${this.repeatMode}`);
        return true;
    }

    /**
     * Get the current tile repeat mode.
     * @returns {string} 'wrap' | 'mirrorTile'
     */
    getRepeatMode() {
        return this.repeatMode;
    }

    /**
     * Set the flow animation speed (tile streaming along ribbon).
     * @param {number} tilesPerSecond - Speed in tiles per second. Positive = forward, negative = backward, 0 = disabled.
     */
    setFlowSpeed(tilesPerSecond) {
        const parsed = Number(tilesPerSecond);
        if (!Number.isFinite(parsed)) {
            return false;
        }

        const previousDirection = this.flowDirection;
        this.flowDirection = parsed < 0 ? -1 : 1;
        this.requestedFlowSpeed = Math.abs(parsed);
        this.#syncFlowSpeedAlignment();

        console.log(`[TileManager] Flow speed set to ${this.flowSpeed} tiles/second (requested ${tilesPerSecond})`);
        return previousDirection !== this.flowDirection;
    }

    /**
     * Get the current flow speed.
     * @returns {number} Flow speed in tiles per second
     */
    getFlowSpeed() {
        return this.flowSpeed;
    }

    getRequestedFlowSpeed() {
        return this.flowDirection * this.requestedFlowSpeed;
    }

    setFlowAlignmentEnabled(enabled) {
        const nextEnabled = !!enabled;
        if (this.flowAlignmentEnabled === nextEnabled) {
            return false;
        }

        this.flowAlignmentEnabled = nextEnabled;
        this.#syncFlowSpeedAlignment();
        return true;
    }

    isFlowAlignmentEnabled() {
        return this.flowAlignmentEnabled;
    }

    getFlowAlignmentInfo() {
        return this.flowAlignmentInfo ? { ...this.flowAlignmentInfo } : null;
    }

    /**
     * Get the current tile flow offset (integer).
     * Used by RibbonSeries to offset material assignments for conveyor effect.
     * @returns {number} Current tile offset
     */
    getTileFlowOffset() {
        return this.tileFlowOffset;
    }

    /**
     * Get the current signed fractional flow offset.
     * Used for continuous UV-based animation within dual-texture materials.
     * @returns {number} Current fractional offset
     */
    getFlowOffset() {
        return this.flowOffset;
    }

    getPendingFlowWrapTiles() {
        if (this.flowOffset >= 1.0) {
            return Math.floor(this.flowOffset);
        }

        if (this.flowOffset <= -1.0) {
            return Math.ceil(this.flowOffset);
        }

        return 0;
    }

    advanceFlowOffset(deltaTiles) {
        const parsed = Number(deltaTiles);
        if (!this.flowEnabled || !Number.isFinite(parsed) || parsed === 0) {
            return false;
        }

        this.flowOffset += parsed;
        this.#syncFlowOffsetUniforms();
        return true;
    }

    /**
     * Wrap the flow offset after texture pairs have been swapped.
     * Called by RibbonSeries.updateFlowMaterials() after creating new materials.
     * @param {number} wholeTiles - Number of whole tiles to shift (can be negative)
     */
    wrapFlowOffset(wholeTiles) {
        // Update tile base offset with wrapping
        const cycleLength = Math.max(1, this.getEffectiveTileCount());
        this.tileFlowOffset = positiveModulo(this.tileFlowOffset + wholeTiles, cycleLength);
        
        // Keep flowOffset within the active tile pair after swapping.
        this.flowOffset -= wholeTiles;
        
        // Update uniforms with wrapped value
        this.#syncFlowOffsetUniforms();
    }

    /**
     * Check if tile base offset has changed since last check.
     * Used by RibbonSeries to know when to swap texture pairs.
     * @returns {boolean} True if tile offset changed
     */
    didTileOffsetChange() {
        if (this._lastCheckedTileOffset !== this.tileFlowOffset) {
            this._lastCheckedTileOffset = this.tileFlowOffset;
            return true;
        }
        return false;
    }

    /**
     * Enable or disable flow animation.
     * When disabled, uses optimized single-texture materials.
     * @param {boolean} enabled - Whether flow animation is enabled
     * @returns {boolean} Whether the state actually changed
     */
    setFlowEnabled(enabled) {
        const wasEnabled = this.flowEnabled;
        this.flowEnabled = !!enabled;
        
        if (!this.flowEnabled) {
            // Reset flow offset when disabled
            this.tileFlowOffset = 0;
            this.flowOffset = 0;
            this.sharedFlowOffsetUniform.value = 0;
        }
        
        const stateChanged = wasEnabled !== this.flowEnabled;
        console.log(`[TileManager] Flow animation ${enabled ? 'enabled' : 'disabled'}${stateChanged ? ' (state changed)' : ''}`);
        
        return stateChanged;
    }

    /**
     * Check if flow animation is enabled.
     * @returns {boolean} Whether flow is enabled
     */
    isFlowEnabled() {
        return this.flowEnabled;
    }

    /**
     * Reset all animation state to time-zero.
     * Call before a deterministic (frame-accurate) render pass.
     */
    resetAnimationState() {
        this.currentLayer = 0;
        this.direction = 1;
        this.lastFrameTime = 0;
        this.flowOffset = 0.0;
        this.tileFlowOffset = 0;
        this.sharedFlowOffsetUniform.value = 0.0;
        this._lastCheckedTileOffset = 0;
        this._deterministicAccum = 0;
        this.#syncCurrentLayerUniforms();

        // Sync WebGPU TSL uniforms
        if (this.rendererType === 'webgpu') {
            for (const m of this.flowMaterials) {
                if (m._flowOffsetUniform) m._flowOffsetUniform.value = 0;
            }
        }

        console.log('[TileManager] Animation state reset to t=0');
    }

    /**
     * Deterministic tick — advance animation by exactly `deltaSec` seconds
     * from the current state. Unlike tick(nowMs) which depends on wall-clock
     * deltas, this is fully reproducible for frame-accurate video export.
     * @param {number} deltaSec - Exact time step in seconds (e.g., 1/30)
     */
    tickDeterministic(deltaSec) {
        if (!this.isKTX2) return;

        // --- Flow animation ---
        if (this.flowEnabled && this.flowSpeed !== 0) {
            this.flowOffset += this.flowSpeed * deltaSec;
            this.sharedFlowOffsetUniform.value = this.flowOffset;

            if (this.rendererType === 'webgpu') {
                for (const material of this.flowMaterials) {
                    if (material._flowOffsetUniform) {
                        material._flowOffsetUniform.value = this.flowOffset;
                    }
                }
            }
        }

        // --- Layer cycling (frame-rate limited) ---
        if (this.layerCount <= 1 || !this.layerAnimationEnabled) return;

        // Accumulate fractional frames
        if (!this._deterministicAccum) this._deterministicAccum = 0;
        this._deterministicAccum += deltaSec;

        const frameInterval = 1 / this.fps;

        while (this._deterministicAccum >= frameInterval) {
            this._deterministicAccum -= frameInterval;

            this.#stepLayerCycle();
        }

        this.#syncCurrentLayerUniforms();
    }

    /**
     * Calculate the duration of one seamless animation loop.
     * Returns the time at which ALL cyclic animations (layer cycling,
     * wave undulation, and optionally tile flow) simultaneously return
     * to their starting state.
     * @param {boolean} includeUndulation - Whether ribbon undulation should be considered part of the loop.
     * @returns {number} Seamless loop duration in seconds
     */
    getSeamlessLoopDuration(includeUndulation = true) {
        const periods = [];
        const layerCycleFraction = this.#getLayerCycleFraction();

        if (this.layerCount > 1 && layerCycleFraction) {
            periods.push(layerCycleFraction);
        }

        if (includeUndulation) {
            const undulationFraction = this.#getUndulationCycleFraction(3.0);
            if (undulationFraction) {
                periods.push(undulationFraction);
            }
        }

        if (this.flowEnabled && this.flowSpeed !== 0) {
            const flowCycleFraction = this.#getFlowCycleFraction();
            if (flowCycleFraction) {
                periods.push(flowCycleFraction);
            }
        }

        if (periods.length === 0) {
            return 1;
        }

        const loopDuration = lcmFractions(periods);
        return loopDuration ? fractionToNumber(loopDuration) : 1;
    }

    /**
     * Load textures from a user-provided zip file (ArrayBuffer).
     * This replaces the current textures with those from the uploaded file.
     * @param {ArrayBuffer} arrayBuffer - The zip file as an ArrayBuffer
     * @param {Function} onProgress - Optional progress callback: (stage, current, total) => {}
     * @returns {Promise<boolean>} True if successful, false otherwise
     */
    async loadFromUserZip(arrayBuffer, onProgress = null) {
        try {
            console.log(`[TileManager] Loading user-uploaded zip, size: ${arrayBuffer.byteLength} bytes`);

            this.clearAllTiles();

            const zip = new JSZip();
            const zipData = await zip.loadAsync(arrayBuffer);

            // Extract and parse metadata.json if present
            const metadataFile = zipData.file('metadata.json');
            if (metadataFile) {
                try {
                    const metadataText = await metadataFile.async('text');
                    this.metadata = JSON.parse(metadataText);

                    // Determine variant from metadata
                    const crossSectionType = this.metadata?.settings?.crossSectionType;
                    if (crossSectionType) {
                        this.variant = crossSectionType; // 'planes' or 'waves'
                        console.log(`[TileManager] Variant set from metadata: ${this.variant}`);
                    }
                } catch (error) {
                    console.warn('[TileManager] Failed to parse metadata.json:', error);
                }
            } else {
                console.warn('[TileManager] No metadata.json found in zip, defaulting to "waves" variant');
                this.variant = 'waves';
            }

            // Count ktx2 files first
            const ktx2Files = [];
            zipData.forEach((relativePath, file) => {
                if (relativePath.endsWith('.ktx2')) {
                    ktx2Files.push({ relativePath, file });
                }
            });

            const totalFiles = ktx2Files.length;
            if (totalFiles === 0) {
                console.error('[TileManager] No KTX2 files found in uploaded zip');
                return false;
            }

            console.log(`[TileManager] Found ${totalFiles} KTX2 files to extract`);

            // Update tile count based on actual files
            this.tileCount = totalFiles;

            // Extract all ktx2 files into memory with progress tracking
            this.zipFiles = {};
            let extractedCount = 0;

            if (onProgress) {
                onProgress('extracting', 0, totalFiles);
            }

            for (const { relativePath, file } of ktx2Files) {
                const data = await file.async('uint8array');
                this.zipFiles[relativePath] = data;
                extractedCount++;

                if (onProgress) {
                    onProgress('extracting', extractedCount, totalFiles);
                }
            }

            console.log(`[TileManager] Extracted ${Object.keys(this.zipFiles).length} KTX2 files from user zip`);

            // Mark as KTX2 and zip mode
            this.isZip = true;
            this.isKTX2 = true;

            // Reset layer state
            this.layerCount = 0;
            this.currentLayer = 0;
            this.direction = 1;
            this.sharedLayerUniform.value = 0;

            // Reset flow state
            this.tileFlowOffset = 0;
            this.flowAccumulator = 0;

            // Initialize KTX2 loader if not already done
            if (!this._ktx2Loader) {
                const ok = await this.#initKTX2();
                if (!ok) {
                    console.error('[TileManager] Failed to initialize KTX2 loader for user zip');
                    return false;
                }
            }

            // Load all tiles
            if (onProgress) {
                onProgress('building', 0, this.tileCount);
            }

            const promises = [];
            for (let i = 0; i < this.tileCount; i++) {
                const promise = this.#loadKTX2Tile(i).then(result => {
                    if (onProgress) {
                        onProgress('building', i + 1, this.tileCount);
                    }
                    return result;
                });
                promises.push(promise);
            }

            const results = await Promise.all(promises);
            this.materials = results;

            const parsedTextureCount = this.arrayTextures.filter(Boolean).length;
            if (parsedTextureCount !== this.tileCount || this.layerCount <= 0) {
                console.error(`[TileManager] Incomplete user zip load: parsed ${parsedTextureCount}/${this.tileCount} tiles, layerCount=${this.layerCount}`);
                this.clearAllTiles();
                return false;
            }

            console.log(`[TileManager] Loaded ${this.materials.length} KTX2 materials from user zip, layerCount=${this.layerCount}`);
            return true;
        } catch (error) {
            console.error('[TileManager] Failed to load user zip:', error);
            return false;
        }
    }

    /**
     * Public dispose — releases all GPU resources held by this TileManager.
     * Call this when you want to fully free VRAM (e.g., during Slyce processing).
     */
    dispose() {
        this.#disposeMaterials();

        // Dispose raw array textures (not covered by #disposeMaterials)
        this.arrayTextures.forEach(t => {
            if (t?.dispose) t.dispose();
        });
        this.arrayTextures = [];

        // Release shared KTX2 loader reference
        if (this._ktx2Loader) {
            releaseKTX2Loader();
            this._ktx2Loader = null;
        }

        this._onTick = null;
        this._onLayerChange = null;
        this._lastNotifiedLayer = 0;

        console.log('[TileManager] Disposed all GPU resources');
    }

    /**
     * Dispose of all current materials to free GPU memory
     */
    #disposeMaterials() {
        this.materials.forEach(material => {
            if (material) {
                // Dispose texture if it exists
                if (material.map) {
                    material.map.dispose();
                }
                // For array textures stored in uniforms
                if (material.uniforms?.uTexArray?.value) {
                    material.uniforms.uTexArray.value.dispose();
                }
                material.dispose();
            }
        });
        this.materials = [];

        this.mirroredMaterials.forEach(material => {
            material?.dispose?.();
        });
        this.mirroredMaterials.clear();

        this.clearEphemeralStaticMaterials();
        this.#disposeFlowMaterialCache();

        // Also dispose tiles (for JPG mode)
        this.tiles.forEach(texture => {
            if (texture && texture.dispose) {
                texture.dispose();
            }
        });
        this.tiles = [];

        // Clear zip files from memory
        this.zipFiles = null;
    }

    /**
     * Get the current tile count
     * @returns {number} The number of tiles
     */
    getTileCount() {
        return this.tileCount;
    }

    // ── Realtime mode methods ──────────────────────────────────────────

    /**
     * Clear all existing tiles and textures, resetting the TileManager
     * for fresh use (e.g. entering realtime mode). Keeps the KTX2Loader
     * and renderer intact so new tiles can still be added.
     */
    clearAllTiles() {
        // Dispose materials + their textures
        this.materials.forEach(material => {
            if (material) {
                if (material.map) material.map.dispose();
                if (material.uniforms?.uTexArray?.value) material.uniforms.uTexArray.value.dispose();
                material.dispose();
            }
        });
        this.materials = [];

        // Dispose raw array textures
        this.arrayTextures.forEach(t => {
            if (t?.dispose) t.dispose();
        });
        this.arrayTextures = [];

        this.mirroredMaterials.forEach(material => {
            material?.dispose?.();
        });
        this.mirroredMaterials.clear();

        this.clearEphemeralStaticMaterials();
        this.#disposeFlowMaterialCache();

        // Dispose JPG tiles
        this.tiles.forEach(texture => {
            if (texture?.dispose) texture.dispose();
        });
        this.tiles = [];

        // Reset layer cycling state
        this.layerCount = 0;
        this.currentLayer = 0;
        this.direction = 1;
        this.sharedLayerUniform.value = 0;
        this.loadedCount = 0;
        this.lastFrameTime = 0;
        this.flowOffset = 0.0;
        this.tileFlowOffset = 0;
        this.zipFiles = null;
        this.flowAccumulator = 0;
        this._lastCheckedTileOffset = 0;
        this._deterministicAccum = 0;
        this.sharedFlowOffsetUniform.value = 0.0;
        this.currentTextureSet = null;
        this.expectedLayerCount = 0;
        this.textureSourceLabel = 'default';
        this.decodedTileDepths = [];
        this.decodedTileKinds = [];
        this.decodedTileLayerSources = [];
        this._layerChangeCount = 0;
        this._lastLayerChangeTimeMs = 0;

        console.log('[TileManager] Cleared all tiles');
    }

    /**
     * Parse a KTX2 buffer and add it as a tile at the given index.
     * Used by the realtime orchestrator when encoding completes.
     *
     * @param {ArrayBuffer|Uint8Array} ktx2Buffer — The KTX2 file data
     * @param {number} tileIndex — Where to insert in the materials/arrayTextures arrays
     * @returns {Promise<THREE.Material>} The created sampler2DArray material
     */
    async addTileFromBuffer(ktx2Buffer, tileIndex) {
        if (!this._ktx2Loader) {
            const ok = await this.#initKTX2();
            if (!ok) throw new Error('Failed to initialize KTX2Loader');
        }

        this.#disposeFlowMaterialCache();

        return new Promise((resolve, reject) => {
            const buffer = ktx2Buffer instanceof Uint8Array
                ? ktx2Buffer.buffer
                : ktx2Buffer;

            this._ktx2Loader.parse(
                buffer,
                (arrayTexture) => {
                    arrayTexture.flipY = false;
                    arrayTexture.generateMipmaps = false;
                    const hasMips = Array.isArray(arrayTexture.mipmaps) && arrayTexture.mipmaps.length > 1;
                    arrayTexture.minFilter = hasMips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
                    arrayTexture.magFilter = THREE.LinearFilter;
                    arrayTexture.wrapS = THREE.ClampToEdgeWrapping;
                    arrayTexture.wrapT = THREE.ClampToEdgeWrapping;

                    if (this.rendererType === 'webgl') {
                        arrayTexture.colorSpace = THREE.LinearSRGBColorSpace;
                    }

                    const depth = arrayTexture.image?.depth || 1;
                        const material = this.#registerDecodedArrayTexture(arrayTexture, tileIndex, 'Realtime tile');
                        rememberDecodedTexture(this.#getDecodedTextureCacheKey(), this.rendererType, tileIndex, arrayTexture);
                    this.materials[tileIndex] = material;

                    console.log(`[TileManager] Added tile ${tileIndex} from buffer (depth=${depth})`);
                    resolve(material);
                },
                (error) => {
                    console.error(`[TileManager] Failed to parse KTX2 tile ${tileIndex} from buffer:`, error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Remove and dispose a single tile by index.
     * Used for FIFO eviction in realtime mode.
     *
     * @param {number} tileIndex
     */
    removeTile(tileIndex) {
        this.#disposeFlowMaterialCache();

        // Dispose array texture
        if (this.arrayTextures[tileIndex]) {
            this.arrayTextures[tileIndex].dispose();
            this.arrayTextures[tileIndex] = null;
        }

        // Dispose material + its textures
        const material = this.materials[tileIndex];
        if (material) {
            if (material.uniforms?.uTexArray?.value) {
                material.uniforms.uTexArray.value.dispose();
            }
            if (material.map) {
                material.map.dispose();
            }
            material.dispose();
            this.materials[tileIndex] = null;
        }

        console.log(`[TileManager] Removed tile ${tileIndex}`);
    }

    /**
     * Fetch a URL with byte-level progress tracking using ReadableStream.
     * Falls back to simple fetch if streaming is not available.
     * @param {string} url - URL to fetch
     * @param {Function} onBytesReceived - Callback: (bytesReceived) => {}
     * @returns {Promise<ArrayBuffer>} The fetched data
     */
    async #fetchWithProgress(url, onBytesReceived) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Check if streaming is available
        if (!response.body) {
            // Fallback: no streaming, report full size at end
            const data = await response.arrayBuffer();
            if (onBytesReceived) {
                onBytesReceived(data.byteLength);
            }
            return data;
        }

        const reader = response.body.getReader();
        const chunks = [];
        let receivedLength = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            receivedLength += value.length;

            // Report bytes received for this chunk
            if (onBytesReceived) {
                onBytesReceived(value.length);
            }
        }

        // Combine chunks into single ArrayBuffer
        const buffer = new Uint8Array(receivedLength);
        let position = 0;
        for (const chunk of chunks) {
            buffer.set(chunk, position);
            position += chunk.length;
        }

        return buffer.buffer;
    }

    /**
     * Load textures from a remote texture set (via Rivvon API).
     * Downloads KTX2 tiles from CDN URLs and builds materials.
     * @param {Object} textureSet - Texture set metadata from API
     * @param {Array} textureSet.tiles - Array of { tileIndex, url, fileSize }
     * @param {number} textureSet.tile_count - Number of tiles
     * @param {number} textureSet.layer_count - Layers per tile
     * @param {string} textureSet.cross_section_type - 'planes' or 'waves'
     * @param {Function} onProgress - Optional progress callback: (stage, current, total) => {}
     * @returns {Promise<boolean>} True if successful, false otherwise
     */
    async loadFromRemote(textureSet, onProgress = null) {
        this.lastLoadError = null;

        try {
            const { tiles, tile_count, layer_count, cross_section_type } = textureSet;

            if (!tiles || tiles.length === 0) {
                console.error('[TileManager] No tiles in remote texture set');
                return false;
            }

            console.log(`[TileManager] Loading remote texture set: ${tiles.length} tiles`);

            this.clearAllTiles();

            // Update state from texture set metadata
            this.tileCount = tile_count || tiles.length;
            this.variant = cross_section_type || 'waves';
            this.isKTX2 = true;
            this.isZip = true; // Use zip-like flow to parse from downloaded buffers
            this.currentTextureSet = textureSet;
            this.expectedLayerCount = Number(layer_count) || 0;
            this.textureSourceLabel = 'remote';

            // Reset layer state
            this.layerCount = 0;
            this.currentLayer = 0;
            this.direction = 1;
            this.sharedLayerUniform.value = 0;

            // Reset flow state
            this.tileFlowOffset = 0;
            this.flowAccumulator = 0;

            // Initialize KTX2 loader if not already done
            if (!this._ktx2Loader) {
                const ok = await this.#initKTX2();
                if (!ok) {
                    console.error('[TileManager] Failed to initialize KTX2 loader for remote textures');
                    return false;
                }
            }

            // Calculate total bytes for progress tracking
            // Use fileSize from tile metadata, or estimate based on tile count
            const totalBytes = tiles.reduce((sum, tile) => sum + (tile.fileSize || tile.file_size || 0), 0);
            const hasFileSizes = totalBytes > 0;
            let downloadedBytes = 0;

            // Determine if this is a Google Drive source (no streaming support)
            const isDriveSource = tiles.some(tile => tile.driveFileId || (tile.url && tile.url.includes('drive.google.com')));
            
            console.log(`[TileManager] Progress tracking mode: ${hasFileSizes ? 'byte-level' : 'tile-count fallback'}`);
            console.log(`[TileManager] Source type: ${isDriveSource ? 'Google Drive' : 'CDN'}`);
            if (hasFileSizes) {
                console.log(`[TileManager] Total bytes to download: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
            } else {
                console.log(`[TileManager] No file sizes available, using tile count: ${tiles.length}`);
            }

            if (onProgress) {
                onProgress('downloading', 0, hasFileSizes ? totalBytes : tiles.length);
            }

            const tileEntry = await getOrFetchTextureTiles(textureSet, { onProgress });
            return await this.#loadFromSharedTileEntry(textureSet, tileEntry, onProgress, 'remote');
        } catch (error) {
            this.lastLoadError = error;
            console.error('[TileManager] Failed to load remote textures:', error);
            return false;
        }
    }

    async loadFromSession(textureSet, tileEntry = null, onProgress = null) {
        this.lastLoadError = null;

        try {
            const resolvedTileEntry = tileEntry || getCachedTextureTiles(textureSet);
            if (!resolvedTileEntry) {
                console.error('[TileManager] No session tile entry available for texture set');
                return false;
            }

            const progressTotal = Number(resolvedTileEntry.progressTotal) || Number(resolvedTileEntry.byteSize) || Number(resolvedTileEntry.tileCount) || Number(textureSet?.tile_count) || 0;
            if (onProgress) {
                onProgress('downloading', progressTotal, progressTotal || 1);
            }

            return await this.#loadFromSharedTileEntry(textureSet, resolvedTileEntry, onProgress, resolvedTileEntry.source || 'session');
        } catch (error) {
            this.lastLoadError = error;
            console.error('[TileManager] Failed to load session textures:', error);
            return false;
        }
    }

    async #loadFromSharedTileEntry(textureSet, tileEntry, onProgress = null, sourceLabel = 'session') {
        const { tile_count, cross_section_type, thumbnail_data_url } = textureSet || {};
        const cachedTileCount = Object.keys(tileEntry?.zipFiles || {}).length;
        const expectedTileCount = Number(tile_count) || Number(tileEntry?.tileCount) || cachedTileCount;

        if (!tileEntry || !tileEntry.zipFiles || Object.keys(tileEntry.zipFiles).length === 0) {
            console.error('[TileManager] No cached tile entry payloads available');
            return false;
        }

        if (typeof tileEntry.isComplete === 'boolean' && !tileEntry.isComplete) {
            throw new Error(
                `Only ${cachedTileCount}/${expectedTileCount} texture tiles were available from the ${sourceLabel} source. Try loading the texture again or choosing a lower-resolution variant on this device.`
            );
        }

        this.clearAllTiles();

        this.tileCount = Number(tile_count) || Number(tileEntry.tileCount) || Object.keys(tileEntry.zipFiles).length;
        this.variant = cross_section_type || tileEntry.variant || 'waves';
        this.isKTX2 = true;
        this.isZip = true;
        this.currentTextureSet = {
            ...textureSet,
            thumbnail_url: thumbnail_data_url || textureSet?.thumbnail_url || null,
        };
        this.expectedLayerCount = Number(textureSet?.layer_count) || Number(tileEntry?.layerCount) || 0;
        this.textureSourceLabel = sourceLabel;

        this.layerCount = 0;
        this.currentLayer = 0;
        this.direction = 1;
        this.sharedLayerUniform.value = 0;

        this.tileFlowOffset = 0;
        this.flowAccumulator = 0;

        if (!this._ktx2Loader) {
            const ok = await this.#initKTX2();
            if (!ok) {
                console.error('[TileManager] Failed to initialize KTX2 loader for cached textures');
                return false;
            }
        }

        this.zipFiles = {};
        for (const [filename, bytes] of Object.entries(tileEntry.zipFiles || {})) {
            if (bytes instanceof ArrayBuffer) {
                this.zipFiles[filename] = new Uint8Array(bytes.slice(0));
                continue;
            }

            if (ArrayBuffer.isView(bytes)) {
                this.zipFiles[filename] = new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
            }
        }

        console.log(`[TileManager] ${sourceLabel} tile data ready from shared cache path. Cached bytes: ${(Number(tileEntry.byteSize || 0) / 1024 / 1024).toFixed(2)} MB`);

        let completedBuilds = 0;
        if (onProgress) {
            onProgress('building', 0, this.tileCount);
        }

        const promises = [];
        for (let i = 0; i < this.tileCount; i++) {
            const promise = this.#loadKTX2Tile(i).then(result => {
                completedBuilds++;
                if (onProgress) {
                    onProgress('building', completedBuilds, this.tileCount);
                }
                return result;
            });
            promises.push(promise);
        }

        const results = await Promise.all(promises);
        this.materials = results;

        const parsedTextureCount = this.arrayTextures.filter(Boolean).length;
        if (parsedTextureCount !== this.tileCount || this.layerCount <= 0) {
            console.error(`[TileManager] Incomplete cached texture load: parsed ${parsedTextureCount}/${this.tileCount} tiles, layerCount=${this.layerCount}`);
            this.clearAllTiles();
            return false;
        }

        console.log(`[TileManager] Loaded ${this.materials.length} KTX2 materials from ${sourceLabel}, layerCount=${this.layerCount}`);
        return true;
    }

    /**
     * Load textures from already-fetched local tile records.
     * @param {Object} textureSet - Texture set metadata from localStorage service
     * @param {Array} tiles - Array of local tile records with bytes/blob payloads
     * @param {Function} onProgress - Optional progress callback: (stage, current, total) => {}
     * @returns {Promise<boolean>} True if successful, false otherwise
     */
    async loadFromTileRecords(textureSet, tiles, onProgress = null) {
        this.lastLoadError = null;

        try {
            const { id, tile_count, cross_section_type, thumbnail_data_url } = textureSet;

            console.log(`[TileManager] Loading local tile records: ${id}, ${tile_count} tiles`);

            this.clearAllTiles();

            // Update state from texture set metadata
            this.tileCount = tile_count;
            this.variant = cross_section_type || 'waves';
            this.isKTX2 = true;
            this.isZip = true; // Use zip-like flow to parse from buffers

            // Store texture set for thumbnail access
            this.currentTextureSet = {
                ...textureSet,
                thumbnail_url: thumbnail_data_url
            };
            this.expectedLayerCount = Number(textureSet?.layer_count) || 0;
            this.textureSourceLabel = 'local';

            // Reset layer state
            this.layerCount = 0;
            this.currentLayer = 0;
            this.direction = 1;
            this.sharedLayerUniform.value = 0;

            // Reset flow state
            this.tileFlowOffset = 0;
            this.flowAccumulator = 0;

            // Initialize KTX2 loader if not already done
            if (!this._ktx2Loader) {
                const ok = await this.#initKTX2();
                if (!ok) {
                    console.error('[TileManager] Failed to initialize KTX2 loader for local textures');
                    return false;
                }
            }

            if (!tiles || tiles.length === 0) {
                console.error('[TileManager] No tiles found in local texture set');
                return false;
            }

            if (onProgress) {
                onProgress('downloading', 0, tile_count);
            }

            // Convert blobs to Uint8Arrays and store in zipFiles format
            this.zipFiles = {};
            let loadedCount = 0;

            const readBlobWithFileReader = (blob) => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error || new Error('Failed to read blob with FileReader'));
                reader.readAsArrayBuffer(blob);
            });

            const readTileBuffer = async (tile) => {
                if (tile.bytes instanceof ArrayBuffer) {
                    return tile.bytes;
                }
                if (ArrayBuffer.isView(tile.bytes)) {
                    return tile.bytes.buffer.slice(tile.bytes.byteOffset, tile.bytes.byteOffset + tile.bytes.byteLength);
                }
                if (tile.blob instanceof Blob) {
                    try {
                        return await tile.blob.arrayBuffer();
                    } catch (error) {
                        console.warn(`[TileManager] tile.blob.arrayBuffer() failed for tile ${tile.tile_index}, retrying with FileReader`, error);
                        return await readBlobWithFileReader(tile.blob);
                    }
                }
                return null;
            };

            for (const tile of tiles) {
                try {
                    const arrayBuffer = await readTileBuffer(tile);
                    if (!arrayBuffer) {
                        console.error(`[TileManager] Local tile ${tile.tile_index} is missing binary data`);
                        continue;
                    }
                    this.zipFiles[`${tile.tile_index}.ktx2`] = new Uint8Array(arrayBuffer);
                    loadedCount++;
                    if (onProgress) {
                        onProgress('downloading', loadedCount, tile_count);
                    }
                } catch (error) {
                    console.error(`[TileManager] Failed to read local tile ${tile.tile_index}:`, error);
                }
            }

            console.log(`[TileManager] Loaded ${loadedCount} tiles from IndexedDB`);

            // Build materials with progress tracking
            let completedBuilds = 0;
            if (onProgress) {
                onProgress('building', 0, this.tileCount);
            }

            const promises = [];
            for (let i = 0; i < this.tileCount; i++) {
                const promise = this.#loadKTX2Tile(i).then(result => {
                    completedBuilds++;
                    if (onProgress) {
                        onProgress('building', completedBuilds, this.tileCount);
                    }
                    return result;
                });
                promises.push(promise);
            }

            const results = await Promise.all(promises);
            this.materials = results;

            const parsedTextureCount = this.arrayTextures.filter(Boolean).length;
            if (loadedCount !== tile_count || parsedTextureCount !== this.tileCount || this.layerCount <= 0) {
                console.error(`[TileManager] Incomplete local texture load: read ${loadedCount}/${tile_count} tiles, parsed ${parsedTextureCount}/${this.tileCount}, layerCount=${this.layerCount}`);
                this.clearAllTiles();
                return false;
            }

            console.log(`[TileManager] Loaded ${this.materials.length} KTX2 materials from local, layerCount=${this.layerCount}`);
            return true;
        } catch (error) {
            this.lastLoadError = error;
            console.error('[TileManager] Failed to load local textures:', error);
            return false;
        }
    }

    /**
     * Load textures from local IndexedDB storage.
     * Reads KTX2 tiles from browser storage and builds materials.
     * @param {Object} textureSet - Texture set metadata from localStorage service
     * @param {string} textureSet.id - Texture set ID
     * @param {number} textureSet.tile_count - Number of tiles
     * @param {number} textureSet.layer_count - Layers per tile
     * @param {string} textureSet.cross_section_type - 'planes' or 'waves'
     * @param {string} textureSet.thumbnail_data_url - Thumbnail for background
     * @param {Function} getTiles - Function to get tiles from localStorage: (textureSetId) => Promise<Array>
     * @param {Function} onProgress - Optional progress callback: (stage, current, total) => {}
     * @returns {Promise<boolean>} True if successful, false otherwise
     */
    async loadFromLocal(textureSet, getTiles, onProgress = null) {
        this.lastLoadError = null;

        try {
            const { id } = textureSet;
            const tiles = await getTiles(id);
            return await this.loadFromTileRecords(textureSet, tiles, onProgress);
        } catch (error) {
            this.lastLoadError = error;
            console.error('[TileManager] Failed to load local textures:', error);
            return false;
        }
    }
}
