import * as THREE from 'three';

export function useRenderFilter(ctx) {
    let activeRendererType = 'webgl';
    let webGPUDeps = null;

    let filterScene = null;
    let filterCamera = null;
    let filterGeometry = null;
    let filterQuad = null;
    let filterMaterial = null;
    let filterRenderTarget = null;

    function shouldApplyFilter() {
        return ctx.app.renderFilterMode === 'blackAndWhite';
    }

    async function initRenderFilter(rendererType = 'webgl') {
        disposeRenderFilter();

        activeRendererType = rendererType === 'webgpu' ? 'webgpu' : 'webgl';
        filterScene = new THREE.Scene();
        filterCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        filterGeometry = new THREE.PlaneGeometry(2, 2);

        if (activeRendererType === 'webgpu') {
            const [threeWebGPU, threeTSL] = await Promise.all([
                import('three/webgpu'),
                import('three/tsl')
            ]);

            webGPUDeps = { threeWebGPU, threeTSL };
        }
    }

    function createRenderTarget(width, height) {
        const options = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            colorSpace: ctx.renderer.value?.outputColorSpace ?? THREE.LinearSRGBColorSpace,
            depthBuffer: true,
            stencilBuffer: false,
        };

        const target = activeRendererType === 'webgpu'
            ? new THREE.RenderTarget(width, height, options)
            : new THREE.WebGLRenderTarget(width, height, options);

        target.texture.colorSpace = options.colorSpace;
        return target;
    }

    function createWebGLFilterMaterial(texture) {
        return new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: texture }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                uniform sampler2D tDiffuse;
                varying vec2 vUv;

                void main() {
                    vec4 color = texture2D(tDiffuse, vUv);

                    // Handle premultiplied-alpha inputs so luminance is computed
                    // from the original color before transparency is reapplied.
                    float alpha = color.a;
                    vec3 unpremultiplied = alpha > 0.0 ? (color.rgb / alpha) : vec3(0.0);
                    float luminance = dot(unpremultiplied, vec3(0.2126, 0.7152, 0.0722));
                    vec3 premultipliedFiltered = vec3(luminance) * alpha;
                    gl_FragColor = vec4(premultipliedFiltered, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            depthTest: false,
        });
    }

    function createWebGPUFilterMaterial(texture) {
        const { MeshBasicNodeMaterial } = webGPUDeps.threeWebGPU;
        const { texture: textureNode, uv, float, vec2, vec3, vec4, dot, max } = webGPUDeps.threeTSL;

        const material = new MeshBasicNodeMaterial();
        const baseUv = uv();
        const sampleUv = vec2(baseUv.x, float(1).sub(baseUv.y));
        const sampledColor = textureNode(texture, sampleUv);
        const alpha = sampledColor.a;
        const safeAlpha = max(alpha, float(0.00001));
        const unpremultiplied = sampledColor.rgb.div(safeAlpha);
        const luminance = dot(unpremultiplied, vec3(0.2126, 0.7152, 0.0722));
        const premultipliedFiltered = vec3(luminance, luminance, luminance).mul(alpha);

        // Match WebGL path: filter first in unpremultiplied space, then reapply alpha.
        material.colorNode = vec4(premultipliedFiltered, alpha);
        material.transparent = true;
        material.depthWrite = false;
        material.depthTest = false;

        return material;
    }

    function ensureFilterQuad(texture) {
        if (!filterScene || !filterGeometry) {
            return false;
        }

        if (!filterQuad) {
            filterQuad = new THREE.Mesh(filterGeometry, null);
            filterQuad.frustumCulled = false;
            filterScene.add(filterQuad);
        }

        if (activeRendererType === 'webgpu') {
            filterMaterial?.dispose?.();
            filterMaterial = createWebGPUFilterMaterial(texture);
            filterQuad.material = filterMaterial;
            return true;
        }

        if (!filterMaterial) {
            filterMaterial = createWebGLFilterMaterial(texture);
            filterQuad.material = filterMaterial;
            return true;
        }

        filterMaterial.uniforms.tDiffuse.value = texture;
        return true;
    }

    function ensureFilterResources() {
        const renderer = ctx.renderer.value;
        if (!renderer?.domElement || !filterScene || !filterCamera) {
            return false;
        }

        const width = renderer.domElement.width;
        const height = renderer.domElement.height;

        if (!width || !height) {
            return false;
        }

        const needsNewTarget = !filterRenderTarget
            || filterRenderTarget.width !== width
            || filterRenderTarget.height !== height;

        if (needsNewTarget) {
            filterRenderTarget?.dispose?.();
            filterRenderTarget = createRenderTarget(width, height);

            if (!ensureFilterQuad(filterRenderTarget.texture)) {
                return false;
            }
        }

        return true;
    }

    function applyCapMaskFilterOverrides(scene) {
        const overrides = [];

        scene.traverse((obj) => {
            const materials = Array.isArray(obj.material)
                ? obj.material
                : (obj.material ? [obj.material] : []);

            materials.forEach((material) => {
                if (!material || !material._hasCapMask) {
                    return;
                }

                overrides.push({
                    material,
                    transparent: material.transparent,
                    depthWrite: material.depthWrite,
                    depthTest: material.depthTest,
                    alphaTest: material.alphaTest,
                    alphaToCoverage: material.alphaToCoverage,
                });

                // For post-processing to preserve cap transparency correctly,
                // use real alpha blending instead of alpha-to-coverage while
                // retaining depth behavior to avoid sorting artifacts.
                material.transparent = true;
                material.depthWrite = true;
                material.depthTest = true;
                material.alphaTest = Math.max(material.alphaTest || 0, 0.05);
                material.alphaToCoverage = false;
                material.needsUpdate = true;
            });
        });

        return overrides;
    }

    function restoreCapMaskFilterOverrides(overrides) {
        overrides.forEach(({ material, transparent, depthWrite, depthTest, alphaTest, alphaToCoverage }) => {
            material.transparent = transparent;
            material.depthWrite = depthWrite;
            material.depthTest = depthTest;
            material.alphaTest = alphaTest;
            material.alphaToCoverage = alphaToCoverage;
            material.needsUpdate = true;
        });
    }

    function renderScene(target = null) {
        const renderer = ctx.renderer.value;
        if (!renderer || !ctx.scene.value || !ctx.camera.value) {
            return;
        }

        if (!shouldApplyFilter() || !ensureFilterResources()) {
            renderer.setRenderTarget(target);
            renderer.render(ctx.scene.value, ctx.camera.value);
            return;
        }

        // Save current clear color and alpha
        const savedClearColor = renderer.getClearColor(new THREE.Color());
        const savedClearAlpha = renderer.getClearAlpha();
        const capMaskOverrides = applyCapMaskFilterOverrides(ctx.scene.value);

        try {
            // Render scene to filter target with transparent clear color
            renderer.setClearColor(0x000000, 0); // Clear to transparent black
            renderer.setRenderTarget(filterRenderTarget);
            renderer.clear(); // Explicitly clear the render target
            renderer.render(ctx.scene.value, ctx.camera.value);
        } finally {
            restoreCapMaskFilterOverrides(capMaskOverrides);
        }

        // Restore clear color and render filtered result to target
        renderer.setClearColor(savedClearColor, savedClearAlpha);
        renderer.setRenderTarget(target);
        renderer.render(filterScene, filterCamera);
    }

    function disposeRenderFilter() {
        filterRenderTarget?.dispose?.();
        filterRenderTarget = null;

        filterMaterial?.dispose?.();
        filterMaterial = null;

        if (filterQuad && filterScene) {
            filterScene.remove(filterQuad);
        }
        filterQuad = null;

        filterGeometry?.dispose?.();
        filterGeometry = null;

        filterScene = null;
        filterCamera = null;
        webGPUDeps = null;
    }

    return {
        initRenderFilter,
        renderScene,
        disposeRenderFilter,
    };
}