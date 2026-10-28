export function getDefaultSceneProjectionPreviewResolution() {
  const coarsePointer =
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches;
  return coarsePointer ? 256 : 512;
}

export function normalizeSceneProjectionPreviewResolution(value) {
  if (value === "full") return value;
  const parsed = Number(value);
  return parsed === 256 || parsed === 512
    ? parsed
    : getDefaultSceneProjectionPreviewResolution();
}
