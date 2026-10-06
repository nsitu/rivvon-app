// Rounded to the settings sliders' 0.01 steps, using the New Line Cinema
// reference: 7.20 x 6.57 holes, 10.47 gaps, 2.90 edge inset, 1.04 radius.
// Lengths are relative to ribbon width. With the shader's aperture mapping,
// these defaults give a 0.10 x 0.0909 hole (1.10:1), a 0.0395 edge inset,
// and a radius of 15.7% of hole width. Hole:gap is approximately 67:100.
export const DEFAULT_FILMSTRIP_STYLE_ENABLED = false;
export const DEFAULT_FILMSTRIP_GAP_LENGTH = 0.15;
export const MIN_FILMSTRIP_GAP_LENGTH = 0.05;
export const MAX_FILMSTRIP_GAP_LENGTH = 2;
export const DEFAULT_FILMSTRIP_HOLE_LENGTH = 0.10;
export const MIN_FILMSTRIP_HOLE_LENGTH = 0.05;
export const MAX_FILMSTRIP_HOLE_LENGTH = 1;
export const DEFAULT_FILMSTRIP_APERTURE = 0.23;
export const MIN_FILMSTRIP_APERTURE = 0.1;
export const MAX_FILMSTRIP_APERTURE = 0.95;
export const DEFAULT_FILMSTRIP_HOLE_ROUNDEDNESS = 0.33;
export const MIN_FILMSTRIP_HOLE_ROUNDEDNESS = 0;
export const MAX_FILMSTRIP_HOLE_ROUNDEDNESS = 1;
export const FILMSTRIP_EDGE_BAND_WIDTH = 0.17;

export const DEFAULT_FILMSTRIP_MOTION_ENABLED = false;
export const DEFAULT_FILMSTRIP_MOTION_SPEED = 1;
export const MIN_FILMSTRIP_MOTION_SPEED = 0.1;
export const MAX_FILMSTRIP_MOTION_SPEED = 3;

// A multiplier keeps 100% aligned with the conveyor's applied speed.
export function normalizeFilmstripMotionSpeed(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed)
        ? Math.min(MAX_FILMSTRIP_MOTION_SPEED, Math.max(MIN_FILMSTRIP_MOTION_SPEED, parsed))
        : DEFAULT_FILMSTRIP_MOTION_SPEED;
}
