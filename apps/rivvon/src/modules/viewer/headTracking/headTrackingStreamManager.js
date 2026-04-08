function isLocalDevelopmentHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1';
}

function hasSecureCameraContext() {
    if (typeof window === 'undefined' || typeof location === 'undefined') {
        return false;
    }

    return window.isSecureContext || isLocalDevelopmentHost(location.hostname);
}

function waitForVideoReady(video) {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            video.removeEventListener('error', handleError);
        };

        const handleLoadedMetadata = async () => {
            try {
                await video.play();
                cleanup();
                resolve(video);
            } catch (error) {
                cleanup();
                reject(error);
            }
        };

        const handleError = () => {
            cleanup();
            reject(new Error('Unable to start the head-tracking camera preview.'));
        };

        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
            void handleLoadedMetadata();
            return;
        }

        video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
        video.addEventListener('error', handleError, { once: true });
    });
}

export class HeadTrackingStreamManager {
    constructor(options = {}) {
        this._constraints = {
            audio: false,
            video: {
                facingMode: 'user',
                width: { ideal: 640 },
                height: { ideal: 480 },
                ...(options.video ?? {}),
            },
            ...options,
        };

        this._stream = null;
        this._video = document.createElement('video');
        this._video.autoplay = true;
        this._video.muted = true;
        this._video.playsInline = true;
        this._video.setAttribute('autoplay', 'true');
        this._video.setAttribute('muted', 'true');
        this._video.setAttribute('playsinline', 'true');
    }

    static isSupported() {
        return typeof navigator !== 'undefined'
            && !!navigator.mediaDevices?.getUserMedia
            && hasSecureCameraContext();
    }

    async start() {
        if (this._stream) {
            return this._video;
        }

        if (!HeadTrackingStreamManager.isSupported()) {
            throw new Error('Head tracking requires webcam access on localhost or HTTPS.');
        }

        const stream = await navigator.mediaDevices.getUserMedia(this._constraints);
        this._stream = stream;
        this._video.srcObject = stream;

        try {
            await waitForVideoReady(this._video);
            return this._video;
        } catch (error) {
            this.stop();
            throw error;
        }
    }

    stop() {
        if (this._video) {
            this._video.pause();
            this._video.srcObject = null;
        }

        if (this._stream) {
            for (const track of this._stream.getTracks()) {
                track.stop();
            }
        }

        this._stream = null;
    }

    isActive() {
        return !!this._stream;
    }

    getStream() {
        return this._stream;
    }

    getVideo() {
        return this._video;
    }

    dispose() {
        this.stop();
        this._video.removeAttribute('src');
        this._video.load();
    }
}