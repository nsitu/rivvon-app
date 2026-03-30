/**
 * RealtimeCamera — Webcam capture using MediaStreamTrackProcessor (MSTP).
 * Yields VideoFrame objects via an async generator. Includes inline polyfill
 * for browsers without native MSTP support (Firefox, Safari).
 *
 * Borrowed patterns from timespy's CameraManager and polyfillMSTP.
 */

// ── MSTP Polyfill ──────────────────────────────────────────────────────
function polyfillMSTP() {
    if (typeof MediaStreamTrackProcessor !== 'undefined') return;

    class PolyfillMediaStreamTrackProcessor {
        constructor({ track }) {
            this._track = track;
            const self = this;

            this.readable = new ReadableStream({
                start(controller) {
                    self._controller = controller;
                    const video = document.createElement('video');
                    video.srcObject = new MediaStream([track]);
                    video.muted = true;
                    video.playsInline = true;
                    self._video = video;
                    self._canvas = new OffscreenCanvas(1, 1);
                    self._ctx = self._canvas.getContext('2d');
                    self._stopped = false;

                    video.play().then(() => {
                        self._pump(controller);
                    });
                },
                cancel() {
                    self._stopped = true;
                    if (self._video) {
                        self._video.pause();
                        self._video.srcObject = null;
                    }
                }
            });
        }

        _pump(controller) {
            if (this._stopped || this._track.readyState === 'ended') {
                controller.close();
                return;
            }
            const { videoWidth, videoHeight } = this._video;
            if (videoWidth && videoHeight) {
                this._canvas.width = videoWidth;
                this._canvas.height = videoHeight;
                this._ctx.drawImage(this._video, 0, 0);
                // Create a VideoFrame if available, otherwise use ImageBitmap
                if (typeof VideoFrame !== 'undefined') {
                    const frame = new VideoFrame(this._canvas, { timestamp: performance.now() * 1000 });
                    controller.enqueue(frame);
                } else {
                    // Fallback: use canvas directly — consumer must handle
                    const bmp = this._canvas.transferToImageBitmap();
                    controller.enqueue(bmp);
                }
            }
            requestAnimationFrame(() => this._pump(controller));
        }
    }

    globalThis.MediaStreamTrackProcessor = PolyfillMediaStreamTrackProcessor;
}

// ── Resolution helpers ─────────────────────────────────────────────────

const RESOLUTIONS = {
    '240p': { width: 320, height: 240 },
    '480p': { width: 640, height: 480 },
    '720p': { width: 1280, height: 720 }
};

function clampResolution(desired, maxWidth = 1280, maxHeight = 720) {
    const w = Math.min(desired.width, maxWidth);
    const h = Math.min(desired.height, maxHeight);
    return { width: w, height: h };
}

// ── RealtimeCamera class ───────────────────────────────────────────────

export class RealtimeCamera {
    constructor(options = {}) {
        const { resolution = '480p', facingMode = 'user' } = options;
        this._resolution = RESOLUTIONS[resolution] || RESOLUTIONS['480p'];
        this._facingMode = facingMode;
        this._stream = null;
        this._track = null;
        this._stopped = false;
    }

    /**
     * Acquire camera and return an async generator that yields VideoFrame objects.
     * Caller must call .close() on each VideoFrame after use.
     */
    async *getFrameStream() {
        polyfillMSTP();

        await this._acquireCamera();

        const processor = new MediaStreamTrackProcessor({ track: this._track });
        const reader = processor.readable.getReader();

        try {
            while (!this._stopped) {
                const { value: frame, done } = await reader.read();
                if (done || this._stopped) {
                    if (frame?.close) frame.close();
                    break;
                }
                yield frame;
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Toggle between front and rear cameras.
     * Returns true if successfully switched.
     */
    async toggleCamera() {
        this._facingMode = this._facingMode === 'user' ? 'environment' : 'user';
        // Stop current stream
        if (this._track) {
            this._track.stop();
        }
        if (this._stream) {
            this._stream.getTracks().forEach(t => t.stop());
        }
        // Re-acquire with new facing mode
        await this._acquireCamera();
        return this._facingMode;
    }

    /**
     * Set capture resolution. Takes effect on next toggleCamera() or restart.
     * @param {'480p'|'720p'} res
     */
    setResolution(res) {
        this._resolution = RESOLUTIONS[res] || RESOLUTIONS['480p'];
    }

    /**
     * Stop camera and release all resources.
     */
    stop() {
        this._stopped = true;
        if (this._track) {
            this._track.stop();
            this._track = null;
        }
        if (this._stream) {
            this._stream.getTracks().forEach(t => t.stop());
            this._stream = null;
        }
    }

    get facingMode() {
        return this._facingMode;
    }

    get resolution() {
        return { ...this._resolution };
    }

    get isActive() {
        return !!this._track && this._track.readyState === 'live';
    }

    /**
     * Get the raw MediaStream (for binding to a <video> element).
     * @returns {MediaStream|null}
     */
    getMediaStream() {
        return this._stream;
    }

    // ── Private ────────────────────────────────────────────────────────

    async _acquireCamera() {
        this._stopped = false;
        const clamped = clampResolution(this._resolution);
        const constraints = {
            video: {
                facingMode: this._facingMode,
                width: { ideal: clamped.width },
                height: { ideal: clamped.height }
            },
            audio: false
        };

        this._stream = await navigator.mediaDevices.getUserMedia(constraints);
        this._track = this._stream.getVideoTracks()[0];

        if (!this._track) {
            throw new Error('No video track available from camera');
        }

        const settings = this._track.getSettings();
        console.log(`[RealtimeCamera] Acquired camera: ${settings.width}x${settings.height} @${settings.frameRate}fps facing=${this._facingMode}`);
    }
}
