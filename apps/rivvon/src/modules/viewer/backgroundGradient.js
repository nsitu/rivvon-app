import * as THREE from 'three';
export * from '../../../../../packages/shared-types/src/backgroundGradient.js';

export const GRADIENT_GRID_SIZE = 3;
export const GRADIENT_POINTS = Object.freeze(Array.from({ length: 9 }, (_, i) =>
    Object.freeze([(i % 3 + 0.5) / 3, (Math.floor(i / 3) + 0.5) / 3])));

export function getPaletteAtlasSize(layerCount) {
    const columns = Math.ceil(Math.sqrt(Math.max(1, layerCount)));
    return { width: columns * 3, height: Math.ceil(Math.max(1, layerCount) / columns) * 3 };
}

// Clamp inside each layer's nine texel centers, preventing filtering into a
// neighboring layer. Source orientation and flow are applied by the caller.
export const PALETTE_SAMPLE_GLSL = /* glsl */ `
    vec4 samplePalette(sampler2D palette, vec2 coord, float layer) {
        vec2 size = vec2(textureSize(palette, 0));
        float columns = size.x / 3.0;
        vec2 tile = vec2(mod(layer, columns), floor(layer / columns));
        return texture(palette, (tile * 3.0 + clamp(coord * 3.0, vec2(0.5), vec2(2.5))) / size);
    }
`;

export function samplePaletteNode(tsl, palette, coord, layer) {
    const { vec2, float, texture } = tsl;
    const { width, height } = palette.image;
    const columns = width / 3;
    const tile = vec2(float(layer).mod(columns), float(layer).div(columns).floor());
    return texture(palette, tile.mul(3).add(coord.mul(3).clamp(0.5, 2.5)).div(vec2(width, height)));
}

export const GRADIENT_GLSL = /* glsl */ `
    uniform float uGradientInfluence;
    uniform float uGradientFalloff;
    vec4 sampleGradient(sampler2D palette, vec2 coord) {
        vec4 color = vec4(0.0);
        float total = 0.0;
        for (int y = 0; y < 3; y++) {
            for (int x = 0; x < 3; x++) {
                vec2 point = (vec2(float(x), float(y)) + 0.5) / 3.0;
                vec2 delta = coord - point;
                float weight = pow(1.0 + dot(delta, delta) / (uGradientInfluence * uGradientInfluence), -uGradientFalloff);
                color += texture2D(palette, point) * weight;
                total += weight;
            }
        }
        return color / total;
    }
`;

export function createGradientNode(tsl, palette, influence, falloff) {
    const { vec2, vec4, float, texture, uv, Fn } = tsl;
    return Fn(() => {
        const color = vec4(0).toVar();
        const total = float(0).toVar();
        for (const point of GRADIENT_POINTS) {
            const delta = uv().sub(vec2(...point));
            const weight = delta.dot(delta).div(influence.mul(influence)).add(1).pow(falloff.negate());
            color.addAssign(texture(palette, vec2(...point)).mul(weight));
            total.addAssign(weight);
        }
        return color.div(total);
    })();
}

/** Extract all layers into a tiny atlas once per source version, entirely on
 * the GPU. The runtime owns these targets; source KTX2 textures stay untouched. */
export async function createGradientPaletteCache(renderer, webgpu) {
    const tsl = webgpu ? await import('three/tsl') : null;
    const { MeshBasicNodeMaterial } = webgpu ? await import('three/webgpu') : {};
    const entries = new Map();
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const quad = new THREE.Mesh(geometry);
    quad.frustumCulled = false;
    scene.add(quad);

    function get(source) {
        const existing = entries.get(source);
        if (existing?.version === source.version) return existing.target.texture;
        const { width, height } = getPaletteAtlasSize(source.image.depth);
        const target = new THREE.RenderTarget(width, height, {
            type: THREE.HalfFloatType, format: THREE.RGBAFormat,
            minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
            depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
        });
        let material;
        if (webgpu) {
            const { uv, vec2, textureLoad, ivec2, float } = tsl;
            const pixel = uv().mul(vec2(width, height)).floor();
            const layer = pixel.y.div(3).floor().mul(width / 3).add(pixel.x.div(3).floor()).min(source.image.depth - 1);
            const coord = vec2(pixel.x.mod(3), pixel.y.mod(3)).add(0.5).div(3);
            material = new MeshBasicNodeMaterial();
            // Integer loads keep extraction independent of mip selection and
            // avoid Three r182's explicit-LOD array sampler WGSL limitation.
            material.colorNode = textureLoad(source, ivec2(coord.mul(vec2(source.image.width, source.image.height))))
                .depth(float(layer));
        } else {
            material = new THREE.ShaderMaterial({
                glslVersion: THREE.GLSL3,
                uniforms: { source: { value: source }, size: { value: new THREE.Vector2(width, height) }, layers: { value: source.image.depth } },
                vertexShader: `out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
                fragmentShader: `precision highp float; precision highp sampler2DArray;
                    uniform sampler2DArray source; uniform vec2 size; uniform float layers;
                    in vec2 vUv; out vec4 outColor;
                    void main() {
                        vec2 pixel = floor(vUv * size);
                        float layer = min(floor(pixel.y / 3.0) * (size.x / 3.0) + floor(pixel.x / 3.0), layers - 1.0);
                        vec2 coord = (mod(pixel, 3.0) + 0.5) / 3.0;
                        outColor = texelFetch(source, ivec3(ivec2(coord * vec2(textureSize(source, 0).xy)), int(layer)), 0);
                    }`,
            });
        }
        material.depthTest = false;
        material.depthWrite = false;
        material.toneMapped = false;
        quad.material = material;
        const previous = renderer.getRenderTarget();
        try {
            renderer.setRenderTarget(target);
            renderer.render(scene, camera);
        } catch (error) {
            target.dispose();
            throw error;
        } finally {
            renderer.setRenderTarget(previous);
            material.dispose();
        }
        existing?.target.dispose();
        const onDispose = existing?.onDispose ?? (() => {
            entries.get(source)?.target.dispose();
            entries.delete(source);
            source.removeEventListener('dispose', onDispose);
        });
        if (!existing) source.addEventListener('dispose', onDispose);
        entries.set(source, { version: source.version, target, onDispose });
        return target.texture;
    }

    return {
        get,
        dispose() {
            for (const [source, { target, onDispose }] of entries) {
                source.removeEventListener('dispose', onDispose);
                target.dispose();
            }
            entries.clear();
            geometry.dispose();
        },
    };
}
