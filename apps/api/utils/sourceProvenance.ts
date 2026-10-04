// Allowlist provenance rather than retaining arbitrary Google responses or URLs.
export function normalizeSourceProvenance(input: unknown): Record<string, unknown> | null {
    if (input === undefined || input === null) return null;
    if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid source provenance');
    const value = input as Record<string, unknown>;
    if (value.provider !== 'google-photos' || value.version !== 1) throw new Error('Unsupported source provenance');
    const result: Record<string, unknown> = { version: 1, provider: 'google-photos', downloadVariant: 'google-photos-dv-transcode' };
    for (const field of ['mediaItemId', 'originalFilename', 'reportedMimeType', 'cameraMake', 'cameraModel']) {
        if (value[field] === undefined || value[field] === null) continue;
        if (typeof value[field] !== 'string' || value[field].length > 1024) throw new Error('Invalid source provenance text');
        result[field] = value[field];
    }
    if (!result.mediaItemId) throw new Error('Missing source media ID');
    for (const field of ['createTime', 'importedAt']) {
        if (value[field] === undefined || value[field] === null) continue;
        if (typeof value[field] !== 'string' || value[field].length > 64 || !Number.isFinite(Date.parse(value[field]))) {
            throw new Error('Invalid source provenance timestamp');
        }
        result[field] = value[field];
    }
    for (const field of ['reportedWidth', 'reportedHeight', 'reportedFps']) {
        if (value[field] === undefined || value[field] === null) continue;
        if (typeof value[field] !== 'number' || !Number.isFinite(value[field]) || value[field] <= 0) throw new Error('Invalid source provenance dimensions');
        result[field] = value[field];
    }
    return result;
}

export function readSourceProvenance(json: string | null | undefined) {
    try { return json ? normalizeSourceProvenance(JSON.parse(json)) : null; } catch { return null; }
}
