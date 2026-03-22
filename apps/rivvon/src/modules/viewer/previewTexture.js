/**
 * PreviewTexture — Manages lightweight single-layer preview rendering
 * for tiles in 'building' or 'encoding' state.
 *
 * Each preview tile gets its own THREE.Texture + material whose UV
 * transforms match the KTX2 array-texture materials so that swapping
 * from preview → KTX2 is seamless (no visible flip or rotation).
 *
 * Per frame the texture's `.image` is swapped to the canvas matching
 * the current animation layer — ONE GPU upload per preview tile per
 * frame, zero pixel copying.
 *
 * Renderer-specific material:
 *   WebGL  → ShaderMaterial  (sampler2D + GLSL rotate90/V-flip)
 *   WebGPU → NodeMaterial    (TSL texture() with rotate90/V-flip)
 */

import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
import { texture as tslTexture, uniform, uv, float, vec2, vec3, vec4, pow } from 'three/tsl';

export class PreviewTexture {
    /**
     * @param {Object} options
     * @param {'webgl'|'webgpu'} options.rendererType
     * @param {boolean}          options.rotate90 — match TileManager's rotate90 flag
     */
    constructor({ rendererType = 'webgl', rotate90 = true } = {}) {
        /** @type {Map<number, { texture: THREE.Texture, material: THREE.Material, canvasSet: HTMLCanvasElement[] }>} */
        this.activePreviews = new Map();
        this.rendererType = rendererType;
        this.rotate90 = rotate90;
    }

    /**
     * Register a preview tile for a given tile ID.
     *
     * @param {number} tileId
     * @param {HTMLCanvasElement[]} canvasSet — Array of crossSectionCount canvases
     * @returns {{ texture: THREE.Texture, material: THREE.Material }}
     */
    addPreviewTile(tileId, canvasSet) {
        // Dispose any existing preview for this tileId
        if (this.activePreviews.has(tileId)) {
            this.removePreviewTile(tileId);
        }

        // flipY=false so shader/TSL handles orientation (same as KTX2 path)
        const texture = new THREE.CanvasTexture(canvasSet[0]);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.generateMipmaps = false;
        texture.flipY = false;
        texture.needsUpdate = true;

        const material = this.rendererType === 'webgpu'
            ? this._createWebGPUMaterial(texture)
            : this._createWebGLMaterial(texture);

        const entry = { texture, material, canvasSet };
        this.activePreviews.set(tileId, entry);
        return { texture, material };
    }

    // ── WebGL: GLSL ShaderMaterial (sampler2D) ──────────────────────────

    _createWebGLMaterial(texture) {
        texture.colorSpace = THREE.LinearSRGBColorSpace;

        return new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: {
                uTex: { value: texture },
                uRotate90: { value: this.rotate90 ? 1 : 0 }
            },
            vertexShader: /* glsl */`
                out vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                precision highp float;
                in vec2 vUv;
                uniform sampler2D uTex;
                uniform int uRotate90;
                out vec4 outColor;
                void main() {
                    vec2 uvR = (uRotate90 == 1) ? vec2(vUv.y, 1.0 - vUv.x) : vUv;
                    vec2 flippedUv = vec2(uvR.x, 1.0 - uvR.y);
                    vec4 texColor = texture(uTex, flippedUv);
                    // sRGB → linear to match KTX2 GPU decode
                    outColor = vec4(pow(texColor.rgb, vec3(2.2)), texColor.a);
                    if (outColor.a < 0.01) discard;
                }
            `,
            transparent: true,
            depthWrite: true,
            side: THREE.DoubleSide
        });
    }

    // ── WebGPU: TSL NodeMaterial ─────────────────────────────────────────

    _createWebGPUMaterial(tex) {
        const rotateUniform = uniform(this.rotate90 ? 1 : 0);
        const baseUV = uv();

        const rotatedUV = rotateUniform.equal(1).select(
            vec2(baseUV.y, float(1).sub(baseUV.x)),
            baseUV
        );

        const finalUV = vec2(
            rotatedUV.x,
            float(1).sub(rotatedUV.y)
        );

        const sampled = tslTexture(tex, finalUV);

        const material = new THREE_WEBGPU.NodeMaterial();
        // sRGB → linear to match KTX2 GPU decode
        material.colorNode = vec4(pow(sampled.rgb, vec3(float(2.2))), sampled.a);
        material.transparent = true;
        material.alphaTest = 0.01;
        material.depthWrite = true;
        material.side = THREE.DoubleSide;
        material._rotateUniform = rotateUniform;

        return material;
    }

    /**
     * Remove and dispose a preview tile.
     * @param {number} tileId
     */
    removePreviewTile(tileId) {
        const entry = this.activePreviews.get(tileId);
        if (!entry) return;

        entry.texture.dispose();
        entry.material.dispose();
        this.activePreviews.delete(tileId);
    }

    /**
     * Called from render loop each frame. Swaps each preview tile's
     * texture source to the canvas matching the current animation layer.
     *
     * @param {number} currentLayer — The active layer index (from TileManager ping-pong)
     */
    update(currentLayer) {
        for (const preview of this.activePreviews.values()) {
            const layerIdx = Math.min(currentLayer, preview.canvasSet.length - 1);
            preview.texture.image = preview.canvasSet[layerIdx];
            preview.texture.needsUpdate = true;
        }
    }

    /**
     * Get the preview material for a tile (if it exists).
     * @param {number} tileId
     * @returns {THREE.Material|null}
     */
    getMaterial(tileId) {
        return this.activePreviews.get(tileId)?.material || null;
    }

    /** Number of active preview tiles. */
    get count() {
        return this.activePreviews.size;
    }

    /**
     * Dispose all previews and release resources.
     */
    dispose() {
        for (const tileId of [...this.activePreviews.keys()]) {
            this.removePreviewTile(tileId);
        }
    }
}
