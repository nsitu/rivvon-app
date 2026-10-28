export const DEFAULT_BACKGROUND_MODE = 'texture';
export const DEFAULT_BACKGROUND_GRADIENT_INFLUENCE = 0.5;
export const DEFAULT_BACKGROUND_GRADIENT_FALLOFF = 2;
export const normalizeBackgroundMode = value => value === 'gradient' ? 'gradient' : DEFAULT_BACKGROUND_MODE;
const clamp = (value, fallback, min, max) => Number.isFinite(Number(value))
    ? Math.max(min, Math.min(max, Number(value))) : fallback;
export const normalizeBackgroundGradientInfluence = value => clamp(value ?? DEFAULT_BACKGROUND_GRADIENT_INFLUENCE, DEFAULT_BACKGROUND_GRADIENT_INFLUENCE, 0.15, 1.5);
export const normalizeBackgroundGradientFalloff = value => clamp(value ?? DEFAULT_BACKGROUND_GRADIENT_FALLOFF, DEFAULT_BACKGROUND_GRADIENT_FALLOFF, 0.5, 6);
