import { MathUtils, Quaternion, Vector3 } from 'three';

const DEFAULT_OPTIONS = {
    yawDeadZone: MathUtils.degToRad(2.5),
    pitchDeadZone: MathUtils.degToRad(2),
    rollDeadZone: MathUtils.degToRad(2),
    positionDeadZoneX: 0.035,
    positionDeadZoneY: 0.035,
    ribbonYawGain: 1,
    ribbonPitchGain: 0.5,
    ribbonRollGain: 0.85,
    ribbonTranslateXGain: 1,
    ribbonTranslateYGain: 1,
    dollyDeadZone: 0.025,
    dollyGain: 0.7,
    minDollyFactor: 0.72,
    maxDollyFactor: 1.25,
};

function applyDeadZone(value, deadZone) {
    const magnitude = Math.abs(value);
    if (magnitude <= deadZone) {
        return 0;
    }

    return Math.sign(value) * (magnitude - deadZone);
}

function compressScaleDelta(value, deadZone, limit) {
    const effectiveValue = applyDeadZone(value, deadZone);
    return MathUtils.clamp(effectiveValue, -limit, limit);
}

function toPlainVector(vector) {
    if (!vector) {
        return null;
    }

    return {
        x: vector.x,
        y: vector.y,
        z: vector.z,
    };
}

export class HeadTrackingCameraController {
    constructor(options = {}) {
        this._options = { ...DEFAULT_OPTIONS, ...options };

        this._camera = null;
        this._controls = null;
        this._baseline = null;
        this._savedControlsEnabled = true;
        this._active = false;
        this._ribbonSeries = null;
        this._ribbonRoot = null;

        this._forward = new Vector3();
        this._baseForward = new Vector3();
        this._baseRight = new Vector3();
        this._baseUp = new Vector3();
        this._baseOffset = new Vector3();
        this._cameraOffset = new Vector3();
        this._cameraPosition = new Vector3();
        this._pitchAxis = new Vector3();
        this._rollAxis = new Vector3();
        this._yawQuat = new Quaternion();
        this._pitchQuat = new Quaternion();
        this._rollQuat = new Quaternion();
        this._deltaQuat = new Quaternion();

        this._lastInput = { yaw: 0, pitch: 0, roll: 0, scaleDelta: 0, frameX: 0, frameY: 0 };
        this._lastEffective = { yaw: 0, pitch: 0, roll: 0, scaleDelta: 0, frameX: 0, frameY: 0 };
        this._lastMapped = {
            ribbonYaw: 0,
            ribbonPitch: 0,
            ribbonRoll: 0,
            ribbonTranslateX: 0,
            ribbonTranslateY: 0,
            worldOffsetX: 0,
            worldOffsetY: 0,
            dollyFactor: 1,
        };
    }

    attach(camera, controls) {
        this._camera = camera;
        this._controls = controls;
        if (this._controls) {
            this._controls.enabled = !this._active;
        }
    }

    setRibbonSeries(ribbonSeries) {
        this._ribbonSeries = ribbonSeries;
        this._ribbonRoot = ribbonSeries?.getTransformRoot?.() ?? null;

        if (this._active) {
            this._captureRibbonBaseline();
        }
    }

    detach() {
        this._camera = null;
        this._controls = null;
        this._baseline = null;
        this._active = false;
        this._lastInput = { yaw: 0, pitch: 0, roll: 0, scaleDelta: 0, frameX: 0, frameY: 0 };
        this._lastEffective = { yaw: 0, pitch: 0, roll: 0, scaleDelta: 0, frameX: 0, frameY: 0 };
        this._lastMapped = {
            ribbonYaw: 0,
            ribbonPitch: 0,
            ribbonRoll: 0,
            ribbonTranslateX: 0,
            ribbonTranslateY: 0,
            worldOffsetX: 0,
            worldOffsetY: 0,
            dollyFactor: 1,
        };
    }

    get isActive() {
        return this._active;
    }

    _estimateLookTarget(distanceHint = null) {
        if (!this._camera) {
            return null;
        }

        const fallbackDistance = distanceHint
            ?? this._controls?.target?.distanceTo(this._camera.position)
            ?? this._baseline?.distance
            ?? 10;

        this._camera.getWorldDirection(this._forward);
        return this._camera.position.clone().addScaledVector(this._forward, Math.max(fallbackDistance, 0.1));
    }

    _captureRibbonBaseline() {
        if (!this._baseline) {
            return;
        }

        this._baseline.ribbonPosition = this._ribbonRoot?.position?.clone() ?? null;
        this._baseline.ribbonQuaternion = this._ribbonRoot?.quaternion?.clone() ?? null;
    }

    captureBaseline(target = null) {
        if (!this._camera) {
            return null;
        }

        const resolvedTarget = target?.clone()
            ?? this._controls?.target?.clone()
            ?? this._estimateLookTarget();

        if (!resolvedTarget) {
            return null;
        }

        const distance = Math.max(this._camera.position.distanceTo(resolvedTarget), 0.1);
        this._baseline = {
            position: this._camera.position.clone(),
            quaternion: this._camera.quaternion.clone(),
            up: this._camera.up.clone(),
            target: resolvedTarget.clone(),
            distance,
            ribbonPosition: null,
            ribbonQuaternion: null,
        };
        this._captureRibbonBaseline();

        if (this._controls) {
            this._controls.target.copy(resolvedTarget);
        }

        this._lastInput = { yaw: 0, pitch: 0, roll: 0, scaleDelta: 0, frameX: 0, frameY: 0 };
        this._lastEffective = { yaw: 0, pitch: 0, roll: 0, scaleDelta: 0, frameX: 0, frameY: 0 };
        this._lastMapped = {
            ribbonYaw: 0,
            ribbonPitch: 0,
            ribbonRoll: 0,
            ribbonTranslateX: 0,
            ribbonTranslateY: 0,
            worldOffsetX: 0,
            worldOffsetY: 0,
            dollyFactor: 1,
        };

        return this._baseline;
    }

    activate(target = null) {
        this.captureBaseline(target);
        this._active = !!this._baseline;

        if (this._controls) {
            this._savedControlsEnabled = this._controls.enabled;
            this._controls.enabled = false;
        }

        return this._active;
    }

    deactivate({ restoreBaseline = true } = {}) {
        if (restoreBaseline) {
            this.restoreBaseline();
        }

        this._active = false;

        if (this._controls) {
            this._controls.enabled = this._savedControlsEnabled;
        }
    }

    restoreBaseline() {
        if (!this._camera || !this._baseline) {
            return;
        }

        this._camera.position.copy(this._baseline.position);
        this._camera.quaternion.copy(this._baseline.quaternion);
        this._camera.up.copy(this._baseline.up);
        this._camera.updateMatrixWorld();

        if (this._controls) {
            this._controls.target.copy(this._baseline.target);
            this._controls.update();
        }

        if (this._ribbonRoot && this._baseline.ribbonPosition && this._baseline.ribbonQuaternion) {
            this._ribbonRoot.position.copy(this._baseline.ribbonPosition);
            this._ribbonRoot.quaternion.copy(this._baseline.ribbonQuaternion);
            this._ribbonRoot.updateMatrixWorld(true);
        }

        this._lastEffective = { yaw: 0, pitch: 0, roll: 0, scaleDelta: 0, frameX: 0, frameY: 0 };
        this._lastMapped = {
            ribbonYaw: 0,
            ribbonPitch: 0,
            ribbonRoll: 0,
            ribbonTranslateX: 0,
            ribbonTranslateY: 0,
            worldOffsetX: 0,
            worldOffsetY: 0,
            dollyFactor: 1,
        };
    }

    apply({ yaw = 0, pitch = 0, roll = 0, scaleDelta = 0, frameX = 0, frameY = 0 } = {}) {
        if (!this._active || !this._camera || !this._baseline) {
            return;
        }

        const options = this._options;
        const effectiveYaw = applyDeadZone(yaw, options.yawDeadZone);
        const effectivePitch = applyDeadZone(pitch, options.pitchDeadZone);
        const effectiveRoll = applyDeadZone(roll, options.rollDeadZone);
        const effectiveFrameX = applyDeadZone(frameX, options.positionDeadZoneX);
        const effectiveFrameY = applyDeadZone(frameY, options.positionDeadZoneY);
        const effectiveScale = compressScaleDelta(scaleDelta, options.dollyDeadZone, 0.45);

        this._lastInput = { yaw, pitch, roll, scaleDelta, frameX, frameY };
        this._lastEffective = {
            yaw: effectiveYaw,
            pitch: effectivePitch,
            roll: effectiveRoll,
            scaleDelta: effectiveScale,
            frameX: effectiveFrameX,
            frameY: effectiveFrameY,
        };

        this._baseOffset.subVectors(this._baseline.position, this._baseline.target);
        this._baseForward.subVectors(this._baseline.target, this._baseline.position).normalize();
        this._baseRight.crossVectors(this._baseForward, this._baseline.up).normalize();
        this._baseUp.crossVectors(this._baseRight, this._baseForward).normalize();

        const ribbonYaw = effectiveYaw * -options.ribbonYawGain;
        const ribbonPitch = effectivePitch * options.ribbonPitchGain;
        const ribbonRoll = effectiveRoll * options.ribbonRollGain;
        const ribbonTranslateX = effectiveFrameX * -options.ribbonTranslateXGain;
        const ribbonTranslateY = effectiveFrameY * options.ribbonTranslateYGain;

        this._yawQuat.setFromAxisAngle(this._baseUp, ribbonYaw);
        this._pitchAxis.copy(this._baseRight).applyQuaternion(this._yawQuat).normalize();
        this._pitchQuat.setFromAxisAngle(this._pitchAxis, ribbonPitch);
        this._rollAxis.copy(this._baseForward).applyQuaternion(this._yawQuat).applyQuaternion(this._pitchQuat).normalize();
        this._rollQuat.setFromAxisAngle(this._rollAxis, ribbonRoll);

        const dollyFactor = MathUtils.clamp(
            1 - (effectiveScale * options.dollyGain),
            options.minDollyFactor,
            options.maxDollyFactor,
        );
        const currentDistance = this._baseline.distance * dollyFactor;
        const verticalFov = MathUtils.degToRad(this._camera.fov ?? 50);
        const viewHeight = 2 * Math.tan(verticalFov * 0.5) * currentDistance;
        const viewWidth = viewHeight * (this._camera.aspect || 1);
        const worldOffsetX = ribbonTranslateX * viewWidth * 0.5;
        const worldOffsetY = ribbonTranslateY * viewHeight * 0.5;

        if (this._ribbonRoot && this._baseline.ribbonPosition && this._baseline.ribbonQuaternion) {
            this._deltaQuat.identity();
            this._deltaQuat.multiply(this._yawQuat);
            this._deltaQuat.multiply(this._pitchQuat);
            this._deltaQuat.multiply(this._rollQuat);

            this._ribbonRoot.position.copy(this._baseline.ribbonPosition);
            this._ribbonRoot.position.addScaledVector(this._baseRight, worldOffsetX);
            this._ribbonRoot.position.addScaledVector(this._baseUp, worldOffsetY);
            this._ribbonRoot.quaternion.copy(this._baseline.ribbonQuaternion).premultiply(this._deltaQuat);
            this._ribbonRoot.updateMatrixWorld(true);
        }
        this._lastMapped = {
            ribbonYaw,
            ribbonPitch,
            ribbonRoll,
            ribbonTranslateX,
            ribbonTranslateY,
            worldOffsetX,
            worldOffsetY,
            dollyFactor,
        };
        this._cameraOffset.copy(this._baseOffset).setLength(this._baseline.distance * dollyFactor);

        this._cameraPosition.copy(this._baseline.target).add(this._cameraOffset);
        this._camera.position.copy(this._cameraPosition);
        this._camera.quaternion.copy(this._baseline.quaternion);
        this._camera.up.copy(this._baseline.up);

        this._camera.updateMatrixWorld();

        if (this._controls) {
            this._controls.target.copy(this._baseline.target);
        }
    }

    getDebugTelemetry() {
        const target = this._controls?.target ?? this._baseline?.target ?? null;
        const currentDistance = (this._camera && target)
            ? this._camera.position.distanceTo(target)
            : null;

        return {
            active: this._active,
            input: { ...this._lastInput },
            effective: { ...this._lastEffective },
            mapped: { ...this._lastMapped },
            baselineDistance: this._baseline?.distance ?? null,
            currentDistance,
            cameraPosition: toPlainVector(this._camera?.position),
            cameraTarget: toPlainVector(target),
            ribbonPosition: toPlainVector(this._ribbonRoot?.position ?? this._baseline?.ribbonPosition ?? null),
        };
    }
}