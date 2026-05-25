import { EventEmitter } from 'events';
import { getCached2dContext } from './samplingRuntime.js';

const CROSS_SECTION_PLANES = 'planes';
const SAMPLING_ROWS = 'rows';
const COPY_BYTES_ALIGNMENT = 256;
const WGSL_PI = '3.1415926535897932384626433832795';
const WORKGROUP_SIZE_X = 8;
const WORKGROUP_SIZE_Y = 8;

let sharedWebGPUContextPromise = null;

function createCanvasSurface(width, height) {
    if (typeof OffscreenCanvas !== 'undefined') {
        try {
            return new OffscreenCanvas(width, height);
        } catch (error) {
            console.warn('[WebGPUDirectArrayTileBuilder] OffscreenCanvas unavailable, falling back to DOM canvas:', error);
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
    sizes: vec4u,
    modes: vec4u,
    frame: vec4f,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var outputTexture: texture_storage_2d_array<rgba8unorm, write>;

const PI = ${WGSL_PI};

fn resolveSampleLocation(layerIndex: u32) -> f32 {
    let crossSectionCount = params.modes.x;
    let crossSectionType = params.modes.y;
    let distributionRange = params.frame.x;
    let frameIndex = params.frame.y;
    let frameCount = params.frame.z;

    if (crossSectionType == 0u) {
        if (crossSectionCount <= 1u) {
            return 0.5 * max(distributionRange - 1.0, 0.0);
        }

        let normalizedIndex = (f32(layerIndex) / f32(crossSectionCount - 1u)) * PI;
        return ((cos(normalizedIndex) + 1.0) * 0.5) * max(distributionRange - 1.0, 0.0);
    }

    let halfRange = distributionRange * 0.5;
    let phaseShift = (2.0 * PI * f32(layerIndex)) / f32(max(crossSectionCount, 1u));
    let omega = select(0.0, (2.0 * PI) / frameCount, frameCount > 0.0);
    let globalIndex = min(frameIndex, frameCount) - 1.0;
    let sampleLocation = halfRange * sin(omega * globalIndex + phaseShift) + halfRange;

    return clamp(sampleLocation, 0.0, max(distributionRange - 1.0, 0.0));
}

@compute @workgroup_size(${WORKGROUP_SIZE_X}, ${WORKGROUP_SIZE_Y}, 1)
fn csMain(@builtin(global_invocation_id) globalId: vec3<u32>) {
    let x = globalId.x;
    let layerIndex = globalId.y;
    let tileWidth = params.sizes.x;
    let tileHeight = params.sizes.y;
    let sourceWidth = params.sizes.z;
    let sourceHeight = params.sizes.w;
    let crossSectionCount = params.modes.x;
    let samplingMode = params.modes.z;
    let drawRow = params.modes.w;

    if (x >= tileWidth || layerIndex >= crossSectionCount || drawRow >= tileHeight) {
        return;
    }

    let localCoordX = (f32(x) + 0.5) / max(f32(tileWidth), 1.0);
    let sampleLocation = resolveSampleLocation(layerIndex);
    var sourcePixel: vec2f;

    if (samplingMode == 1u) {
        sourcePixel = vec2f(
            sampleLocation,
            (1.0 - localCoordX) * max(f32(sourceHeight) - 1.0, 0.0)
        );
    } else {
        sourcePixel = vec2f(
            localCoordX * max(f32(sourceWidth) - 1.0, 0.0),
            sampleLocation
        );
    }

    let sourceUv = (sourcePixel + vec2f(0.5, 0.5)) / vec2f(max(f32(sourceWidth), 1.0), max(f32(sourceHeight), 1.0));
    let color = textureSampleLevel(sourceTexture, sourceSampler, sourceUv, 0.0);
    textureStore(outputTexture, vec2i(i32(x), i32(drawRow)), i32(layerIndex), color);
}
`
    });
}

function buildSupportError(reason, extras = {}) {
    return {
        supported: false,
        reason,
        ...extras,
    };
}

function probeDirectArrayTextureSupport(device) {
    let sourceTexture = null;
    let arrayTexture = null;

    try {
        sourceTexture = device.createTexture({
            size: { width: 1, height: 1, depthOrArrayLayers: 1 },
            format: 'rgba8unorm',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        arrayTexture = device.createTexture({
            size: { width: 1, height: 1, depthOrArrayLayers: 1 },
            format: 'rgba8unorm',
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
        });

        sourceTexture.createView();
        arrayTexture.createView({ dimension: '2d-array' });
        return null;
    } catch (error) {
        return error?.message || 'WebGPU device rejected rgba8unorm source or array-texture usage needed for the direct-array path.';
    } finally {
        sourceTexture?.destroy?.();
        arrayTexture?.destroy?.();
    }
}

export class WebGPUDirectArrayTileBuilder extends EventEmitter {
    static async getSupportReport(settings) {
        try {
            const context = await getSharedWebGPUContext();
            if (!context?.device) {
                return buildSupportError('WebGPU is unavailable in this browser.');
            }

            const maxTextureSize = Number(context.device.limits?.maxTextureDimension2D) || 0;
            const maxTextureArrayLayers = Number(context.device.limits?.maxTextureArrayLayers) || 0;
            if (maxTextureSize <= 0) {
                return buildSupportError('WebGPU device did not report a usable maxTextureDimension2D limit.');
            }

            if (maxTextureArrayLayers <= 0) {
                return buildSupportError('WebGPU device did not report a usable maxTextureArrayLayers limit.', {
                    maxTextureSize,
                    maxTextureArrayLayers,
                });
            }

            const sourceWidth = Number(settings.fileInfo?.width) || 0;
            const sourceHeight = Number(settings.fileInfo?.height) || 0;
            const tileWidth = Number(settings.tilePlan?.width) || 0;
            const tileHeight = Number(settings.tilePlan?.height) || 0;
            const layerCount = Number(settings.crossSectionCount) || 0;

            if (sourceWidth < 1 || sourceHeight < 1) {
                return buildSupportError('Direct-array WebGPU assembly requires a valid scaled source frame size.', {
                    maxTextureSize,
                    maxTextureArrayLayers,
                });
            }

            if (tileWidth < 1 || tileHeight < 1 || layerCount < 1) {
                return buildSupportError('Direct-array WebGPU assembly requires a valid tile size and layer count.', {
                    maxTextureSize,
                    maxTextureArrayLayers,
                });
            }

            if (sourceWidth > maxTextureSize || sourceHeight > maxTextureSize) {
                return buildSupportError(
                    `Scaled source frame ${sourceWidth}x${sourceHeight} exceeds the WebGPU texture size limit (${maxTextureSize}px).`,
                    { maxTextureSize, maxTextureArrayLayers }
                );
            }

            if (tileWidth > maxTextureSize || tileHeight > maxTextureSize) {
                return buildSupportError(
                    `Output tile ${tileWidth}x${tileHeight} exceeds the WebGPU texture size limit (${maxTextureSize}px).`,
                    { maxTextureSize, maxTextureArrayLayers }
                );
            }

            if (layerCount > maxTextureArrayLayers) {
                return buildSupportError(
                    `Cross-section count ${layerCount} exceeds the WebGPU array-layer limit (${maxTextureArrayLayers}).`,
                    { maxTextureSize, maxTextureArrayLayers }
                );
            }

            const probeError = probeDirectArrayTextureSupport(context.device);
            if (probeError) {
                return buildSupportError(probeError, {
                    maxTextureSize,
                    maxTextureArrayLayers,
                });
            }

            return {
                supported: true,
                reason: `Array texture ${tileWidth}x${tileHeight}x${layerCount} is within WebGPU limits (${maxTextureSize}px, ${maxTextureArrayLayers} layers).`,
                maxTextureSize,
                maxTextureArrayLayers,
                device: context.device,
                arrayTexture: {
                    width: tileWidth,
                    height: tileHeight,
                    layerCount,
                },
                sourceTexture: {
                    width: sourceWidth,
                    height: sourceHeight,
                },
            };
        } catch (error) {
            return buildSupportError(error?.message || 'WebGPU support check failed.');
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
        if (!report?.supported || !report.device) {
            throw new Error(report?.reason || 'WebGPU direct-array tile builder is unavailable.');
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
        this._uploadCanvas = null;
        this._uploadCtx = null;
        this._loggedUploadFallback = false;

        this._previewCanvas = createCanvasSurface(tilePlan.width, tilePlan.height);
        this._previewCtx = getCached2dContext(this._previewCanvas);
        if (!this._previewCtx) {
            throw new Error('Unable to acquire a 2D context for the layer preview canvas.');
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
        this._arrayTexture = this._device.createTexture({
            size: {
                width: this._tileWidth,
                height: this._tileHeight,
                depthOrArrayLayers: this._crossSectionCount,
            },
            format: 'rgba8unorm',
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
        });
        this._arrayTextureView = this._arrayTexture.createView({ dimension: '2d-array' });
        this._sampler = this._device.createSampler({
            minFilter: 'linear',
            magFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });
        this._uniformBytes = new ArrayBuffer(48);
        this._uniformView = new DataView(this._uniformBytes);
        this._uniformBuffer = this._device.createBuffer({
            size: this._uniformBytes.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const shaderModule = createShaderModule(this._device);
        this._pipeline = this._device.createComputePipeline({
            layout: 'auto',
            compute: {
                module: shaderModule,
                entryPoint: 'csMain',
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
                {
                    binding: 3,
                    resource: this._arrayTextureView,
                },
            ],
        });

        this._setStaticUniforms(fileInfo);
    }

    _setStaticUniforms(fileInfo) {
        this._uniformView.setUint32(0, this._tileWidth, true);
        this._uniformView.setUint32(4, this._tileHeight, true);
        this._uniformView.setUint32(8, fileInfo.width, true);
        this._uniformView.setUint32(12, fileInfo.height, true);
        this._uniformView.setUint32(16, this._crossSectionCount, true);
        this._uniformView.setUint32(20, this._crossSectionType === CROSS_SECTION_PLANES ? 0 : 1, true);
        this._uniformView.setUint32(24, this._samplingMode === SAMPLING_ROWS ? 0 : 1, true);
        this._uniformView.setUint32(28, 0, true);
        this._uniformView.setFloat32(32, this._distributionRange, true);
        this._uniformView.setFloat32(36, 0, true);
        this._uniformView.setFloat32(40, this._frameCount, true);
        this._uniformView.setFloat32(44, 0, true);
        this._device.queue.writeBuffer(this._uniformBuffer, 0, this._uniformBytes);
    }

    _updateDynamicUniforms(drawLocation, frameNumber) {
        this._uniformView.setUint32(28, drawLocation, true);
        this._uniformView.setFloat32(36, frameNumber, true);
        this._device.queue.writeBuffer(this._uniformBuffer, 0, this._uniformBytes);
    }

    _ensureUploadFallback() {
        if (this._uploadCtx) {
            return;
        }

        const { width, height } = this.settings.fileInfo;
        this._uploadCanvas = createCanvasSurface(width, height);
        this._uploadCtx = getCached2dContext(this._uploadCanvas);
        if (!this._uploadCtx) {
            throw new Error('Unable to acquire a 2D context for the WebGPU upload fallback canvas.');
        }
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

        try {
            this._device.queue.copyExternalImageToTexture(
                { source: videoFrame, flipY: false },
                { texture: this._sourceTexture },
                { width, height, depthOrArrayLayers: 1 }
            );
            return;
        } catch (error) {
            this._ensureUploadFallback();
            this._uploadCtx.clearRect(0, 0, width, height);
            this._uploadCtx.drawImage(videoFrame, 0, 0, width, height);
            this._device.queue.copyExternalImageToTexture(
                { source: this._uploadCanvas, flipY: false },
                { texture: this._sourceTexture },
                { width, height, depthOrArrayLayers: 1 }
            );

            if (!this._loggedUploadFallback) {
                this._loggedUploadFallback = true;
                console.warn('[WebGPUDirectArrayTileBuilder] Falling back to upload canvas for source frame copies:', error);
            }
        }
    }

    _dispatchFrame(drawLocation, frameNumber) {
        this._updateDynamicUniforms(drawLocation, frameNumber);

        const encoder = this._device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(this._pipeline);
        pass.setBindGroup(0, this._bindGroup);
        pass.dispatchWorkgroups(
            Math.ceil(this._tileWidth / WORKGROUP_SIZE_X),
            Math.ceil(this._crossSectionCount / WORKGROUP_SIZE_Y),
            1
        );
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

        encoder.copyTextureToBuffer(
            {
                texture: this._arrayTexture,
                origin: { x: 0, y: 0, z: 0 },
            },
            {
                buffer: readbackBuffer,
                offset: 0,
                bytesPerRow,
                rowsPerImage: this._tileHeight,
            },
            {
                width: this._tileWidth,
                height: this._tileHeight,
                depthOrArrayLayers: this._crossSectionCount,
            }
        );

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
        // File-mode WebGPU direct-array tiles do not pool preview surfaces yet.
    }

    getCurrentPreviewCanvas() {
        return this._previewCanvas ?? null;
    }

    dispose() {
        this._sourceTexture?.destroy?.();
        this._arrayTexture?.destroy?.();
        this._uniformBuffer?.destroy?.();

        this._sourceTexture = null;
        this._sourceTextureView = null;
        this._arrayTexture = null;
        this._arrayTextureView = null;
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
            this._dispatchFrame(drawLocation, frameNumber);
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