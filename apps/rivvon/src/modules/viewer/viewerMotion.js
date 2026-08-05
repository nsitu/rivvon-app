import { MathUtils } from "three";
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
];

export function normalizeArtworkMotionMode(value) {
  return ARTWORK_MOTION_MODES.includes(value)
    ? value
    : DEFAULT_ARTWORK_MOTION_MODE;
}

export function getArtworkMotionAngle(progress, direction = 1) {
  return MathUtils.euclideanModulo(progress, 1) * Math.PI * 2 * direction;
}
