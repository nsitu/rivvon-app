import bwdifShader from './bwdif.wgsl?raw';

const renderShader = /* wgsl */ `
struct Params { width:u32, height:u32, field:u32, intra:u32 }
@group(0) @binding(0) var<storage, read> image:array<u32>;
@group(0) @binding(1) var<uniform> p:Params;
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
    let x=f32((i<<1u)&2u);let y=f32(i&2u);
    return vec4f(x*2.0-1.0,y*2.0-1.0,0,1);
}
fn chroma(plane:u32, pos:vec2f)->f32 {
    let size=vec2i(i32(p.width/2u),i32(p.height/2u));
    let base=vec2i(floor(pos));let f=fract(pos);
    let offset=p.width*p.height+plane*(p.width*p.height/4u);
    let a=clamp(base,vec2i(0),size-1);let b=clamp(base+vec2i(1),vec2i(0),size-1);
    let tl=f32(image[offset+u32(a.y)*u32(size.x)+u32(a.x)]);
    let tr=f32(image[offset+u32(a.y)*u32(size.x)+u32(b.x)]);
    let bl=f32(image[offset+u32(b.y)*u32(size.x)+u32(a.x)]);
    let br=f32(image[offset+u32(b.y)*u32(size.x)+u32(b.x)]);
    return mix(mix(tl,tr,f.x),mix(bl,br,f.x),f.y);
}
@fragment fn fragment(@builtin(position) pos:vec4f)->@location(0) vec4f {
    let x=u32(pos.x);let y=u32(pos.y);
    let luma=(f32(image[y*p.width+x])-16.0)/219.0;
    // Reconstruct native interlaced chroma before any RGB conversion/scaling.
    let uv=vec2f(f32(x)*0.5,(f32(y)-0.5)*0.5);
    let cb=(chroma(0u,uv)-128.0)/224.0;let cr=(chroma(1u,uv)-128.0)/224.0;
    return vec4f(clamp(vec3f(luma+1.5748*cr,luma-0.187324*cb-0.468124*cr,luma+1.8556*cb),vec3f(0),vec3f(1)),1);
}`;

/** Three reusable native-YUV slots; reconstructed images never read back to JS. */
export class GpuBwdif {
    static async create(width, height) {
        if (!navigator.gpu) throw new Error('Sony A7 interlaced video requires WebGPU for high-quality deinterlacing.');
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error('A WebGPU adapter is required for Sony A7 deinterlacing.');
        const device = await adapter.requestDevice();
        const instance = new GpuBwdif(device, width, height);
        try { await instance.init(); return instance; }
        catch (error) { instance.dispose(); throw error; }
    }

    constructor(device, width, height) {
        this.device = device; this.width = width; this.height = height;
        this.byteCount = width * height * 3 / 2;
        this.bytes = new Uint8Array(this.byteCount);
        this.pixels = new Uint32Array(this.byteCount);
        this.slots = [];
        this.failure = null;
        device.addEventListener('uncapturederror', event => { this.failure = event.error; });
        device.lost.then(info => { this.failure = new Error(`Deinterlacing GPU device lost: ${info.message || info.reason}`); });
    }

    async init() {
        const device = this.device;
        device.pushErrorScope('validation');
        const shader = device.createShaderModule({ code: bwdifShader });
        this.compute = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: shader, entryPoint: 'main' } });
        this.canvas = new OffscreenCanvas(this.width, this.height);
        this.context = this.canvas.getContext('webgpu');
        if (!this.context) throw new Error('Unable to create the deinterlacing GPU canvas.');
        const format = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({ device, format, alphaMode: 'opaque', colorSpace: 'srgb' });
        const render = device.createShaderModule({ code: renderShader });
        this.render = await device.createRenderPipelineAsync({
            layout: 'auto', vertex: { module: render, entryPoint: 'vertex' },
            fragment: { module: render, entryPoint: 'fragment', targets: [{ format }] },
        });
        for (let i = 0; i < 3; i++) this.slots.push(device.createBuffer({ size: this.byteCount * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }));
        this.output = device.createBuffer({ size: this.byteCount * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        this.params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.renderBindings = device.createBindGroup({ layout: this.render.getBindGroupLayout(0), entries: [
            { binding: 0, resource: { buffer: this.output } }, { binding: 1, resource: { buffer: this.params } },
        ] });
        const error = await device.popErrorScope();
        if (error) throw error;
    }

    async upload(frame, slot) {
        this.check();
        if (frame.format !== 'I420' || frame.visibleRect.width !== this.width || frame.visibleRect.height !== this.height) {
            throw new Error('The browser did not produce the expected 8-bit 1920×1080 YUV frames for Sony A7 deinterlacing.');
        }
        const ySize = this.width * this.height;
        await frame.copyTo(this.bytes, { rect: frame.visibleRect, layout: [
            { offset: 0, stride: this.width }, { offset: ySize, stride: this.width / 2 },
            { offset: ySize * 5 / 4, stride: this.width / 2 },
        ] });
        this.check();
        this.pixels.set(this.bytes);
        this.device.queue.writeBuffer(this.slots[slot], 0, this.pixels);
        this.check();
    }

    check() {
        if (this.disposed) throw new DOMException('Deinterlacing stopped.', 'AbortError');
        if (this.failure) throw this.failure;
    }

    async frame(previous, current, next, field, intra, timestamp, duration) {
        this.check();
        const device = this.device;
        device.queue.writeBuffer(this.params, 0, new Uint32Array([this.width, this.height, field, Number(intra)]));
        const bindings = device.createBindGroup({ layout: this.compute.getBindGroupLayout(0), entries: [
            ...[previous, current, next].map((slot, binding) => ({ binding, resource: { buffer: this.slots[slot] } })),
            { binding: 3, resource: { buffer: this.output } }, { binding: 4, resource: { buffer: this.params } },
        ] });
        const encoder = device.createCommandEncoder();
        const compute = encoder.beginComputePass();
        compute.setPipeline(this.compute); compute.setBindGroup(0, bindings);
        compute.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8), 3); compute.end();
        const render = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
        render.setPipeline(this.render); render.setBindGroup(0, this.renderBindings); render.draw(3); render.end();
        device.queue.submit([encoder.finish()]);
        // A bounded fence also ensures validation/device failures surface before
        // advancing progress. No reconstructed pixel data crosses back to JS.
        await device.queue.onSubmittedWorkDone();
        this.check();
        return new VideoFrame(this.canvas, { timestamp, duration });
    }

    dispose() {
        this.disposed = true;
        this.context?.unconfigure();
        for (const slot of this.slots) slot.destroy();
        this.output?.destroy(); this.params?.destroy(); this.device.destroy();
    }
}
