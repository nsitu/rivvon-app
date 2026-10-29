import * as THREE from 'three';

export const ARTWORK_BLEND_OPTIONS = [
    { label: 'Normal', value: 'normal' },
    { label: 'Soft Light', value: 'softLight' },
];
export const normalizeArtworkBlendMode = value => value === 'softLight' ? 'softLight' : 'normal';

// Layer tags avoid depending on mesh names or changing the camera's layers.
export const ARTWORK_BACKDROP_FLAG = 'rivvonArtworkBackdrop';

/** Blend the completed depth-tested artwork with its backdrop. Inputs and
 * output are premultiplied; the blend function operates on straight sRGB.
 * Normal bypasses this compositor entirely in useRenderFilter. */
export function createArtworkBlendCompositor(ctx) {
    let rendererType = 'webgl', webGPUDeps = null;
    let artworkTarget = null, backgroundTarget = null, material = null;
    let outputEncodedAlpha = null;
    let compositeScene = null, compositeCamera = null, geometry = null;
    const drawingSize = new THREE.Vector2();

    function dispose() {
        artworkTarget?.dispose(); backgroundTarget?.dispose(); material?.dispose(); geometry?.dispose();
        artworkTarget = backgroundTarget = material = geometry = compositeScene = compositeCamera = null;
        outputEncodedAlpha = null;
    }
    function init(type, deps = null) { dispose(); rendererType = type; webGPUDeps = deps; }

    function createTarget(width, height, artwork) {
        const Target = rendererType === 'webgpu' ? THREE.RenderTarget : THREE.WebGLRenderTarget;
        const target = new Target(width, height, {
            depthBuffer: artwork, stencilBuffer: false,
            minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
            // WebGL's ribbon shaders already write encoded RGB numerically.
            // WebGPU writes linear RGB; its compositor explicitly converts the
            // straight colors for blending and returns linear premultiplied RGB.
            colorSpace: THREE.LinearSRGBColorSpace,
            type: rendererType === 'webgl' && ctx.renderer.value.extensions?.has('EXT_color_buffer_float') === false
                ? THREE.UnsignedByteType : THREE.HalfFloatType,
            samples: artwork && ctx.app.renderAntialiasEnabled !== false
                ? Math.min(4, ctx.renderer.value.capabilities?.maxSamples ?? 4) : 0,
        });
        target.texture.generateMipmaps = false;
        target.texture.name = artwork ? 'RivvonArtworkBlendSource' : 'RivvonArtworkBlendBackdrop';
        return target;
    }

    function createMaterial() {
        if (rendererType === 'webgpu') {
            const { MeshBasicNodeMaterial } = webGPUDeps.threeWebGPU;
            const { uv, texture, vec2, vec3, vec4, float, uniform, mix, max, sRGBTransferOETF, sRGBTransferEOTF } = webGPUDeps.threeTSL;
            const mat = new MeshBasicNodeMaterial();
            const coordinates = uv();
            // Match the existing WebGPU filter's render-target orientation.
            const sampleUv = vec2(coordinates.x, float(1).sub(coordinates.y));
            const source = texture(artworkTarget.texture, sampleUv), backdrop = texture(backgroundTarget.texture, sampleUv);
            const sourceAlpha = source.a.clamp(0, 1), backdropAlpha = backdrop.a.clamp(0, 1);
            const sourceLinear = source.rgb.div(max(sourceAlpha, float(0.00001))).clamp(0, 1);
            const backdropLinear = backdrop.rgb.div(max(backdropAlpha, float(0.00001))).clamp(0, 1);
            const sourceColor = sRGBTransferOETF(sourceLinear), base = sRGBTransferOETF(backdropLinear);
            const low = base.sub(float(1).sub(sourceColor.mul(2)).mul(base).mul(float(1).sub(base)));
            const high = base.add(sourceColor.mul(2).sub(1).mul(base.sqrt().sub(base)));
            // TSL select reduces vector predicates to one boolean. mix keeps
            // the Soft Light branch independent for each RGB channel.
            const blended = mix(high, low, sourceColor.lessThan(vec3(0.5)));
            const alpha = sourceAlpha.add(backdropAlpha.mul(float(1).sub(sourceAlpha)));
            const encoded = sourceColor.mul(sourceAlpha.mul(float(1).sub(backdropAlpha)))
                .add(blended.mul(sourceAlpha.mul(backdropAlpha)))
                .add(base.mul(backdropAlpha.mul(float(1).sub(sourceAlpha))));
            // Convert straight RGB, then reassociate alpha. Encoding premultiplied
            // RGB directly would introduce halos along translucent edges.
            const straight = encoded.div(max(alpha, float(0.00001)));
            outputEncodedAlpha = uniform(false);
            const linearPremultiplied = sRGBTransferEOTF(straight).mul(alpha);
            // The screen output pass converts RGB without unassociating alpha.
            // Supply inverse-transferred encoded premultiplication for that pass.
            mat.colorNode = vec4(outputEncodedAlpha.select(sRGBTransferEOTF(encoded), linearPremultiplied), alpha);
            mat.depthTest = mat.depthWrite = false;
            mat.blending = THREE.NoBlending;
            mat.toneMapped = false;
            return mat;
        }
        return new THREE.ShaderMaterial({
            uniforms: { tArtwork: { value: artworkTarget.texture }, tBackdrop: { value: backgroundTarget.texture } },
            vertexShader: `varying vec2 vUv;
                void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
            fragmentShader: `precision highp float;
                varying vec2 vUv;
                uniform sampler2D tArtwork;
                uniform sampler2D tBackdrop;
                void main() {
                    vec4 source = texture2D(tArtwork, vUv);
                    vec4 backdrop = texture2D(tBackdrop, vUv);
                    float sa = clamp(source.a, 0.0, 1.0);
                    float ba = clamp(backdrop.a, 0.0, 1.0);
                    vec3 s = clamp(source.rgb / max(sa, 0.00001), 0.0, 1.0);
                    vec3 b = clamp(backdrop.rgb / max(ba, 0.00001), 0.0, 1.0);
                    vec3 low = b - (1.0 - 2.0 * s) * b * (1.0 - b);
                    vec3 high = b + (2.0 * s - 1.0) * (sqrt(b) - b);
                    vec3 blended = mix(low, high, step(vec3(0.5), s));
                    vec3 color = sa * (1.0 - ba) * s + sa * ba * blended + (1.0 - sa) * ba * b;
                    gl_FragColor = vec4(color, sa + ba * (1.0 - sa));
                }`,
            depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
        });
    }

    function ensureResources(target) {
        const renderer = ctx.renderer.value;
        const width = target?.width || renderer.getDrawingBufferSize(drawingSize).x;
        const height = target?.height || drawingSize.y;
        if (!artworkTarget) {
            artworkTarget = createTarget(width, height, true); backgroundTarget = createTarget(width, height, false);
            material = createMaterial();
            geometry = new THREE.PlaneGeometry(2, 2);
            compositeScene = new THREE.Scene();
            compositeScene.add(new THREE.Mesh(geometry, material));
            compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        } else {
            artworkTarget.setSize(width, height); backgroundTarget.setSize(width, height);
        }
    }

    function render(target, renderArtwork) {
        ensureResources(target);
        const renderer = ctx.renderer.value, scene = ctx.scene.value, camera = ctx.camera.value;
        const savedTarget = renderer.getRenderTarget();
        const savedColor = renderer.getClearColor(new THREE.Color()), savedAlpha = renderer.getClearAlpha();
        const savedBackground = scene.background;
        const drawables = [], backdrops = [], shadows = [], backdropMaterials = new Map();
        // Preserve ancestor visibility. Only toggle drawables, never groups,
        // cameras, or lights; camera-attached backgrounds must remain reachable.
        scene.traverse(object => {
            if (object.isMesh || object.isLine || object.isPoints || object.isSprite) {
                (object.userData?.[ARTWORK_BACKDROP_FLAG] ? backdrops : drawables).push({ object, visible: object.visible });
            }
            if (object.isLight && object.shadow) shadows.push({ shadow: object.shadow, auto: object.shadow.autoUpdate, needs: object.shadow.needsUpdate });
        });
        const shadowAuto = renderer.shadowMap?.autoUpdate, shadowNeeds = renderer.shadowMap?.needsUpdate;
        try {
            backdrops.forEach(({ object }) => { object.visible = false; });
            scene.background = null;
            renderer.setClearColor(0, 0); renderer.setRenderTarget(artworkTarget); renderer.clear();
            renderArtwork(); // Produces the depth-tested ribbon and its shadow maps.

            backdrops.forEach(({ object, visible }) => { object.visible = visible; });
            drawables.forEach(({ object }) => { object.visible = false; });
            // Keep the maps produced with the artwork visible. Otherwise a
            // background-only draw would refresh them with no shadow casters.
            for (const { object } of backdrops) {
                for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
                    if (!mat || mat.transparent || backdropMaterials.has(mat)) continue;
                    backdropMaterials.set(mat, { transparent: mat.transparent, blending: mat.blending, premultipliedAlpha: mat.premultipliedAlpha });
                    // Background shaders can write partial alpha with opaque
                    // materials. Store it as premultiplied coverage for this pass.
                    mat.transparent = true; mat.blending = THREE.NormalBlending; mat.premultipliedAlpha = false; mat.needsUpdate = true;
                }
            }
            shadows.forEach(({ shadow }) => { shadow.autoUpdate = false; shadow.needsUpdate = false; });
            if (renderer.shadowMap) { renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false; }
            scene.background = savedBackground;
            renderer.setClearColor(savedColor, savedAlpha); renderer.setRenderTarget(backgroundTarget); renderer.clear();
            renderer.render(scene, camera);
            if (outputEncodedAlpha) outputEncodedAlpha.value = target === null && renderer.outputColorSpace === THREE.SRGBColorSpace;
            renderer.setRenderTarget(target); renderer.render(compositeScene, compositeCamera);
        } finally {
            for (const { object, visible } of [...drawables, ...backdrops]) object.visible = visible;
            for (const { shadow, auto, needs } of shadows) { shadow.autoUpdate = auto; shadow.needsUpdate = needs; }
            if (renderer.shadowMap) { renderer.shadowMap.autoUpdate = shadowAuto; renderer.shadowMap.needsUpdate = shadowNeeds; }
            for (const [mat, original] of backdropMaterials) { Object.assign(mat, original); mat.needsUpdate = true; }
            scene.background = savedBackground;
            renderer.setClearColor(savedColor, savedAlpha); renderer.setRenderTarget(savedTarget);
        }
    }

    return { init, render, dispose };
}
