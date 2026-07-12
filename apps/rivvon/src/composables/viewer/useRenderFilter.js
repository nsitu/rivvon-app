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
    let filterContrastUniform = null;
    let filterSaturationUniform = null;

    function getActiveFilterMode() {
        return ctx.app.renderFilterMode === 'duotone'
            ? ctx.app.renderFilterMode
            : 'none';
    }

    function isTransparentShadowsEnabled() {
        return ctx.app.transparentShadowsEnabled === true;
    }

    function isPeakTroughTransparencyEnabled() {
        return ctx.app.peakTroughTransparencyEnabled === true
            && ctx.app.activeTextureCrossSectionType === 'waves';
    }

    function getContrastValue() {
        const value = Number(ctx.app.contrast);
        return Number.isFinite(value) ? Math.min(2, Math.max(0, value)) : 1;
    }

    function getSaturationValue() {
        const value = Number(ctx.app.saturation);
        return Number.isFinite(value) ? Math.min(2, Math.max(0, value)) : 1;
    }

    function isTransparencyHighlightsMode() {
        return ctx.app.transparencyMode === 'highlights';
    }

    function getTransparentShadowsThresholds() {
        const min = Number(ctx.app.transparentShadowsThresholdMin);
        const max = Number(ctx.app.transparentShadowsThresholdMax);

        return {
            min: Number.isFinite(min) ? Math.min(1, Math.max(0, min)) : 0.2,
            max: Number.isFinite(max) ? Math.min(1, Math.max(0, max)) : 0.5,
        };
    }

    function getPostProcessFilterMode() {
        const mode = getActiveFilterMode();
        return mode === 'duotone'
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
            ? `mix(vec3(0.0), vec3(${getDuotoneColorValues()}), filteredLuminance)`
            : 'contrasted';

        return new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: texture },
                uContrast: { value: getContrastValue() },
                uSaturation: { value: getSaturationValue() },
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
                uniform float uContrast;
                uniform float uSaturation;
                varying vec2 vUv;

                void main() {
                    vec4 color = texture2D(tDiffuse, vUv);

                    float alpha = color.a;
                    vec3 unpremultiplied = alpha > 0.0 ? (color.rgb / alpha) : vec3(0.0);

                    float luminance = dot(unpremultiplied, vec3(0.2126, 0.7152, 0.0722));

                    vec3 saturated = mix(vec3(luminance), unpremultiplied, uSaturation);
                    vec3 contrasted = (saturated - 0.5) * uContrast + 0.5;
                    float filteredLuminance = dot(contrasted, vec3(0.2126, 0.7152, 0.0722));

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
        const { texture: textureNode, uniform, uv, float, vec2, vec3, vec4, dot, max, mix } = webGPUDeps.threeTSL;
        const [duotoneRed, duotoneGreen, duotoneBlue] = getDuotoneColorValues()
            .split(', ')
            .map((value) => Number(value));
        const filterMode = getPostProcessFilterMode();
        const contrastValue = getContrastValue();
        const saturationValue = getSaturationValue();

        const material = new MeshBasicNodeMaterial();
        const baseUv = uv();
        const sampleUv = vec2(baseUv.x, float(1).sub(baseUv.y));
        const sampledColor = textureNode(texture, sampleUv);
        const contrastUniform = uniform(float(contrastValue));
        const saturationUniform = uniform(float(saturationValue));
        const alpha = sampledColor.a;
        const safeAlpha = max(alpha, float(0.00001));
        const unpremultiplied = sampledColor.rgb.div(safeAlpha);
        const luminance = dot(unpremultiplied, vec3(0.2126, 0.7152, 0.0722));
        const saturated = mix(vec3(luminance, luminance, luminance), unpremultiplied, saturationUniform);
        const contrasted = saturated.sub(vec3(0.5)).mul(contrastUniform).add(vec3(0.5));
        const filteredLuminance = dot(contrasted, vec3(0.2126, 0.7152, 0.0722));
        const grayscale = vec3(filteredLuminance, filteredLuminance, filteredLuminance);

        let filteredBase;
        if (filterMode === 'duotone') {
            filteredBase = mix(vec3(0.0, 0.0, 0.0), vec3(duotoneRed, duotoneGreen, duotoneBlue), filteredLuminance);
        } else {
            filteredBase = contrasted;
        }

        const premultipliedFiltered = filteredBase.mul(alpha);

    filterContrastUniform = contrastUniform;
    filterSaturationUniform = saturationUniform;
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
        const peakTroughEnabled = isPeakTroughTransparencyEnabled();
        const useHighlights = isTransparencyHighlightsMode();
        const { min, max } = getTransparentShadowsThresholds();

        scene.traverse((obj) => {
            const materials = Array.isArray(obj.material)
                ? obj.material
                : (obj.material ? [obj.material] : []);

            materials.forEach((material) => {
                if (!material?._transparentShadowsUniform) {
                    return;
                }

                material._transparentShadowsUniform.value = enabled ? 1 : 0;
                if (material._peakTroughTransparencyUniform) {
                    material._peakTroughTransparencyUniform.value = peakTroughEnabled ? 1 : 0;
                }
                if (material._transparentHighlightsUniform) {
                    material._transparentHighlightsUniform.value = useHighlights ? 1 : 0;
                }
                if (material._transparentShadowsMinUniform) {
                    material._transparentShadowsMinUniform.value = min;
                }
                if (material._transparentShadowsMaxUniform) {
                    material._transparentShadowsMaxUniform.value = max;
                }

                const original = material._transparentShadowsOriginalState || {
                    transparent: material.transparent,
                    depthWrite: material.depthWrite,
                    alphaToCoverage: material.alphaToCoverage,
                };

                const hasTransparencyEffect = enabled || peakTroughEnabled;
                const nextTransparent = hasTransparencyEffect ? true : original.transparent;
                const nextDepthWrite = hasTransparencyEffect ? false : original.depthWrite;
                const nextAlphaToCoverage = hasTransparencyEffect ? false : original.alphaToCoverage;

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

        if (filterMaterial?.uniforms?.uContrast) {
            filterMaterial.uniforms.uContrast.value = getContrastValue();
        }
        if (filterMaterial?.uniforms?.uSaturation) {
            filterMaterial.uniforms.uSaturation.value = getSaturationValue();
        }
        if (filterContrastUniform) {
            filterContrastUniform.value = getContrastValue();
        }
        if (filterSaturationUniform) {
            filterSaturationUniform.value = getSaturationValue();
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
        filterContrastUniform = null;
        filterSaturationUniform = null;

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
