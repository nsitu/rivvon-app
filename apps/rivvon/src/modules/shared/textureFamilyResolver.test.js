import { describe, expect, it } from 'vitest';

import {
    getTextureAvailableResolutions,
    groupTextureRecordsIntoFamilies,
    resolveFamilyVariant,
} from './textureFamilyResolver.js';

describe('getTextureAvailableResolutions', () => {
    it('deduplicates and sorts explicit resolutions descending', () => {
        expect(
            getTextureAvailableResolutions({
                available_resolutions: [256, '1024', 512, 512, 'bad'],
            })
        ).toEqual([1024, 512, 256]);
    });
});

describe('resolveFamilyVariant', () => {
    const variantSummaries = [
        { id: 'root-1024', root_texture_id: 'root-1024', resolution: 1024, is_root: true, created_at: 100 },
        { id: 'variant-512', root_texture_id: 'root-1024', resolution: 512, created_at: 200 },
        { id: 'variant-256', root_texture_id: 'root-1024', resolution: 256, created_at: 300 },
    ];

    it('prefers the highest variant at or below the requested cap', () => {
        expect(resolveFamilyVariant({ variantSummaries }, 700)).toMatchObject({ id: 'variant-512' });
    });

    it('falls back to the nearest higher variant when all variants exceed the cap', () => {
        expect(resolveFamilyVariant({ variantSummaries }, 128)).toMatchObject({ id: 'variant-256' });
    });
});

describe('groupTextureRecordsIntoFamilies', () => {
    it('groups related records and resolves the preferred variant', () => {
        const records = [
            {
                id: 'root-1024',
                created_at: 100,
                variant_summaries: [
                    {
                        id: 'root-1024',
                        root_texture_id: 'root-1024',
                        resolution: 1024,
                        is_root: true,
                        created_at: 100,
                    },
                ],
            },
            {
                id: 'variant-512',
                parent_texture_set_id: 'root-1024',
                created_at: 200,
                variant_info: {
                    root_texture_set_id: 'root-1024',
                },
                variant_summaries: [
                    {
                        id: 'variant-512',
                        root_texture_id: 'root-1024',
                        parent_texture_set_id: 'root-1024',
                        resolution: 512,
                        created_at: 200,
                    },
                ],
            },
        ];

        const [family] = groupTextureRecordsIntoFamilies(records, { preferredMaxResolution: 700 });

        expect(family.rootTextureId).toBe('root-1024');
        expect(family.availableResolutions).toEqual([1024, 512]);
        expect(family.resolvedVariantSummary).toMatchObject({ id: 'variant-512' });
        expect(family.resolvedVariantRecord).toMatchObject({ id: 'variant-512' });
        expect(family.hasDerivedVariants).toBe(true);
    });
});