import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { presetRoutes } from './presets';
import { uploadRoutes } from './upload';
import { audioUploadRoutes } from './audioUpload';
import { createSessionToken } from '../utils/session';
import { prepareMediaDeletion } from '../utils/presetDependencies';

const owner = { id: 'owner', googleId: 'google-owner', email: 'owner@example.com', name: 'Owner' };
const other = { ...owner, id: 'other', googleId: 'google-other' };
const scene = () => ({ schemaVersion: 1,
    geometry: { paths: [[{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }]], width: 1.2 },
    textures: [{ id: 'texture', name: 'Texture', tileCount: 1, tileResolution: 512, layerCount: 60, variant: 'waves' }],
    camera: { position: [0, 0, 5], target: [0, 0, 0], quaternion: [0, 0, 0, 1], fov: 45 } });

function bucket() {
    const objects = new Map();
    return { objects,
        put: vi.fn(async (key, value, options = {}) => { objects.set(key, { bytes: await new Response(value).arrayBuffer(), type: options.httpMetadata?.contentType }); }),
        head: vi.fn(async key => objects.has(key) ? {} : null),
        get: vi.fn(async key => {
            const value = objects.get(key);
            if (!value) return null;
            return { body: new Response(value.bytes).body, size: value.bytes.byteLength, httpEtag: '"etag"',
                writeHttpMetadata(headers) { headers.set('Content-Type', value.type || 'application/octet-stream'); },
                json: async () => JSON.parse(new TextDecoder().decode(value.bytes)) };
        }),
        delete: vi.fn(async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); }),
    };
}

describe('stored scene presets and referenced media', () => {
    let sqlite, env, headers;
    beforeEach(async () => {
        sqlite = new DatabaseSync(':memory:');
        sqlite.exec('PRAGMA foreign_keys = ON');
        sqlite.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
        // Applying the upgrade to an existing database is also idempotent.
        sqlite.exec(readFileSync(new URL('../db/migrations/012_scene_presets.sql', import.meta.url), 'utf8'));
        sqlite.exec(`INSERT INTO users (id) VALUES ('owner'), ('other');
            INSERT INTO texture_sets (id, owner_id, name, tile_resolution, tile_count, layer_count, status)
            VALUES ('texture', 'owner', 'Texture', 512, 1, 60, 'complete');
            INSERT INTO texture_tiles (id, texture_set_id, tile_index, r2_key) VALUES ('tile', 'texture', 0, 'original.ktx2');
            INSERT INTO audio_assets (id, owner_id, name, mime_type, format, duration, expected_file_size, r2_key, status)
            VALUES ('audio', 'owner', 'Audio', 'audio/wav', 'wav', 1, 4, 'original.wav', 'complete');`);
        const DB = { prepare(sql) { return {
            sql, values: [], bind(...values) { this.values = values; return this; },
            async first() { return sqlite.prepare(sql).get(...this.values) || null; },
            async all() { return { results: sqlite.prepare(sql).all(...this.values) }; },
            async run() { return sqlite.prepare(sql).run(...this.values); },
        }; }, async batch(statements) {
            sqlite.exec('BEGIN');
            try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
            catch (error) { sqlite.exec('ROLLBACK'); throw error; }
        } };
        env = { DB, SESSION_SECRET: 'preset-test-secret', PRESETS_BUCKET: bucket(), BUCKET: bucket() };
        await env.BUCKET.put('original.ktx2', new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: 'image/ktx2' } });
        await env.BUCKET.put('original.wav', new Uint8Array([4, 5, 6]));
        headers = { Cookie: `session=${await createSessionToken(owner, env.SESSION_SECRET)}` };
    });
    afterEach(() => sqlite.close());
    const json = (body, userHeaders = headers) => ({ method: 'POST', headers: { ...userHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    async function save(visibility = 'private', input = scene(), userHeaders = headers, extra = {}) {
        const created = await presetRoutes.request('/', json({ name: 'Saved ribbon', visibility, scene: input, ...extra }, userHeaders), env);
        expect(created.status).toBe(201);
        const id = (await created.json()).preset.id;
        const thumbnail = await presetRoutes.request(`/${id}/assets/thumbnail`, { method: 'PUT', headers: { ...userHeaders, 'Content-Type': 'image/webp' }, body: new Uint8Array([1]) }, env);
        expect(thumbnail.status).toBe(200);
        expect((await presetRoutes.request(`/${id}/complete`, { method: 'POST', headers: userHeaders }, env)).status).toBe(200);
        return id;
    }

    it('stores only the scene and thumbnail, serves original media, and keeps snapshots immutable', async () => {
        const id = await save('unlisted');
        expect([...env.PRESETS_BUCKET.objects.keys()].sort()).toEqual([`presets/${id}/scene.json`, `presets/${id}/thumbnail`]);
        expect(env.BUCKET.put).toHaveBeenCalledTimes(2); // Fixture assets only.
        const asset = await presetRoutes.request(`/${id}/assets/texture-0-0.ktx2`, {}, env);
        expect([...new Uint8Array(await asset.arrayBuffer())]).toEqual([1, 2, 3]);
        expect((await presetRoutes.request(`/${id}/assets/texture-0-1.ktx2`, {}, env)).status).toBe(404);
        expect((await presetRoutes.request(`/${id}/assets/thumbnail`, { method: 'PUT', headers }, env)).status).toBe(409);
        expect((await presetRoutes.request(`/${id}`, { ...json({ scene: scene() }), method: 'PATCH' }, env)).status).toBe(400);
        expect((await presetRoutes.request(`/${id}`, { method: 'DELETE', headers }, env)).status).toBe(200);
        expect(env.BUCKET.delete).not.toHaveBeenCalled();
        expect(sqlite.prepare('SELECT id FROM texture_sets').get().id).toBe('texture');
    });

    it('enforces private access and lists only public completed presets anonymously', async () => {
        const privateId = await save(); const unlistedId = await save('unlisted'); const publicId = await save('public');
        const strangerHeaders = { Cookie: `session=${await createSessionToken(other, env.SESSION_SECRET)}` };
        for (const userHeaders of [{}, strangerHeaders]) {
            expect((await presetRoutes.request(`/${privateId}`, { headers: userHeaders }, env)).status).toBe(404);
            expect((await presetRoutes.request(`/${privateId}/assets/thumbnail`, { headers: userHeaders }, env)).status).toBe(404);
        }
        expect((await presetRoutes.request(`/${privateId}`, { headers }, env)).status).toBe(200);
        expect((await presetRoutes.request(`/${unlistedId}`, {}, env)).status).toBe(200);
        const library = await presetRoutes.request('/?scope=public', {}, env);
        expect((await library.json()).presets.map(preset => preset.id)).toEqual([publicId]);
        expect(library.headers.get('Cache-Control')).toContain('no-store');
        expect((await presetRoutes.request('/', {}, env)).status).toBe(401);
    });

    it('rejects inaccessible dependencies; a readable parent permits saving a derivative without copying assets', async () => {
        const strangerHeaders = { Cookie: `session=${await createSessionToken(other, env.SESSION_SECRET)}` };
        expect((await presetRoutes.request('/', json({ name: 'Stolen', scene: scene() }, strangerHeaders), env)).status).toBe(400);
        const parentPresetId = await save('unlisted');
        const id = await save('private', scene(), strangerHeaders, { parentPresetId });
        expect((await presetRoutes.request(`/${id}/assets/texture-0-0.ktx2`, { headers: strangerHeaders }, env)).status).toBe(200);
        expect(env.BUCKET.put).toHaveBeenCalledTimes(2);
    });

    it('hides incomplete saves and validates required assets before completion', async () => {
        const created = await presetRoutes.request('/', json({ name: 'Incomplete', scene: scene() }), env);
        const id = (await created.json()).preset.id;
        expect((await presetRoutes.request(`/${id}/complete`, { method: 'POST', headers }, env)).status).toBe(409);
        expect((await presetRoutes.request(`/${id}`, { headers }, env)).status).toBe(404);
    });

    it.each(['texture', 'audio'])('requires explicit reviewed preset IDs before deleting %s', async kind => {
        const input = scene(); if (kind === 'audio') input.audio = { assetId: 'audio', loop: true };
        const id = await save('unlisted', input);
        const routes = kind === 'texture' ? uploadRoutes : audioUploadRoutes;
        const resource = kind === 'texture' ? 'texture' : 'audio';
        const deps = await routes.request(`/${resource}/preset-dependencies`, { headers }, env);
        expect((await deps.json()).linkedPresets.map(preset => preset.id)).toEqual([id]);
        const refused = await routes.request(`/${resource}`, { method: 'DELETE', headers }, env);
        expect(refused.status).toBe(409);
        expect(env.BUCKET.delete).not.toHaveBeenCalled();
        expect((await presetRoutes.request(`/${id}`, {}, env)).status).toBe(200);
        const accepted = await routes.request(`/${resource}`, { ...json({ acceptedPresetIds: [id] }), method: 'DELETE' }, env);
        expect(accepted.status).toBe(200);
        expect((await presetRoutes.request(`/${id}`, {}, env)).status).toBe(404);
        expect(env.PRESETS_BUCKET.objects.size).toBe(0);
        expect(sqlite.prepare('SELECT COUNT(*) AS count FROM preset_media_dependencies').get().count).toBe(0);
    });

    it('checks variants too when deleting an entire texture family', async () => {
        sqlite.exec(`INSERT INTO texture_sets (id, parent_texture_set_id, owner_id, name, tile_resolution, tile_count, layer_count, status)
            VALUES ('variant', 'texture', 'owner', 'Variant', 256, 1, 60, 'complete');`);
        const input = scene(); input.textures[0].id = 'variant';
        const id = await save('unlisted', input);
        const refused = await uploadRoutes.request('/texture', { method: 'DELETE', headers }, env);
        expect(refused.status).toBe(409);
        expect((await refused.json()).linkedPresets[0].id).toBe(id);
        const accepted = await uploadRoutes.request(`/texture?acceptedPresetIds=${encodeURIComponent(JSON.stringify([id]))}`, { method: 'DELETE', headers }, env);
        expect(accepted.status).toBe(200);
        expect(sqlite.prepare('SELECT COUNT(*) AS count FROM texture_sets').get().count).toBe(0);
    });

    it('requires renewed consent for newly linked presets, including races inside the deletion transaction', async () => {
        const reviewed = await save('unlisted');
        const newPreset = await save('unlisted');
        const result = await prepareMediaDeletion(env, 'texture', ['texture'], owner.id, [reviewed]);
        expect(result.conflict.map(preset => preset.id)).toContain(newPreset);
        expect(env.BUCKET.delete).not.toHaveBeenCalled();
        const originalBatch = env.DB.batch;
        env.DB.batch = async statements => {
            sqlite.exec(`INSERT INTO scene_presets (id, owner_id, name, visibility, schema_version, manifest_json, status)
                VALUES ('raced', 'owner', 'New preset', 'unlisted', 1, '[]', 'complete');
                INSERT INTO preset_media_dependencies (preset_id, texture_set_id) VALUES ('raced', 'texture');`);
            return originalBatch(statements);
        };
        const race = await prepareMediaDeletion(env, 'texture', ['texture'], owner.id, [reviewed, newPreset]);
        expect(race.conflict.map(preset => preset.id)).toContain('raced');
        expect(sqlite.prepare('SELECT COUNT(*) AS count FROM scene_presets').get().count).toBe(3);
        expect(sqlite.prepare('SELECT status FROM texture_sets').get().status).toBe('complete');
        expect(env.PRESETS_BUCKET.delete).not.toHaveBeenCalled();
    });

    it('prevents new references after a media deletion has started', async () => {
        await prepareMediaDeletion(env, 'texture', ['texture'], owner.id, []);
        sqlite.exec(`INSERT INTO scene_presets (id, owner_id, name, schema_version, manifest_json) VALUES ('late', 'owner', 'Late', 1, '[]');`);
        expect(() => sqlite.exec(`INSERT INTO preset_media_dependencies (preset_id, texture_set_id) VALUES ('late', 'texture')`)).toThrow('no longer available');
        expect(() => sqlite.exec(`UPDATE texture_sets SET status = 'complete' WHERE id = 'texture'`)).toThrow('deletion is in progress');
    });
});
