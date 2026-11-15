import { describe, expect, it } from 'vitest';
import { getDefaultExportResolutionPreset, normalizeExportDimensionSettings, resolveExportDimensions } from './exportVideoDimensions.js';

describe('video export dimensions', () => {
    it('starts at square 2160 and uses that default for missing or invalid settings', () => {
        for (const settings of [{}, { aspectRatioPreset: 'invalid', resolutionPreset: 'invalid' }, { aspectRatioPreset: 'square' }]) {
            expect(normalizeExportDimensionSettings(settings)).toMatchObject({
                aspectRatioPreset: 'square', resolutionPreset: 'square-2160', width: 2160, height: 2160,
            });
        }
        expect(resolveExportDimensions()).toEqual({ width: 2160, height: 2160 });
    });

    it('keeps explicit overview dimensions and other aspect ratios available', () => {
        expect(normalizeExportDimensionSettings({ aspectRatioPreset: 'landscape', resolutionPreset: '1080p' }))
            .toMatchObject({ aspectRatioPreset: 'landscape', resolutionPreset: '1080p', width: 1920, height: 1080 });
        expect(normalizeExportDimensionSettings({ aspectRatioPreset: 'custom', resolutionPreset: 'custom', customWidth: 1500, customHeight: 900 }))
            .toMatchObject({ aspectRatioPreset: 'custom', resolutionPreset: 'custom', width: 1500, height: 900 });
        expect(getDefaultExportResolutionPreset('landscape')).toBe('720p');
        expect(getDefaultExportResolutionPreset('portrait')).toBe('720p-v');
    });
});
