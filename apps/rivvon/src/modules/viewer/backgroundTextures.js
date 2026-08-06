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
    label: "Water",
    value: "water",
    type: "procedural",
  },
];

export const DEFAULT_BACKGROUND_TEXTURE = "card";

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
