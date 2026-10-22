import { describe, expect, it, vi } from 'vitest';
import { uploadRoutes } from './upload';
import { createSessionToken } from '../utils/session';

const owner = { id: 'owner', googleId: 'google-owner', email: 'owner@example.com', name: 'Owner' };

function environment() {
    const statements: { sql: string; values: unknown[] }[] = [];
    const DB = { prepare(sql: string) {
        const statement = { sql, values: [] as unknown[], bind(...values: unknown[]) { this.values = values; return this; },
            async first() { return !sql.includes('owner_id = ?') || this.values[1] === owner.id ? { id: 'root', owner_id: owner.id } : null; },
            async run() { statements.push(this); return {}; } };
        return statement;
    } };
    return { env: { DB, BUCKET: { put: vi.fn(async () => {}) }, SESSION_SECRET: 'thumbnail-test-secret', ADMIN_USERS: 'admin@example.com' } as any, statements };
}

describe('texture thumbnail replacement', () => {
    it.each([owner, { ...owner, id: 'admin', email: 'admin@example.com' }])('lets owners and admins replace the shared family thumbnail', async (viewer) => {
        const { env, statements } = environment();
        const headers = { Cookie: `session=${await createSessionToken(viewer, env.SESSION_SECRET)}`, 'Content-Type': 'image/jpeg' };
        const response = await uploadRoutes.request('/root/thumbnail', { method: 'PUT', headers, body: 'image' }, env);
        expect(response.status).toBe(200);
        const data = await response.json() as any;
        expect(data.thumbnailUrl).toMatch(/^https:\/\/cdn.rivvon.ca\/thumbnails\/root.jpg\?v=.+$/);
        expect(env.BUCKET.put).toHaveBeenCalledWith('thumbnails/root.jpg', expect.any(ArrayBuffer), { httpMetadata: { contentType: 'image/jpeg' } });
        expect(statements[0].sql).toContain('WHERE id = ? OR parent_texture_set_id = ?');
        expect(statements[0].values).toEqual([data.thumbnailUrl, 'root', 'root']);
        const second = await uploadRoutes.request('/root/thumbnail', { method: 'PUT', headers, body: 'new image' }, env);
        expect((await second.json() as any).thumbnailUrl).not.toBe(data.thumbnailUrl);
    });
    it('rejects other users without writing storage or metadata', async () => {
        const { env, statements } = environment();
        const other = { ...owner, id: 'other', email: 'other@example.com' };
        const response = await uploadRoutes.request('/root/thumbnail', { method: 'PUT', body: 'image',
            headers: { Cookie: `session=${await createSessionToken(other, env.SESSION_SECRET)}`, 'Content-Type': 'image/jpeg' } }, env);
        expect(response.status).toBe(404);
        expect(env.BUCKET.put).not.toHaveBeenCalled();
        expect(statements).toEqual([]);
    });
});
