import { describe, expect, it, vi } from 'vitest';
import { uploadRoutes } from './upload';
import { createSessionToken } from '../utils/session';
import { readFileSync } from 'node:fs';
import { isValidKtx2Tile } from '../utils/ktx2';

const owner = { id: 'owner', googleId: 'google-owner', email: 'owner@example.com', name: 'Owner' };
function validTile() {
    const bytes = new Uint8Array(120);
    bytes.set([0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A]);
    const view = new DataView(bytes.buffer);
    for (const [offset, value] of [[20, 512], [24, 512], [36, 1], [40, 1]]) view.setUint32(offset, value, true);
    view.setBigUint64(80, 104n, true); view.setBigUint64(88, 16n, true);
    return bytes;
}
function environment(size = 120, tiles = [{ id: 'tile', tile_index: 0, r2_key: 'textures/root/0.ktx2' }]) {
    const statements: { sql: string; values: unknown[] }[] = [];
    const DB = { prepare(sql: string) {
        return { sql, values: [] as unknown[], bind(...values: unknown[]) { this.values = values; return this; },
            async first() { return sql.includes('FROM texture_tiles') ? tiles[0] : { id: 'root', owner_id: owner.id, tile_count: 1, tile_resolution: 512, layer_count: 1, storage_provider: 'r2' }; },
            async all() { return { results: tiles }; }, async run() { statements.push(this); return {}; } };
    } };
    return { env: { DB, BUCKET: { put: vi.fn(async () => {}), head: vi.fn(async () => ({ size })) }, SESSION_SECRET: 'tile-test-secret' } as any, statements };
}
async function headers(env: any) { return { Cookie: `session=${await createSessionToken(owner, env.SESSION_SECRET)}`, 'Content-Type': 'image/ktx2' }; }

describe('texture tile upload integrity', () => {
    it('refuses recovery over nonempty cloud data', async () => {
        const { env } = environment(120);
        const response = await uploadRoutes.request('/root/tile/0?repairEmptyOnly=true', { method: 'PUT', headers: await headers(env), body: validTile() }, env);
        expect(response.status).toBe(409); expect(env.BUCKET.put).not.toHaveBeenCalled();
    });
    it('restores empty files at the existing ID with a fresh media URL', async () => {
        const { env, statements } = environment(0);
        const response = await uploadRoutes.request('/root/tile/0?repairEmptyOnly=true', { method: 'PUT', headers: await headers(env), body: validTile() }, env);
        expect(response.status).toBe(200);
        expect((await response.json() as any).url).toMatch(/textures\/root\/0.ktx2\?v=.+/);
        expect(statements[0].sql).toContain('public_url = ?');
        expect(statements.some(statement => statement.sql.includes('INSERT'))).toBe(false);
    });
    it('rejects recovery data with a different layer count', async () => {
        const { env } = environment(0);
        const body = validTile(); new DataView(body.buffer).setUint32(32, 240, true);
        const response = await uploadRoutes.request('/root/tile/0?repairEmptyOnly=true', { method: 'PUT', headers: await headers(env), body }, env);
        expect(response.status).toBe(400); expect(env.BUCKET.put).not.toHaveBeenCalled();
    });
    it.each(['planes', 'waves'])('accepts the actual multi-mip %s tile format', (kind) => {
        const bytes = readFileSync(new URL(`../../rivvon/public/tiles-ktx2-${kind}/0.ktx2`, import.meta.url));
        expect(isValidKtx2Tile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).toBe(true);
    });
    it.each(['empty', 'wrong signature', 'zero dimensions', 'truncated mip'])('rejects %s payloads before changing storage', async (kind) => {
        const { env, statements } = environment();
        let body = validTile();
        if (kind === 'empty') body = new Uint8Array();
        if (kind === 'wrong signature') body[0] = 0;
        if (kind === 'zero dimensions') new DataView(body.buffer).setUint32(20, 0, true);
        if (kind === 'truncated mip') body = body.slice(0, 110);
        const response = await uploadRoutes.request('/root/tile/0', { method: 'PUT', headers: await headers(env), body }, env);
        expect(response.status).toBe(400);
        expect(env.BUCKET.put).not.toHaveBeenCalled(); expect(statements).toEqual([]);
    });
    it('accepts a nonempty KTX2 payload with valid mip bounds', async () => {
        const { env } = environment();
        const response = await uploadRoutes.request('/root/tile/0', { method: 'PUT', headers: await headers(env), body: validTile() }, env);
        expect(response.status).toBe(200); expect(env.BUCKET.put).toHaveBeenCalledOnce();
    });
    it.each([0, 10])('does not complete a texture with a %s-byte placeholder', async (size) => {
        const { env, statements } = environment(size);
        const response = await uploadRoutes.request('/root/complete', { method: 'POST', headers: await headers(env) }, env);
        expect(response.status).toBe(400); expect(statements).toEqual([]);
    });
    it('does not complete a texture with missing tiles', async () => {
        const { env, statements } = environment(120, []);
        const response = await uploadRoutes.request('/root/complete', { method: 'POST', headers: await headers(env) }, env);
        expect(response.status).toBe(400); expect(statements).toEqual([]);
    });
    it('completes a texture only after all nonempty tiles exist', async () => {
        const { env, statements } = environment();
        const response = await uploadRoutes.request('/root/complete', { method: 'POST', headers: await headers(env) }, env);
        expect(response.status).toBe(200);
        expect(statements.some(statement => statement.sql.includes("SET status = 'complete'"))).toBe(true);
    });
});
