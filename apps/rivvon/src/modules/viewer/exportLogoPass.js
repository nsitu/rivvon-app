import {
    CanvasTexture, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial,
} from 'three';
import { getExportLogoOverlayLayout, loadExportLogoAsset, rasterizeExportLogo } from './exportLogoOverlay.js';

function createWebGLLogoPass(renderer, width, height, { canvas, x, y }) {
    const texture = new CanvasTexture(canvas);
    texture.premultiplyAlpha = true;
    texture.generateMipmaps = false;
    texture.minFilter = texture.magFilter;
    const material = new ShaderMaterial({
        uniforms: { logo: { value: texture } },
        vertexShader: `
            varying vec2 logoUv;
            void main() {
                logoUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D logo;
            varying vec2 logoUv;
            void main() { gl_FragColor = texture2D(logo, logoUv); }
        `,
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
    });
    const geometry = new PlaneGeometry(canvas.width, canvas.height);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x + canvas.width / 2, height - y - canvas.height / 2, -1);
    const camera = new OrthographicCamera(0, width, height, 0, 0, 2);
    const scene = new Scene();
    scene.add(mesh);

    return {
        render() {
            const autoClear = renderer.autoClear;
            renderer.autoClear = false;
            try {
                renderer.render(scene, camera);
            } finally {
                renderer.autoClear = autoClear;
            }
        },
        dispose() {
            geometry.dispose();
            material.dispose();
            texture.dispose();
        },
    };
}

function createWebGPULogoPass(renderer, width, height, { canvas, x, y }) {
    // Load the resolved, display-ready canvas after Three's output pass so the
    // logo blends in display space, including over partially transparent artwork.
    const context = renderer.getContext();
    const { device } = renderer.backend;
    const { format } = context.getCurrentTexture();
    const shader = device.createShaderModule({ code: `
        @group(0) @binding(0) var logo: texture_2d<f32>;

        @vertex fn vertexMain(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
            let positions = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
            return vec4f(positions[i], 0, 1);
        }

        @fragment fn fragmentMain(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
            return textureLoad(logo, vec2i(pixel.xy) - vec2i(${x}, ${y}), 0);
        }
    ` });
    const sourceOver = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' };
    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: shader, entryPoint: 'vertexMain' },
        fragment: { module: shader, entryPoint: 'fragmentMain', targets: [{ format, blend: { color: sourceOver, alpha: sourceOver } }] },
    });
    const size = [canvas.width, canvas.height];
    const texture = device.createTexture({
        size, format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: canvas }, { texture, premultipliedAlpha: true }, size);
    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture.createView() }],
    });
    const left = Math.max(0, x);
    const top = Math.max(0, y);
    const visibleWidth = Math.max(0, Math.min(width, x + canvas.width) - left);
    const visibleHeight = Math.max(0, Math.min(height, y + canvas.height) - top);

    return {
        render() {
            if (!visibleWidth || !visibleHeight) return;
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginRenderPass({ colorAttachments: [{
                view: context.getCurrentTexture().createView(), loadOp: 'load', storeOp: 'store',
            }] });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.setScissorRect(left, top, visibleWidth, visibleHeight);
            pass.draw(3);
            pass.end();
            device.queue.submit([encoder.finish()]);
        },
        dispose() { texture.destroy(); },
    };
}

export async function createExportLogoPass(renderer, width, height, enabled, corner) {
    const webgpu = renderer.backend?.isWebGPUBackend;
    if (!enabled || (!renderer.isWebGLRenderer && !webgpu)) return null;

    const { image, aspectRatio } = await loadExportLogoAsset();
    const layout = getExportLogoOverlayLayout(width, height, aspectRatio, corner);
    const raster = rasterizeExportLogo(image, layout);
    return webgpu ? createWebGPULogoPass(renderer, width, height, raster) : createWebGLLogoPass(renderer, width, height, raster);
}
