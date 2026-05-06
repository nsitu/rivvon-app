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

export function getTextureOverviewPreset(presetId = DEFAULT_PRESET_ID) {
    return PRESETS.find((preset) => preset.id === presetId) || PRESETS[0];
}

export function calculateTextureOverviewLayout(options = {}) {
    const {
        targetWidth = 1920,
        targetHeight = 1080,
        tileWidth = 512,
        tileHeight = tileWidth,
        spacing = 0,
    } = options;

    const safeTileWidth = Math.max(1, Math.round(Number(tileWidth) || 1));
    const safeTileHeight = Math.max(1, Math.round(Number(tileHeight) || safeTileWidth));
    const safeSpacing = Math.max(0, Number(spacing) || 0);
    const cellWidth = safeTileWidth + safeSpacing;
    const cellHeight = safeTileHeight + safeSpacing;
    const safeTargetWidth = Math.max(1, Number(targetWidth) || safeTileWidth);
    const safeTargetHeight = Math.max(1, Number(targetHeight) || safeTileHeight);
    const cols = Math.max(1, Math.ceil((safeTargetWidth + safeSpacing) / cellWidth));
    const rows = Math.max(1, Math.ceil((safeTargetHeight + safeSpacing) / cellHeight));
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
            x: -safeTargetWidth / 2 + safeTileWidth / 2 + col * cellWidth,
            y: safeTargetHeight / 2 - safeTileHeight / 2 - row * cellHeight,
        });
    }

    return {
        cols,
        rows,
        cellCount,
        frameWidth: safeTargetWidth,
        frameHeight: safeTargetHeight,
        width,
        height,
        tileWidth: safeTileWidth,
        tileHeight: safeTileHeight,
        spacing: safeSpacing,
        positions,
    };
}