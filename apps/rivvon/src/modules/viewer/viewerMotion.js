import { Euler, MathUtils, Quaternion } from "three";
import {
  DEFAULT_SEAMLESS_LOOP_COUNT as DEFAULT_ARTWORK_MOTION_LOOP_COUNT,
  SEAMLESS_LOOP_COUNTS as ARTWORK_MOTION_LOOP_COUNTS,
  SEAMLESS_LOOP_COUNT_OPTIONS as ARTWORK_MOTION_LOOP_COUNT_OPTIONS,
  normalizeSeamlessLoopCount as normalizeArtworkMotionLoopCount,
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

// A small, deterministic Fourier series gives us band-limited periodic noise.
// Integer frequencies make the value and slope repeat at every loop seam.
const TUMBLE_HARMONICS = {
  x: [
    [1, MathUtils.degToRad(13), 0.35],
    [2, MathUtils.degToRad(6), 2.1],
    [4, MathUtils.degToRad(2), -0.7],
  ],
  y: [
    [1, MathUtils.degToRad(18), 1.4],
    [3, MathUtils.degToRad(7), -0.25],
    [5, MathUtils.degToRad(2.5), 2.6],
  ],
  z: [
    [2, MathUtils.degToRad(7), 0.8],
    [3, MathUtils.degToRad(3.5), 2.35],
    [5, MathUtils.degToRad(1.5), -1.1],
  ],
};

function evaluatePeriodicNoise(harmonics, phase) {
  return harmonics.reduce((value, [frequency, amplitude, offset]) => (
    value
    + amplitude * (
      Math.sin(phase * frequency + offset) - Math.sin(offset)
    )
  ), 0);
}

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
  rotation = new Euler(),
) {
  const normalizedProgress = MathUtils.euclideanModulo(Number(progress) || 0, 1);
  if (normalizedProgress === 0) {
    return target.identity();
  }

  const phase = normalizedProgress * Math.PI * 2;
  rotation.set(
    evaluatePeriodicNoise(TUMBLE_HARMONICS.x, phase),
    evaluatePeriodicNoise(TUMBLE_HARMONICS.y, phase),
    evaluatePeriodicNoise(TUMBLE_HARMONICS.z, phase),
    "YXZ",
  );

  return target.setFromEuler(rotation).normalize();
}
