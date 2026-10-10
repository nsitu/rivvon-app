import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { optionalSession, verifySession } from '../middleware/session';
import type { AppEnv } from '../types/hono';
import { syncUser } from '../utils/user';
import { normalizeScenePreset } from '../../../packages/shared-types/src/scenePreset.js';
import { buildGoogleDriveDownloadUrl } from '../utils/storagePaths';
import { removePresetFiles, presetDeletionStatements } from '../utils/presetDependencies';

type PresetRow = { id: string; owner_id: string; name: string; description: string; visibility: string;
    status: string; manifest_json: string; audio_json: string | null; [key: string]: any };
const VISIBILITY = new Set(['private', 'unlisted', 'public']);
const key = (id: string, asset: string) => `presets/${id}/${asset}`;
const metadata = (row: PresetRow) => ({ id: row.id, owner_id: row.owner_id, name: row.name,
    description: row.description, visibility: row.visibility, parent_preset_id: row.parent_preset_id,
    created_at: row.created_at, updated_at: row.updated_at, schema_version: row.schema_version });

export const presetRoutes = new Hono<AppEnv>();
presetRoutes.use('*', optionalSession);
presetRoutes.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    c.header('Vary', 'Cookie');
    if (!c.env.PRESETS_BUCKET) return c.json({ error: 'Preset storage is not configured.' }, 503);
    await next();
});

const readRow = (db: D1Database, id: string) => db.prepare('SELECT * FROM scene_presets WHERE id = ?').bind(id).first<PresetRow>();
function accessible(row: PresetRow | null, userId?: string): row is PresetRow {
    return Boolean(row?.status === 'complete' && (row.owner_id === userId || row.visibility !== 'private'));
}

presetRoutes.get('/', async (c) => {
    const mine = c.req.query('scope') !== 'public', auth = c.get('auth');
    if (mine && !auth) return c.json({ error: 'Sign in to browse your presets.' }, 401);
    const limit = Math.min(100, Math.max(1, Number.parseInt(c.req.query('limit') || '24', 10) || 24));
    const offset = Math.max(0, Number.parseInt(c.req.query('offset') || '0', 10) || 0);
    const where = mine ? "owner_id = ? AND status = 'complete'" : "visibility = 'public' AND status = 'complete'";
    const bindings = mine ? [auth.userId] : [];
    const [rows, count] = await Promise.all([
        c.env.DB.prepare(`SELECT * FROM scene_presets WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
            .bind(...bindings, limit, offset).all<PresetRow>(),
        c.env.DB.prepare(`SELECT COUNT(*) AS total FROM scene_presets WHERE ${where}`).bind(...bindings).first<{ total: number }>(),
    ]);
    return c.json({ presets: rows.results.map(metadata), pagination: { limit, offset, total: count?.total || 0 } });
});

presetRoutes.post('/', verifySession, async (c) => {
    const auth = c.get('auth');
    const raw = await c.req.text();
    if (new TextEncoder().encode(raw).length > 4 * 1024 * 1024) return c.json({ error: 'Preset is too large.' }, 413);
    let body: any, scene: any;
    try { body = JSON.parse(raw); scene = normalizeScenePreset(body.scene); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Invalid preset' }, 400); }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 200 || !VISIBILITY.has(body.visibility || 'private')) return c.json({ error: 'Invalid preset name or visibility.' }, 400);
    const parentId = typeof body.parentPresetId === 'string' ? body.parentPresetId : null;
    const parent = parentId ? await readRow(c.env.DB, parentId) : null;
    if (parentId && !accessible(parent, auth.userId)) return c.json({ error: 'Parent preset not found.' }, 404);
    const sourceId = scene.audio?.sourcePresetId;
    const audioSource = sourceId ? await readRow(c.env.DB, sourceId) : null;
    if (sourceId && !accessible(audioSource, auth.userId)) return c.json({ error: 'Audio source preset is unavailable.' }, 400);
    const grants = [parent?.id, audioSource?.id].filter(Boolean);
    const hasGrant = async (column: string, id: string) => {
        if (!grants.length) return false;
        return Boolean(await c.env.DB.prepare(`SELECT preset_id FROM preset_media_dependencies WHERE ${column} = ? AND preset_id IN (${grants.map(() => '?').join(',')})`)
            .bind(id, ...grants).first());
    };
    const textureIds = [...new Set<string>(scene.textures.map((texture: any) => texture.id))];
    for (const textureId of textureIds) {
        const texture = await c.env.DB.prepare("SELECT * FROM texture_sets WHERE id = ? AND status = 'complete'").bind(textureId).first<any>();
        if (!texture || (texture.owner_id !== auth.userId && !texture.is_public && !await hasGrant('texture_set_id', textureId))) {
            return c.json({ error: 'A texture is unavailable or cannot be used in this preset.' }, 400);
        }
        for (const assignment of scene.textures.filter((texture: any) => texture.id === textureId)) {
            assignment.tileCount = texture.tile_count; assignment.tileResolution = texture.tile_resolution;
            assignment.layerCount = texture.layer_count; assignment.variant = texture.cross_section_type === 'planes' ? 'planes' : 'waves';
        }
    }
    let audio: any = null;
    if (scene.audio?.assetId) {
        audio = await c.env.DB.prepare("SELECT id, name, owner_id, is_public, duration, channel_count, mime_type FROM audio_assets WHERE id = ? AND status = 'complete'")
            .bind(scene.audio.assetId).first<any>();
        if (!audio || (audio.owner_id !== auth.userId && !audio.is_public && !await hasGrant('audio_asset_id', audio.id))) return c.json({ error: 'Preset audio is unavailable.' }, 400);
        audio = { id: audio.id, name: audio.name, duration: audio.duration, channel_count: audio.channel_count, mime_type: audio.mime_type };
    }
    if (scene.audio) scene.audio.sourcePresetId = '';
    try { scene = normalizeScenePreset(scene); }
    catch { return c.json({ error: 'The referenced media exceeds the supported preset limits.' }, 400); }
    const id = nanoid();
    await syncUser(c.env.DB, auth.userId, { name: auth.name, email: auth.email, picture: auth.picture });
    // The dependency triggers reject a concurrent source deletion. D1 batch is atomic.
    try { await c.env.DB.batch([
        c.env.DB.prepare(`INSERT INTO scene_presets
            (id, owner_id, parent_preset_id, name, description, visibility, schema_version, manifest_json, audio_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, auth.userId, parentId, name,
            typeof body.description === 'string' ? body.description.slice(0, 2000) : '', body.visibility || 'private',
            scene.schemaVersion, JSON.stringify(scene.textures), audio ? JSON.stringify(audio) : null),
        ...textureIds.map(textureId => c.env.DB.prepare('INSERT INTO preset_media_dependencies (preset_id, texture_set_id) VALUES (?, ?)').bind(id, textureId)),
        ...(audio ? [c.env.DB.prepare('INSERT INTO preset_media_dependencies (preset_id, audio_asset_id) VALUES (?, ?)').bind(id, audio.id)] : []),
    ]); } catch (error) {
        if (String(error).includes('no longer available')) return c.json({ error: 'Media was deleted while this preset was being saved. Select available media and try again.' }, 409);
        throw error;
    }
    try { await c.env.PRESETS_BUCKET.put(key(id, 'scene.json'), JSON.stringify(scene), { httpMetadata: { contentType: 'application/json' } }); }
    catch (error) { await c.env.DB.batch(presetDeletionStatements(c.env.DB, [id])); throw error; }
    if (!await readRow(c.env.DB, id)) {
        await removePresetFiles(c.env, [id]);
        return c.json({ error: 'Media was deleted while this preset was being saved.' }, 409);
    }
    return c.json({ preset: { id, name, visibility: body.visibility || 'private' } }, 201);
});

presetRoutes.put('/:id/assets/thumbnail', verifySession, async (c) => {
    const row = await readRow(c.env.DB, c.req.param('id'));
    if (!row || row.owner_id !== c.get('auth').userId) return c.json({ error: 'Preset not found.' }, 404);
    if (row.status !== 'pending') return c.json({ error: 'Saved preset scenes are immutable.' }, 409);
    const contentType = c.req.header('Content-Type')?.split(';')[0];
    if (!['image/webp', 'image/png', 'image/jpeg'].includes(contentType || '')) return c.json({ error: 'Invalid thumbnail format.' }, 400);
    const bytes = await c.req.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 1024 * 1024) return c.json({ error: 'Invalid thumbnail size.' }, 413);
    await c.env.PRESETS_BUCKET.put(key(row.id, 'thumbnail'), bytes, { httpMetadata: { contentType } });
    if (!await readRow(c.env.DB, row.id)) {
        await removePresetFiles(c.env, [row.id]);
        return c.json({ error: 'This preset was deleted during upload.' }, 409);
    }
    return c.json({ success: true });
});

presetRoutes.post('/:id/complete', verifySession, async (c) => {
    const row = await readRow(c.env.DB, c.req.param('id'));
    if (!row || row.owner_id !== c.get('auth').userId) return c.json({ error: 'Preset not found.' }, 404);
    if (row.status === 'deleting') return c.json({ error: 'Preset is being deleted.' }, 409);
    const [scene, thumbnail] = await Promise.all(['scene.json', 'thumbnail'].map(asset => c.env.PRESETS_BUCKET.head(key(row.id, asset))));
    if (!scene || !thumbnail) return c.json({ error: 'Preset upload is incomplete.' }, 409);
    await c.env.DB.prepare("UPDATE scene_presets SET status = 'complete', updated_at = unixepoch() WHERE id = ? AND status = 'pending'").bind(row.id).run();
    return c.json({ preset: metadata(row) });
});

presetRoutes.get('/:id', async (c) => {
    const row = await readRow(c.env.DB, c.req.param('id'));
    if (!accessible(row, c.get('auth')?.userId)) return c.json({ error: 'Preset not found or private.' }, 404);
    const object = await c.env.PRESETS_BUCKET.get(key(row.id, 'scene.json'));
    if (!object) return c.json({ error: 'Preset scene is unavailable.' }, 404);
    return c.json({ preset: metadata(row), scene: await object.json(), audio: row.audio_json ? JSON.parse(row.audio_json) : null });
});

// Access through a preset grants read access only to its registered dependencies.
// Original assets remain in their existing storage and retain their own visibility.
presetRoutes.get('/:id/assets/:asset', async (c) => {
    const row = await readRow(c.env.DB, c.req.param('id'));
    if (!accessible(row, c.get('auth')?.userId)) return c.json({ error: 'Preset not found or private.' }, 404);
    const asset = c.req.param('asset'), match = /^texture-(\d+)-(\d+)\.ktx2$/.exec(asset);
    let object: R2ObjectBody | null = null;
    if (asset === 'thumbnail') object = await c.env.PRESETS_BUCKET.get(key(row.id, asset));
    else if (asset === 'audio') {
        const dependency = await c.env.DB.prepare(`SELECT a.r2_key FROM audio_assets a JOIN preset_media_dependencies d ON d.audio_asset_id = a.id
            WHERE d.preset_id = ? AND a.status = 'complete'`).bind(row.id).first<any>();
        if (dependency?.r2_key) object = await c.env.BUCKET.get(dependency.r2_key, { range: c.req.raw.headers });
    } else if (match) {
        const texture = JSON.parse(row.manifest_json)[Number(match[1])];
        if (!texture || Number(match[2]) >= texture.tileCount) return c.json({ error: 'Tile not found.' }, 404);
        const tile = await c.env.DB.prepare(`SELECT t.r2_key, t.drive_file_id FROM texture_tiles t JOIN preset_media_dependencies d ON d.texture_set_id = t.texture_set_id
            JOIN texture_sets s ON s.id = t.texture_set_id WHERE d.preset_id = ? AND t.texture_set_id = ? AND t.tile_index = ? AND s.status = 'complete'`)
            .bind(row.id, texture.id, Number(match[2])).first<any>();
        if (tile?.r2_key) object = await c.env.BUCKET.get(tile.r2_key);
        else if (tile?.drive_file_id) {
            const response = await fetch(buildGoogleDriveDownloadUrl(tile.drive_file_id));
            if (!response.ok || response.headers.get('Content-Type')?.includes('text/html')) return c.json({ error: 'This Google Drive texture is not publicly readable. Check its sharing permissions.' }, 502);
            return new Response(response.body, { headers: { 'Content-Type': 'image/ktx2', 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
        }
    }
    if (!object) return c.json({ error: 'Preset media is unavailable.' }, 404);
    const headers = new Headers({ 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' });
    object.writeHttpMetadata(headers); headers.set('ETag', object.httpEtag);
    let status = 200;
    if (object.range && 'offset' in object.range && 'length' in object.range && object.range.offset !== undefined && object.range.length !== undefined) {
        headers.set('Content-Range', `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
        headers.set('Content-Length', String(object.range.length)); status = 206;
    } else headers.set('Content-Length', String(object.size));
    return new Response(object.body, { status, headers });
});

presetRoutes.patch('/:id', verifySession, async (c) => {
    const row = await readRow(c.env.DB, c.req.param('id'));
    if (!row || row.owner_id !== c.get('auth').userId || row.status !== 'complete') return c.json({ error: 'Preset not found.' }, 404);
    const body = await c.req.json();
    if (Object.keys(body).some(key => !['name', 'description', 'visibility'].includes(key))) return c.json({ error: 'Saved preset scenes are immutable.' }, 400);
    const name = body.name === undefined ? row.name : String(body.name).trim(), visibility = body.visibility ?? row.visibility;
    if (!name || name.length > 200 || !VISIBILITY.has(visibility)) return c.json({ error: 'Invalid preset metadata.' }, 400);
    const description = body.description === undefined ? row.description : String(body.description).slice(0, 2000);
    await c.env.DB.prepare('UPDATE scene_presets SET name = ?, description = ?, visibility = ?, updated_at = unixepoch() WHERE id = ?').bind(name, description, visibility, row.id).run();
    return c.json({ preset: metadata({ ...row, name, description, visibility }) });
});

presetRoutes.delete('/:id', verifySession, async (c) => {
    const row = await readRow(c.env.DB, c.req.param('id'));
    if (!row || row.owner_id !== c.get('auth').userId) return c.json({ error: 'Preset not found.' }, 404);
    await c.env.DB.batch(presetDeletionStatements(c.env.DB, [row.id]));
    await removePresetFiles(c.env, [row.id]);
    return c.json({ success: true });
});
