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
                    float luminance = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
                    gl_FragColor = vec4(vec3(luminance), color.a);
                }
            `,
            transparent: true,
            depthWrite: false,
            depthTest: false,
        });
    }

    function createWebGPUFilterMaterial(texture) {
        const { MeshBasicNodeMaterial } = webGPUDeps.threeWebGPU;
        const { texture: textureNode, uv, float, vec2, vec3, vec4, dot } = webGPUDeps.threeTSL;

        const material = new MeshBasicNodeMaterial();
        const baseUv = uv();
        const sampleUv = vec2(baseUv.x, float(1).sub(baseUv.y));
        const sampledColor = textureNode(texture, sampleUv);
        const luminance = dot(sampledColor.rgb, vec3(0.2126, 0.7152, 0.0722));

        material.colorNode = vec4(vec3(luminance, luminance, luminance), sampledColor.a);
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

        renderer.setRenderTarget(filterRenderTarget);
        renderer.render(ctx.scene.value, ctx.camera.value);

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