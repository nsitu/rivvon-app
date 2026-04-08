const TASKS_VISION_VERSION = '0.10.34';
const TASKS_VISION_WASM_ROOT = `/vendor/mediapipe/tasks-vision/${TASKS_VISION_VERSION}/wasm`;
const FACE_LANDMARKER_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export const FACE_LANDMARKER_DETECTION_STATUS = {
    skipped: 'skipped',
    processed: 'processed',
};

let tasksVisionModulePromise = null;
let visionRuntimePromise = null;

async function loadTasksVisionModule() {
    if (!tasksVisionModulePromise) {
        tasksVisionModulePromise = import('@mediapipe/tasks-vision');
    }

    return tasksVisionModulePromise;
}

async function loadVisionRuntime() {
    if (!visionRuntimePromise) {
        visionRuntimePromise = loadTasksVisionModule().then(({ FilesetResolver }) => (
            FilesetResolver.forVisionTasks(TASKS_VISION_WASM_ROOT)
        ));
    }

    return visionRuntimePromise;
}

async function createLandmarker(delegate) {
    const [{ FaceLandmarker }, vision] = await Promise.all([
        loadTasksVisionModule(),
        loadVisionRuntime(),
    ]);

    return FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: FACE_LANDMARKER_MODEL_URL,
            delegate,
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
    });
}

export class FaceLandmarkerDetector {
    constructor() {
        this._landmarker = null;
        this._lastVideoTime = -1;
    }

    async initialize() {
        if (this._landmarker) {
            return this._landmarker;
        }

        try {
            this._landmarker = await createLandmarker('GPU');
        } catch (gpuError) {
            console.warn('[HeadTracking] GPU face landmarker init failed, falling back to CPU.', gpuError);
            this._landmarker = await createLandmarker('CPU');
        }

        return this._landmarker;
    }

    detect(video, timestampMs = performance.now()) {
        if (!this._landmarker || !video) {
            return {
                status: FACE_LANDMARKER_DETECTION_STATUS.skipped,
                result: null,
            };
        }

        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            return {
                status: FACE_LANDMARKER_DETECTION_STATUS.skipped,
                result: null,
            };
        }

        if (video.currentTime === this._lastVideoTime) {
            return {
                status: FACE_LANDMARKER_DETECTION_STATUS.skipped,
                result: null,
            };
        }

        this._lastVideoTime = video.currentTime;
        return {
            status: FACE_LANDMARKER_DETECTION_STATUS.processed,
            result: this._landmarker.detectForVideo(video, timestampMs),
        };
    }

    dispose() {
        this._lastVideoTime = -1;
        this._landmarker?.close?.();
        this._landmarker = null;
    }
}