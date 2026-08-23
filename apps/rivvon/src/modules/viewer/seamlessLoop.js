export const SEAMLESS_LOOP_COUNTS = [1, 2, 3, 4];
export const DEFAULT_SEAMLESS_LOOP_COUNT = 1;

export const SEAMLESS_LOOP_COUNT_OPTIONS = SEAMLESS_LOOP_COUNTS.map((value) => ({
  label: `${value} ${value === 1 ? "loop" : "loops"}`,
  value,
}));

// Motion duration is expressed as a multiplier of one material loop. Keep
// these values separate from material/export loop counts so fractional motion
// rates do not become valid material/export loop counts.
export const MOTION_LOOP_DURATION_MULTIPLIERS = [
  1,
  0.5,
  1 / 3,
  0.25,
  0.2,
  1 / 6,
  1 / 7,
  0.125,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
];
export const DEFAULT_MOTION_LOOP_DURATION_MULTIPLIER = 1;

export const MOTION_LOOP_DURATION_OPTIONS = [
  { label: "1 path per material loop", value: 1, pathCount: 1, materialLoopCount: 1 },
  { label: "2 paths per material loop", value: 0.5, pathCount: 2, materialLoopCount: 1 },
  { label: "3 paths per material loop", value: 1 / 3, pathCount: 3, materialLoopCount: 1 },
  { label: "4 paths per material loop", value: 0.25, pathCount: 4, materialLoopCount: 1 },
  { label: "5 paths per material loop", value: 0.2, pathCount: 5, materialLoopCount: 1 },
  { label: "6 paths per material loop", value: 1 / 6, pathCount: 6, materialLoopCount: 1 },
  { label: "7 paths per material loop", value: 1 / 7, pathCount: 7, materialLoopCount: 1 },
  { label: "8 paths per material loop", value: 0.125, pathCount: 8, materialLoopCount: 1 },
  { label: "1 path per 2 material loops", value: 2, pathCount: 1, materialLoopCount: 2 },
  { label: "1 path per 3 material loops", value: 3, pathCount: 1, materialLoopCount: 3 },
  { label: "1 path per 4 material loops", value: 4, pathCount: 1, materialLoopCount: 4 },
  { label: "1 path per 5 material loops", value: 5, pathCount: 1, materialLoopCount: 5 },
  { label: "1 path per 6 material loops", value: 6, pathCount: 1, materialLoopCount: 6 },
  { label: "1 path per 7 material loops", value: 7, pathCount: 1, materialLoopCount: 7 },
  { label: "1 path per 8 material loops", value: 8, pathCount: 1, materialLoopCount: 8 },
];

export function normalizeSeamlessLoopCount(value) {
  const parsed = Number(value);
  return SEAMLESS_LOOP_COUNTS.includes(parsed)
    ? parsed
    : DEFAULT_SEAMLESS_LOOP_COUNT;
}

export function normalizeMotionLoopDurationMultiplier(value) {
  const parsed = Number(value);
  const matchingMultiplier = MOTION_LOOP_DURATION_MULTIPLIERS.find(
    (multiplier) => Math.abs(multiplier - parsed) < 1e-6,
  );
  return matchingMultiplier ?? DEFAULT_MOTION_LOOP_DURATION_MULTIPLIER;
}

export function getSeamlessLoopDuration(
  tileManager,
  includeUndulation = true,
  fallback = 3,
) {
  const fallbackDuration = Math.max(0.1, Number(fallback) || 3);
  const duration = tileManager?.getSeamlessLoopDuration?.(includeUndulation);
  return Math.max(0.1, Number(duration) || fallbackDuration);
}

export function getSeamlessLoopDurationForCount(
  tileManager,
  loopCount = DEFAULT_SEAMLESS_LOOP_COUNT,
  includeUndulation = true,
  fallback = 3,
) {
  return getSeamlessLoopDuration(tileManager, includeUndulation, fallback)
    * normalizeSeamlessLoopCount(loopCount);
}

export function getSeamlessLoopDurationForMotionRate(
  tileManager,
  durationMultiplier = DEFAULT_MOTION_LOOP_DURATION_MULTIPLIER,
  includeUndulation = true,
  fallback = 3,
) {
  return getSeamlessLoopDuration(tileManager, includeUndulation, fallback)
    * normalizeMotionLoopDurationMultiplier(durationMultiplier);
}
