const DEFAULT_PRESET_ID = 'landscape-1080p';

const PRESETS = [
    {
        id: 'landscape-1080p',
        label: 'Landscape HD',
        width: 1920,
        height: 1080,
    },
    {
        id: 'portrait-1080p',
        label: 'Portrait HD',
        width: 1080,
        height: 1920,
    },
    {
        id: 'square-1080',
        label: 'Square',
        width: 1080,
        height: 1080,
    },
    {
        id: 'landscape-4k',
        label: 'Landscape 4K',
        width: 3840,
        height: 2160,
    },
];

export const TEXTURE_OVERVIEW_PRESETS = PRESETS;
export const DEFAULT_TEXTURE_OVERVIEW_PRESET_ID = DEFAULT_PRESET_ID;
export const TEXTURE_OVERVIEW_LAYOUT_STRATEGY_FILL_FRAME = 'fillFrame';
export const TEXTURE_OVERVIEW_LAYOUT_STRATEGY_ALIGN_TO_EDGE = 'fitRows';
export const DEFAULT_TEXTURE_OVERVIEW_LAYOUT_STRATEGY = TEXTURE_OVERVIEW_LAYOUT_STRATEGY_ALIGN_TO_EDGE;

const TEXTURE_OVERVIEW_LAYOUT_STRATEGIES = [
    TEXTURE_OVERVIEW_LAYOUT_STRATEGY_FILL_FRAME,
    TEXTURE_OVERVIEW_LAYOUT_STRATEGY_ALIGN_TO_EDGE,
];

export function getTextureOverviewPreset(presetId = DEFAULT_PRESET_ID) {
    return PRESETS.find((preset) => preset.id === presetId) || PRESETS[0];
}

export function normalizeTextureOverviewLayoutStrategy(value) {
    return TEXTURE_OVERVIEW_LAYOUT_STRATEGIES.includes(value)
        ? value
        : DEFAULT_TEXTURE_OVERVIEW_LAYOUT_STRATEGY;
}

function findLargestDivisorAtOrBelow(target, maxValue) {
    const safeTarget = Math.max(1, Math.round(Number(target) || 1));
    const safeMaxValue = Math.max(1, Math.min(safeTarget, Math.floor(Number(maxValue) || 1)));

    for (let candidate = safeMaxValue; candidate >= 1; candidate -= 1) {
        if (safeTarget % candidate === 0) {
            return candidate;
        }
    }

    return 1;
}

function findLargestTileSpanThatFitsVertically(targetSpan, tileSpan, spacing = 0) {
    const safeTargetSpan = Math.max(1, Math.round(Number(targetSpan) || 1));
    const safeTileSpan = Math.max(1, Math.round(Number(tileSpan) || 1));
    const safeSpacing = Math.max(0, Math.round(Number(spacing) || 0));
    const maxScale = Math.min(1, safeTargetSpan / safeTileSpan);
    const maxFittedTileSpan = Math.max(1, Math.floor(safeTileSpan * maxScale));

    if (safeSpacing === 0) {
        return findLargestDivisorAtOrBelow(safeTargetSpan, maxFittedTileSpan);
    }

    const maxFittedCellSpan = Math.max(safeSpacing + 1, maxFittedTileSpan + safeSpacing);
    const fittedCellSpan = findLargestDivisorAtOrBelow(safeTargetSpan + safeSpacing, maxFittedCellSpan);
    return Math.max(1, fittedCellSpan - safeSpacing);
}

export function calculateTextureOverviewLayout(options = {}) {
    const {
        targetWidth = 1920,
        targetHeight = 1080,
        tileWidth = 512,
        tileHeight = tileWidth,
        spacing = 0,
        strategy = DEFAULT_TEXTURE_OVERVIEW_LAYOUT_STRATEGY,
    } = options;

    const safeTileWidth = Math.max(1, Math.round(Number(tileWidth) || 1));
    const safeTileHeight = Math.max(1, Math.round(Number(tileHeight) || safeTileWidth));
    const safeSpacing = Math.max(0, Number(spacing) || 0);
    const safeTargetWidth = Math.max(1, Number(targetWidth) || safeTileWidth);
    const safeTargetHeight = Math.max(1, Number(targetHeight) || safeTileHeight);
    const safeStrategy = normalizeTextureOverviewLayoutStrategy(strategy);
    let resolvedTileWidth = safeTileWidth;
    let resolvedTileHeight = safeTileHeight;

    if (safeStrategy === TEXTURE_OVERVIEW_LAYOUT_STRATEGY_ALIGN_TO_EDGE) {
        const fittedTileHeight = findLargestTileSpanThatFitsVertically(
            safeTargetHeight,
            safeTileHeight,
            safeSpacing,
        );
        const fittedScale = fittedTileHeight / safeTileHeight;

        resolvedTileHeight = fittedTileHeight;
        resolvedTileWidth = Math.max(
            1,
            Math.min(
                Math.floor(safeTargetWidth),
                Math.round(safeTileWidth * fittedScale),
            ),
        );
    }

    const cellWidth = resolvedTileWidth + safeSpacing;
    const cellHeight = resolvedTileHeight + safeSpacing;
    const cols = Math.max(1, Math.ceil((safeTargetWidth + safeSpacing) / cellWidth));
    const rows = safeStrategy === TEXTURE_OVERVIEW_LAYOUT_STRATEGY_ALIGN_TO_EDGE
        ? Math.max(1, Math.floor((safeTargetHeight + safeSpacing) / cellHeight))
        : Math.max(1, Math.ceil((safeTargetHeight + safeSpacing) / cellHeight));
    const cellCount = cols * rows;
    const width = cols * cellWidth - safeSpacing;
    const height = rows * cellHeight - safeSpacing;
    const positions = [];

    for (let index = 0; index < cellCount; index += 1) {
        const col = index % cols;
        const row = Math.floor(index / cols);

        positions.push({
            index,
            col,
            row,
            x: -safeTargetWidth / 2 + resolvedTileWidth / 2 + col * cellWidth,
            y: safeTargetHeight / 2 - resolvedTileHeight / 2 - row * cellHeight,
        });
    }

    return {
        strategy: safeStrategy,
        cols,
        rows,
        cellCount,
        frameWidth: safeTargetWidth,
        frameHeight: safeTargetHeight,
        width,
        height,
        tileWidth: resolvedTileWidth,
        tileHeight: resolvedTileHeight,
        spacing: safeSpacing,
        positions,
    };
}