import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { KalmanFilter1D } from '../kalmanFilter.js';

const FACE_LANDMARKS = {
    leftEyeOuter: 33,
    rightEyeOuter: 263,
    leftFaceEdge: 234,
    rightFaceEdge: 454,
    forehead: 10,
    chin: 152,
};

const ANGLE_FILTER_OPTIONS = {
    processNoise: 0.0008,
    measurementNoise: 0.02,
};

const SCALE_FILTER_OPTIONS = {
    processNoise: 0.0002,
    measurementNoise: 0.006,
};

function toCameraPoint(landmark, out) {
    out.set(
        (landmark.x - 0.5) * 2,
        (0.5 - landmark.y) * 2,
        -landmark.z,
    );

    return out;
}

function extractLandmarkScale(landmarks) {
    if (!Array.isArray(landmarks) || landmarks.length <= FACE_LANDMARKS.rightFaceEdge) {
        return null;
    }

    const faceWidth2d = Math.max(
        Math.abs(landmarks[FACE_LANDMARKS.rightFaceEdge].x - landmarks[FACE_LANDMARKS.leftFaceEdge].x),
        1e-4,
    );
    const faceHeight2d = Math.max(
        Math.abs(landmarks[FACE_LANDMARKS.chin].y - landmarks[FACE_LANDMARKS.forehead].y),
        1e-4,
    );

    return Math.sqrt(faceWidth2d * faceHeight2d);
}

function extractLandmarkFrameCenter(landmarks) {
    if (!Array.isArray(landmarks) || landmarks.length <= FACE_LANDMARKS.rightFaceEdge) {
        return null;
    }

    const centerX = (
        landmarks[FACE_LANDMARKS.leftFaceEdge].x
        + landmarks[FACE_LANDMARKS.rightFaceEdge].x
    ) / 2;
    const centerY = (
        landmarks[FACE_LANDMARKS.forehead].y
        + landmarks[FACE_LANDMARKS.chin].y
    ) / 2;
    const centerZ = (
        landmarks[FACE_LANDMARKS.leftEyeOuter].z
        + landmarks[FACE_LANDMARKS.rightEyeOuter].z
        + landmarks[FACE_LANDMARKS.forehead].z
        + landmarks[FACE_LANDMARKS.chin].z
    ) / 4;

    return {
        x: (centerX - 0.5) * 2,
        y: (0.5 - centerY) * 2,
        z: -centerZ,
    };
}

function isFinitePoseValue(value) {
    return Number.isFinite(value);
}

export class HeadPoseEstimator {
    constructor() {
        this._yawFilter = new KalmanFilter1D(ANGLE_FILTER_OPTIONS);
        this._pitchFilter = new KalmanFilter1D(ANGLE_FILTER_OPTIONS);
        this._rollFilter = new KalmanFilter1D(ANGLE_FILTER_OPTIONS);
        this._scaleFilter = new KalmanFilter1D(SCALE_FILTER_OPTIONS);

        this._rotation = new Matrix4();
        this._transform = new Matrix4();
        this._euler = new Euler(0, 0, 0, 'YXZ');
        this._quaternion = new Quaternion();
        this._translation = new Vector3();
        this._matrixScale = new Vector3();

        this._leftEye = new Vector3();
        this._rightEye = new Vector3();
        this._forehead = new Vector3();
        this._chin = new Vector3();
        this._faceRight = new Vector3();
        this._faceVertical = new Vector3();
        this._faceForward = new Vector3();
        this._faceUp = new Vector3();
    }

    reset() {
        this._yawFilter.reset();
        this._pitchFilter.reset();
        this._rollFilter.reset();
        this._scaleFilter.reset();
    }

    _buildPose(rawYaw, rawPitch, rawRoll, rawScale, meta = {}) {
        if (
            !isFinitePoseValue(rawYaw)
            || !isFinitePoseValue(rawPitch)
            || !isFinitePoseValue(rawRoll)
            || !isFinitePoseValue(rawScale)
            || rawScale <= 0
        ) {
            return null;
        }

        return {
            yaw: this._yawFilter.update(rawYaw),
            pitch: this._pitchFilter.update(rawPitch),
            roll: this._rollFilter.update(rawRoll),
            scale: this._scaleFilter.update(rawScale),
            raw: {
                yaw: rawYaw,
                pitch: rawPitch,
                roll: rawRoll,
                scale: rawScale,
                source: meta.source ?? 'unknown',
                position: meta.position ? { ...meta.position } : null,
                frameCenter: meta.frameCenter ? { ...meta.frameCenter } : null,
            },
        };
    }

    _estimateFromTransformationMatrix(facialTransformationMatrix, fallbackScale = null, frameCenter = null) {
        const data = facialTransformationMatrix?.data;
        if (
            facialTransformationMatrix?.rows !== 4
            || facialTransformationMatrix?.columns !== 4
            || !Array.isArray(data)
            || data.length < 16
        ) {
            return null;
        }

        // MediaPipe exposes the 4x4 face pose matrix in row-major order.
        this._transform.set(
            data[0], data[1], data[2], data[3],
            data[4], data[5], data[6], data[7],
            data[8], data[9], data[10], data[11],
            data[12], data[13], data[14], data[15],
        );
        this._transform.decompose(this._translation, this._quaternion, this._matrixScale);
        this._euler.setFromQuaternion(this._quaternion, 'YXZ');

        const matrixScale = Math.max(
            (Math.abs(this._matrixScale.x) + Math.abs(this._matrixScale.y) + Math.abs(this._matrixScale.z)) / 3,
            1e-4,
        );

        return this._buildPose(
            this._euler.y,
            this._euler.x,
            this._euler.z,
            fallbackScale ?? matrixScale,
            {
                source: 'matrix',
                position: {
                    x: this._translation.x,
                    y: this._translation.y,
                    z: this._translation.z,
                },
                frameCenter,
            },
        );
    }

    _estimateFromLandmarks(landmarks) {
        if (!Array.isArray(landmarks) || landmarks.length <= FACE_LANDMARKS.rightFaceEdge) {
            return null;
        }

        const leftEye = toCameraPoint(landmarks[FACE_LANDMARKS.leftEyeOuter], this._leftEye);
        const rightEye = toCameraPoint(landmarks[FACE_LANDMARKS.rightEyeOuter], this._rightEye);
        const forehead = toCameraPoint(landmarks[FACE_LANDMARKS.forehead], this._forehead);
        const chin = toCameraPoint(landmarks[FACE_LANDMARKS.chin], this._chin);

        const faceRight = this._faceRight.subVectors(rightEye, leftEye);
        const faceVertical = this._faceVertical.subVectors(forehead, chin);

        if (faceRight.lengthSq() < 1e-6 || faceVertical.lengthSq() < 1e-6) {
            return null;
        }

        faceRight.normalize();
        faceVertical.normalize();

        const faceForward = this._faceForward.crossVectors(faceRight, faceVertical);
        if (faceForward.lengthSq() < 1e-6) {
            return null;
        }

        faceForward.normalize();
        if (faceForward.z < 0) {
            faceForward.negate();
        }

        const faceUp = this._faceUp.crossVectors(faceForward, faceRight);
        if (faceUp.lengthSq() < 1e-6) {
            return null;
        }

        faceUp.normalize();

        this._rotation.makeBasis(faceRight, faceUp, faceForward);
        this._euler.setFromRotationMatrix(this._rotation, 'YXZ');

        const rawYaw = this._euler.y;
        const rawPitch = this._euler.x;
        const rawRoll = this._euler.z;

        return this._buildPose(
            rawYaw,
            rawPitch,
            rawRoll,
            extractLandmarkScale(landmarks),
            {
                source: 'landmarks',
                position: extractLandmarkFrameCenter(landmarks),
                frameCenter: extractLandmarkFrameCenter(landmarks),
            },
        );
    }

    estimate({ landmarks = null, facialTransformationMatrix = null } = {}) {
        const frameCenter = extractLandmarkFrameCenter(landmarks);

        return this._estimateFromTransformationMatrix(
            facialTransformationMatrix,
            extractLandmarkScale(landmarks),
            frameCenter,
        ) ?? this._estimateFromLandmarks(landmarks);
    }
}