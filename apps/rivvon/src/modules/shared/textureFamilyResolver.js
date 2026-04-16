function toResolutionNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toTimestamp(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function getTextureRootId(texture = {}) {
    return texture?.root_texture_id
        || texture?.variant_info?.root_texture_set_id
        || texture?.variant_info?.family_id
        || texture?.parent_texture_set_id
        || texture?.derived_from?.root_texture_set_id
        || texture?.id
        || null;
}

export function buildTextureVariantSummary(texture = {}) {
    const rootTextureId = getTextureRootId(texture);
    const tileResolution = toResolutionNumber(
        texture?.tile_resolution
        ?? texture?.variant_info?.target_resolution
        ?? texture?.derived_from?.tile_resolution
    );

    return {
        id: texture?.id || null,
        root_texture_id: rootTextureId,
        parent_texture_set_id: texture?.parent_texture_set_id
            || texture?.variant_info?.parent_texture_set_id
            || null,
        resolution: tileResolution,
        tile_resolution: tileResolution,
        total_size_bytes: Number(texture?.total_size_bytes ?? texture?.total_size ?? 0) || 0,
        size_bytes: Number(texture?.total_size_bytes ?? texture?.total_size ?? 0) || 0,
        storage_provider: texture?.storage_provider || (texture?.isLocal ? 'local' : 'r2'),
        status: texture?.status || 'complete',
        created_at: Number(texture?.created_at) || null,
        updated_at: Number(texture?.updated_at) || null,
        is_root: Boolean(
            texture?.id && texture?.id === rootTextureId
            || (texture?.cached_from && texture.cached_from === rootTextureId)
        )
    };
}

export function normalizeTextureVariantSummaries(texture = {}) {
    const variantSummaries = Array.isArray(texture?.variant_summaries)
        ? texture.variant_summaries
        : [];

    if (variantSummaries.length === 0) {
        return [buildTextureVariantSummary(texture)].filter((summary) => summary.id);
    }

    const dedupedById = new Map();
    for (const summary of variantSummaries) {
        if (!summary?.id) {
            continue;
        }

        dedupedById.set(summary.id, {
            id: summary.id,
            root_texture_id: summary.root_texture_id || getTextureRootId(texture),
            parent_texture_set_id: summary.parent_texture_set_id || null,
            resolution: toResolutionNumber(summary.resolution ?? summary.tile_resolution),
            tile_resolution: toResolutionNumber(summary.tile_resolution ?? summary.resolution),
            total_size_bytes: Number(summary.total_size_bytes ?? summary.size_bytes ?? 0) || 0,
            size_bytes: Number(summary.size_bytes ?? summary.total_size_bytes ?? 0) || 0,
            storage_provider: summary.storage_provider || texture?.storage_provider || (texture?.isLocal ? 'local' : 'r2'),
            status: summary.status || 'complete',
            created_at: Number(summary.created_at) || null,
            updated_at: Number(summary.updated_at) || null,
            is_root: Boolean(summary.is_root || summary.id === (summary.root_texture_id || getTextureRootId(texture)))
        });
    }

    return Array.from(dedupedById.values()).sort((left, right) => {
        const resolutionDelta = (right.resolution || 0) - (left.resolution || 0);
        if (resolutionDelta !== 0) {
            return resolutionDelta;
        }

        if (left.is_root !== right.is_root) {
            return left.is_root ? -1 : 1;
        }

        return toTimestamp(right.created_at) - toTimestamp(left.created_at);
    });
}

export function getTextureAvailableResolutions(texture = {}) {
    const explicitResolutions = Array.isArray(texture?.available_resolutions)
        ? texture.available_resolutions
            .map((resolution) => toResolutionNumber(resolution))
            .filter((resolution) => resolution !== null)
        : [];

    if (explicitResolutions.length > 0) {
        return [...new Set(explicitResolutions)].sort((left, right) => right - left);
    }

    const variantResolutions = normalizeTextureVariantSummaries(texture)
        .map((summary) => summary.resolution)
        .filter((resolution) => resolution !== null);

    return [...new Set(variantResolutions)].sort((left, right) => right - left);
}

export function resolveFamilyVariant(textureOrFamily, preferredMaxResolution = null) {
    const variantSummaries = Array.isArray(textureOrFamily?.variantSummaries)
        ? normalizeTextureVariantSummaries({ variant_summaries: textureOrFamily.variantSummaries })
        : normalizeTextureVariantSummaries(textureOrFamily || {});

    if (variantSummaries.length === 0) {
        return null;
    }

    const preferredResolution = toResolutionNumber(preferredMaxResolution);
    if (preferredResolution === null) {
        return variantSummaries[0];
    }

    const belowOrAtCap = variantSummaries.filter((summary) => summary.resolution !== null && summary.resolution <= preferredResolution);
    if (belowOrAtCap.length > 0) {
        return belowOrAtCap.sort((left, right) => (right.resolution || 0) - (left.resolution || 0))[0];
    }

    const aboveCap = variantSummaries.filter((summary) => summary.resolution !== null && summary.resolution > preferredResolution);
    if (aboveCap.length > 0) {
        return aboveCap.sort((left, right) => (left.resolution || 0) - (right.resolution || 0))[0];
    }

    return variantSummaries[0];
}

export function groupTextureRecordsIntoFamilies(records = [], { preferredMaxResolution = null } = {}) {
    const familyMap = new Map();

    for (const record of records) {
        const rootTextureId = getTextureRootId(record);
        if (!rootTextureId) {
            continue;
        }

        const existingFamily = familyMap.get(rootTextureId) || {
            rootTextureId,
            root: null,
            records: [],
            variantSummaryById: new Map()
        };

        existingFamily.records.push(record);

        if (!existingFamily.root && (record?.id === rootTextureId || record?.cached_from === rootTextureId)) {
            existingFamily.root = record;
        }

        const variantSummaries = normalizeTextureVariantSummaries(record);
        for (const summary of variantSummaries) {
            existingFamily.variantSummaryById.set(summary.id, summary);
        }

        if (variantSummaries.length === 0 && record?.id) {
            existingFamily.variantSummaryById.set(record.id, buildTextureVariantSummary(record));
        }

        familyMap.set(rootTextureId, existingFamily);
    }

    return Array.from(familyMap.values())
        .map((family) => {
            const variantSummaries = Array.from(family.variantSummaryById.values()).sort((left, right) => {
                const resolutionDelta = (right.resolution || 0) - (left.resolution || 0);
                if (resolutionDelta !== 0) {
                    return resolutionDelta;
                }

                if (left.is_root !== right.is_root) {
                    return left.is_root ? -1 : 1;
                }

                return toTimestamp(right.created_at) - toTimestamp(left.created_at);
            });

            const root = family.root || family.records.find((record) => record?.id === family.rootTextureId) || family.records[0] || null;
            const availableResolutions = [...new Set(
                variantSummaries
                    .map((summary) => summary.resolution)
                    .filter((resolution) => resolution !== null)
            )].sort((left, right) => right - left);
            const resolvedVariantSummary = resolveFamilyVariant({ variantSummaries }, preferredMaxResolution);
            const recordsById = new Map(family.records.map((record) => [record.id, record]));

            return {
                rootTextureId: family.rootTextureId,
                root,
                records: family.records,
                availableResolutions,
                variantSummaries,
                resolvedVariantSummary,
                resolvedVariantRecord: resolvedVariantSummary ? recordsById.get(resolvedVariantSummary.id) || null : null,
                hasDerivedVariants: variantSummaries.length > 1,
            };
        })
        .sort((left, right) => toTimestamp(right.root?.created_at) - toTimestamp(left.root?.created_at));
}