import * as THREE from 'three';
import { BLEND_MODES_GLSL, createBlendNode } from './blendModes.js';
import { getBlendModeIndex, normalizeBlendStrength } from '../../../../../packages/shared-types/src/blendModes.js';
import { createGradientMapLut, serializeGradientMapStops, GRADIENT_MAP_LUT_SIZE, normalizeGradientMapMix } from './gradientMap.js';
import { getBackgroundTextureCoverScale, normalizeBackgroundTextureVerticalAlignment } from './backgroundTextures.js';

export const STATIC_TEXTURE_ADJUSTMENTS_GLSL = /* glsl */ `
    uniform float uStaticTextureBlendMode;
    uniform float uStaticTextureBlendStrength;
    ${BLEND_MODES_GLSL}
    uniform float uStaticTextureContrast;
    uniform float uStaticTextureSaturation;
    uniform bool uStaticTextureGradientMapEnabled;
    uniform float uStaticTextureGradientMapMix;
    uniform sampler2D uStaticTextureGradientMap;
    uniform vec2 uStaticTextureUvScale;
    uniform vec2 uStaticTextureUvOffset;

    vec2 getStaticTextureUv(vec2 uv) {
        return uv * uStaticTextureUvScale + uStaticTextureUvOffset;
    }

    vec3 adjustStaticTexture(vec3 color) {
        vec3 weights = vec3(0.2126, 0.7152, 0.0722);
        float luminance = dot(color, weights);
        vec3 saturated = mix(vec3(luminance), color, uStaticTextureSaturation);
        vec3 contrasted = clamp((saturated - 0.5) * uStaticTextureContrast + 0.5, 0.0, 1.0);
        if (uStaticTextureGradientMapEnabled) {
            float position = clamp(dot(contrasted, weights), 0.0, 1.0);
            vec3 mapped = texture2D(uStaticTextureGradientMap, vec2(position, 0.5)).rgb;
            return mix(contrasted, mapped, uStaticTextureGradientMapMix);
        }
        return contrasted;
    }
`;

const normalizeAmount = value => Number.isFinite(Number(value))
    ? Math.max(0, Math.min(2, Number(value))) : 1;

// One LUT per background runtime, shared by its source/display materials and
// reused across preview and export. Adjust only the static sample before blend.
export function createBackgroundTextureAdjustments(app, sourceTexture = null) {
    const gradientTexture = new THREE.DataTexture(new Uint8Array(GRADIENT_MAP_LUT_SIZE * 4), GRADIENT_MAP_LUT_SIZE, 1);
    gradientTexture.name = 'RivvonBackgroundTextureGradientMapLUT';
    gradientTexture.colorSpace = THREE.SRGBColorSpace;
    gradientTexture.minFilter = THREE.LinearFilter;
    gradientTexture.magFilter = THREE.LinearFilter;
    gradientTexture.generateMipmaps = false;
    const uniforms = {
        uStaticTextureBlendMode: { value: 1 },
        uStaticTextureBlendStrength: { value: 1 },
        uStaticTextureContrast: { value: 1 },
        uStaticTextureSaturation: { value: 1 },
        uStaticTextureGradientMapEnabled: { value: false },
        uStaticTextureGradientMapMix: { value: 1 },
        uStaticTextureGradientMap: { value: gradientTexture },
        uStaticTextureUvScale: { value: new THREE.Vector2(1, 1) },
        uStaticTextureUvOffset: { value: new THREE.Vector2(0, 0) },
    };
    const nodeUniformSets = new Set();
    let gradientSignature = null;

    function update(surfaceAspect = 1) {
        uniforms.uStaticTextureBlendMode.value = getBlendModeIndex(app.backgroundTextureBlendMode, 'softLight');
        uniforms.uStaticTextureBlendStrength.value = normalizeBlendStrength(app.backgroundTextureBlendStrength);
        const image = sourceTexture?.image;
        uniforms.uStaticTextureUvScale.value.set(...getBackgroundTextureCoverScale(
            image?.naturalWidth || image?.width, image?.naturalHeight || image?.height, surfaceAspect,
        ));
        const scale = uniforms.uStaticTextureUvScale.value;
        const alignment = normalizeBackgroundTextureVerticalAlignment(app.backgroundTextureVerticalAlignment);
        // Image UVs run from bottom to top. 0% selects the top crop, 100% the bottom.
        uniforms.uStaticTextureUvOffset.value.set((1 - scale.x) * 0.5, (1 - scale.y) * (1 - alignment));
        uniforms.uStaticTextureContrast.value = normalizeAmount(app.backgroundTextureContrast);
        uniforms.uStaticTextureSaturation.value = normalizeAmount(app.backgroundTextureSaturation);
        uniforms.uStaticTextureGradientMapEnabled.value = !!app.backgroundTextureGradientMapEnabled;
        uniforms.uStaticTextureGradientMapMix.value = normalizeGradientMapMix(app.backgroundTextureGradientMapMix);
        const signature = serializeGradientMapStops(app.backgroundTextureGradientMapStops);
        if (signature !== gradientSignature) {
            gradientTexture.image.data = createGradientMapLut(app.backgroundTextureGradientMapStops);
            gradientTexture.needsUpdate = true;
            gradientSignature = signature;
        }
        for (const nodes of nodeUniformSets) {
            for (const key of Object.keys(nodes)) nodes[key].value = uniforms[key].value;
        }
    }

    function createNode(tsl, sourceUv, material) {
        const { uniform, dot, vec2, vec3, mix, texture } = tsl;
        const nodes = Object.fromEntries(Object.entries(uniforms)
            .filter(([key]) => key !== 'uStaticTextureGradientMap')
            .map(([key, entry]) => [key, uniform(entry.value)]));
        nodeUniformSets.add(nodes);
        material._staticTextureAdjustmentUniforms = nodes;
        material.addEventListener('dispose', () => nodeUniformSets.delete(nodes));
        const sampleUv = sourceUv.mul(nodes.uStaticTextureUvScale).add(nodes.uStaticTextureUvOffset);
        const color = texture(sourceTexture, sampleUv).rgb;
        const weights = vec3(0.2126, 0.7152, 0.0722);
        const luminance = dot(color, weights);
        const saturated = mix(vec3(luminance), color, nodes.uStaticTextureSaturation);
        const contrasted = saturated.sub(0.5).mul(nodes.uStaticTextureContrast).add(0.5).clamp(0, 1);
        const position = dot(contrasted, weights).clamp(0, 1);
        const mapped = texture(gradientTexture, vec2(position, 0.5)).rgb;
        const mixed = mix(contrasted, mapped, nodes.uStaticTextureGradientMapMix);
        return nodes.uStaticTextureGradientMapEnabled.select(mixed, contrasted);
    }

    function compositeNode(tsl, sourceUv, material, base, softLightBlend) {
        const adjusted = createNode(tsl, sourceUv, material);
        const nodes = material._staticTextureAdjustmentUniforms;
        const sampleUv = sourceUv.mul(nodes.uStaticTextureUvScale).add(nodes.uStaticTextureUvOffset);
        const alpha = tsl.texture(sourceTexture, sampleUv).a;
        const selected = createBlendNode(tsl, base, adjusted, nodes.uStaticTextureBlendMode, nodes.uStaticTextureBlendStrength);
        // Preserve the legacy background Soft Light node graph for existing presets.
        const softLight = tsl.mix(adjusted, softLightBlend(base, adjusted), nodes.uStaticTextureBlendStrength);
        const blended = nodes.uStaticTextureBlendMode.equal(1).select(softLight, selected);
        return tsl.mix(base, blended, alpha);
    }
    update();
    return { uniforms, update, createNode, compositeNode, dispose: () => { nodeUniformSets.clear(); gradientTexture.dispose(); } };
}
