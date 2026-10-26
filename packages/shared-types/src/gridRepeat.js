// Shared by the viewer and the preset validator; these are artwork settings.
export const MIN_GRID_REPEAT_COUNT = 1;
export const MAX_GRID_REPEAT_COUNT = 12;
// Gap between motif bounds in base ribbon widths; negative gaps overlap copies.
export const MIN_GRID_REPEAT_SPACING = -5;
export const MAX_GRID_REPEAT_SPACING = 5;
export const GRID_REPEAT_DEFAULTS = Object.freeze({
    gridRepeatEnabled: false,
    gridRepeatColumns: 3,
    gridRepeatRows: 3,
    gridRepeatColumnSpacing: 1,
    gridRepeatRowSpacing: 1,
    gridRepeatCheckerboard: false,
});

export function normalizeGridRepeatCount(value) {
    const count = Number(value);
    return Number.isFinite(count)
        ? Math.max(MIN_GRID_REPEAT_COUNT, Math.min(MAX_GRID_REPEAT_COUNT, Math.round(count)))
        : GRID_REPEAT_DEFAULTS.gridRepeatColumns;
}

export function normalizeGridRepeatSettings(settings = {}) {
    return {
        gridRepeatEnabled: settings.gridRepeatEnabled === true,
        gridRepeatColumns: normalizeGridRepeatCount(settings.gridRepeatColumns ?? 3),
        gridRepeatRows: normalizeGridRepeatCount(settings.gridRepeatRows ?? 3),
        gridRepeatColumnSpacing: normalizeGridRepeatSpacing(settings.gridRepeatColumnSpacing ?? 1),
        gridRepeatRowSpacing: normalizeGridRepeatSpacing(settings.gridRepeatRowSpacing ?? 1),
        gridRepeatCheckerboard: settings.gridRepeatCheckerboard === true,
    };
}

export function normalizeGridRepeatSpacing(value) {
    const spacing = Number(value);
    return Number.isFinite(spacing)
        ? Math.max(MIN_GRID_REPEAT_SPACING, Math.min(MAX_GRID_REPEAT_SPACING, spacing))
        : GRID_REPEAT_DEFAULTS.gridRepeatColumnSpacing;
}
