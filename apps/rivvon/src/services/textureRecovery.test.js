import { afterEach, describe, expect, it, vi } from 'vitest';
import { restoreEmptyTextureTiles } from './textureRecovery.js';
import { createTextureThumbnail } from '../modules/shared/textureThumbnail.js';
vi.mock('../modules/shared/textureThumbnail.js', () => ({ createTextureThumbnail: vi.fn(async () => new Blob(['thumbnail'])) }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function setup() {
    const texture = { id: 'cloud', name: 'Original', storage_provider: 'r2', tile_resolution: 512, layer_count: 240, tile_count: 2, cross_section_type: 'waves',
        tiles: [0, 1].map(index => ({ tileIndex: index, fileSize: 0, url: `https://cdn.example/${index}` })) };
    const localTexture = { ...texture, id: 'local', cached_from: 'cloud' };
    const bytes = new Uint8Array(120);
    bytes.set([0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A]);
    const header = new DataView(bytes.buffer);
    for (const [offset, value] of [[20, 512], [24, 512], [32, 240], [40, 1]]) header.setUint32(offset, value, true);
    vi.stubGlobal('fetch', vi.fn(async url => String(url).endsWith('/api/auth/me')
        ? Response.json({ authenticated: true, user: { id: 'owner' } }) : new Response(new Blob([]))));
    return { texture, localTexture, tiles: [0, 1].map(tile_index => ({ tile_index, blob: new Blob([bytes]) })),
        fetchTextureWithTiles: vi.fn(async () => texture), uploadTile: vi.fn(async () => {}),
        completeTextureSet: vi.fn(async () => {}), uploadThumbnail: vi.fn(async () => ({ thumbnailUrl: 'preview' })) };
}
describe('restoring empty cloud files from an intact local copy', () => {
    it('requires this browser to be authenticated before reading or changing cloud texture files', async () => {
        const options = setup();
        vi.mocked(fetch).mockResolvedValue(Response.json({ authenticated: false }));
        await expect(restoreEmptyTextureTiles(options)).rejects.toThrow('Sign in to Rivvon in this browser');
        expect(options.fetchTextureWithTiles).not.toHaveBeenCalled();
        expect(options.uploadTile).not.toHaveBeenCalled();
        expect(createTextureThumbnail).not.toHaveBeenCalled();
    });
    it('rejects a session belonging to another account before uploading', async () => {
        const options = setup(); options.texture.owner_id = 'someone-else';
        await expect(restoreEmptyTextureTiles(options)).rejects.toThrow('account that owns this texture');
        expect(options.uploadTile).not.toHaveBeenCalled();
    });
    it('retains the original cloud ID and regenerates its thumbnail', async () => {
        const options = setup();
        const result = await restoreEmptyTextureTiles(options);
        expect(result).toMatchObject({ restoredCount: 2, thumbnailUrl: 'preview' });
        expect(options.uploadTile.mock.calls.map(call => [call[0], call[1], call[3]])).toEqual([
            ['cloud', 0, { repairEmptyOnly: true }], ['cloud', 1, { repairEmptyOnly: true }],
        ]);
        expect(options.completeTextureSet).toHaveBeenCalledExactlyOnceWith('cloud');
        expect(options.uploadThumbnail).toHaveBeenCalledWith('cloud', expect.any(Blob));
    });
    it('checks every local tile before uploading anything', async () => {
        const options = setup(); options.tiles[1].blob = new Blob([]);
        await expect(restoreEmptyTextureTiles(options)).rejects.toThrow('Local tile 2');
        expect(options.uploadTile).not.toHaveBeenCalled();
        expect(createTextureThumbnail).not.toHaveBeenCalled();
    });
    it('rejects incompatible copies', async () => {
        const options = setup(); options.localTexture.layer_count = 60;
        await expect(restoreEmptyTextureTiles(options)).rejects.toThrow('does not match');
        expect(options.uploadTile).not.toHaveBeenCalled();
    });
    it('will not overwrite cloud bytes even when file-size metadata says zero', async () => {
        const options = setup(); vi.mocked(fetch).mockImplementation(async url => String(url).endsWith('/api/auth/me')
            ? Response.json({ authenticated: true, user: { id: 'owner' } }) : new Response(new Blob(['existing'])));
        await expect(restoreEmptyTextureTiles(options)).rejects.toThrow('contains data');
        expect(options.uploadTile).not.toHaveBeenCalled();
    });
    it('resumes a partial recovery without replacing successful files', async () => {
        const options = setup();
        options.uploadTile.mockImplementation(async (id, index) => {
            if (index === 1) throw new Error('Interrupted');
            options.texture.tiles[0].fileSize = 120;
        });
        await expect(restoreEmptyTextureTiles(options)).rejects.toThrow('Interrupted');
        expect(options.completeTextureSet).not.toHaveBeenCalled();
        options.uploadTile.mockResolvedValue(undefined);
        await restoreEmptyTextureTiles(options);
        expect(options.uploadTile.mock.calls.map(call => call[1])).toEqual([0, 1, 1]);
    });
});
