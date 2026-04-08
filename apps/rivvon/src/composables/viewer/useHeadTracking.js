import { MathUtils } from 'three';
import { onUnmounted, shallowRef, watch } from 'vue';
import { HeadTrackingStreamManager } from '../../modules/viewer/headTracking/headTrackingStreamManager';
import {
    FaceLandmarkerDetector,
    FACE_LANDMARKER_DETECTION_STATUS,
} from '../../modules/viewer/headTracking/faceLandmarkerDetector';
import { HeadPoseEstimator } from '../../modules/viewer/headTracking/headPoseEstimator';
import { HeadTrackingCameraController } from '../../modules/viewer/headTracking/headTrackingCameraController';

const CALIBRATION_STABLE_FRAMES = 12;
const CALIBRATION_ANGLE_THRESHOLD = MathUtils.degToRad(1.2);
const CALIBRATION_ROLL_THRESHOLD = MathUtils.degToRad(1.4);
const CALIBRATION_SCALE_THRESHOLD = 0.012;
const FACE_LOST_GRACE_MS = 350;

const MIRROR_SIGNS = {
    yaw: -1,
    pitch: -1,
    roll: -1,
};

function clonePose(pose) {
    if (!pose) {
        return null;
    }

    return {
        yaw: pose.yaw,
        pitch: pose.pitch,
        roll: pose.roll,
        scale: pose.scale,
        raw: {
            yaw: pose.raw?.yaw ?? 0,
            pitch: pose.raw?.pitch ?? 0,
            roll: pose.raw?.roll ?? 0,
            scale: pose.raw?.scale ?? 0,
            source: pose.raw?.source ?? 'unknown',
            position: pose.raw?.position ? { ...pose.raw.position } : null,
            frameCenter: pose.raw?.frameCenter ? { ...pose.raw.frameCenter } : null,
        },
    };
}

function snapshotVideo(video) {
    if (!video) {
        return null;
    }

    return {
        readyState: video.readyState,
        currentTime: video.currentTime,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
    };
}

function describeHeadTrackingError(error) {
    switch (error?.name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
            return {
                supported: true,
                reason: 'permission-denied',
                message: 'Camera access was denied. Head tracking needs webcam permission.',
            };
        case 'NotFoundError':
        case 'DevicesNotFoundError':
            return {
                supported: true,
                reason: 'camera-not-found',
                message: 'No front-facing camera was found for head tracking.',
            };
        case 'NotReadableError':
        case 'TrackStartError':
            return {
                supported: true,
                reason: 'camera-busy',
                message: 'The webcam is already in use by another application or browser mode.',
            };
        default:
            return {
                supported: HeadTrackingStreamManager.isSupported(),
                reason: 'startup-failed',
                message: error?.message || 'Head tracking could not start.',
            };
    }
}

export function useHeadTracking(ctx) {
    const streamManager = shallowRef(null);
    const detector = shallowRef(null);
    const poseEstimator = shallowRef(new HeadPoseEstimator());
    const cameraController = shallowRef(new HeadTrackingCameraController());

    let neutralPose = null;
    let neutralScale = null;
    let neutralFrameCenter = null;
    let lastCalibrationPose = null;
    let stableFrameCount = 0;
    let lastFaceSeenAt = 0;
    let activationToken = 0;
    let startPromise = null;
    let pausedForVisibility = false;

    const debugState = {
        tickTimestampMs: 0,
        detectionStatus: 'idle',
        faceDetected: false,
        pose: null,
        mappedInput: { yaw: 0, pitch: 0, roll: 0, scaleDelta: 0, frameX: 0, frameY: 0 },
        video: null,
    };

    function setRuntimeState(payload = {}) {
        ctx.app.setHeadTrackingRuntimeState(payload);
    }

    function isSelected() {
        return ctx.app.viewerControlMode === 'headTracking';
    }

    function evaluateSupport() {
        const supported = HeadTrackingStreamManager.isSupported();
        ctx.app.setHeadTrackingSupported(supported);
        return supported;
    }

    function ensureStreamManager() {
        if (!streamManager.value) {
            streamManager.value = new HeadTrackingStreamManager();
        }

        return streamManager.value;
    }

    async function ensureDetector() {
        if (!detector.value) {
            detector.value = new FaceLandmarkerDetector();
        }

        await detector.value.initialize();
        return detector.value;
    }

    function resetCalibrationState() {
        neutralPose = null;
        neutralScale = null;
        neutralFrameCenter = null;
        lastCalibrationPose = null;
        stableFrameCount = 0;
        lastFaceSeenAt = 0;
        poseEstimator.value?.reset();
        debugState.faceDetected = false;
        debugState.pose = null;
        debugState.mappedInput = { yaw: 0, pitch: 0, roll: 0, scaleDelta: 0, frameX: 0, frameY: 0 };
    }

    function beginCalibration(statusMessage = 'Center your face and hold still to calibrate head tracking.') {
        resetCalibrationState();
        setRuntimeState({
            active: false,
            calibrating: true,
            statusMessage,
            errorMessage: '',
            suspendedReason: null,
        });
    }

    function handleFaceMissing(timestampMs) {
        debugState.faceDetected = false;
        debugState.pose = null;
        debugState.mappedInput = { yaw: 0, pitch: 0, roll: 0, scaleDelta: 0, frameX: 0, frameY: 0 };

        if (ctx.app.headTrackingCalibrating || !neutralPose) {
            setRuntimeState({
                active: false,
                calibrating: true,
                statusMessage: 'Show your face and hold still to calibrate head tracking.',
                errorMessage: '',
                suspendedReason: 'waiting-for-face',
            });
            return;
        }

        if (lastFaceSeenAt !== 0 && (timestampMs - lastFaceSeenAt) > FACE_LOST_GRACE_MS) {
            cameraController.value.apply({ yaw: 0, pitch: 0, roll: 0, scaleDelta: 0 });
            setRuntimeState({
                active: false,
                calibrating: false,
                statusMessage: 'Face not detected. Return to the camera to resume head tracking.',
                errorMessage: '',
                suspendedReason: 'face-not-detected',
            });
        }
    }

    function completeCalibration(pose) {
        neutralPose = {
            yaw: pose.yaw,
            pitch: pose.pitch,
            roll: pose.roll,
        };
        neutralScale = pose.scale;
        neutralFrameCenter = pose.raw?.frameCenter
            ? { ...pose.raw.frameCenter }
            : { x: 0, y: 0 };

        setRuntimeState({
            active: true,
            calibrating: false,
            statusMessage: 'Head tracking active.',
            errorMessage: '',
            suspendedReason: null,
        });
    }

    function updateCalibration(pose) {
        if (!lastCalibrationPose) {
            lastCalibrationPose = pose;
            stableFrameCount = 1;
            setRuntimeState({
                active: false,
                calibrating: true,
                statusMessage: 'Center your face and hold still to calibrate head tracking.',
                errorMessage: '',
                suspendedReason: null,
            });
            return false;
        }

        const isStable = Math.abs(pose.yaw - lastCalibrationPose.yaw) <= CALIBRATION_ANGLE_THRESHOLD
            && Math.abs(pose.pitch - lastCalibrationPose.pitch) <= CALIBRATION_ANGLE_THRESHOLD
            && Math.abs(pose.roll - lastCalibrationPose.roll) <= CALIBRATION_ROLL_THRESHOLD
            && Math.abs(pose.scale - lastCalibrationPose.scale) <= CALIBRATION_SCALE_THRESHOLD;

        stableFrameCount = isStable ? (stableFrameCount + 1) : 1;
        lastCalibrationPose = pose;

        if (stableFrameCount >= CALIBRATION_STABLE_FRAMES) {
            completeCalibration(pose);
            return true;
        }

        setRuntimeState({
            active: false,
            calibrating: true,
            statusMessage: 'Hold still to finish head-tracking calibration.',
            errorMessage: '',
            suspendedReason: null,
        });

        return false;
    }

    function attach(camera, controls) {
        cameraController.value.attach(camera, controls);
        cameraController.value.setRibbonSeries(ctx.ribbonSeries.value);
        evaluateSupport();
    }

    function stopTracking({ restoreBaseline = true, preserveFeedback = false, releaseDetector = false } = {}) {
        activationToken += 1;
        streamManager.value?.stop();
        resetCalibrationState();

        if (releaseDetector && detector.value) {
            detector.value.dispose();
            detector.value = null;
        }

        if (cameraController.value.isActive) {
            cameraController.value.deactivate({ restoreBaseline });
        }

        if (!preserveFeedback) {
            setRuntimeState({
                active: false,
                calibrating: false,
                statusMessage: '',
                errorMessage: '',
                suspendedReason: null,
            });
        } else {
            setRuntimeState({
                active: false,
                calibrating: false,
            });
        }
    }

    async function startTracking({ recaptureBaseline = true, statusMessage = 'Center your face and hold still to calibrate head tracking.' } = {}) {
        if (!ctx.camera.value || !ctx.controls.value || !isSelected()) {
            return false;
        }

        if (!evaluateSupport()) {
            exitToOrbit({
                supported: false,
                reason: 'unsupported-browser',
                errorMessage: 'Head tracking requires webcam access on localhost or HTTPS in a supported browser.',
            });
            return false;
        }

        if (startPromise) {
            return startPromise;
        }

        cameraController.value.attach(ctx.camera.value, ctx.controls.value);
        if (recaptureBaseline || !cameraController.value.isActive) {
            cameraController.value.activate();
        }

        const token = ++activationToken;
        beginCalibration('Requesting webcam access for head tracking…');

        startPromise = (async () => {
            try {
                await ensureDetector();
                if (token !== activationToken || !isSelected()) {
                    return false;
                }

                await ensureStreamManager().start();
                if (token !== activationToken || !isSelected()) {
                    streamManager.value?.stop();
                    return false;
                }

                pausedForVisibility = false;
                beginCalibration(statusMessage);
                setRuntimeState({ supported: true });
                return true;
            } catch (error) {
                const describedError = describeHeadTrackingError(error);
                exitToOrbit({
                    supported: describedError.supported,
                    reason: describedError.reason,
                    errorMessage: describedError.message,
                });
                return false;
            } finally {
                startPromise = null;
            }
        })();

        return startPromise;
    }

    function exitToOrbit({ reason = null, statusMessage = '', errorMessage = '', supported = ctx.app.headTrackingSupported, clearFeedback = false } = {}) {
        const preserveFeedback = !clearFeedback && (!!reason || !!statusMessage || !!errorMessage);

        if (preserveFeedback) {
            setRuntimeState({
                supported,
                active: false,
                calibrating: false,
                statusMessage,
                errorMessage,
                suspendedReason: reason,
            });
        }

        stopTracking({
            restoreBaseline: true,
            preserveFeedback,
            releaseDetector: false,
        });

        if (!preserveFeedback) {
            setRuntimeState({
                supported,
                active: false,
                calibrating: false,
                statusMessage: '',
                errorMessage: '',
                suspendedReason: null,
            });
        }

        if (ctx.app.viewerControlMode !== 'orbit') {
            ctx.app.setViewerControlMode('orbit');
        }
    }

    function recenter() {
        if (!isSelected() || !ctx.camera.value) {
            return;
        }

        cameraController.value.captureBaseline();
        beginCalibration('Hold still to re-center head tracking.');

        if (!streamManager.value?.isActive()) {
            void startTracking({
                recaptureBaseline: false,
                statusMessage: 'Hold still to re-center head tracking.',
            });
        }
    }

    function tick(timestampMs = performance.now()) {
        if (!isSelected() || !cameraController.value.isActive || !streamManager.value?.isActive()) {
            return;
        }

        const video = streamManager.value.getVideo();
        debugState.tickTimestampMs = timestampMs;
        debugState.video = snapshotVideo(video);

        const detection = detector.value?.detect(video, timestampMs);
        debugState.detectionStatus = detection?.status ?? FACE_LANDMARKER_DETECTION_STATUS.skipped;
        if (detection?.status !== FACE_LANDMARKER_DETECTION_STATUS.processed) {
            return;
        }

        const landmarks = detection.result?.faceLandmarks?.[0] ?? null;
        const facialTransformationMatrix = detection.result?.facialTransformationMatrixes?.[0] ?? null;

        debugState.faceDetected = !!(landmarks || facialTransformationMatrix);

        if (!landmarks && !facialTransformationMatrix) {
            handleFaceMissing(timestampMs);
            return;
        }

        const pose = poseEstimator.value?.estimate({
            landmarks,
            facialTransformationMatrix,
        });
        if (!pose) {
            handleFaceMissing(timestampMs);
            return;
        }

        debugState.pose = clonePose(pose);

        lastFaceSeenAt = timestampMs;

        if (!neutralPose || ctx.app.headTrackingCalibrating) {
            if (!updateCalibration(pose)) {
                debugState.mappedInput = { yaw: 0, pitch: 0, roll: 0, scaleDelta: 0, frameX: 0, frameY: 0 };
                cameraController.value.apply({ yaw: 0, pitch: 0, roll: 0, scaleDelta: 0, frameX: 0, frameY: 0 });
                return;
            }
        }

        const scaleDelta = neutralScale > 0 ? ((pose.scale / neutralScale) - 1) : 0;
        const frameCenter = pose.raw?.frameCenter ?? { x: 0, y: 0 };
        const frameX = neutralFrameCenter ? (frameCenter.x - neutralFrameCenter.x) : 0;
        const frameY = neutralFrameCenter ? (frameCenter.y - neutralFrameCenter.y) : 0;
        const mappedInput = {
            yaw: (pose.yaw - neutralPose.yaw) * MIRROR_SIGNS.yaw,
            pitch: (pose.pitch - neutralPose.pitch) * MIRROR_SIGNS.pitch,
            roll: (pose.roll - neutralPose.roll) * MIRROR_SIGNS.roll,
            scaleDelta,
            frameX,
            frameY,
        };
        debugState.mappedInput = mappedInput;
        cameraController.value.apply(mappedInput);

        if (!ctx.app.headTrackingActive || ctx.app.headTrackingSuspendedReason) {
            setRuntimeState({
                active: true,
                calibrating: false,
                statusMessage: 'Head tracking active.',
                errorMessage: '',
                suspendedReason: null,
            });
        }
    }

    function getDebugSnapshot() {
        return {
            selected: isSelected(),
            supported: ctx.app.headTrackingSupported,
            active: ctx.app.headTrackingActive,
            calibrating: ctx.app.headTrackingCalibrating,
            statusMessage: ctx.app.headTrackingStatusMessage,
            errorMessage: ctx.app.headTrackingErrorMessage,
            suspendedReason: ctx.app.headTrackingSuspendedReason,
            tickTimestampMs: debugState.tickTimestampMs,
            detectionStatus: debugState.detectionStatus,
            faceDetected: debugState.faceDetected,
            pose: clonePose(debugState.pose),
            neutralPose: neutralPose ? { ...neutralPose } : null,
            neutralScale,
            neutralFrameCenter: neutralFrameCenter ? { ...neutralFrameCenter } : null,
            mappedInput: { ...debugState.mappedInput },
            video: debugState.video ? { ...debugState.video } : null,
            calibrationStableFrames: stableFrameCount,
            calibrationTargetFrames: CALIBRATION_STABLE_FRAMES,
            lastFaceSeenAgeMs: lastFaceSeenAt ? Math.max(0, performance.now() - lastFaceSeenAt) : null,
            controller: cameraController.value.getDebugTelemetry?.() ?? null,
        };
    }

    function pauseForVisibility() {
        if (!isSelected()) {
            return;
        }

        activationToken += 1;
        streamManager.value?.stop();
        pausedForVisibility = true;
        setRuntimeState({
            active: false,
            calibrating: false,
            statusMessage: 'Head tracking paused while this tab is hidden.',
            errorMessage: '',
            suspendedReason: 'visibility-hidden',
        });
    }

    async function resumeFromVisibility() {
        if (!pausedForVisibility || !isSelected()) {
            return;
        }

        await startTracking({
            recaptureBaseline: false,
            statusMessage: 'Head tracking resumed. Hold still to re-center.',
        });
    }

    function detach({ releaseDetector = false } = {}) {
        activationToken += 1;
        streamManager.value?.stop();
        resetCalibrationState();

        if (releaseDetector && detector.value) {
            detector.value.dispose();
            detector.value = null;
        }

        cameraController.value.detach();
        if (isSelected()) {
            setRuntimeState({
                active: false,
                calibrating: false,
                statusMessage: 'Restoring head tracking…',
                errorMessage: '',
                suspendedReason: 'viewer-reinitializing',
            });
        } else {
            setRuntimeState({
                active: false,
                calibrating: false,
            });
        }
    }

    async function syncWithSelectedMode() {
        if (isSelected()) {
            await startTracking();
            return;
        }

        const preserveFeedback = !!ctx.app.headTrackingSuspendedReason || !!ctx.app.headTrackingErrorMessage;
        stopTracking({
            restoreBaseline: true,
            preserveFeedback,
            releaseDetector: false,
        });
    }

    watch(() => ctx.app.viewerControlMode, () => {
        void syncWithSelectedMode();
    }, { immediate: true });

    watch(() => ctx.app.headTrackingRecenterToken, (currentToken, previousToken) => {
        if (currentToken === previousToken) {
            return;
        }

        recenter();
    });

    watch(() => ctx.ribbonSeries.value, (series) => {
        cameraController.value.setRibbonSeries(series);
    }, { immediate: true });

    onUnmounted(() => {
        streamManager.value?.dispose?.();
        detector.value?.dispose?.();
        detector.value = null;
        streamManager.value = null;
        cameraController.value.detach();
    });

    return {
        attach,
        detach,
        tick,
        recenter,
        syncWithSelectedMode,
        pauseForVisibility,
        resumeFromVisibility,
        exitToOrbit,
        getDebugSnapshot,
        cameraController,
    };
}