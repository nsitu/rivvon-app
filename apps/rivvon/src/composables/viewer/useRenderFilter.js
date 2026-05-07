import * as THREE from 'three';

export function useRenderFilter(ctx) {
    let activeRendererType = 'webgl';
    let webGPUDeps = null;
    const duotoneColor = new THREE.Color();

    let filterScene = null;
    let filterCamera = null;
    let filterGeometry = null;
    let filterQuad = null;
    let filterMaterial = null;
    let filterRenderTarget = null;
    let filterMaterialSignature = null;
    let filterMaterialTexture = null;

    function getActiveFilterMode() {
        return ctx.app.renderFilterMode === 'blackAndWhite'
            || ctx.app.renderFilterMode === 'duotone'
            ? ctx.app.renderFilterMode
            : 'none';
    }

    function isTransparentShadowsEnabled() {
        return ctx.app.transparentShadowsEnabled === true;
    }

    function getPostProcessFilterMode() {
        const mode = getActiveFilterMode();
        return mode === 'blackAndWhite' || mode === 'duotone'
            ? mode
            : 'none';
    }

    function getDuotoneColorValues() {
        duotoneColor.set(ctx.app.duotoneColor || '#ff7a00');
        return [duotoneColor.r, duotoneColor.g, duotoneColor.b]
            .map((value) => Number(value).toFixed(8))
            .join(', ');
    }

    function getFilterMaterialSignature() {
        const mode = getPostProcessFilterMode();
        return mode === 'duotone'
            ? `${mode}:${ctx.app.duotoneColor || '#ff7a00'}`
            : mode;
    }

    function shouldApplyFilter() {
        return getPostProcessFilterMode() !== 'none';
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
        const filterMode = getPostProcessFilterMode();
        const filteredColorExpression = filterMode === 'duotone'
            ? `mix(vec3(0.0), vec3(${getDuotoneColorValues()}), luminance)`
            : 'vec3(luminance)';

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
                    vec3 filteredColor = ${filteredColorExpression};
                    vec3 premultipliedFiltered = filteredColor * alpha;
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
        const { texture: textureNode, uv, float, vec2, vec3, vec4, dot, max, mix } = webGPUDeps.threeTSL;
        const [duotoneRed, duotoneGreen, duotoneBlue] = getDuotoneColorValues()
            .split(', ')
            .map((value) => Number(value));
        const filterMode = getPostProcessFilterMode();

        const material = new MeshBasicNodeMaterial();
        const baseUv = uv();
        const sampleUv = vec2(baseUv.x, float(1).sub(baseUv.y));
        const sampledColor = textureNode(texture, sampleUv);
        const alpha = sampledColor.a;
        const safeAlpha = max(alpha, float(0.00001));
        const unpremultiplied = sampledColor.rgb.div(safeAlpha);
        const luminance = dot(unpremultiplied, vec3(0.2126, 0.7152, 0.0722));
        const grayscale = vec3(luminance, luminance, luminance);
        const filteredBase = filterMode === 'duotone'
            ? mix(vec3(0.0, 0.0, 0.0), vec3(duotoneRed, duotoneGreen, duotoneBlue), luminance)
            : grayscale;
        const premultipliedFiltered = filteredBase.mul(alpha);

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

        const nextSignature = getFilterMaterialSignature();

        if (!filterQuad) {
            filterQuad = new THREE.Mesh(filterGeometry, null);
            filterQuad.frustumCulled = false;
            filterScene.add(filterQuad);
        }

        const needsNewMaterial = !filterMaterial
            || filterMaterialSignature !== nextSignature
            || filterMaterialTexture !== texture;

        if (!needsNewMaterial) {
            return true;
        }

        if (activeRendererType === 'webgpu') {
            filterMaterial?.dispose?.();
            filterMaterial = createWebGPUFilterMaterial(texture);
            filterQuad.material = filterMaterial;
            filterMaterialSignature = nextSignature;
            filterMaterialTexture = texture;
            return true;
        }

        filterMaterial?.dispose?.();
        filterMaterial = createWebGLFilterMaterial(texture);
        filterQuad.material = filterMaterial;
        filterMaterialSignature = nextSignature;
        filterMaterialTexture = texture;
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
        }

        return ensureFilterQuad(filterRenderTarget.texture);
    }

    function syncTransparentShadowsMaterials(scene) {
        const enabled = isTransparentShadowsEnabled();

        scene.traverse((obj) => {
            const materials = Array.isArray(obj.material)
                ? obj.material
                : (obj.material ? [obj.material] : []);

            materials.forEach((material) => {
                if (!material?._transparentShadowsUniform) {
                    return;
                }

                material._transparentShadowsUniform.value = enabled ? 1 : 0;

                const original = material._transparentShadowsOriginalState || {
                    transparent: material.transparent,
                    depthWrite: material.depthWrite,
                    alphaToCoverage: material.alphaToCoverage,
                };

                const nextTransparent = enabled ? true : original.transparent;
                const nextDepthWrite = enabled ? false : original.depthWrite;
                const nextAlphaToCoverage = enabled ? false : original.alphaToCoverage;

                if (
                    material.transparent !== nextTransparent
                    || material.depthWrite !== nextDepthWrite
                    || material.alphaToCoverage !== nextAlphaToCoverage
                ) {
                    material.transparent = nextTransparent;
                    material.depthWrite = nextDepthWrite;
                    material.alphaToCoverage = nextAlphaToCoverage;
                    material.needsUpdate = true;
                }
            });
        });
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

        syncTransparentShadowsMaterials(ctx.scene.value);

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
        filterMaterialSignature = null;
        filterMaterialTexture = null;

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