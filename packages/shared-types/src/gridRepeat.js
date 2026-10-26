// Shared by the viewer and the preset validator; these are artwork settings.
export const MIN_GRID_REPEAT_COUNT = 1;
export const MAX_GRID_REPEAT_COUNT = 12;
export const GRID_REPEAT_DEFAULTS = Object.freeze({
    gridRepeatEnabled: false,
    gridRepeatColumns: 3,
    gridRepeatRows: 3,
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
        gridRepeatCheckerboard: settings.gridRepeatCheckerboard === true,
    };
}
