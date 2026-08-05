import { Quaternion, Vector3 } from "three";
import { watch } from "vue";
import {
  getViewerMotionAngle,
  normalizeViewerMotionMode,
} from "../../modules/viewer/viewerMotion.js";
import { getCircularTiltAnglesAtProgress } from "../../modules/viewer/mouseTiltMotion.js";
import { getSeamlessLoopDurationForCount } from "../../modules/viewer/seamlessLoop.js";

const WORLD_UP = new Vector3(0, 1, 0);

export function useViewerMotion(ctx) {
  let activeMode = "none";
  let activeRoot = null;
  let motionStartTime = null;
  let baseline = null;

  const baseForward = new Vector3();
  const baseRight = new Vector3();
  const baseUp = new Vector3();
  const yawQuaternion = new Quaternion();
  const pitchQuaternion = new Quaternion();
  const deltaQuaternion = new Quaternion();
  const orbitRotation = new Quaternion();
  const orbitOffset = new Vector3();
  const pitchAxis = new Vector3();

  function resolveRoot() {
    return ctx.ribbonSeries.value?.getTransformRoot?.() ?? null;
  }

  function captureBaseline() {
    const root = resolveRoot();
    if (!root || !ctx.camera.value) {
      return false;
    }

    const target = ctx.controls.value?.target?.clone() ?? root.position.clone();
    const camera = ctx.camera.value;

    baseForward.subVectors(target, camera.position).normalize();
    baseRight.crossVectors(baseForward, camera.up).normalize();
    baseUp.crossVectors(baseRight, baseForward).normalize();

    baseline = {
      root,
      position: root.position.clone(),
      quaternion: root.quaternion.clone(),
      pivot: ctx.app.sphericalProjectionEnabled
        ? new Vector3(0, 0, 0)
        : target,
      baseRight: baseRight.clone(),
      baseUp: baseUp.clone(),
    };
    activeRoot = root;
    return true;
  }

  function restoreBaseline() {
    if (!baseline?.root) {
      return;
    }

    baseline.root.position.copy(baseline.position);
    baseline.root.quaternion.copy(baseline.quaternion);
    baseline.root.updateMatrixWorld(true);
  }

  function deactivate({ restore = true } = {}) {
    if (restore) {
      restoreBaseline();
    }

    activeMode = "none";
    activeRoot = null;
    motionStartTime = null;
    baseline = null;
  }

  function activate(mode, now) {
    if (!captureBaseline()) {
      return false;
    }

    activeMode = mode;
    motionStartTime = now;
    return true;
  }

  function getRequestedMode() {
    if (
      ctx.app.viewerControlMode !== "orbit" ||
      ctx.cinematicCamera.isPlaying.value
    ) {
      return "none";
    }

    return normalizeViewerMotionMode(ctx.app.viewerMotionMode);
  }

  function syncMode(now) {
    const requestedMode = getRequestedMode();
    if (requestedMode === activeMode && activeRoot === resolveRoot()) {
      return;
    }

    deactivate();
    if (requestedMode !== "none") {
      activate(requestedMode, now);
    }
  }

  function applyCircularTilt(progress) {
    const { yaw, pitch } = getCircularTiltAnglesAtProgress(progress);
    const ribbonYaw = -yaw;

    yawQuaternion.setFromAxisAngle(baseline.baseUp, ribbonYaw);
    pitchAxis.copy(baseline.baseRight).applyQuaternion(yawQuaternion).normalize();
    pitchQuaternion.setFromAxisAngle(pitchAxis, pitch);

    deltaQuaternion.identity();
    deltaQuaternion.multiply(yawQuaternion);
    deltaQuaternion.multiply(pitchQuaternion);

    baseline.root.position.copy(baseline.position);
    baseline.root.quaternion
      .copy(baseline.quaternion)
      .premultiply(deltaQuaternion);
  }

  function applyCircularOrbit(progress, direction) {
    orbitRotation.setFromAxisAngle(
      WORLD_UP,
      getViewerMotionAngle(progress, direction),
    );

    orbitOffset
      .copy(baseline.position)
      .sub(baseline.pivot)
      .applyQuaternion(orbitRotation);

    baseline.root.position.copy(baseline.pivot).add(orbitOffset);
    baseline.root.quaternion
      .copy(baseline.quaternion)
      .premultiply(orbitRotation);
  }

  function tick(now) {
    syncMode(now);
    if (activeMode === "none" || motionStartTime == null || !baseline) {
      return;
    }

    const motionDuration = getSeamlessLoopDurationForCount(
      ctx.tileManager.value,
      ctx.app.viewerMotionLoopCount,
      ctx.app.undulationEnabled,
    );
    const progress = (Math.max(0, now - motionStartTime) / 1000) / motionDuration;

    if (activeMode === "circularTilt") {
      applyCircularTilt(progress);
    } else if (activeMode === "circularOrbit") {
      applyCircularOrbit(progress, 1);
    } else if (activeMode === "circularOrbitReverse") {
      applyCircularOrbit(progress, -1);
    }

    baseline.root.updateMatrixWorld(true);
  }

  watch(
    () => ctx.ribbonSeries.value,
    () => {
      if (activeMode !== "none") {
        deactivate();
      }
    },
  );

  return {
    tick,
    deactivate,
  };
}
