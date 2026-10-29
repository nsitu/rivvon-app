import * as THREE from 'three';
import { useRenderFilter } from '../src/composables/viewer/useRenderFilter.js';
import { applyRendererDisplayConfig } from '../src/modules/viewer/rendererConfig.js';
import { ARTWORK_BACKDROP_FLAG } from '../src/modules/viewer/artworkBlend.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const errors = [];
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
window.artworkBlendTest = (async () => {
    const report = [];
    for (const type of ['webgl', 'webgpu']) {
        const gpu = type === 'webgpu';
        const modules = gpu ? await Promise.all([import('three/webgpu'), import('three/tsl')]) : null;
        const renderer = gpu ? new modules[0].WebGPURenderer({ alpha: true, antialias: false })
            : new THREE.WebGLRenderer({ alpha: true, antialias: false, preserveDrawingBuffer: true });
        if (gpu) { await renderer.init(); renderer.backend.device.addEventListener('uncapturederror', event => errors.push(event.error.message)); }
        renderer.setPixelRatio(1); renderer.setSize(96, 64); applyRendererDisplayConfig(renderer, null, type);
        document.body.append(renderer.domElement);
        const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10);
        camera.position.z = 3;
        const app = { artworkBlendMode: 'softLight', renderFilterMode: 'none', renderAntialiasEnabled: false, contrast: 1, saturation: 1 };
        function material(rgb, alpha = 1, transparent = false) {
            if (gpu) {
                const result = new modules[0].MeshBasicNodeMaterial();
                const linear = new THREE.Color().setRGB(...rgb, THREE.SRGBColorSpace);
                result.colorNode = modules[1].vec4(modules[1].vec3(...linear.toArray()), alpha);
                result.transparent = transparent; return result;
            }
            return new THREE.ShaderMaterial({ transparent,
                vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
                fragmentShader: `void main(){gl_FragColor=vec4(${rgb.join(',')},${Number(alpha).toFixed(4)});}` });
        }
        const geometry = new THREE.PlaneGeometry(2, 2);
        const backdrop = new THREE.Mesh(geometry, material([.25, .5, .75])); backdrop.position.z = -1; backdrop.userData[ARTWORK_BACKDROP_FLAG] = true;
        const artwork = new THREE.Mesh(new THREE.PlaneGeometry(.8, .7), material([.75, .25, .5], .5, true)); artwork.position.y = .4;
        scene.add(backdrop, artwork);
        const filter = useRenderFilter({ app, renderer: { value: renderer }, scene: { value: scene }, camera: { value: camera } });
        await filter.initRenderFilter(type);
        async function pixel(x, y) {
            filter.renderScene();
            const copy = new OffscreenCanvas(renderer.domElement.width, renderer.domElement.height), context = copy.getContext('2d'); context.drawImage(renderer.domElement, 0, 0);
            return [...context.getImageData(x, y, 1, 1).data];
        }
        const close = (actual, expected, label, tolerance = 3) => assert(actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance), `${type} ${label}: ${actual} expected ${expected}`);
        try {
            const blended = await pixel(48, 19), background = await pixel(48, 48);
            close(blended, [80, 112, 191, 255], 'soft-light source-over');
            close(background, [64, 128, 191, 255], 'background orientation');
            backdrop.visible = false;
            const transparent = await pixel(48, 19);
            close(transparent, [191, 64, 128, 128], 'transparent backdrop');
            backdrop.visible = true;
            const previousBackdropMaterial = backdrop.material;
            backdrop.material = material([.25, .5, .75], .5); // Opaque material with partial alpha, like the scene background.
            const partial = await pixel(48, 19);
            // sa = ba = .5: premultiplied encoded RGB = [.34375, .28125, .5], alpha = .75.
            close(partial, [117, 96, 170, 191], 'partial-alpha backdrop');
            backdrop.material.dispose(); backdrop.material = previousBackdropMaterial;
            app.renderFilterMode = 'gradientMap'; app.gradientMapMix = 0;
            const filtered = await pixel(48, 19);
            close(filtered, blended, 'neutral post-filter');
            backdrop.visible = false;
            const filteredTransparent = await pixel(48, 19);
            close(filteredTransparent, transparent, 'transparent post-filter');
            backdrop.visible = true;
            app.renderFilterMode = 'none';
            renderer.setSize(192, 128);
            const resized = await pixel(96, 38); close(resized, blended, 'export-size framing');
            renderer.setSize(96, 64); close(await pixel(48, 19), blended, 'restored preview');
            const previousArtworkMaterial = artwork.material;
            artwork.material = material([.75, .25, .5]); artwork.material._hasCapMask = true; artwork.material.alphaToCoverage = true;
            const behind = new THREE.Mesh(artwork.geometry, material([.2, .8, .3])); behind.position.set(0, .4, -.5); scene.add(behind);
            const crossing = await pixel(48, 19);
            close(crossing, [96, 96, 191, 255], 'depth-tested crossing');
            assert(artwork.material.alphaToCoverage && !artwork.material.transparent, type + ' cap material was not restored');
            scene.remove(behind); behind.material.dispose(); artwork.material.dispose(); artwork.material = previousArtworkMaterial;
            app.artworkBlendMode = 'normal';
            const normal = await pixel(48, 19);
            assert(normal.some((v, i) => i < 3 && Math.abs(v - blended[i]) > 15), `${type}: Normal did not differ from Soft Light`);
            report.push({ renderer: type, blended, background, transparent, partial, filtered, filteredTransparent, resized, crossing, normal });
        } finally { filter.disposeRenderFilter(); geometry.dispose(); artwork.geometry.dispose(); artwork.material.dispose(); backdrop.material.dispose(); renderer.dispose(); }
    }
    assert(!errors.length, errors.join('\n'));
    console.log('[Artwork blend test] Passed');
    return report;
})();
