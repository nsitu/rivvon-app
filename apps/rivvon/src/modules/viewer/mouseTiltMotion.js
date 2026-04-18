import { HeadTrackingCameraController } from './headTracking/headTrackingCameraController';

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
    const normalizedProgress = ((progress % 1) + 1) % 1;
    const angle = normalizedProgress * CIRCULAR_TILT_TURN_RADIANS;

    return getMouseTiltAnglesFromNormalizedPosition(
        Math.cos(angle),
        Math.sin(angle),
    );
}