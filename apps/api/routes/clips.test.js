import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { Input, ALL_FORMATS, BlobSource } from 'mediabunny';
import { clipRoutes, clipUploadRoutes, cleanupClips } from './clips';
import { presetRoutes } from './presets';
import { createSessionToken } from '../utils/session';
import { inspectClipInput, getClipInputFormats, MAX_CLIP_BYTES, CLIP_UPLOAD_PART_BYTES } from '../../../packages/shared-types/src/clipAsset.js';

const fixture = name => new Uint8Array(readFileSync(new URL(`../../../packages/shared-types/fixtures/${name.includes('.') ? name : `${name}.mp4`}`, import.meta.url)));
const bytes = fixture('clip');
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN6UAAAAASUVORK5CYII=', 'base64'));
function bucket() {
    const objects = new Map(), uploads = new Map();
    return { objects, uploads,
        createMultipartUpload: vi.fn(async (key, options) => {
            const uploadId = crypto.randomUUID(), parts = new Map();
            const upload = { key, uploadId, parts,
                uploadPart: vi.fn(async (partNumber, data) => {
                    if (!uploads.has(uploadId)) throw new Error('NoSuchUpload');
                    const bytes = new Uint8Array(await new Response(data).arrayBuffer()), etag = crypto.randomUUID();
                    parts.set(partNumber, { bytes, etag }); return { partNumber, etag };
                }),
                complete: vi.fn(async receipts => {
                    if (!uploads.has(uploadId)) throw new Error('NoSuchUpload');
                    const data = receipts.map(part => {
                        const saved = parts.get(part.partNumber); if (!saved || saved.etag !== part.etag) throw new Error('Invalid part'); return saved.bytes;
                    });
                    objects.set(key, { bytes: new Uint8Array(await new Blob(data).arrayBuffer()), type: options.httpMetadata.contentType });
                    uploads.delete(uploadId); return { size: objects.get(key).bytes.length };
                }),
                abort: vi.fn(async () => { uploads.delete(uploadId); }),
            };
            uploads.set(uploadId, upload); return upload;
        }),
        resumeMultipartUpload: vi.fn((key, id) => {
            const upload = uploads.get(id);
            if (!upload || upload.key !== key) throw new Error('NoSuchUpload'); return upload;
        }),
        put: vi.fn(async (key, data, options) => { objects.set(key, { bytes: new Uint8Array(await new Response(data).arrayBuffer()), type: options.httpMetadata.contentType }); }),
        head: vi.fn(async key => objects.has(key) ? { size: objects.get(key).bytes.length } : null),
        get: vi.fn(async (key, { range } = {}) => {
            const object = objects.get(key); if (!object) return null;
            const result = range ? object.bytes.slice(range.offset, range.offset + range.length) : object.bytes;
            return { size: object.bytes.length, body: new Response(result).body, httpEtag: '"clip"',
                writeHttpMetadata(headers) { headers.set('Content-Type', object.type); } };
        }),
        delete: vi.fn(async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); }),
        list: vi.fn(async ({ prefix }) => ({ objects: [...objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })), truncated: false })),
    };
}

describe('private clip resources', () => {
    let db, env, app, headers, otherHeaders;
    beforeEach(async () => {
        // Cloudflare's length-preserving upload stream; enforce the same byte contract in Node.
        vi.stubGlobal('FixedLengthStream', class extends TransformStream {
            constructor(expected) { let size = 0; super({ transform(chunk, controller) { size += chunk.length; if (size > expected) throw new Error('Too many bytes'); controller.enqueue(chunk); }, flush() { if (size !== expected) throw new Error('Truncated stream'); } }); }
        });
        db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = ON');
        db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
        db.exec("INSERT INTO users (id) VALUES ('owner'), ('other')");
        const DB = { prepare(sql) { return { values: [], bind(...values) { this.values = values; return this; },
            async first() { return db.prepare(sql).get(...this.values) || null; },
            async all() { return { results: db.prepare(sql).all(...this.values) }; },
            async run() { return db.prepare(sql).run(...this.values); },
        }; }, async batch(statements) { db.exec('BEGIN'); try { const result = []; for (const statement of statements) result.push(await statement.run()); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } } };
        env = { DB, CLIPS_BUCKET: bucket(), PRESETS_BUCKET: bucket(), SESSION_SECRET: 'clip-tests' };
        app = new Hono().route('/clips', clipRoutes).route('/clip', clipUploadRoutes).route('/presets', presetRoutes);
        const session = async id => ({ Cookie: `session=${await createSessionToken({ id, googleId: id, email: `${id}@example.com`, name: id }, env.SESSION_SECRET)}` });
        headers = await session('owner'); otherHeaders = await session('other');
    });
    afterEach(() => { db.close(); vi.unstubAllGlobals(); });
    const json = (method, body, auth = headers) => ({ method, headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const put = (id, asset, body, extra = {}) => app.request(`/clip/${id}/assets/${asset}`, { method: 'PUT', headers: { ...headers, 'Content-Type': asset === 'clip' ? 'video/mp4' : 'image/png', 'Content-Length': String(body.length), ...extra }, body }, env);
    async function pending(data = bytes, mimeType = 'video/mp4') {
        const response = await app.request('/clip', json('POST', { name: 'Clip', mimeType, width: 32, height: 24, fileSize: data.length, thumbnailSize: png.length, thumbnailMimeType: 'image/png' }), env);
        expect(response.status).toBe(201); return (await response.json()).clipId;
    }
    const complete = id => app.request(`/clip/${id}/complete`, { method: 'POST', headers }, env);
    async function saved() {
        const id = await pending(); expect((await put(id, 'clip', bytes)).status).toBe(200); expect((await put(id, 'thumbnail', png)).status).toBe(200);
        const result = await complete(id); expect(result.status).toBe(200); expect((await result.json()).clip).toMatchObject({ duration: 1.2, width: 32, height: 24 }); return id;
    }
    const startUpload = id => app.request(`/clip/${id}/upload`, { method: 'POST', headers }, env);
    const putPart = (id, session, number, data, auth = headers, mimeType = 'video/mp4') => app.request(`/clip/${id}/upload/${session}/parts/${number}`, {
        method: 'PUT', headers: { ...auth, 'Content-Type': mimeType, 'Content-Length': String(data.length) }, body: data,
    }, env);
    const assemble = (id, session, parts) => app.request(`/clip/${id}/upload/${session}/complete`, json('POST', { parts }), env);
    it('accepts exactly 1 GB, rejects one byte more, and keeps legacy requests bounded', async () => {
        const id = await pending({ length: MAX_CLIP_BYTES });
        const session = await startUpload(id).then(r => r.json());
        expect(session).toMatchObject({ partSize: CLIP_UPLOAD_PART_BYTES, partCount: Math.ceil(MAX_CLIP_BYTES / CLIP_UPLOAD_PART_BYTES) });
        const tooLarge = await app.request('/clip', json('POST', { name: 'Clip', mimeType: 'video/mp4', width: 32, height: 24,
            fileSize: MAX_CLIP_BYTES + 1, thumbnailSize: png.length, thumbnailMimeType: 'image/png' }), env);
        expect(tooLarge.status).toBe(400);
        expect((await put(id, 'clip', bytes)).status).toBe(413);
    });
    it('assembles, verifies, and finalizes multipart clips idempotently without retaining sessions', async () => {
        const id = await pending(), session = await startUpload(id).then(r => r.json());
        expect((await startUpload(id).then(r => r.json())).sessionId).toBe(session.sessionId);
        expect(env.CLIPS_BUCKET.createMultipartUpload).toHaveBeenCalledOnce();
        const receipt = await putPart(id, session.sessionId, 1, bytes).then(r => r.json());
        expect((await assemble(id, session.sessionId, [receipt])).status).toBe(200);
        expect((await assemble(id, session.sessionId, [receipt])).status).toBe(200);
        await put(id, 'thumbnail', png);
        expect((await complete(id)).status).toBe(200);
        expect(env.CLIPS_BUCKET.uploads.size).toBe(0);
        expect(db.prepare('SELECT * FROM clip_upload_sessions').all()).toEqual([]);
        expect((await putPart(id, session.sessionId, 1, bytes)).status).toBe(409);
    });
    it('enforces owner, session, part count/size, and assembly receipts', async () => {
        const id = await pending({ length: CLIP_UPLOAD_PART_BYTES + bytes.length });
        const session = await startUpload(id).then(r => r.json());
        expect((await putPart(id, session.sessionId, 1, bytes, otherHeaders)).status).toBe(404);
        expect((await putPart(id, 'other-session', 1, bytes)).status).toBe(404);
        expect((await putPart(id, session.sessionId, 0, bytes)).status).toBe(400);
        expect((await putPart(id, session.sessionId, 3, bytes)).status).toBe(400);
        expect((await putPart(id, session.sessionId, 1, bytes)).status).toBe(400);
        const first = await putPart(id, session.sessionId, 1, new Uint8Array(CLIP_UPLOAD_PART_BYTES)).then(r => r.json());
        const last = await putPart(id, session.sessionId, 2, bytes).then(r => r.json());
        expect((await assemble(id, session.sessionId, [first])).status).toBe(400);
        expect((await assemble(id, session.sessionId, [last, first])).status).toBe(400);
        expect((await assemble(id, session.sessionId, [first, last])).status).toBe(200);
    });
    it('preserves a non-MP4 container through multipart assembly and media verification', async () => {
        const data = fixture('clip-vp9.webm'), id = await pending(data, 'video/webm');
        const session = await startUpload(id).then(response => response.json());
        expect(env.CLIPS_BUCKET.createMultipartUpload).toHaveBeenCalledWith(expect.any(String), { httpMetadata: { contentType: 'video/webm' } });
        const part = await putPart(id, session.sessionId, 1, data, headers, 'video/webm').then(response => response.json());
        expect((await assemble(id, session.sessionId, [part])).status).toBe(200);
        await put(id, 'thumbnail', png);
        const result = await complete(id); expect(result.status).toBe(200);
        expect((await result.json()).clip.mime_type).toBe('video/webm');
    });
    it('aborts unfinished parts on cancel and expiry and cannot assemble after deletion', async () => {
        const id = await pending(), session = await startUpload(id).then(r => r.json());
        const receipt = await putPart(id, session.sessionId, 1, bytes).then(r => r.json());
        const upload = [...env.CLIPS_BUCKET.uploads.values()][0];
        expect((await app.request(`/clip/${id}`, json('DELETE', {}), env)).status).toBe(200);
        expect(upload.abort).toHaveBeenCalledOnce(); expect(env.CLIPS_BUCKET.uploads.size).toBe(0);
        expect((await assemble(id, session.sessionId, [receipt])).status).toBe(404);
        const expired = await pending(); await startUpload(expired);
        db.prepare('UPDATE clip_assets SET upload_expires_at = 0 WHERE id = ?').run(expired);
        await cleanupClips(env); expect(env.CLIPS_BUCKET.uploads.size).toBe(0);
        expect(db.prepare('SELECT * FROM clip_upload_sessions').all()).toEqual([]);
    });
    it('rejects assembly if deletion starts after R2 completes and removes the new object', async () => {
        const id = await pending(), session = await startUpload(id).then(r => r.json());
        const receipt = await putPart(id, session.sessionId, 1, bytes).then(r => r.json());
        const upload = [...env.CLIPS_BUCKET.uploads.values()][0], real = upload.complete.getMockImplementation();
        upload.complete.mockImplementationOnce(async parts => {
            const result = await real(parts); db.prepare("UPDATE clip_assets SET status = 'deleting' WHERE id = ?").run(id); return result;
        });
        expect((await assemble(id, session.sessionId, [receipt])).status).toBe(409);
        expect(env.CLIPS_BUCKET.objects.size).toBe(0);
    });
    async function preset(id, auth = headers, extra = {}) {
        db.exec("INSERT OR IGNORE INTO texture_sets (id, owner_id, name, tile_resolution, tile_count, layer_count, status, is_public) VALUES ('texture', 'owner', 'Texture', 512, 1, 1, 'complete', 1)");
        const scene = { schemaVersion: 3, geometry: { paths: [[{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }]] }, textures: [{ id: 'texture', tileCount: 1, tileResolution: 512, layerCount: 1 }],
            artwork: { backgroundTextureSource: { kind: 'clip', id }, backgroundTextureEnabled: false, backgroundClipPlaybackMode: 'alignLoop' }, camera: { position: [0, 0, 5], target: [0, 0, 0], quaternion: [0, 0, 0, 1], fov: 45 } };
        const result = await app.request('/presets', json('POST', { name: 'Clip scene', scene, visibility: 'unlisted', ...extra }, auth), env);
        expect(result.status).toBe(201); const presetId = (await result.json()).preset.id;
        db.prepare("UPDATE scene_presets SET status = 'complete' WHERE id = ?").run(presetId); return presetId;
    }
    it('streams an immutable upload, verifies real media, and completes idempotently', async () => {
        const id = await saved(); expect((await complete(id)).status).toBe(200);
        expect((await put(id, 'clip', bytes)).status).toBe(409);
        expect((await app.request('/clips', { headers }, env).then(r => r.json())).clips).toMatchObject([{ id, duration: 1.2 }]);
        const bad = await pending(); await put(bad, 'clip', new Uint8Array(bytes.length)); await put(bad, 'thumbnail', png);
        expect((await complete(bad)).status).toBe(400);
        const truncated = await pending(); expect((await put(truncated, 'clip', bytes.slice(1))).status).toBe(400);
    });
    it('protects metadata, range reads, HEAD, and posters and serves proper byte ranges', async () => {
        const id = await saved();
        for (const path of [`/clips/${id}`, `/clips/${id}/assets/clip`, `/clips/${id}/assets/thumbnail`]) expect((await app.request(path, { headers: otherHeaders }, env)).status).toBe(404);
        expect((await app.request(`/clips/${id}/assets/clip`, { method: 'HEAD', headers: otherHeaders }, env)).status).toBe(404);
        const range = await app.request(`/clips/${id}/assets/clip`, { headers: { ...headers, Range: 'bytes=10-29' } }, env);
        expect(range.status).toBe(206); expect(range.headers.get('Content-Range')).toBe(`bytes 10-29/${bytes.length}`); expect(range.headers.get('Content-Length')).toBe('20');
        expect(new Uint8Array(await range.arrayBuffer())).toEqual(bytes.slice(10, 30));
        expect((await app.request(`/clips/${id}/assets/clip`, { headers: { ...headers, Range: 'bytes=999999-' } }, env)).status).toBe(416);
        const suffix = await app.request(`/clips/${id}/assets/clip`, { headers: { ...headers, Range: 'bytes=-10' } }, env);
        expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(bytes.slice(-10));
        const head = await app.request(`/clips/${id}/assets/clip`, { method: 'HEAD', headers }, env); expect(head.status).toBe(200); expect(await head.text()).toBe('');
    });
    it('retains disabled clip dependencies, grants derivative presets, and rechecks deletion consent', async () => {
        const id = await saved(), first = await preset(id);
        expect((await app.request(`/clips/${id}/assets/clip?sourcePresetId=${first}`, {}, env)).status).toBe(200);
        const derivative = await preset(id, otherHeaders, { backgroundSourcePresetId: first });
        expect((await app.request(`/presets/${first}`, { method: 'DELETE', headers }, env)).status).toBe(200);
        expect((await app.request(`/clips/${id}/assets/clip?sourcePresetId=${derivative}`, {}, env)).status).toBe(200);
        expect((await app.request(`/clip/${id}`, json('DELETE', {}), env)).status).toBe(409);
        const another = await preset(id);
        expect((await app.request(`/clip/${id}`, json('DELETE', { acceptedPresetIds: [derivative] }), env)).status).toBe(409);
        expect((await app.request(`/clip/${id}`, json('DELETE', { acceptedPresetIds: [derivative, another] }), env)).status).toBe(200);
        expect(env.CLIPS_BUCKET.objects.size).toBe(0);
    });
    it('cannot replace a clip after a concurrent completion and cleans expired uploads', async () => {
        const id = await pending(); await put(id, 'clip', bytes); await put(id, 'thumbnail', png);
        const original = db.prepare('SELECT clip_key FROM clip_assets WHERE id = ?').get(id).clip_key;
        const real = env.CLIPS_BUCKET.put.getMockImplementation();
        env.CLIPS_BUCKET.put.mockImplementationOnce(async (...args) => { await real(...args); expect((await complete(id)).status).toBe(200); });
        expect((await put(id, 'clip', bytes)).status).toBe(409);
        expect(db.prepare('SELECT clip_key FROM clip_assets WHERE id = ?').get(id).clip_key).toBe(original);
        const expired = await pending(); await put(expired, 'clip', bytes); db.prepare('UPDATE clip_assets SET upload_expires_at = 0 WHERE id = ?').run(expired);
        await cleanupClips(env); expect(db.prepare('SELECT id FROM clip_assets WHERE id = ?').get(expired)).toBeUndefined();
    });
    it.each([
        ['clip-vp9.webm', 'video/webm', 'vp09'], ['clip-vp9.mkv', 'video/x-matroska', 'vp09'],
        ['clip.mov', 'video/quicktime', 'avc1'], ['clip-hevc.mp4', 'video/mp4', 'hev1'],
        ['clip-av1.mp4', 'video/mp4', 'av01'], ['clip.mts', 'video/mp2t', 'avc1'],
    ])('verifies and serves the actual format of %s without a codec allowlist', async (name, mimeType, codecPrefix) => {
        const data = fixture(name), id = await pending(data, mimeType);
        expect((await put(id, 'clip', data, { 'Content-Type': mimeType })).status).toBe(200);
        await put(id, 'thumbnail', png);
        const result = await complete(id); expect(result.status).toBe(200);
        const clip = (await result.json()).clip;
        expect(clip.mime_type).toBe(mimeType); expect(clip.codec.startsWith(codecPrefix)).toBe(true);
        expect((await app.request(`/clips/${id}/assets/clip`, { headers }, env)).headers.get('Content-Type')).toBe(mimeType);
    });
    it('checks the real container instead of accepting spoofed upload metadata', async () => {
        const data = fixture('clip-vp9.webm'), id = await pending(data, 'video/mp4');
        await put(id, 'clip', data); await put(id, 'thumbnail', png);
        const result = await complete(id); expect(result.status).toBe(400);
        expect((await result.json()).error).toContain('format does not match');
    });
    it('leaves decoding capability decisions to the client instead of imposing an AVC profile gate', async () => {
        const input = new Input({ formats: getClipInputFormats(ALL_FORMATS), source: new BlobSource(new Blob([fixture('interlaced-clip')])) });
        try { await expect(inspectClipInput(input)).resolves.toMatchObject({ width: 32, height: 32, mimeType: 'video/mp4' }); } finally { input.dispose(); }
    });
    it('excludes external playlists from the local-file parser set', () => {
        expect(getClipInputFormats(ALL_FORMATS).some(format => format.mimeType.includes('mpegurl'))).toBe(false);
    });
    it('preserves existing resource dependencies when applying migration 014', () => {
        // The common test fixture includes the latest schema. Remove the clip
        // consent trigger (absent before 014) before exercising the old rows.
        db.exec('DROP TRIGGER clip_delete_requires_preset_consent');
        db.exec(`INSERT INTO scene_presets (id, owner_id, name, schema_version, manifest_json) VALUES ('legacy', 'owner', 'Legacy scene', 2, '[]');
            INSERT INTO texture_sets (id, owner_id, name, tile_resolution, tile_count, layer_count, status) VALUES ('texture', 'owner', 'Texture', 512, 1, 1, 'complete');
            INSERT INTO audio_assets (id, owner_id, name, mime_type, format, duration, expected_file_size, status) VALUES ('audio', 'owner', 'Audio', 'audio/wav', 'wav', 1, 10, 'complete');
            INSERT INTO image_assets (id, owner_id, name, mime_type, width, height, expected_file_size, thumbnail_size, thumbnail_mime_type, image_key, thumbnail_key, status)
                VALUES ('image', 'owner', 'Image', 'image/png', 1, 1, 10, 10, 'image/png', 'image', 'thumbnail', 'complete');
            INSERT INTO preset_media_dependencies (preset_id, texture_set_id) VALUES ('legacy', 'texture');
            INSERT INTO preset_media_dependencies (preset_id, audio_asset_id) VALUES ('legacy', 'audio');
            INSERT INTO preset_media_dependencies (preset_id, image_asset_id) VALUES ('legacy', 'image');`);
        db.exec(readFileSync(new URL('../db/migrations/014_clip_assets.sql', import.meta.url), 'utf8'));
        expect(db.prepare('SELECT * FROM preset_media_dependencies').all()).toHaveLength(3);
        expect(() => db.prepare("UPDATE image_assets SET status = 'deleting' WHERE id = 'image'").run()).toThrow('Linked presets changed');
        expect(() => db.prepare("UPDATE audio_assets SET status = 'deleting' WHERE id = 'audio'").run()).toThrow('Linked presets changed');
        expect(() => db.prepare("UPDATE texture_sets SET status = 'deleting' WHERE id = 'texture'").run()).toThrow('Linked presets changed');
    });
});
