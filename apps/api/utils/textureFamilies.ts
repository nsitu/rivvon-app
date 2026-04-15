export interface TextureFamilyListRecord {
    id: string;
    parent_texture_set_id?: string | null;
    tile_resolution?: number | string | null;
    total_size_bytes?: number | string | null;
    storage_provider?: string | null;
    status?: string | null;
    created_at?: number | string | null;
    updated_at?: number | string | null;
    [key: string]: any;
}

export interface TextureVariantSummary {
    id: string;
    root_texture_id: string;
    parent_texture_set_id: string | null;
    resolution: number | null;
    tile_resolution: number | null;
    total_size_bytes: number;
    size_bytes: number;
    storage_provider: string;
    status: string | null;
    created_at: number | null;
    updated_at: number | null;
    is_root: boolean;
}

export interface TextureFamilySummary<T extends TextureFamilyListRecord = TextureFamilyListRecord> {
    rootTextureId: string;
    root: T;
    members: T[];
    availableResolutions: number[];
    variantSummaries: TextureVariantSummary[];
    familyUpdatedAt: number;
}

function toNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function toTimestamp(value: unknown): number {
    return toNumber(value) ?? 0;
}

export function getRootTextureId(texture: TextureFamilyListRecord): string {
    return (texture.parent_texture_set_id || texture.id) as string;
}

export function buildTextureVariantSummary(texture: TextureFamilyListRecord): TextureVariantSummary {
    const rootTextureId = getRootTextureId(texture);
    const tileResolution = toNumber(texture.tile_resolution);

    return {
        id: texture.id,
        root_texture_id: rootTextureId,
        parent_texture_set_id: texture.parent_texture_set_id || null,
        resolution: tileResolution,
        tile_resolution: tileResolution,
        total_size_bytes: toNumber(texture.total_size_bytes) ?? 0,
        size_bytes: toNumber(texture.total_size_bytes) ?? 0,
        storage_provider: texture.storage_provider || 'r2',
        status: texture.status || null,
        created_at: toNumber(texture.created_at),
        updated_at: toNumber(texture.updated_at),
        is_root: texture.id === rootTextureId,
    };
}

function chooseFamilyRoot<T extends TextureFamilyListRecord>(rootTextureId: string, members: T[]): T {
    const explicitRoot = members.find((member) => member.id === rootTextureId);
    if (explicitRoot) {
        return explicitRoot;
    }

    return [...members].sort((left, right) => {
        const leftResolution = toNumber(left.tile_resolution) ?? 0;
        const rightResolution = toNumber(right.tile_resolution) ?? 0;
        if (leftResolution !== rightResolution) {
            return rightResolution - leftResolution;
        }

        return toTimestamp(right.created_at) - toTimestamp(left.created_at);
    })[0];
}

function sortVariantSummaries(left: TextureVariantSummary, right: TextureVariantSummary): number {
    const leftResolution = left.resolution ?? 0;
    const rightResolution = right.resolution ?? 0;
    if (leftResolution !== rightResolution) {
        return rightResolution - leftResolution;
    }

    if (left.is_root !== right.is_root) {
        return left.is_root ? -1 : 1;
    }

    return (right.created_at ?? 0) - (left.created_at ?? 0);
}

export function buildTextureFamilySummaries<T extends TextureFamilyListRecord>(records: T[]): TextureFamilySummary<T>[] {
    const familyMap = new Map<string, { members: T[]; variantSummaryById: Map<string, TextureVariantSummary> }>();

    for (const record of records) {
        const rootTextureId = getRootTextureId(record);
        const existingFamily = familyMap.get(rootTextureId) || {
            members: [],
            variantSummaryById: new Map<string, TextureVariantSummary>(),
        };

        existingFamily.members.push(record);
        existingFamily.variantSummaryById.set(record.id, buildTextureVariantSummary(record));
        familyMap.set(rootTextureId, existingFamily);
    }

    return Array.from(familyMap.entries())
        .map(([rootTextureId, family]) => {
            const root = chooseFamilyRoot(rootTextureId, family.members);
            const variantSummaries = Array.from(family.variantSummaryById.values()).sort(sortVariantSummaries);
            const availableResolutions = [...new Set(
                variantSummaries
                    .map((summary) => summary.resolution)
                    .filter((resolution): resolution is number => Number.isFinite(resolution as number) && (resolution as number) > 0)
            )].sort((left, right) => right - left);
            const familyUpdatedAt = family.members.reduce((maxTimestamp, member) => {
                return Math.max(maxTimestamp, toTimestamp(member.updated_at), toTimestamp(member.created_at));
            }, 0);

            return {
                rootTextureId,
                root,
                members: family.members,
                availableResolutions,
                variantSummaries,
                familyUpdatedAt,
            };
        })
        .sort((left, right) => {
            const createdDelta = toTimestamp(right.root.created_at) - toTimestamp(left.root.created_at);
            if (createdDelta !== 0) {
                return createdDelta;
            }

            return right.familyUpdatedAt - left.familyUpdatedAt;
        });
}

export function decorateTextureFamilyRoot<T extends TextureFamilyListRecord>(family: TextureFamilySummary<T>): T & {
    root_texture_id: string;
    available_resolutions: number[];
    variant_summaries: TextureVariantSummary[];
} {
    return {
        ...family.root,
        root_texture_id: family.rootTextureId,
        available_resolutions: family.availableResolutions,
        variant_summaries: family.variantSummaries,
    };
}