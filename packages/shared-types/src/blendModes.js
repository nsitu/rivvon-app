// Order is also the shader mode index. Keep both renderers on this contract.
export const BLEND_MODE_OPTIONS = Object.freeze([
    { label: 'Normal', value: 'normal' },
    { label: 'Soft Light', value: 'softLight' },
    { label: 'Multiply', value: 'multiply' },
    { label: 'Screen', value: 'screen' },
    { label: 'Overlay', value: 'overlay' },
    { label: 'Difference', value: 'difference' },
].map(Object.freeze));
export const BLEND_MODES = Object.freeze(BLEND_MODE_OPTIONS.map(option => option.value));
export const normalizeBlendMode = (value, fallback = 'normal') => BLEND_MODES.includes(value) ? value : fallback;
export const getBlendModeIndex = (value, fallback = 'normal') => BLEND_MODES.indexOf(normalizeBlendMode(value, fallback));

export function normalizeBlendStrength(value) {
    const amount = Number(value);
    return value == null || !Number.isFinite(amount) ? 1 : Math.min(1, Math.max(0, amount));
}
