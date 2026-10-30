import * as THREE from 'three';
import { useSceneBackground } from '../src/composables/viewer/useSceneBackground.js';
import { useRenderFilter } from '../src/composables/viewer/useRenderFilter.js';
import { applyRendererDisplayConfig } from '../src/modules/viewer/rendererConfig.js';
import { ARTWORK_BACKDROP_FLAG } from '../src/modules/viewer/artworkBlend.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
// Independent reference colours for source [.75, .25, .5] over base [.25, .5, .75].
const blendReferences = {
    multiply: [.1875, .125, .375], screen: [.8125, .625, .875],
    overlay: [.375, .25, .75], difference: [.5, .25, .25],
};
const sourceRGB = [.75, .25, .5], baseRGB = [.25, .5, .75];
const expectedPixel = (blend, strength, sourceAlpha = .5, baseAlpha = 1, gpu = false) => {
    const alpha = sourceAlpha + baseAlpha * (1 - sourceAlpha);
    const full = blend.map((value, i) => (sourceAlpha * (1 - baseAlpha) * sourceRGB[i]
        + sourceAlpha * baseAlpha * value + (1 - sourceAlpha) * baseAlpha * baseRGB[i]) / alpha);
    let normal;
    if (gpu) {
        const source = new THREE.Color().setRGB(...sourceRGB, THREE.SRGBColorSpace).toArray();
        const base = new THREE.Color().setRGB(...baseRGB, THREE.SRGBColorSpace).toArray();
        normal = new THREE.Color().setRGB(...source.map((value, i) =>
            (value * sourceAlpha + base[i] * baseAlpha * (1 - sourceAlpha)) / alpha)).convertLinearToSRGB().toArray();
    } else {
        normal = sourceRGB.map((value, i) => (value * sourceAlpha + baseRGB[i] * baseAlpha * (1 - sourceAlpha)) / alpha);
    }
    return [...full.map((value, i) => Math.round(255 * (normal[i] * (1 - strength) + value * strength))), Math.round(alpha * 255)];
};
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
            app.artworkBlendMode = 'normal';
            const normalReference = await pixel(48, 19);
            const modeResults = [];
            for (const [mode, blend] of Object.entries(blendReferences)) {
                app.artworkBlendMode = mode;
                for (const strength of [0, .5, 1]) {
                    app.artworkBlendStrength = strength;
                    const expected = expectedPixel(blend, strength, .5, 1, gpu);
                    close(await pixel(48, 19), expected, `${mode} ${strength} source-over`);
                    if (strength === 0) close(await pixel(48, 19), normalReference, `${mode} zero strength matches Normal`);
                    app.renderFilterMode = 'gradientMap'; app.gradientMapMix = 0;
                    close(await pixel(48, 19), expected, `${mode} ${strength} neutral post-filter`);
                    app.renderFilterMode = 'none';
                    backdrop.visible = false;
                    close(await pixel(48, 19), expectedPixel(blend, strength, .5, 0, gpu), `${mode} ${strength} transparent backdrop`);
                    backdrop.visible = true;
                    const original = backdrop.material;
                    backdrop.material = material(baseRGB, .5);
                    close(await pixel(48, 19), expectedPixel(blend, strength, .5, .5, gpu), `${mode} ${strength} partial backdrop`);
                    backdrop.material.dispose(); backdrop.material = original;
                    // Exercise the actual offscreen export route, then display its texture.
                    const Target = gpu ? THREE.RenderTarget : THREE.WebGLRenderTarget;
                    const target = new Target(192, 128, { colorSpace: renderer.outputColorSpace });
                    const outputMaterial = gpu ? new modules[0].MeshBasicNodeMaterial() : new THREE.MeshBasicMaterial({ map: target.texture });
                    if (gpu) {
                        const { texture, uv, vec2, float } = modules[1], coordinates = uv();
                        outputMaterial.colorNode = texture(target.texture, vec2(coordinates.x, float(1).sub(coordinates.y)));
                    }
                    outputMaterial.toneMapped = false;
                    const outputScene = new THREE.Scene(), quad = new THREE.Mesh(geometry, outputMaterial); outputScene.add(quad);
                    filter.renderScene(target); renderer.setRenderTarget(null);
                    renderer.render(outputScene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
                    const copy = new OffscreenCanvas(96, 64), context = copy.getContext('2d'); context.drawImage(renderer.domElement, 0, 0);
                    close([...context.getImageData(48, 19, 1, 1).data], expected, `${mode} ${strength} export target`);
                    target.dispose(); outputMaterial.dispose();
                    close(await pixel(48, 19), expected, `${mode} ${strength} restored preview`);
                }
                modeResults.push(mode);
            }
            app.artworkBlendMode = 'softLight'; app.artworkBlendStrength = 1;
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
            report.push({ renderer: type, modeResults, blended, background, transparent, partial, filtered, filteredTransparent, resized, crossing, normal });
        } finally { filter.disposeRenderFilter(); geometry.dispose(); artwork.geometry.dispose(); artwork.material.dispose(); backdrop.material.dispose(); }

        // Real background paths: sharp, blurred and gradient, with a translucent image.
        const backgroundScene = new THREE.Scene(), backgroundCamera = new THREE.PerspectiveCamera(40, 1.5, .1, 100);
        const tile = new THREE.DataArrayTexture(new Uint8Array([64, 128, 191, 255]), 1, 1, 1);
        tile.needsUpdate = true;
        const backgroundApp = { rendererType: type, backgroundBaseEnabled: false,
            backgroundOverlayEnabled: true, backgroundOverlayColor: '#4080bf', backgroundOverlayOpacity: 1,
            backgroundTextureEnabled: true, backgroundTexture: 'card' };
        const backgroundCtx = { app: backgroundApp, renderer: { value: renderer }, scene: { value: backgroundScene },
            camera: { value: backgroundCamera }, backgroundTexture: { value: null }, getBackgroundTime: () => 0,
            tileManager: { value: { arrayTextures: [tile], variant: 'waves', currentLayer: 0, getLayerCount: () => 1, getSeamlessLoopDuration: () => 12 } } };
        const runtime = useSceneBackground(backgroundCtx), load = THREE.TextureLoader.prototype.load;
        THREE.TextureLoader.prototype.load = function(_url, onLoad) {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d'); context.fillStyle = 'rgba(191,64,128,0.5)'; context.fillRect(0, 0, 1, 1);
            const texture = new THREE.CanvasTexture(canvas); onLoad(texture); return texture;
        };
        try {
            for (const path of ['sharp', 'blurred', 'gradient']) {
                backgroundApp.backgroundMode = path === 'gradient' ? 'gradient' : 'texture';
                backgroundApp.backgroundBlurEnabled = path === 'blurred';
                await runtime.setBackgroundFromTileManager({ opacity: 1 });
                for (const mode of Object.keys(blendReferences)) {
                    backgroundApp.backgroundTextureBlendMode = mode;
                    for (const strength of [0, .5, 1]) {
                        backgroundApp.backgroundTextureBlendStrength = strength;
                        for (const options of [{}, { blurMode: 'export', width: 192, height: 128 }, {}]) {
                            runtime.updateBackground({ timeSeconds: 0, ...options });
                            renderer.setRenderTarget(null); renderer.render(backgroundScene, backgroundCamera);
                            const copy = new OffscreenCanvas(96, 64), context = copy.getContext('2d'); context.drawImage(renderer.domElement, 0, 0);
                            // Backgrounds retain their existing linear texture/tint treatment.
                            const base = new THREE.Color('#4080bf').toArray(), source = new THREE.Color('#bf4080').toArray();
                            const functions = { multiply: (b, s) => b * s, screen: (b, s) => b + s - b * s,
                                overlay: (b, s) => b < .5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s), difference: (b, s) => Math.abs(b - s) };
                            const result = base.map((b, i) => b * .5 + .5 * (source[i] * (1 - strength) + functions[mode](b, source[i]) * strength));
                            const displayed = new THREE.Color().setRGB(...result);
                            if (gpu) displayed.convertLinearToSRGB();
                            close([...context.getImageData(48, 32, 1, 1).data], [...displayed.toArray().map(v => Math.round(v * 255)), 255], `${path} background ${mode} ${strength}`);
                        }

                    }
                }
            }
        } finally { THREE.TextureLoader.prototype.load = load; runtime.disposeBackground(); tile.dispose(); renderer.dispose(); }

    }
    assert(!errors.length, errors.join('\n'));
    console.log('[Artwork blend test] Passed');
    return report;
})();
