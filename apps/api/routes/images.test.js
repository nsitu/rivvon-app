import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { imageRoutes, imageUploadRoutes, cleanupImages } from './images';
import { presetRoutes } from './presets';
import { createSessionToken } from '../utils/session';

const owner = { id: 'owner', googleId: 'google-owner', email: 'owner@example.com', name: 'Owner' };
const other = { ...owner, id: 'other', googleId: 'google-other' };
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN6UAAAAASUVORK5CYII=', 'base64'));
function bucket() {
    const objects = new Map();
    return { objects,
        put: vi.fn(async (key, bytes, options) => { objects.set(key, { bytes: new Uint8Array(bytes), type: options.httpMetadata.contentType }); }),
        head: vi.fn(async key => objects.has(key) ? { size: objects.get(key).bytes.byteLength } : null),
        get: vi.fn(async key => {
            const object = objects.get(key); if (!object) return null;
            return { size: object.bytes.byteLength, httpEtag: '"etag"', body: new Response(object.bytes).body,
                writeHttpMetadata(headers) { headers.set('Content-Type', object.type); } };
        }),
        delete: vi.fn(async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); }),
        list: vi.fn(async ({ prefix }) => ({ objects: [...objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })), truncated: false })),
    };
}

describe('image resources and preset dependencies', () => {
    let sqlite, env, app, headers, otherHeaders;
    beforeEach(async () => {
        sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys = ON');
        sqlite.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
        sqlite.exec("INSERT INTO users (id) VALUES ('owner'), ('other')");
        const DB = { prepare(sql) { return { values: [], bind(...values) { this.values = values; return this; },
            async first() { return sqlite.prepare(sql).get(...this.values) || null; },
            async all() { return { results: sqlite.prepare(sql).all(...this.values) }; },
            async run() { return sqlite.prepare(sql).run(...this.values); },
        }; }, async batch(statements) {
            sqlite.exec('BEGIN');
            try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; }
            catch (error) { sqlite.exec('ROLLBACK'); throw error; }
        } };
        env = { DB, IMAGES_BUCKET: bucket(), PRESETS_BUCKET: bucket(), SESSION_SECRET: 'image-test-secret' };
        app = new Hono().route('/images', imageRoutes).route('/image', imageUploadRoutes).route('/presets', presetRoutes);
        headers = { Cookie: `session=${await createSessionToken(owner, env.SESSION_SECRET)}` };
        otherHeaders = { Cookie: `session=${await createSessionToken(other, env.SESSION_SECRET)}` };
    });
    afterEach(() => sqlite.close());
    const json = (method, data, extra = headers) => ({ method, headers: { ...extra, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const metadata = () => ({ name: 'Image', mimeType: 'image/png', width: 1, height: 1, fileSize: png.length, thumbnailSize: png.length, thumbnailMimeType: 'image/png' });
    async function pending() {
        const created = await app.request('/image', json('POST', metadata()), env);
        expect(created.status).toBe(201); return (await created.json()).imageId;
    }
    const put = (id, asset = 'image', bytes = png, user = headers) => app.request(`/image/${id}/assets/${asset}`, { method: 'PUT', headers: { ...user, 'Content-Type': 'image/png' }, body: bytes }, env);
    async function complete(id) {
        expect((await put(id)).status).toBe(200); expect((await put(id, 'thumbnail')).status).toBe(200);
        const response = await app.request(`/image/${id}/complete`, { method: 'POST', headers }, env);
        expect(response.status).toBe(200); return id;
    }

    it('validates bytes, finalizes idempotently, lists owned images and keeps completed bytes immutable', async () => {
        const id = await pending();
        expect((await app.request(`/image/${id}/complete`, { method: 'POST', headers }, env)).status).toBe(409);
        expect((await app.request('/images', { headers }, env).then(r => r.json())).images).toEqual([]);
        expect((await put(id, 'image', new Uint8Array(png.length))).status).toBe(400);
        await complete(id);
        expect((await app.request(`/image/${id}/complete`, { method: 'POST', headers }, env)).status).toBe(200);
        const list = await app.request('/images', { headers }, env).then(r => r.json());
        expect(list.images).toMatchObject([{ id, name: 'Image', width: 1, height: 1, file_size: png.length }]);
        expect(JSON.stringify(list)).not.toContain('image_key');
        expect((await put(id)).status).toBe(409);
        const bytes = await app.request(`/images/${id}/assets/image`, { headers }, env);
        expect(bytes.headers.get('Cache-Control')).toBe('private, no-store');
        expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(png);
        expect((await app.request(`/image/${id}`, json('PATCH', { name: 'Renamed' }), env)).status).toBe(200);
    });

    it('enforces owner access on metadata, bytes and writes including thumbnails', async () => {
        const id = await complete(await pending());
        expect((await app.request('/image', json('POST', metadata(), {}), env)).status).toBe(401);
        for (const endpoint of [`/images/${id}`, `/images/${id}/assets/image`, `/images/${id}/assets/thumbnail`]) {
            expect((await app.request(endpoint, {}, env)).status).toBe(404);
            expect((await app.request(endpoint, { headers: otherHeaders }, env)).status).toBe(404);
        }
        expect((await app.request(`/image/${id}`, json('DELETE', {}, otherHeaders), env)).status).toBe(404);
        expect((await app.request(`/image/${id}`, json('PATCH', { name: 'Other' }, otherHeaders), env)).status).toBe(404);
        expect((await app.request('/images', { headers: otherHeaders }, env).then(r => r.json())).images).toEqual([]);
    });

    it('rejects invalid metadata, mismatched size and dimensions before finalizing', async () => {
        for (const invalid of [{ fileSize: 21 * 1024 * 1024 }, { width: 4097 }, { mimeType: 'image/svg+xml' }, { name: '' }]) {
            expect((await app.request('/image', json('POST', { ...metadata(), ...invalid }), env)).status).toBe(400);
        }
        const id = await pending();
        const oversized = new Uint8Array(1024 * 1024 + 1);
        expect((await put(id, 'thumbnail', oversized)).status).toBe(413);
        const wrongDimensions = png.slice(); new DataView(wrongDimensions.buffer).setUint32(16, 2);
        expect((await put(id, 'image', wrongDimensions)).status).toBe(400);
        expect(env.IMAGES_BUCKET.put).not.toHaveBeenCalled();
    });

    it('cannot overwrite a completed asset with an upload that started before completion', async () => {
        const id = await pending(); await put(id); await put(id, 'thumbnail');
        const original = sqlite.prepare('SELECT image_key FROM image_assets WHERE id = ?').get(id).image_key;
        const realPut = env.IMAGES_BUCKET.put.getMockImplementation();
        env.IMAGES_BUCKET.put.mockImplementationOnce(async (...args) => {
            await realPut(...args);
            expect((await app.request(`/image/${id}/complete`, { method: 'POST', headers }, env)).status).toBe(200);
        });
        expect((await put(id)).status).toBe(409);
        expect(sqlite.prepare('SELECT image_key FROM image_assets WHERE id = ?').get(id).image_key).toBe(original);
        expect(env.IMAGES_BUCKET.objects.has(original)).toBe(true);
        expect(env.IMAGES_BUCKET.objects.size).toBe(2);
    });

    async function savePreset(imageId, visibility = 'unlisted', userHeaders = headers, extra = {}) {
        sqlite.exec("INSERT OR IGNORE INTO texture_sets (id, owner_id, name, tile_resolution, tile_count, layer_count, status, is_public) VALUES ('texture', 'owner', 'Texture', 512, 1, 1, 'complete', 1)");
        const scene = { schemaVersion: 2, geometry: { paths: [[{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }]] },
            textures: [{ id: 'texture', tileCount: 1, tileResolution: 512, layerCount: 1 }],
            artwork: { backgroundTextureSource: { kind: 'image', id: imageId }, backgroundTextureEnabled: false, backgroundTextureBlendMode: 'normal' },
            camera: { position: [0, 0, 5], target: [0, 0, 0], quaternion: [0, 0, 0, 1], fov: 45 } };
        const created = await app.request('/presets', json('POST', { name: 'Image scene', scene, visibility, ...extra }, userHeaders), env);
        if (created.status !== 201) return created;
        const id = (await created.json()).preset.id;
        sqlite.prepare("UPDATE scene_presets SET status = 'complete' WHERE id = ?").run(id);
        return id;
    }

    it('grants only the registered image through a visible preset, including a disabled selection and derivative presets', async () => {
        const id = await complete(await pending()), presetId = await savePreset(id);
        expect(typeof presetId).toBe('string');
        const asset = await app.request(`/presets/${presetId}/assets/background-image`, {}, env);
        expect(asset.status).toBe(200); expect(new Uint8Array(await asset.arrayBuffer())).toEqual(png);
        expect((await app.request(`/images/${id}/assets/thumbnail?sourcePresetId=${presetId}`, {}, env)).status).toBe(200);
        expect((await app.request(`/images/${id}?sourcePresetId=missing`, {}, env)).status).toBe(404);
        expect((await savePreset(id, 'private', otherHeaders)).status).toBe(400);
        expect(typeof await savePreset(id, 'private', otherHeaders, { backgroundSourcePresetId: presetId })).toBe('string');
        const privateId = await savePreset(id, 'private');
        expect((await app.request(`/presets/${privateId}/assets/background-image`, {}, env)).status).toBe(404);
    });

    it('requires fresh cascade consent and preserves source images when a preset alone is deleted', async () => {
        const id = await complete(await pending()), first = await savePreset(id);
        expect((await app.request(`/presets/${first}`, { method: 'DELETE', headers }, env)).status).toBe(200);
        expect(sqlite.prepare('SELECT id FROM image_assets WHERE id = ?').get(id)).toBeTruthy();
        const second = await savePreset(id);
        const conflict = await app.request(`/image/${id}`, json('DELETE', {}), env);
        expect(conflict.status).toBe(409);
        const third = await savePreset(id);
        expect((await app.request(`/image/${id}`, json('DELETE', { acceptedPresetIds: [second] }), env)).status).toBe(409);
        expect((await app.request(`/image/${id}`, json('DELETE', { acceptedPresetIds: [second, third] }), env)).status).toBe(200);
        expect(env.IMAGES_BUCKET.objects.size).toBe(0);
        expect(sqlite.prepare('SELECT id FROM scene_presets').all()).toEqual([]);
    });

    it('cleans expired uploads and retries interrupted deletion without removing completed images', async () => {
        const done = await complete(await pending()), expired = await pending(); await put(expired);
        sqlite.prepare('UPDATE image_assets SET upload_expires_at = 0 WHERE id = ?').run(expired);
        expect((await put(expired)).status).toBe(409);
        await cleanupImages(env);
        expect(sqlite.prepare('SELECT id FROM image_assets').all()).toEqual([{ id: done }]);
        expect([...env.IMAGES_BUCKET.objects.keys()].every(key => key.startsWith(`images/${done}/`))).toBe(true);
    });
});

it('upgrades existing texture/audio dependencies and keeps deletion and readiness guards', () => {
    const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = ON');
    try {
        db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('owner');
            CREATE TABLE texture_sets(id TEXT PRIMARY KEY, status TEXT); INSERT INTO texture_sets VALUES ('texture', 'complete');
            CREATE TABLE audio_assets(id TEXT PRIMARY KEY, status TEXT); INSERT INTO audio_assets VALUES ('audio', 'complete');`);
        db.exec(readFileSync(new URL('../db/migrations/012_scene_presets.sql', import.meta.url), 'utf8'));
        db.exec(`INSERT INTO scene_presets (id, owner_id, name, schema_version, manifest_json) VALUES ('preset', 'owner', 'Existing', 1, '[]');
            INSERT INTO preset_media_dependencies (preset_id, texture_set_id) VALUES ('preset', 'texture');
            INSERT INTO preset_media_dependencies (preset_id, audio_asset_id) VALUES ('preset', 'audio');`);
        db.exec(readFileSync(new URL('../db/migrations/013_image_assets.sql', import.meta.url), 'utf8'));
        expect(db.prepare('SELECT COUNT(*) AS count FROM preset_media_dependencies').get().count).toBe(2);
        expect(() => db.exec("UPDATE texture_sets SET status = 'deleting'")).toThrow('Linked presets changed');
        expect(() => db.exec("INSERT INTO preset_media_dependencies (preset_id, image_asset_id) VALUES ('preset', 'missing')")).toThrow('no longer available');
        expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { db.close(); }
});
