import { EventEmitter } from 'events';
import { getCached2dContext } from './samplingRuntime.js';

const CROSS_SECTION_PLANES = 'planes';
const SAMPLING_ROWS = 'rows';
const COPY_BYTES_ALIGNMENT = 256;
const WGSL_PI = '3.1415926535897932384626433832795';

let sharedWebGPUContextPromise = null;

function createCanvasSurface(width, height) {
    if (typeof OffscreenCanvas !== 'undefined') {
        try {
            return new OffscreenCanvas(width, height);
        } catch (error) {
            console.warn('[WebGPUTileBuilder] OffscreenCanvas unavailable, falling back to DOM canvas:', error);
        }
    }

    if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    throw new Error('Canvas creation is unavailable in this environment.');
}

function buildAtlasLayout(tileWidth, tileHeight, layerCount, maxTextureSize) {
    if (!Number.isFinite(tileWidth) || !Number.isFinite(tileHeight) || !Number.isFinite(layerCount)) {
        return null;
    }

    if (tileWidth < 1 || tileHeight < 1 || layerCount < 1) {
        return null;
    }

    if (tileWidth > maxTextureSize || tileHeight > maxTextureSize) {
        return null;
    }

    const maxColumns = Math.max(1, Math.floor(maxTextureSize / tileWidth));
    const columns = Math.min(layerCount, maxColumns);
    const rows = Math.ceil(layerCount / columns);

    if (rows * tileHeight > maxTextureSize) {
        return null;
    }

    return {
        columns,
        rows,
        width: columns * tileWidth,
        height: rows * tileHeight,
    };
}

function getLayerCell(layout, layerIndex, tileWidth, tileHeight) {
    const column = layerIndex % layout.columns;
    const row = Math.floor(layerIndex / layout.columns);

    return {
        x: column * tileWidth,
        y: row * tileHeight,
    };
}

function disposeCanvas(canvas) {
    if (!canvas) {
        return;
    }

    if (typeof canvas.width === 'number') {
        canvas.width = 1;
    }

    if (typeof canvas.height === 'number') {
        canvas.height = 1;
    }
}

function alignTo(value, alignment) {
    return Math.ceil(value / alignment) * alignment;
}

async function getSharedWebGPUContext() {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
        return null;
    }

    if (!sharedWebGPUContextPromise) {
        sharedWebGPUContextPromise = (async () => {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                return null;
            }

            const device = await adapter.requestDevice();
            if (device?.lost) {
                device.lost
                    .catch(() => { })
                    .finally(() => {
                        sharedWebGPUContextPromise = null;
                    });
            }

            return { adapter, device };
        })().catch(error => {
            sharedWebGPUContextPromise = null;
            throw error;
        });
    }

    return sharedWebGPUContextPromise;
}

function createShaderModule(device) {
    return device.createShaderModule({
        code: /* wgsl */ `
struct Params {
    atlasSize: vec2f,
    tileSize: vec2f,
    atlasColumns: u32,
    crossSectionCount: u32,
    crossSectionType: u32,
    samplingMode: u32,
    distributionRange: f32,
    drawRow: f32,
    frameIndex: f32,
    frameCount: f32,
    sourceSize: vec2f,
    padding: vec2f,
};

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) localCoord: vec2f,
    @location(1) @interpolate(flat) sampleLocation: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;

const corners = array<vec2f, 6>(
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, 0.0),
    vec2f(1.0, 1.0)
);

fn resolveSampleLocation(layerIndex: u32) -> f32 {
    if (params.crossSectionType == 0u) {
        if (params.crossSectionCount <= 1u) {
            return 0.5 * max(params.distributionRange - 1.0, 0.0);
        }

        let normalizedIndex = (f32(layerIndex) / f32(params.crossSectionCount - 1u)) * ${WGSL_PI};
        return ((cos(normalizedIndex) + 1.0) * 0.5) * max(params.distributionRange - 1.0, 0.0);
    }

    let halfRange = params.distributionRange * 0.5;
    let phaseShift = (2.0 * ${WGSL_PI} * f32(layerIndex)) / f32(max(params.crossSectionCount, 1u));
    let omega = select(0.0, (2.0 * ${WGSL_PI}) / params.frameCount, params.frameCount > 0.0);
    let globalIndex = min(params.frameIndex, params.frameCount) - 1.0;
    let sampleLocation = halfRange * sin(omega * globalIndex + phaseShift) + halfRange;

    return clamp(sampleLocation, 0.0, max(params.distributionRange - 1.0, 0.0));
}

@vertex
fn vsMain(
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32,
) -> VertexOutput {
    let corner = corners[vertexIndex];
    let atlasColumns = max(params.atlasColumns, 1u);
    let column = instanceIndex % atlasColumns;
    let row = instanceIndex / atlasColumns;
    let cellOrigin = vec2f(
        f32(column) * params.tileSize.x,
        f32(row) * params.tileSize.y + params.drawRow
    );
    let pixelPosition = cellOrigin + vec2f(corner.x * params.tileSize.x, corner.y);
    let normalizedPosition = pixelPosition / params.atlasSize;

    var output: VertexOutput;
    output.position = vec4f(
        normalizedPosition.x * 2.0 - 1.0,
        1.0 - normalizedPosition.y * 2.0,
        0.0,
        1.0
    );
    output.localCoord = corner;
    output.sampleLocation = resolveSampleLocation(instanceIndex);
    return output;
}

@fragment
fn fsMain(input: VertexOutput) -> @location(0) vec4f {
    var sourcePixel: vec2f;

    if (params.samplingMode == 1u) {
        sourcePixel = vec2f(
            input.sampleLocation,
            (1.0 - input.localCoord.x) * max(params.sourceSize.y - 1.0, 0.0)
        );
    } else {
        sourcePixel = vec2f(
            input.localCoord.x * max(params.sourceSize.x - 1.0, 0.0),
            input.sampleLocation
        );
    }

    let sourceUv = (sourcePixel + vec2f(0.5, 0.5)) / params.sourceSize;
    return textureSampleLevel(sourceTexture, sourceSampler, sourceUv, 0.0);
}
`
    });
}

export class WebGPUTileBuilder extends EventEmitter {
    static async getSupportReport(settings) {
        try {
            const context = await getSharedWebGPUContext();
            if (!context?.device) {
                return {
                    supported: false,
                    reason: 'WebGPU is unavailable in this browser.',
                };
            }

            const maxTextureSize = Number(context.device.limits?.maxTextureDimension2D) || 0;
            if (maxTextureSize <= 0) {
                return {
                    supported: false,
                    reason: 'WebGPU device did not report a usable maxTextureDimension2D limit.',
                };
            }

            const layout = buildAtlasLayout(
                settings.tilePlan?.width,
                settings.tilePlan?.height,
                settings.crossSectionCount,
                maxTextureSize
            );

            if (!layout) {
                return {
                    supported: false,
                    reason: `Layer atlas would exceed the WebGPU texture size limit (${maxTextureSize}px).`,
                    maxTextureSize,
                };
            }

            const sourceWidth = settings.fileInfo?.width ?? 0;
            const sourceHeight = settings.fileInfo?.height ?? 0;
            if (sourceWidth > maxTextureSize || sourceHeight > maxTextureSize) {
                return {
                    supported: false,
                    reason: `Scaled source frame ${sourceWidth}x${sourceHeight} exceeds the WebGPU texture size limit (${maxTextureSize}px).`,
                    maxTextureSize,
                };
            }

            return {
                supported: true,
                reason: `Atlas ${layout.width}x${layout.height} within ${maxTextureSize}px WebGPU texture limit.`,
                maxTextureSize,
                layout,
                device: context.device,
            };
        } catch (error) {
            return {
                supported: false,
                reason: error?.message || 'WebGPU support check failed.',
            };
        }
    }

    constructor(settings) {
        super();
        this.settings = settings;

        const {
            fileInfo,
            samplingMode,
            crossSectionCount,
            crossSectionType,
            frameCount,
            tilePlan,
            supportReport = null,
        } = settings;

        const report = supportReport;
        if (!report?.supported || !report.layout || !report.device) {
            throw new Error(report?.reason || 'WebGPU tile builder is unavailable.');
        }

        this._device = report.device;
        this._distributionRange = samplingMode === SAMPLING_ROWS ? fileInfo.height : fileInfo.width;
        this._frameCount = Number(frameCount) || 0;
        this._samplingMode = samplingMode;
        this._crossSectionType = crossSectionType;
        this._crossSectionCount = crossSectionCount;
        this._tileWidth = tilePlan.width;
        this._tileHeight = tilePlan.height;
        this._tileNumber = settings.tileNumber;
        this._tileEndFrame = tilePlan.tiles[this._tileNumber].end;
        this._layout = report.layout;

        this._previewCanvas = createCanvasSurface(tilePlan.width, tilePlan.height);
        this._previewCtx = getCached2dContext(this._previewCanvas);
        if (!this._previewCtx) {
            throw new Error('Unable to acquire a 2D context for the layer preview canvas.');
        }

        this._uploadCanvas = createCanvasSurface(fileInfo.width, fileInfo.height);
        this._uploadCtx = getCached2dContext(this._uploadCanvas);
        if (!this._uploadCtx) {
            throw new Error('Unable to acquire a 2D context for the WebGPU upload canvas.');
        }

        if (tilePlan.rotate !== 0) {
            this._previewCtx.translate(tilePlan.width / 2, tilePlan.height / 2);
            this._previewCtx.rotate(tilePlan.rotate * Math.PI / 180);
            this._previewCtx.translate(-tilePlan.height / 2, -tilePlan.width / 2);
        }

        this._sourceTexture = this._device.createTexture({
            size: {
                width: fileInfo.width,
                height: fileInfo.height,
                depthOrArrayLayers: 1,
            },
            format: 'rgba8unorm',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this._sourceTextureView = this._sourceTexture.createView();
        this._atlasTexture = this._device.createTexture({
            size: {
                width: this._layout.width,
                height: this._layout.height,
                depthOrArrayLayers: 1,
            },
            format: 'rgba8unorm',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        this._atlasTextureView = this._atlasTexture.createView();
        this._sampler = this._device.createSampler({
            minFilter: 'linear',
            magFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });
        this._uniformBytes = new ArrayBuffer(64);
        this._uniformView = new DataView(this._uniformBytes);
        this._uniformBuffer = this._device.createBuffer({
            size: this._uniformBytes.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this._pipeline = this._device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: createShaderModule(this._device),
                entryPoint: 'vsMain',
            },
            fragment: {
                module: createShaderModule(this._device),
                entryPoint: 'fsMain',
                targets: [{ format: 'rgba8unorm' }],
            },
            primitive: {
                topology: 'triangle-list',
            },
        });
        this._bindGroup = this._device.createBindGroup({
            layout: this._pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this._uniformBuffer },
                },
                {
                    binding: 1,
                    resource: this._sampler,
                },
                {
                    binding: 2,
                    resource: this._sourceTextureView,
                },
            ],
        });

        this._setStaticUniforms(fileInfo);
        this._clearAtlasTexture();
    }

    _clearAtlasTexture() {
        const encoder = this._device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: this._atlasTextureView,
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });
        pass.end();
        this._device.queue.submit([encoder.finish()]);
    }

    _setStaticUniforms(fileInfo) {
        this._uniformView.setFloat32(0, this._layout.width, true);
        this._uniformView.setFloat32(4, this._layout.height, true);
        this._uniformView.setFloat32(8, this._tileWidth, true);
        this._uniformView.setFloat32(12, this._tileHeight, true);
        this._uniformView.setUint32(16, this._layout.columns, true);
        this._uniformView.setUint32(20, this._crossSectionCount, true);
        this._uniformView.setUint32(24, this._crossSectionType === CROSS_SECTION_PLANES ? 0 : 1, true);
        this._uniformView.setUint32(28, this._samplingMode === SAMPLING_ROWS ? 0 : 1, true);
        this._uniformView.setFloat32(32, this._distributionRange, true);
        this._uniformView.setFloat32(36, 0, true);
        this._uniformView.setFloat32(40, 0, true);
        this._uniformView.setFloat32(44, this._frameCount, true);
        this._uniformView.setFloat32(48, fileInfo.width, true);
        this._uniformView.setFloat32(52, fileInfo.height, true);
        this._uniformView.setFloat32(56, 0, true);
        this._uniformView.setFloat32(60, 0, true);
        this._device.queue.writeBuffer(this._uniformBuffer, 0, this._uniformBytes);
    }

    _updateDynamicUniforms(drawLocation, frameNumber) {
        this._uniformView.setFloat32(36, drawLocation, true);
        this._uniformView.setFloat32(40, frameNumber, true);
        this._device.queue.writeBuffer(this._uniformBuffer, 0, this._uniformBytes);
    }

    _resolvePreviewSampleLocation(frameNumber) {
        if (this._crossSectionType === CROSS_SECTION_PLANES) {
            if (this._crossSectionCount <= 1) {
                return 0.5 * (this._distributionRange - 1);
            }

            const normalizedIndex = 0;
            return ((Math.cos(normalizedIndex) + 1) / 2) * (this._distributionRange - 1);
        }

        const phaseShift = 0;
        const waveAmplitude = this._distributionRange / 2;
        const waveOffset = this._distributionRange / 2;
        const omega = this._frameCount ? (2 * Math.PI) / this._frameCount : 0;
        const globalIndex = Math.min(frameNumber, this._frameCount) - 1;
        const sampleLocation = waveAmplitude * Math.sin(omega * globalIndex + phaseShift) + waveOffset;
        return Math.max(0, Math.min(this._distributionRange - 1, sampleLocation));
    }

    _updatePreview(videoFrame, drawLocation, frameNumber) {
        const { fileInfo, tilePlan } = this.settings;
        const sampleLocation = this._resolvePreviewSampleLocation(frameNumber);

        if (this._samplingMode === 'columns') {
            this._previewCtx.drawImage(
                videoFrame,
                sampleLocation,
                0,
                1,
                fileInfo.height,
                drawLocation,
                0,
                1,
                tilePlan.width
            );
            return;
        }

        this._previewCtx.drawImage(
            videoFrame,
            0,
            sampleLocation,
            fileInfo.width,
            1,
            0,
            drawLocation,
            tilePlan.width,
            1
        );
    }

    _uploadSourceFrame(videoFrame) {
        const { width, height } = this.settings.fileInfo;

        this._uploadCtx.clearRect(0, 0, width, height);
        this._uploadCtx.drawImage(videoFrame, 0, 0, width, height);

        this._device.queue.copyExternalImageToTexture(
            { source: this._uploadCanvas, flipY: false },
            { texture: this._sourceTexture },
            { width, height, depthOrArrayLayers: 1 }
        );
    }

    _drawFrame(drawLocation, frameNumber) {
        this._updateDynamicUniforms(drawLocation, frameNumber);

        const encoder = this._device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: this._atlasTextureView,
                loadOp: 'load',
                storeOp: 'store',
            }],
        });
        pass.setPipeline(this._pipeline);
        pass.setBindGroup(0, this._bindGroup);
        pass.draw(6, this._crossSectionCount, 0, 0);
        pass.end();
        this._device.queue.submit([encoder.finish()]);
    }

    async _readImages() {
        const bytesPerPixelRow = this._tileWidth * 4;
        const bytesPerRow = alignTo(bytesPerPixelRow, COPY_BYTES_ALIGNMENT);
        const layerStride = bytesPerRow * this._tileHeight;
        const totalBytes = layerStride * this._crossSectionCount;
        const readbackBuffer = this._device.createBuffer({
            size: totalBytes,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const encoder = this._device.createCommandEncoder();

        for (let layerIndex = 0; layerIndex < this._crossSectionCount; layerIndex++) {
            const cell = getLayerCell(this._layout, layerIndex, this._tileWidth, this._tileHeight);

            encoder.copyTextureToBuffer(
                {
                    texture: this._atlasTexture,
                    origin: { x: cell.x, y: cell.y, z: 0 },
                },
                {
                    buffer: readbackBuffer,
                    offset: layerIndex * layerStride,
                    bytesPerRow,
                    rowsPerImage: this._tileHeight,
                },
                {
                    width: this._tileWidth,
                    height: this._tileHeight,
                    depthOrArrayLayers: 1,
                }
            );
        }

        this._device.queue.submit([encoder.finish()]);
        if (typeof this._device.queue.onSubmittedWorkDone === 'function') {
            await this._device.queue.onSubmittedWorkDone();
        }

        await readbackBuffer.mapAsync(GPUMapMode.READ);
        const mapped = new Uint8Array(readbackBuffer.getMappedRange());
        const images = [];

        for (let layerIndex = 0; layerIndex < this._crossSectionCount; layerIndex++) {
            const rgba = new Uint8Array(bytesPerPixelRow * this._tileHeight);
            const layerOffset = layerIndex * layerStride;

            for (let rowIndex = 0; rowIndex < this._tileHeight; rowIndex++) {
                const sourceOffset = layerOffset + (rowIndex * bytesPerRow);
                const targetOffset = rowIndex * bytesPerPixelRow;
                rgba.set(mapped.subarray(sourceOffset, sourceOffset + bytesPerPixelRow), targetOffset);
            }

            images.push({
                rgba,
                width: this._tileWidth,
                height: this._tileHeight,
            });
        }

        readbackBuffer.unmap();
        readbackBuffer.destroy();
        return images;
    }

    releaseCanvasSet() {
        // File-mode WebGPU tiles don't pool preview surfaces yet.
    }

    getCurrentPreviewCanvas() {
        return this._previewCanvas ?? null;
    }

    dispose() {
        this._sourceTexture?.destroy?.();
        this._atlasTexture?.destroy?.();
        this._uniformBuffer?.destroy?.();

        this._sourceTexture = null;
        this._sourceTextureView = null;
        this._atlasTexture = null;
        this._atlasTextureView = null;
        this._uniformBuffer = null;
        this._pipeline = null;
        this._bindGroup = null;
        this._sampler = null;
        this._device = null;
        this._uniformBytes = null;
        this._uniformView = null;
        disposeCanvas(this._previewCanvas);
        disposeCanvas(this._uploadCanvas);
        this._previewCanvas = null;
        this._previewCtx = null;
        this._uploadCanvas = null;
        this._uploadCtx = null;
        this.removeAllListeners();
    }

    processFrame(data) {
        const {
            videoFrame,
            frameNumber,
        } = data;

        const drawLocation = frameNumber - this.settings.tilePlan.tiles[this._tileNumber].start;

        try {
            this._uploadSourceFrame(videoFrame);
            this._drawFrame(drawLocation, frameNumber);
            this._updatePreview(videoFrame, drawLocation, frameNumber);
        } finally {
            videoFrame.close?.();
        }

        if (frameNumber === this._tileEndFrame) {
            this.emit('complete', {
                tileId: this._tileNumber,
                readImages: () => this._readImages(),
            });
        }
    }
}