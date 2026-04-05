export const DEFAULT_WALK_TILE_BRIGHTNESS = 1.06;
export const DEFAULT_WALK_TILE_CONTRAST = 1.14;
export const DEFAULT_WALK_TILE_FILTER_MULTIPLIER = 1;
export const MAX_WALK_TILE_FILTER_MULTIPLIER = 5;

function clampMultiplier(value) {
    return Math.max(
        DEFAULT_WALK_TILE_FILTER_MULTIPLIER,
        Math.min(MAX_WALK_TILE_FILTER_MULTIPLIER, Number(value) || DEFAULT_WALK_TILE_FILTER_MULTIPLIER)
    );
}

export function getWalkTileBrightness(multiplier = DEFAULT_WALK_TILE_FILTER_MULTIPLIER) {
    return DEFAULT_WALK_TILE_BRIGHTNESS * clampMultiplier(multiplier);
}

export function getWalkTileContrast(multiplier = DEFAULT_WALK_TILE_FILTER_MULTIPLIER) {
    return DEFAULT_WALK_TILE_CONTRAST * clampMultiplier(multiplier);
}

export function formatWalkTileFilter(
    brightnessMultiplier = DEFAULT_WALK_TILE_FILTER_MULTIPLIER,
    contrastMultiplier = DEFAULT_WALK_TILE_FILTER_MULTIPLIER
) {
    const brightness = getWalkTileBrightness(brightnessMultiplier);
    const contrast = getWalkTileContrast(contrastMultiplier);

    return `brightness(${brightness.toFixed(2)}) contrast(${contrast.toFixed(2)})`;
}

export function clampWalkTileFilterMultiplier(value) {
    return clampMultiplier(value);
}