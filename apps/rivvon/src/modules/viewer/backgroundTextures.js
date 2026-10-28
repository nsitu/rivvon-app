export const BACKGROUND_TEXTURE_OPTIONS = [
  {
    label: "Card",
    value: "card",
    url: "/background-textures/card.jpg",
  },
  {
    label: "Textile",
    value: "textile",
    url: "/background-textures/textile.jpg",
  },
  {
    label: "Cenote",
    value: "cenote",
    url: "/background-textures/cenote.jpg",
  },
];

export const DEFAULT_BACKGROUND_TEXTURE = "card";
export const DEFAULT_BACKGROUND_TEXTURE_VERTICAL_ALIGNMENT = 0.5;

export function normalizeBackgroundTextureVerticalAlignment(value) {
  const parsed = Number(value);
  return value == null || !Number.isFinite(parsed)
    ? DEFAULT_BACKGROUND_TEXTURE_VERTICAL_ALIGNMENT
    : Math.max(0, Math.min(1, parsed));
}

// Cover fit: crop the longer image axis to fill the background surface
// without stretching. Unknown image dimensions leave the UVs unchanged.
export function getBackgroundTextureCoverScale(imageWidth, imageHeight, surfaceAspect) {
  const width = Number(imageWidth);
  const height = Number(imageHeight);
  const aspect = Number(surfaceAspect);
  if (![width, height, aspect].every(value => value > 0 && Number.isFinite(value))) {
    return [1, 1];
  }
  const imageAspect = width / height;
  const ratio = aspect / imageAspect;
  return [Math.min(1, ratio), Math.min(1, 1 / ratio)];
}

export function normalizeBackgroundTexture(value) {
  return BACKGROUND_TEXTURE_OPTIONS.some((option) => option.value === value)
    ? value
    : DEFAULT_BACKGROUND_TEXTURE;
}

export function getBackgroundTextureOption(value) {
  return (
    BACKGROUND_TEXTURE_OPTIONS.find((option) => option.value === value) ||
    BACKGROUND_TEXTURE_OPTIONS[0]
  );
}
