import * as THREE from 'three';
import { createGradientMapLut, serializeGradientMapStops, GRADIENT_MAP_LUT_SIZE } from './gradientMap.js';

export const STATIC_TEXTURE_ADJUSTMENTS_GLSL = /* glsl */ `
    uniform float uStaticTextureContrast;
    uniform float uStaticTextureSaturation;
    uniform bool uStaticTextureGradientMapEnabled;
    uniform sampler2D uStaticTextureGradientMap;

    vec3 adjustStaticTexture(vec3 color) {
        vec3 weights = vec3(0.2126, 0.7152, 0.0722);
        float luminance = dot(color, weights);
        vec3 saturated = mix(vec3(luminance), color, uStaticTextureSaturation);
        vec3 contrasted = clamp((saturated - 0.5) * uStaticTextureContrast + 0.5, 0.0, 1.0);
        if (uStaticTextureGradientMapEnabled) {
            float position = clamp(dot(contrasted, weights), 0.0, 1.0);
            return texture2D(uStaticTextureGradientMap, vec2(position, 0.5)).rgb;
        }
        return contrasted;
    }
`;

const normalizeAmount = value => Number.isFinite(Number(value))
    ? Math.max(0, Math.min(2, Number(value))) : 1;

// One LUT per background runtime, shared by its source/display materials and
// reused across preview and export. Adjust only the static sample before blend.
export function createBackgroundTextureAdjustments(app) {
    const gradientTexture = new THREE.DataTexture(new Uint8Array(GRADIENT_MAP_LUT_SIZE * 4), GRADIENT_MAP_LUT_SIZE, 1);
    gradientTexture.name = 'RivvonBackgroundTextureGradientMapLUT';
    gradientTexture.colorSpace = THREE.SRGBColorSpace;
    gradientTexture.minFilter = THREE.LinearFilter;
    gradientTexture.magFilter = THREE.LinearFilter;
    gradientTexture.generateMipmaps = false;
    const uniforms = {
        uStaticTextureContrast: { value: 1 },
        uStaticTextureSaturation: { value: 1 },
        uStaticTextureGradientMapEnabled: { value: false },
        uStaticTextureGradientMap: { value: gradientTexture },
    };
    const nodeUniformSets = new Set();
    let gradientSignature = null;

    function update() {
        uniforms.uStaticTextureContrast.value = normalizeAmount(app.backgroundTextureContrast);
        uniforms.uStaticTextureSaturation.value = normalizeAmount(app.backgroundTextureSaturation);
        uniforms.uStaticTextureGradientMapEnabled.value = !!app.backgroundTextureGradientMapEnabled;
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

    function createNode(tsl, color, material) {
        const { uniform, dot, vec2, vec3, mix, texture } = tsl;
        const nodes = Object.fromEntries(Object.entries(uniforms)
            .filter(([key]) => key !== 'uStaticTextureGradientMap')
            .map(([key, entry]) => [key, uniform(entry.value)]));
        nodeUniformSets.add(nodes);
        material._staticTextureAdjustmentUniforms = nodes;
        material.addEventListener('dispose', () => nodeUniformSets.delete(nodes));
        const weights = vec3(0.2126, 0.7152, 0.0722);
        const luminance = dot(color, weights);
        const saturated = mix(vec3(luminance), color, nodes.uStaticTextureSaturation);
        const contrasted = saturated.sub(0.5).mul(nodes.uStaticTextureContrast).add(0.5).clamp(0, 1);
        const position = dot(contrasted, weights).clamp(0, 1);
        const mapped = texture(gradientTexture, vec2(position, 0.5)).rgb;
        return nodes.uStaticTextureGradientMapEnabled.select(mapped, contrasted);
    }

    update();
    return { uniforms, update, createNode, dispose: () => { nodeUniformSets.clear(); gradientTexture.dispose(); } };
}
