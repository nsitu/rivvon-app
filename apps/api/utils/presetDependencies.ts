import type { AppBindings } from '../types/hono';

export type MediaKind = 'texture' | 'audio';
export type LinkedPreset = { id: string; name: string; visibility: string };
const column = (kind: MediaKind) => kind === 'texture' ? 'texture_set_id' : 'audio_asset_id';

export async function getLinkedPresets(db: D1Database, kind: MediaKind, ids: string[], userId: string): Promise<LinkedPreset[]> {
    if (!ids.length) return [];
    const result = await db.prepare(`SELECT DISTINCT p.id,
        CASE WHEN p.owner_id = ? OR p.visibility != 'private' THEN p.name ELSE 'Private preset' END AS name,
        p.visibility FROM scene_presets p JOIN preset_media_dependencies d ON d.preset_id = p.id
        WHERE d.${column(kind)} IN (${ids.map(() => '?').join(',')}) AND p.status != 'deleting'
        ORDER BY p.created_at DESC`).bind(userId, ...ids).all<LinkedPreset>();
    return result.results;
}

/** Consent names the reviewed IDs. Newly linked presets require another confirmation. */
export function acceptsPresetCascade(presets: LinkedPreset[], acceptedIds: string[]) {
    return presets.every(preset => acceptedIds.includes(preset.id));
}

export function presetDeletionStatements(db: D1Database, ids: string[]) {
    const statements: D1PreparedStatement[] = [];
    for (let offset = 0; offset < ids.length; offset += 90) {
        const chunk = ids.slice(offset, offset + 90), parameters = chunk.map(() => '?').join(',');
        statements.push(db.prepare(`DELETE FROM preset_media_dependencies WHERE preset_id IN (${parameters})`).bind(...chunk),
            db.prepare(`DELETE FROM scene_presets WHERE id IN (${parameters})`).bind(...chunk));
    }
    return statements;
}

export async function removePresetFiles(env: AppBindings, ids: string[]) {
    if (!env.PRESETS_BUCKET) return;
    for (const id of ids) {
        await env.PRESETS_BUCKET.delete([`presets/${id}/scene.json`, `presets/${id}/thumbnail`]);
    }
}

export function parseAcceptedPresetIds(value: string | undefined): string[] {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string' && /^[\w-]{1,64}$/.test(id)).slice(0, 5000) : [];
    } catch { return []; }
}

export async function prepareMediaDeletion(env: AppBindings, kind: MediaKind, ids: string[], userId: string, acceptedIds: string[]) {
    const linked = await getLinkedPresets(env.DB, kind, ids, userId);
    if (!acceptsPresetCascade(linked, acceptedIds)) return { conflict: linked, deletedPresets: [] };
    const presetIds = linked.map(preset => preset.id);
    const table = kind === 'texture' ? 'texture_sets' : 'audio_assets';
    try {
        await env.DB.batch([
            ...presetDeletionStatements(env.DB, presetIds),
            env.DB.prepare(`UPDATE ${table} SET status = 'deleting' WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids),
        ]);
    } catch (error) {
        if (!String(error).includes('Linked presets changed')) throw error;
        return { conflict: await getLinkedPresets(env.DB, kind, ids, userId), deletedPresets: [] };
    }
    await removePresetFiles(env, presetIds);
    return { conflict: null, deletedPresets: presetIds };
}
