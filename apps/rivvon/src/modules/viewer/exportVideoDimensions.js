export const DEFAULT_EXPORT_ASPECT_RATIO_PRESET = 'landscape';
export const DEFAULT_EXPORT_CUSTOM_WIDTH = 1920;
export const DEFAULT_EXPORT_CUSTOM_HEIGHT = 1080;

export const EXPORT_ASPECT_RATIO_OPTIONS = [
    { label: 'Landscape (16:9)', value: 'landscape', icon: 'panorama_horizontal' },
    { label: 'Portrait (9:16)', value: 'portrait', icon: 'panorama_vertical' },
    { label: 'Instagram (5:4)', value: 'instagram-5x4', icon: 'crop_portrait' },
    { label: 'Square (1:1)', value: 'square', icon: 'crop_square' },
    { label: 'Custom', value: 'custom', icon: 'crop_free' },
];

export const EXPORT_RESOLUTION_OPTIONS_BY_ASPECT = {
    landscape: [
        { label: '720p (1280×720)', value: '720p' },
        { label: '1080p (1920×1080)', value: '1080p' },
        { label: '4K (3840×2160)', value: '4k' },
    ],
    portrait: [
        { label: '720p (720×1280)', value: '720p-v' },
        { label: '1080p (1080×1920)', value: '1080p-v' },
        { label: '4K (2160×3840)', value: '4k-v' },
    ],
    square: [
        { label: '1080 (1080×1080)', value: 'square' },
        { label: '1920 (1920×1920)', value: 'square-1920' },
        { label: '2160 (2160×2160)', value: 'square-2160' },
        { label: '3840 (3840×3840)', value: 'square-3840' },
    ],
    'instagram-5x4': [
        { label: 'Post (1080×1350)', value: 'ig-5x4-1080' },
        { label: 'Post HD (1920×2400)', value: 'ig-5x4-1920' },
        { label: 'Post Pro (2160×2700)', value: 'ig-5x4-2160' },
        { label: 'Post Max (3840×4800)', value: 'ig-5x4-3840' },
    ],
    custom: [
        { label: 'Custom Dimensions', value: 'custom' },
    ],
};

export function getExportResolutionOptions(aspectRatioPreset = DEFAULT_EXPORT_ASPECT_RATIO_PRESET) {
    return EXPORT_RESOLUTION_OPTIONS_BY_ASPECT[aspectRatioPreset] || EXPORT_RESOLUTION_OPTIONS_BY_ASPECT[DEFAULT_EXPORT_ASPECT_RATIO_PRESET];
}

export function getDefaultExportResolutionPreset(aspectRatioPreset = DEFAULT_EXPORT_ASPECT_RATIO_PRESET) {
    return getExportResolutionOptions(aspectRatioPreset)[0]?.value || 'custom';
}

export function resolveExportDimensions(options = {}) {
    const {
        resolutionPreset = getDefaultExportResolutionPreset(DEFAULT_EXPORT_ASPECT_RATIO_PRESET),
        customWidth = DEFAULT_EXPORT_CUSTOM_WIDTH,
        customHeight = DEFAULT_EXPORT_CUSTOM_HEIGHT,
    } = options;

    switch (resolutionPreset) {
        case '1080p': return { width: 1920, height: 1080 };
        case '720p': return { width: 1280, height: 720 };
        case '480p': return { width: 854, height: 480 };
        case '4k': return { width: 3840, height: 2160 };
        case 'ig-5x4-1080': return { width: 1080, height: 1350 };
        case 'ig-5x4-1920': return { width: 1920, height: 2400 };
        case 'ig-5x4-2160': return { width: 2160, height: 2700 };
        case 'ig-5x4-3840': return { width: 3840, height: 4800 };
        case '720p-v': return { width: 720, height: 1280 };
        case '1080p-v': return { width: 1080, height: 1920 };
        case '4k-v': return { width: 2160, height: 3840 };
        case 'square': return { width: 1080, height: 1080 };
        case 'square-1920': return { width: 1920, height: 1920 };
        case 'square-2160': return { width: 2160, height: 2160 };
        case 'square-3840': return { width: 3840, height: 3840 };
        case 'custom':
            return {
                width: Math.max(320, Math.round(Number(customWidth) || DEFAULT_EXPORT_CUSTOM_WIDTH)),
                height: Math.max(240, Math.round(Number(customHeight) || DEFAULT_EXPORT_CUSTOM_HEIGHT)),
            };
        default:
            return { width: 1920, height: 1080 };
    }
}

export function normalizeExportDimensionSettings(settings = {}) {
    const requestedAspectRatioPreset = settings?.aspectRatioPreset;
    const aspectRatioPreset = EXPORT_RESOLUTION_OPTIONS_BY_ASPECT[requestedAspectRatioPreset]
        ? requestedAspectRatioPreset
        : DEFAULT_EXPORT_ASPECT_RATIO_PRESET;
    const availableResolutionValues = getExportResolutionOptions(aspectRatioPreset).map((option) => option.value);
    const requestedResolutionPreset = settings?.resolutionPreset;
    const resolutionPreset = availableResolutionValues.includes(requestedResolutionPreset)
        ? requestedResolutionPreset
        : getDefaultExportResolutionPreset(aspectRatioPreset);
    const customWidth = Math.max(320, Math.round(Number(settings?.customWidth) || DEFAULT_EXPORT_CUSTOM_WIDTH));
    const customHeight = Math.max(240, Math.round(Number(settings?.customHeight) || DEFAULT_EXPORT_CUSTOM_HEIGHT));
    const { width, height } = resolveExportDimensions({
        resolutionPreset,
        customWidth,
        customHeight,
    });

    return {
        aspectRatioPreset,
        resolutionPreset,
        customWidth,
        customHeight,
        width,
        height,
    };
}