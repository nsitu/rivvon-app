import { HeadTrackingCameraController } from './headTracking/headTrackingCameraController';
import {
    DEFAULT_ARTWORK_TILT_HORIZONTAL_DEGREES,
    DEFAULT_ARTWORK_TILT_VERTICAL_DEGREES,
    normalizeArtworkTiltDegrees,
} from '../../../../../packages/shared-types/src/artworkTilt.js';

export const MOUSE_TILT_MAX_YAW = Math.PI / 6;
export const MOUSE_TILT_MAX_PITCH = Math.PI / 8;
export const MOUSE_TILT_LERP = 0.1;

const CIRCULAR_TILT_TURN_RADIANS = Math.PI * 2;
const MOUSE_TILT_CONTROLLER_OPTIONS = {
    yawDeadZone: 0,
    pitchDeadZone: 0,
    rollDeadZone: 0,
    positionDeadZoneX: 0,
    positionDeadZoneY: 0,
    ribbonYawGain: 1,
    ribbonPitchGain: 1,
    ribbonRollGain: 0,
    ribbonTranslateXGain: 0,
    ribbonTranslateYGain: 0,
    dollyGain: 0,
    minDollyFactor: 1,
    maxDollyFactor: 1,
};

export function createMouseTiltController() {
    return new HeadTrackingCameraController(MOUSE_TILT_CONTROLLER_OPTIONS);
}

export function getMouseTiltAnglesFromNormalizedPosition(normalizedX, normalizedY) {
    return {
        yaw: -normalizedX * MOUSE_TILT_MAX_YAW,
        pitch: normalizedY * MOUSE_TILT_MAX_PITCH,
    };
}

export function getCircularTiltAnglesAtProgress(progress) {
    return getEllipticalTiltAnglesAtProgress(progress);
}

export function getEllipticalTiltAnglesAtProgress(progress, settings = {}) {
    const normalizedProgress = ((progress % 1) + 1) % 1;
    const angle = normalizedProgress * CIRCULAR_TILT_TURN_RADIANS;

    const horizontal = normalizeArtworkTiltDegrees(settings.artworkTiltHorizontalDegrees, DEFAULT_ARTWORK_TILT_HORIZONTAL_DEGREES);
    const vertical = normalizeArtworkTiltDegrees(settings.artworkTiltVerticalDegrees, DEFAULT_ARTWORK_TILT_VERTICAL_DEGREES);
    return {
        yaw: -Math.cos(angle) * horizontal * Math.PI / 180,
        pitch: Math.sin(angle) * vertical * Math.PI / 180,
    };
}
