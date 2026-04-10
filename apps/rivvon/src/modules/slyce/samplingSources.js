import { Input, ALL_FORMATS, BlobSource, VideoSampleSink } from 'mediabunny';
import { RealtimeCamera } from './realtimeCamera.js';

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
        this.onSeekProgress = options.onSeekProgress ?? null;
        this.onRangeStart = options.onRangeStart ?? null;
    }

    async *frames() {
        const input = new Input({
            formats: ALL_FORMATS,
            source: new BlobSource(this.file),
        });

        const videoTrack = await input.getPrimaryVideoTrack();
        const sink = new VideoSampleSink(videoTrack);

        let absoluteFrameNumber = 0;
        let frameNumber = 0;

        for await (const videoSample of sink.samples()) {
            absoluteFrameNumber++;

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

                frameNumber++;
                const tileNumber = this.tilePlan.tiles.findIndex(
                    tile => frameNumber >= tile.start && frameNumber <= tile.end
                );

                if (tileNumber === -1) {
                    processedFrame.close();
                    videoSample.close();
                    continue;
                }

                let wasConsumed = false;
                try {
                    yield {
                        videoFrame: processedFrame,
                        frameNumber,
                        absoluteFrameNumber,
                        tileNumber,
                        effectiveFileInfo
                    };
                    wasConsumed = true;
                } finally {
                    if (!wasConsumed && processedFrame?.close) {
                        processedFrame.close();
                    }
                    videoSample.close();
                }
            } catch (error) {
                if (processedFrame?.close) {
                    processedFrame.close();
                }
                videoSample.close();
                throw error;
            }
        }
    }
}