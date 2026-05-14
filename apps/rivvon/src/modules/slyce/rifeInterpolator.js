import * as ort from 'onnxruntime-web/webgpu';
import {
    calculateProcessingSize,
    createPaddedCanvas,
    cropToOriginal,
    resizeImageData,
} from './rifePadding.js';
import { getRuntimeAssetUrl } from '../shared/runtimeAssets.js';

const DEFAULT_MODEL_PATH = getRuntimeAssetUrl('rife422Model');
const DEFAULT_WASM_PATH = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1/dist/';

export class RIFEInterpolator {
    constructor(options = {}) {
        this.session = null;
        this.modelPath = options.modelPath || DEFAULT_MODEL_PATH;
        this.maxDimension = options.maxDimension || 1280;
        this.alignment = options.alignment || 64;
        this.inputNames = [];
        this.outputNames = [];
        this.singleInputChannelCount = null;
        this.useFP16 = options.useFP16 ?? null;
    }

    float32ToFloat16(value) {
        const floatView = new Float32Array(1);
        const intView = new Uint32Array(floatView.buffer);

        floatView[0] = value;
        const input = intView[0];
        const sign = (input >> 31) & 0x1;
        const exp = (input >> 23) & 0xff;
        const frac = input & 0x7fffff;

        let newExp;
        let newFrac;

        if (exp === 0) {
            newExp = 0;
            newFrac = 0;
        } else if (exp === 0xff) {
            newExp = 0x1f;
            newFrac = frac ? 0x200 : 0;
        } else {
            const unbiasedExp = exp - 127;

            if (unbiasedExp < -14) {
                newExp = 0;
                newFrac = 0;
            } else if (unbiasedExp > 15) {
                newExp = 0x1f;
                newFrac = 0;
            } else {
                newExp = unbiasedExp + 15;
                newFrac = frac >> 13;
            }
        }

        return (sign << 15) | (newExp << 10) | newFrac;
    }

    async init() {
        if (this.session) {
            return this.session;
        }

        ort.env.wasm.wasmPaths = DEFAULT_WASM_PATH;
        ort.env.wasm.numThreads = 1;

        this.session = await ort.InferenceSession.create(this.modelPath, {
            executionProviders: ['webgpu', 'wasm'],
            preferredOutputLocation: 'gpu-buffer',
            logSeverityLevel: 2,
        });

        this.inputNames = this.session.inputNames;
        this.outputNames = this.session.outputNames;

        const firstInputName = this.inputNames[0];
        const inputMetadata = this.session.inputMetadata?.[firstInputName]
            || this.session.handler?.inputMetadata?.[firstInputName];
        const inputDimensions = inputMetadata?.dimensions
            || inputMetadata?.shape
            || inputMetadata?.dims;

        if (this.inputNames.length === 1 && Array.isArray(inputDimensions)) {
            const channelDimension = Number(inputDimensions[1]);
            this.singleInputChannelCount = Number.isFinite(channelDimension) ? channelDimension : null;
        }

        if (this.singleInputChannelCount === null && /rife422_v2_ensembleFalse_op20/i.test(this.modelPath)) {
            this.singleInputChannelCount = 7;
        }

        if (this.useFP16 === null) {
            const inputType = inputMetadata?.dataType;
            this.useFP16 = inputType === 'float16' || inputType === 10;
        }

        return this.session;
    }

    reset() {
        this.session?.release?.();
        this.session = null;
    }

    async videoFrameToImageData(videoFrame) {
        const width = videoFrame.displayWidth || videoFrame.codedWidth || videoFrame.width;
        const height = videoFrame.displayHeight || videoFrame.codedHeight || videoFrame.height;
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(videoFrame, 0, 0);
        return ctx.getImageData(0, 0, width, height);
    }

    imageDataToVideoFrame(imageData, timestamp = 0) {
        const canvas = new OffscreenCanvas(imageData.width, imageData.height);
        const ctx = canvas.getContext('2d');
        ctx.putImageData(imageData, 0, 0);
        return new VideoFrame(canvas, { timestamp });
    }

    imageDataToTensor(imageData) {
        const { width, height, data } = imageData;
        const size = 3 * height * width;

        if (this.useFP16) {
            const output = new Uint16Array(size);

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const srcIndex = (y * width + x) * 4;
                    const dstIndex = y * width + x;
                    output[dstIndex] = this.float32ToFloat16(data[srcIndex] / 255);
                    output[(height * width) + dstIndex] = this.float32ToFloat16(data[srcIndex + 1] / 255);
                    output[(2 * height * width) + dstIndex] = this.float32ToFloat16(data[srcIndex + 2] / 255);
                }
            }

            return new ort.Tensor('float16', output, [1, 3, height, width]);
        }

        const output = new Float32Array(size);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const srcIndex = (y * width + x) * 4;
                const dstIndex = y * width + x;
                output[dstIndex] = data[srcIndex] / 255;
                output[(height * width) + dstIndex] = data[srcIndex + 1] / 255;
                output[(2 * height * width) + dstIndex] = data[srcIndex + 2] / 255;
            }
        }

        return new ort.Tensor('float32', output, [1, 3, height, width]);
    }

    async tensorToImageData(tensor, width, height) {
        const data = await tensor.getData();
        const imageData = new ImageData(width, height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const dstIndex = (y * width + x) * 4;
                const srcIndex = y * width + x;
                imageData.data[dstIndex] = Math.min(255, Math.max(0, Math.round(data[srcIndex] * 255)));
                imageData.data[dstIndex + 1] = Math.min(255, Math.max(0, Math.round(data[(height * width) + srcIndex] * 255)));
                imageData.data[dstIndex + 2] = Math.min(255, Math.max(0, Math.round(data[(2 * height * width) + srcIndex] * 255)));
                imageData.data[dstIndex + 3] = 255;
            }
        }

        return imageData;
    }

    concatenateTensorsWithTimestep(tensor0, tensor1, timestep = 0.5) {
        const [batch, , height, width] = tensor0.dims;
        const channelSize = height * width;
        const isFP16 = tensor0.type === 'float16';

        if (isFP16) {
            const output = new Uint16Array(batch * 7 * channelSize);
            const timestepValue = this.float32ToFloat16(timestep);

            for (let channel = 0; channel < 3; channel++) {
                output.set(tensor0.data.subarray(channel * channelSize, (channel + 1) * channelSize), channel * channelSize);
                output.set(tensor1.data.subarray(channel * channelSize, (channel + 1) * channelSize), (channel + 3) * channelSize);
            }

            for (let index = 0; index < channelSize; index++) {
                output[(6 * channelSize) + index] = timestepValue;
            }

            return new ort.Tensor('float16', output, [batch, 7, height, width]);
        }

        const output = new Float32Array(batch * 7 * channelSize);

        for (let channel = 0; channel < 3; channel++) {
            output.set(tensor0.data.subarray(channel * channelSize, (channel + 1) * channelSize), channel * channelSize);
            output.set(tensor1.data.subarray(channel * channelSize, (channel + 1) * channelSize), (channel + 3) * channelSize);
        }

        for (let index = 0; index < channelSize; index++) {
            output[(6 * channelSize) + index] = timestep;
        }

        return new ort.Tensor('float32', output, [batch, 7, height, width]);
    }

    supportsExplicitTimestep() {
        return (
            (this.inputNames.length === 1 && this.inputNames[0] === 'input' && this.singleInputChannelCount === 7)
            || this.inputNames.includes('timestep')
            || this.inputNames.includes('t')
            || this.inputNames.includes('time')
        );
    }

    buildFeeds(tensor0, tensor1, timestep = 0.5) {
        const feeds = {};

        if (this.inputNames.length === 1 && this.inputNames[0] === 'input') {
            if (this.singleInputChannelCount !== null && this.singleInputChannelCount !== 7) {
                throw new Error(`Unsupported RIFE input format: expected 7 channels, received ${this.singleInputChannelCount}.`);
            }

            feeds.input = this.concatenateTensorsWithTimestep(tensor0, tensor1, timestep);
        } else if (this.inputNames.includes('img0') && this.inputNames.includes('img1')) {
            feeds.img0 = tensor0;
            feeds.img1 = tensor1;
        } else if (this.inputNames.length >= 2) {
            feeds[this.inputNames[0]] = tensor0;
            feeds[this.inputNames[1]] = tensor1;
        } else {
            throw new Error(`Unexpected RIFE inputs: ${this.inputNames.join(', ')}`);
        }

        if (this.inputNames.includes('timestep')) {
            feeds.timestep = new ort.Tensor('float32', [timestep], [1]);
        } else if (this.inputNames.includes('t')) {
            feeds.t = new ort.Tensor('float32', [timestep], [1]);
        } else if (this.inputNames.includes('time')) {
            feeds.time = new ort.Tensor('float32', [timestep], [1]);
        }

        return feeds;
    }

    async interpolateImageData(frame0, frame1, timestep = 0.5, options = {}) {
        await this.init();

        const sizeInfo = options.sizeInfo || calculateProcessingSize(
            frame0.width,
            frame0.height,
            this.maxDimension,
            this.alignment
        );

        let processedFrame0 = frame0;
        let processedFrame1 = frame1;

        if (sizeInfo.isDownscaled) {
            processedFrame0 = resizeImageData(frame0, sizeInfo.scaledWidth, sizeInfo.scaledHeight);
            processedFrame1 = resizeImageData(frame1, sizeInfo.scaledWidth, sizeInfo.scaledHeight);
        }

        const paddedFrame0 = createPaddedCanvas(processedFrame0, sizeInfo.paddedWidth, sizeInfo.paddedHeight);
        const paddedFrame1 = createPaddedCanvas(processedFrame1, sizeInfo.paddedWidth, sizeInfo.paddedHeight);
        const tensor0 = this.imageDataToTensor(paddedFrame0);
        const tensor1 = this.imageDataToTensor(paddedFrame1);
        const feeds = this.buildFeeds(tensor0, tensor1, timestep);
        const outputName = this.outputNames[0];
        const results = await this.session.run(feeds);

        let imageData = await this.tensorToImageData(results[outputName], sizeInfo.paddedWidth, sizeInfo.paddedHeight);
        imageData = cropToOriginal(imageData, sizeInfo.scaledWidth, sizeInfo.scaledHeight);

        if (sizeInfo.isDownscaled) {
            imageData = resizeImageData(imageData, sizeInfo.originalWidth, sizeInfo.originalHeight);
        }

        return imageData;
    }

    async interpolateVideoFrames(frame0, frame1, timestep = 0.5, outputTimestamp = 0) {
        const imageData0 = await this.videoFrameToImageData(frame0);
        const imageData1 = await this.videoFrameToImageData(frame1);
        const interpolatedImageData = await this.interpolateImageData(imageData0, imageData1, timestep);
        return this.imageDataToVideoFrame(interpolatedImageData, outputTimestamp);
    }

    async interpolateMidpoint(frame0, frame1, isVideoFrame = false, options = {}) {
        if (isVideoFrame) {
            return this.interpolateVideoFrames(frame0, frame1, 0.5);
        }

        return this.interpolateImageData(frame0, frame1, 0.5, options);
    }

    async interpolateMultipleMidpoint(frame0, frame1, numInterpolations = 1, isVideoFrame = false, options = {}) {
        if (numInterpolations <= 0) {
            return [];
        }

        const midpoint = await this.interpolateMidpoint(frame0, frame1, isVideoFrame, options);
        if (numInterpolations === 1) {
            return [midpoint];
        }

        const remainingInterpolations = numInterpolations - 1;
        const leftCount = Math.floor(remainingInterpolations / 2);
        const rightCount = remainingInterpolations - leftCount;
        const leftFrames = await this.interpolateMultipleMidpoint(frame0, midpoint, leftCount, isVideoFrame, options);
        const rightFrames = await this.interpolateMultipleMidpoint(midpoint, frame1, rightCount, isVideoFrame, options);

        return [...leftFrames, midpoint, ...rightFrames];
    }

    async interpolateMultiple(frame0, frame1, numInterpolations = 1, isVideoFrame = false, options = {}) {
        await this.init();

        if (numInterpolations <= 0) {
            return [];
        }

        if (!this.supportsExplicitTimestep()) {
            return this.interpolateMultipleMidpoint(frame0, frame1, numInterpolations, isVideoFrame, options);
        }

        const frames = [];

        for (let index = 1; index <= numInterpolations; index++) {
            const timestep = index / (numInterpolations + 1);

            if (isVideoFrame) {
                frames.push(await this.interpolateVideoFrames(frame0, frame1, timestep, options.outputTimestamp));
            } else {
                frames.push(await this.interpolateImageData(frame0, frame1, timestep, options));
            }
        }

        return frames;
    }
}