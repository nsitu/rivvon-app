import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { InputVideoTrack } from 'mediabunny';
import { videoUploadRoutes } from './videoUpload';
import { videoRoutes, myVideoRoutes } from './videos';
import { createSessionToken } from '../utils/session';

const owner = { id: 'owner', googleId: 'google-owner', email: 'owner@example.com', name: 'Owner' };
const fixture = await readFile(new URL('../../../packages/shared-types/fixtures/clip.mp4', import.meta.url));
function environment() {
    const row = { id: 'video', owner_id: owner.id, r2_key: 'videos/video/video.mp4', thumbnail_r2_key: 'poster.webp',
        video_thumbnail_r2_key: 'old.mp4', video_thumbnail_url: 'https://cdn.rivvon.ca/old.mp4', is_public: 1 };
    const statements = [];
    const DB = { prepare(sql) { return { sql, values: [], bind(...values) { this.values = values; return this; },
        async first() {
            if (sql.includes("is_public = 1") && !row.is_public) return null;
            return sql.includes('COUNT') ? { total: 1 } : row;
        },
        async all() { return { results: [row] }; },
        async run() { statements.push(this); return {}; },
    }; } };
    return { row, statements, env: { DB, BUCKET: { put: vi.fn(), delete: vi.fn(async () => {}) },
        SESSION_SECRET: 'video-thumbnail-secret', ADMIN_USERS: 'admin@example.com' } };
}
async function upload(env, viewer = owner, body = fixture, extraHeaders = {}) {
    return videoUploadRoutes.request('/video/video-thumbnail', { method: 'PUT', body,
        headers: { Cookie: `session=${await createSessionToken(viewer, env.SESSION_SECRET)}`, 'Content-Type': 'video/mp4', ...extraHeaders } }, env);
}
describe('video thumbnail storage and API contract', () => {
    it.each([owner, { ...owner, id: 'admin', email: 'admin@example.com' }])('stores a real silent AVC MP4 for owners and admins', async viewer => {
        const { env, statements } = environment();
        const response = await upload(env, viewer);
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data).toMatchObject({ videoId: 'video', width: 32, height: 24, size: fixture.length });
        expect(data.videoThumbnailUrl).toMatch(/^https:\/\/cdn.rivvon.ca\/video-thumbnails\/video\/.+\.mp4$/);
        const key = data.videoThumbnailUrl.replace('https://cdn.rivvon.ca/', '');
        expect(env.BUCKET.put).toHaveBeenCalledWith(key, expect.any(Uint8Array), {
            httpMetadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=31536000, immutable' },
        });
        expect(statements[0].values).toEqual([data.videoThumbnailUrl, key, 32, 24, fixture.length, 'video']);
        expect(env.BUCKET.delete).toHaveBeenCalledWith('old.mp4');
        const second = await upload(env, viewer);
        expect((await second.json()).videoThumbnailUrl).not.toBe(data.videoThumbnailUrl);
    });
    it('rejects unauthenticated and unrelated users before writing anything', async () => {
        const { env } = environment();
        expect((await videoUploadRoutes.request('/video/video-thumbnail', { method: 'PUT', body: fixture }, env)).status).toBe(401);
        expect((await upload(env, { ...owner, id: 'other', email: 'other@example.com' })).status).toBe(403);
        expect(env.BUCKET.put).not.toHaveBeenCalled();
    });
    it.each([
        ['wrong type', fixture, { 'Content-Type': 'image/webp' }],
        ['empty', new Uint8Array(), {}],
        ['invalid MP4', new Uint8Array([1, 2, 3]), {}],
        ['too large', fixture, { 'Content-Length': String(33 * 1024 * 1024) }],
    ])('rejects %s', async (_name, body, headers) => {
        const { env } = environment();
        expect((await upload(env, owner, body, headers)).status).toBe(400);
        expect(env.BUCKET.put).not.toHaveBeenCalled();
    });
    it('rejects dimensions over 360', async () => {
        const { env } = environment();
        const spy = vi.spyOn(InputVideoTrack.prototype, 'getDisplayWidth').mockResolvedValue(720);
        try { expect((await upload(env)).status).toBe(400); }
        finally { spy.mockRestore(); }
        expect(env.BUCKET.put).not.toHaveBeenCalled();
    });
    it('removes the new object and retains the old one if the metadata write fails', async () => {
        const { env } = environment();
        const originalPrepare = env.DB.prepare;
        env.DB.prepare = sql => {
            const statement = originalPrepare(sql);
            if (sql.includes('UPDATE')) statement.run = async () => { throw new Error('Database unavailable'); };
            return statement;
        };
        const response = await upload(env);
        expect(response.status).toBe(500);
        const key = env.BUCKET.put.mock.calls[0][0];
        expect(env.BUCKET.delete).toHaveBeenCalledWith(key);
        expect(env.BUCKET.delete).not.toHaveBeenCalledWith('old.mp4');
    });
    it('deletes the preview along with the video and poster', async () => {
        const { env } = environment();
        const response = await videoUploadRoutes.request('/video', { method: 'DELETE',
            headers: { Cookie: `session=${await createSessionToken(owner, env.SESSION_SECRET)}` } }, env);
        expect(response.status).toBe(200);
        expect(env.BUCKET.delete).toHaveBeenCalledWith(['videos/video/video.mp4', 'poster.webp', 'old.mp4']);
    });
    it('includes the nullable preview URL in list, detail, and owner responses', async () => {
        const { env, row } = environment();
        const cookie = `session=${await createSessionToken(owner, env.SESSION_SECRET)}`;
        for (const [routes, path] of [[videoRoutes, '/'], [videoRoutes, '/video'], [myVideoRoutes, '/']]) {
            const data = await (await routes.request(path, { headers: { Cookie: cookie } }, env)).json();
            expect((data.video || data.videos[0]).video_thumbnail_url).toBe(row.video_thumbnail_url);
        }
    });
    it('redirects stable public embed URLs to the current thumbnail without caching', async () => {
        const { env, row } = environment();
        const response = await videoRoutes.request('/video/video-thumbnail', {}, env);
        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe(row.video_thumbnail_url);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
        row.video_thumbnail_url = 'https://cdn.rivvon.ca/new.mp4';
        const regenerated = await videoRoutes.request('/video/video-thumbnail', { method: 'HEAD' }, env);
        expect(regenerated.headers.get('Location')).toBe(row.video_thumbnail_url);
        row.is_public = 0;
        expect((await videoRoutes.request('/video/video-thumbnail', {}, env)).status).toBe(404);
        row.is_public = 1; row.video_thumbnail_url = null;
        expect((await videoRoutes.request('/video/video-thumbnail', {}, env)).status).toBe(404);
    });
});
