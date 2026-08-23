import { MathUtils, Quaternion, Vector3 } from "three";
import {
  DEFAULT_MOTION_LOOP_DURATION_MULTIPLIER as DEFAULT_ARTWORK_MOTION_LOOP_COUNT,
  MOTION_LOOP_DURATION_MULTIPLIERS as ARTWORK_MOTION_LOOP_COUNTS,
  MOTION_LOOP_DURATION_OPTIONS as ARTWORK_MOTION_LOOP_COUNT_OPTIONS,
  normalizeMotionLoopDurationMultiplier as normalizeArtworkMotionLoopCount,
} from "./seamlessLoop.js";

export const ARTWORK_MOTION_MODES = [
  "none",
  "circularTilt",
  "circularOrbit",
  "circularOrbitReverse",
  "tumbleOrbit",
];

export const DEFAULT_ARTWORK_MOTION_MODE = "none";
export {
  DEFAULT_ARTWORK_MOTION_LOOP_COUNT,
  ARTWORK_MOTION_LOOP_COUNTS,
  ARTWORK_MOTION_LOOP_COUNT_OPTIONS,
  normalizeArtworkMotionLoopCount,
};

export const ARTWORK_MOTION_OPTIONS = [
  {
    label: "None",
    value: "none",
    description: "Artwork stays fixed while you control the camera.",
  },
  {
    label: "Circular Tilt",
    value: "circularTilt",
    description: "Artwork tilts through one full 360° rotation.",
  },
  {
    label: "Counterclockwise Orbit",
    value: "circularOrbit",
    description: "Artwork completes one full counterclockwise turntable orbit.",
  },
  {
    label: "Clockwise Orbit",
    value: "circularOrbitReverse",
    description: "Artwork completes one full clockwise turntable orbit.",
  },
  {
    label: "Tumble Orbit",
    value: "tumbleOrbit",
    description: "Artwork follows a seamless organic tumble across all three axes.",
  },
];

// One coherent revolution around a diagonal axis reads as rigid-body motion.
// A very small orthogonal wobble keeps it from feeling mechanically perfect.
const TUMBLE_AXIS = new Vector3(0.68, 0.55, 0.48).normalize();
const TUMBLE_WOBBLE_AXIS = new Vector3(-0.45, 0.82, -0.35).normalize();
const TUMBLE_WOBBLE_RADIANS = MathUtils.degToRad(4);

export function normalizeArtworkMotionMode(value) {
  return ARTWORK_MOTION_MODES.includes(value)
    ? value
    : DEFAULT_ARTWORK_MOTION_MODE;
}

export function getArtworkMotionAngle(progress, direction = 1) {
  return MathUtils.euclideanModulo(progress, 1) * Math.PI * 2 * direction;
}

/**
 * Evaluate the tumble directly from loop progress so playback never accumulates
 * rotational drift. Integral progress always resolves to the identity quaternion.
 */
export function getTumbleOrbitQuaternionAtProgress(
  progress,
  target = new Quaternion(),
  wobble = new Quaternion(),
) {
  const normalizedProgress = MathUtils.euclideanModulo(Number(progress) || 0, 1);
  if (normalizedProgress === 0) {
    return target.identity();
  }

  const phase = normalizedProgress * Math.PI * 2;
  target.setFromAxisAngle(TUMBLE_AXIS, phase);
  wobble.setFromAxisAngle(
    TUMBLE_WOBBLE_AXIS,
    Math.sin(phase) * TUMBLE_WOBBLE_RADIANS,
  );

  return target.premultiply(wobble).normalize();
}
