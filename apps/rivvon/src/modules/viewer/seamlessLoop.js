export const SEAMLESS_LOOP_COUNTS = [1, 2, 3, 4];
export const DEFAULT_SEAMLESS_LOOP_COUNT = 1;

export const SEAMLESS_LOOP_COUNT_OPTIONS = SEAMLESS_LOOP_COUNTS.map((value) => ({
  label: `${value} ${value === 1 ? "loop" : "loops"}`,
  value,
}));

export function normalizeSeamlessLoopCount(value) {
  const parsed = Number(value);
  return SEAMLESS_LOOP_COUNTS.includes(parsed)
    ? parsed
    : DEFAULT_SEAMLESS_LOOP_COUNT;
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
