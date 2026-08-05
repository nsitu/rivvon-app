import { MathUtils } from "three";

export const VIEWER_MOTION_MODES = [
  "none",
  "circularTilt",
  "circularOrbit",
  "circularOrbitReverse",
];

export const DEFAULT_VIEWER_MOTION_MODE = "none";
export const VIEWER_MOTION_PERIOD_SECONDS = 12;

export const VIEWER_MOTION_OPTIONS = [
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

export function normalizeViewerMotionMode(value) {
  return VIEWER_MOTION_MODES.includes(value)
    ? value
    : DEFAULT_VIEWER_MOTION_MODE;
}

export function getViewerMotionAngle(progress, direction = 1) {
  return MathUtils.euclideanModulo(progress, 1) * Math.PI * 2 * direction;
}
