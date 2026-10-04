import { describe, expect, it } from 'vitest';
import { textureRoutes } from './textures';
import { uploadRoutes } from './upload';
import { createSessionToken } from '../utils/session';

const user = { id: 'owner', googleId: 'google-owner', email: 'owner@example.com', name: 'Owner' };
const provenance = { version: 1, provider: 'google-photos', mediaItemId: 'original-video', createTime: '2020-01-01T00:00:00Z',
    originalFilename: 'original.mov', downloadVariant: 'google-photos-dv-transcode' };
const row = { id: 'root', name: 'Imported texture', owner_id: user.id, tile_resolution: 512, tile_count: 1, layer_count: 60, source_filename: 'imported.mp4',
    source_width: 1920, source_height: 1080, source_duration: 4, source_provenance: JSON.stringify(provenance),
    source_frame_count: 120, sampled_frame_count: 120, status: 'complete', storage_provider: 'google-drive' };

function environment() {
    const statements: { sql: string; values: unknown[] }[] = [];
    const DB = { prepare(sql: string) {
        const statement = { sql, values: [] as unknown[], bind(...values: unknown[]) { this.values = values; return this; },
            async first() { return row; }, async all() { return { results: [] }; }, async run() { statements.push(this); return {}; } };
        return statement;
    } };
    return { env: { DB, SESSION_SECRET: 'provenance-test-secret' } as any, statements };
}

describe('private texture source provenance', () => {
    it.each([null, { ...user, id: 'someone-else', googleId: 'other-google' }])('does not expose source IDs or capture metadata to public or other users', async (viewer) => {
        const { env } = environment();
        const headers: Record<string, string> = viewer ? { Cookie: `session=${await createSessionToken(viewer, env.SESSION_SECRET)}` } : {};
        const response = await textureRoutes.request('/root', { headers }, env);
        const data = await response.json() as any;
        expect(data.source_provenance).toBeUndefined();
        expect(data.source_metadata.provenance).toBeUndefined();
        expect(JSON.stringify(data)).not.toContain('original-video');
    });
    it('restores provenance and measured video facts for the owner', async () => {
        const { env } = environment();
        const response = await textureRoutes.request('/root', { headers: { Cookie: `session=${await createSessionToken(user, env.SESSION_SECRET)}` } }, env);
        expect(await response.json()).toMatchObject({ source_metadata: { filename: 'imported.mp4', duration: 4, provenance } });
        expect(response.headers.get('Cache-Control')).toContain('private');
        expect(response.headers.get('Vary')).toContain('Cookie');
    });
    it('persists allowlisted provenance alongside source measurements', async () => {
        const { env, statements } = environment();
        const response = await uploadRoutes.request('/', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `session=${await createSessionToken(user, env.SESSION_SECRET)}` },
            body: JSON.stringify({ name: 'Imported texture', tileResolution: 512, tileCount: 1, layerCount: 60,
                sourceMetadata: { filename: 'imported.mp4', duration: 4, provenance: { ...provenance, accessToken: 'must-not-be-stored' } } }) }, env);
        expect(response.status).toBe(200);
        const insert = statements.find(statement => statement.sql.includes('INSERT INTO texture_sets'))!;
        expect(insert.sql).toContain('source_provenance');
        expect(insert.values.filter(value => typeof value === 'string' && value.startsWith('{')).map(value => JSON.parse(value as string))).toContainEqual(provenance);
        expect(insert.values.join(' ')).not.toContain('must-not-be-stored');
        expect((insert.sql.match(/\?/g) || []).length).toBe(insert.values.length);
    });
    it('derived cloud variants inherit the root provenance', async () => {
        const { env, statements } = environment();
        const response = await uploadRoutes.request('/', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `session=${await createSessionToken(user, env.SESSION_SECRET)}` },
            body: JSON.stringify({ name: 'Variant', parentTextureSetId: 'root', tileResolution: 256, tileCount: 1, layerCount: 60 }) }, env);
        expect(response.status).toBe(200);
        expect(statements[0].values.filter(value => typeof value === 'string' && value.startsWith('{')).map(value => JSON.parse(value as string))).toContainEqual(provenance);
    });
});
