import { Input, ALL_FORMATS, BlobSource, VideoSampleSink } from 'mediabunny';
import { RealtimeCamera } from './realtimeCamera.js';
import { createLazyLoader } from '../shared/lazyLoader.js';

const loadRifeInterpolator = createLazyLoader(async () => {
    const { RIFEInterpolator } = await import('./rifeInterpolator.js');
    const interpolator = new RIFEInterpolator();
    await interpolator.init();
    return interpolator;
});

function resolveInterpolationFactor(value) {
    const factor = Number(value) || 1;
    return Number.isFinite(factor) && factor >= 1 ? Math.round(factor) : 1;
}

function getNominalFrameDuration(fileInfo) {
    const duration = Number(fileInfo?.duration);
    const frameCount = Number(fileInfo?.nb_frames);

    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(frameCount) || frameCount <= 0) {
        return null;
    }

    return duration / frameCount;
}

function getSampleRangeTimestamps(fileInfo, frameStart, frameEnd) {
    const frameDuration = getNominalFrameDuration(fileInfo);

    if (!frameDuration) {
        return null;
    }

    return {
        // Target the middle of the requested frame so the decoder can jump to the nearest
        // keyframe without us iterating from frame 1 in userland.
        startTimestamp: frameStart > 1
            ? Math.max(0, (frameStart - 1) * frameDuration + frameDuration / 2)
            : 0,
        endTimestamp: Number.isFinite(frameEnd)
            ? Math.max(0, frameEnd * frameDuration)
            : Number.POSITIVE_INFINITY
    };
}

export class CameraFrameSource {
    constructor(options = {}) {
        this._camera = new RealtimeCamera(options);
    }

    async start() {
        await this._camera.start();
    }

    async *frames() {
        for await (const videoFrame of this._camera.getFrameStream()) {
            let wasConsumed = false;
            try {
                yield { videoFrame };
                wasConsumed = true;
            } finally {
                if (!wasConsumed && videoFrame?.close) {
                    videoFrame.close();
                }
            }
        }
    }

    async toggleCamera() {
        return this._camera.toggleCamera();
    }

    setResolution(resolution) {
        this._camera.setResolution(resolution);
    }

    stop() {
        this._camera.stop();
    }

    get frameRate() {
        return this._camera.frameRate;
    }

    get isActive() {
        return this._camera.isActive;
    }

    getMediaStream() {
        return this._camera.getMediaStream();
    }
}

export class VideoFileFrameSource {
    constructor(options) {
        this.file = options.file;
        this.fileInfo = options.fileInfo;
        this.tilePlan = options.tilePlan;
        this.frameStart = options.frameStart ?? 1;
        this.frameEnd = options.frameEnd ?? Number.POSITIVE_INFINITY;
        this.frameInterpolationFactor = options.frameInterpolationFactor ?? 1;
        this.onSeekProgress = options.onSeekProgress ?? null;
        this.onRangeStart = options.onRangeStart ?? null;
        this.onInterpolationStatus = options.onInterpolationStatus ?? null;
    }

    async *frames() {
        const input = new Input({
            formats: ALL_FORMATS,
            source: new BlobSource(this.file),
        });

        const videoTrack = await input.getPrimaryVideoTrack();
        const sink = new VideoSampleSink(videoTrack);
        const sampleRange = getSampleRangeTimestamps(this.fileInfo, this.frameStart, this.frameEnd);
        const sampleIterator = sampleRange
            ? sink.samples(sampleRange.startTimestamp, sampleRange.endTimestamp)
            : sink.samples();

        let absoluteFrameNumber = sampleRange ? this.frameStart - 1 : 0;
        let frameNumber = 0;
        let pendingFrame = null;
        let interpolator = null;
        let completedIteration = false;
        const interpolationFactor = resolveInterpolationFactor(this.frameInterpolationFactor);
        const interpolationCount = Math.max(0, interpolationFactor - 1);
        const lastTileEnd = this.tilePlan.tiles[this.tilePlan.tiles.length - 1]?.end ?? 0;
        const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

        const reportInterpolationStatus = (message) => {
            if (typeof this.onInterpolationStatus === 'function') {
                this.onInterpolationStatus(message);
            }
        };

        const createOutputItem = (frameEntry, outputAbsoluteFrameNumber, isInterpolated = false) => {
            frameNumber++;

            if (lastTileEnd > 0 && frameNumber > lastTileEnd) {
                return null;
            }

            const tileNumber = this.tilePlan.tiles.findIndex(
                tile => frameNumber >= tile.start && frameNumber <= tile.end
            );

            if (tileNumber === -1) {
                return null;
            }

            return {
                videoFrame: frameEntry.videoFrame,
                frameNumber,
                absoluteFrameNumber: outputAbsoluteFrameNumber,
                sourceAbsoluteFrameNumber: frameEntry.absoluteFrameNumber,
                tileNumber,
                effectiveFileInfo: frameEntry.effectiveFileInfo,
                isInterpolated,
            };
        };

        if (sampleRange && this.frameStart > 1 && typeof this.onSeekProgress === 'function') {
            this.onSeekProgress(this.frameStart);
        }

        try {
            for await (const videoSample of sampleIterator) {
                absoluteFrameNumber++;

                if (!sampleRange) {
                    if (absoluteFrameNumber < this.frameStart) {
                        videoSample.close();
                        if (typeof this.onSeekProgress === 'function' && (absoluteFrameNumber === 1 || absoluteFrameNumber % 30 === 0)) {
                            this.onSeekProgress(absoluteFrameNumber);
                        }
                        continue;
                    }

                    if (absoluteFrameNumber > this.frameEnd) {
                        videoSample.close();
                        break;
                    }
                }

                if (absoluteFrameNumber === this.frameStart && this.frameStart > 1 && typeof this.onRangeStart === 'function') {
                    this.onRangeStart();
                }

                const videoFrame = videoSample.toVideoFrame();
                let processedFrame = videoFrame;
                let effectiveFileInfo = this.fileInfo;

                try {
                    if (this.tilePlan.isCropping) {
                        const cropCanvas = new OffscreenCanvas(this.tilePlan.cropWidth, this.tilePlan.cropHeight);
                        const cropCtx = cropCanvas.getContext('2d');
                        cropCtx.drawImage(
                            videoFrame,
                            this.tilePlan.cropX,
                            this.tilePlan.cropY,
                            this.tilePlan.cropWidth,
                            this.tilePlan.cropHeight,
                            0,
                            0,
                            this.tilePlan.cropWidth,
                            this.tilePlan.cropHeight
                        );

                        processedFrame = new VideoFrame(cropCanvas, {
                            timestamp: videoFrame.timestamp
                        });
                        effectiveFileInfo = {
                            ...this.fileInfo,
                            width: this.tilePlan.cropWidth,
                            height: this.tilePlan.cropHeight
                        };
                        videoFrame.close();
                    }

                    if (this.tilePlan.isScaled) {
                        const scaleFactor = this.tilePlan.scaleTo / this.tilePlan.scaleFrom;
                        const scaledWidth = Math.floor(effectiveFileInfo.width * scaleFactor);
                        const scaledHeight = Math.floor(effectiveFileInfo.height * scaleFactor);

                        const tempCanvas = new OffscreenCanvas(scaledWidth, scaledHeight);
                        const tempCtx = tempCanvas.getContext('2d');
                        tempCtx.imageSmoothingEnabled = true;
                        tempCtx.imageSmoothingQuality = 'high';
                        tempCtx.drawImage(
                            processedFrame,
                            0,
                            0,
                            effectiveFileInfo.width,
                            effectiveFileInfo.height,
                            0,
                            0,
                            scaledWidth,
                            scaledHeight
                        );

                        const frameToClose = processedFrame;
                        processedFrame = new VideoFrame(tempCanvas, {
                            timestamp: frameToClose.timestamp
                        });
                        effectiveFileInfo = {
                            ...effectiveFileInfo,
                            width: scaledWidth,
                            height: scaledHeight
                        };
                        frameToClose.close();
                    }

                    videoSample.close();

                    const currentFrame = {
                        videoFrame: processedFrame,
                        absoluteFrameNumber,
                        effectiveFileInfo,
                    };

                    if (pendingFrame === null) {
                        pendingFrame = currentFrame;
                        continue;
                    }

                    let interpolatedFrames = [];

                    if (interpolationCount > 0) {
                        if (!interpolator) {
                            reportInterpolationStatus('Loading RIFE interpolation model...');
                            interpolator = await loadRifeInterpolator();
                            reportInterpolationStatus(
                                hasWebGPU
                                    ? `Interpolating frames at ${interpolationFactor}x...`
                                    : `Interpolating frames at ${interpolationFactor}x with WASM fallback...`
                            );
                        }

                        interpolatedFrames = await interpolator.interpolateMultiple(
                            pendingFrame.videoFrame,
                            currentFrame.videoFrame,
                            interpolationCount,
                            true
                        );
                    }

                    const pendingOutput = createOutputItem(pendingFrame, pendingFrame.absoluteFrameNumber);
                    if (pendingOutput) {
                        let wasConsumed = false;
                        try {
                            yield pendingOutput;
                            wasConsumed = true;
                        } finally {
                            if (!wasConsumed && pendingOutput.videoFrame?.close) {
                                pendingOutput.videoFrame.close();
                            }
                        }
                    } else {
                        pendingFrame.videoFrame.close();
                    }

                    for (let interpolationIndex = 0; interpolationIndex < interpolatedFrames.length; interpolationIndex++) {
                        const interpolatedFrame = interpolatedFrames[interpolationIndex];
                        const timestep = (interpolationIndex + 1) / (interpolationCount + 1);
                        const interpolatedOutput = createOutputItem(
                            {
                                videoFrame: interpolatedFrame,
                                absoluteFrameNumber: pendingFrame.absoluteFrameNumber,
                                effectiveFileInfo: pendingFrame.effectiveFileInfo,
                            },
                            pendingFrame.absoluteFrameNumber + timestep,
                            true
                        );

                        if (interpolatedOutput) {
                            let wasConsumed = false;
                            try {
                                yield interpolatedOutput;
                                wasConsumed = true;
                            } finally {
                                if (!wasConsumed && interpolatedOutput.videoFrame?.close) {
                                    interpolatedOutput.videoFrame.close();
                                }
                            }
                        } else {
                            interpolatedFrame.close();
                        }
                    }

                    pendingFrame = currentFrame;
                } catch (error) {
                    if (processedFrame?.close) {
                        processedFrame.close();
                    }
                    videoSample.close();
                    throw error;
                }
            }

            completedIteration = true;
        } finally {
            if (completedIteration && pendingFrame) {
                const finalOutput = createOutputItem(pendingFrame, pendingFrame.absoluteFrameNumber);
                if (finalOutput) {
                    let wasConsumed = false;
                    try {
                        yield finalOutput;
                        wasConsumed = true;
                    } finally {
                        if (!wasConsumed && finalOutput.videoFrame?.close) {
                            finalOutput.videoFrame.close();
                        }
                    }
                } else if (pendingFrame.videoFrame?.close) {
                    pendingFrame.videoFrame.close();
                }
            }

            reportInterpolationStatus(null);
        }
    }
}