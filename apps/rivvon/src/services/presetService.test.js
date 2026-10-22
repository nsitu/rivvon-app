import { afterEach, describe, expect, it, vi } from 'vitest';
import { savePreset, preparePresetTextures } from './presetService.js';
import { createTextureThumbnail } from '../modules/shared/textureThumbnail.js';
vi.mock('./localStorage.js', () => ({ promoteTextureSetToCachedCloudTexture: vi.fn(async () => {}) }));
vi.mock('../modules/shared/textureThumbnail.js', () => ({ createTextureThumbnail: vi.fn(async () => new Blob(['texture preview'], { type: 'image/jpeg' })) }));
const scene = () => ({ schemaVersion: 1,
    geometry: { paths: [[{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }]], width: 1.2 },
    textures: [{ id: 'existing', name: 'Texture', tileCount: 1, tileResolution: 512, layerCount: 60 }],
    camera: { position: [0, 0, 5], target: [0, 0, 0], quaternion: [0, 0, 0, 1], fov: 45 } });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('preset publication', () => {
    it('never republishes existing media, uploads only the thumbnail and passes references to the API', async () => {
        const fetch = vi.fn(async () => Response.json({ preset: { id: 'saved' } }));
        vi.stubGlobal('fetch', fetch);
        const uploadTexture = vi.fn();
        await savePreset({ scene: scene(), thumbnail: new Blob(['image'], { type: 'image/webp' }), name: 'Ribbon', uploadTexture });
        expect(uploadTexture).not.toHaveBeenCalled();
        expect(createTextureThumbnail).not.toHaveBeenCalled();
        expect(fetch.mock.calls.map(([url]) => url.split('/presets')[1])).toEqual(['', '/saved/assets/thumbnail', '/saved/complete']);
        expect(JSON.parse(fetch.mock.calls[0][1].body).scene.textures[0].id).toBe('existing');
        expect(fetch.mock.calls.every(([, options]) => options.credentials === 'include')).toBe(true);
    });
    it('uploads a local texture once, keeps its new reference on retry, and cleans up incomplete presets', async () => {
        const input = scene(); input.textures[0].id = '';
        const uploadTexture = vi.fn(async () => ({ textureSetId: 'published' }));
        let fail = true;
        const fetch = vi.fn(async url => url.endsWith('/thumbnail') && fail ? Response.json({ error: 'Upload interrupted' }, { status: 503 }) : Response.json({ preset: { id: 'saved' } }));
        vi.stubGlobal('fetch', fetch);
        const options = { scene: input, uploads: [{ assignment: 0, tiles: [{ index: 0, blob: new Blob(['tile']) }] }],
            uploadTexture, thumbnail: new Blob(['image'], { type: 'image/webp' }), name: 'Ribbon' };
        await expect(savePreset(options)).rejects.toThrow('Upload interrupted');
        expect(input.textures[0].id).toBe('published');
        expect(fetch.mock.calls[2][1].method).toBe('DELETE');
        fail = false;
        await savePreset(options);
        expect(uploadTexture).toHaveBeenCalledTimes(1);
        expect(uploadTexture.mock.calls[0][0].isPublic).toBe(false);
        expect(createTextureThumbnail).toHaveBeenCalledTimes(1);
        expect(createTextureThumbnail).toHaveBeenCalledWith(options.uploads[0].tiles);
        expect(uploadTexture.mock.calls[0][0].thumbnailBlob).toBeInstanceOf(Blob);
        expect(uploadTexture.mock.calls[0][0].thumbnailBlob.type).toBe('image/jpeg');
    });
    it('fails before publishing anything if thumbnail generation fails, then permits retry', async () => {
        const input = scene(); input.textures[0].id = '';
        const uploadTexture = vi.fn(async () => ({ textureSetId: 'published' }));
        const fetch = vi.fn(async () => Response.json({ preset: { id: 'saved' } }));
        vi.stubGlobal('fetch', fetch);
        vi.mocked(createTextureThumbnail).mockRejectedValueOnce(new Error('Decode failed'));
        const options = { scene: input, uploads: [{ assignment: 0, tiles: [] }], uploadTexture,
            thumbnail: new Blob(['preset preview']), name: 'Ribbon' };
        await expect(savePreset(options)).rejects.toThrow('Decode failed');
        expect(uploadTexture).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(input.textures[0].id).toBe('');
        await savePreset(options);
        expect(uploadTexture).toHaveBeenCalledTimes(1);
    });
    it('generates and publishes once when a local texture is assigned more than once', async () => {
        const input = scene(); input.textures[0].id = '';
        input.textures.push({ ...input.textures[0] });
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ preset: { id: 'saved' } })));
        const uploadTexture = vi.fn(async () => ({ textureSetId: 'published' }));
        await savePreset({ scene: input, uploads: [0, 1].map(assignment => ({ assignment, localId: 'local', tiles: [] })),
            uploadTexture, thumbnail: new Blob(['preset preview']), name: 'Ribbon' });
        expect(createTextureThumbnail).toHaveBeenCalledTimes(1);
        expect(uploadTexture).toHaveBeenCalledTimes(1);
        expect(input.textures.map(texture => texture.id)).toEqual(['published', 'published']);
    });
});

describe('preset texture download progress', () => {
    it('reports immediately and while each tile is streaming, then preserves the downloaded bytes', async () => {
        const input = scene(); input.textures[0].tileCount = 2;
        const progress = vi.fn();
        let releaseFirstTile;
        vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise(resolve => { releaseFirstTile = resolve; }))
            .mockResolvedValueOnce(new Response(new Uint8Array([5, 6]), { headers: { 'Content-Length': '2' } })));
        const pending = preparePresetTextures('saved', input, progress);
        expect(progress).toHaveBeenCalledWith(expect.any(String), { stage: 'downloading', current: 0, total: 2 });
        releaseFirstTile(new Response(new ReadableStream({ start(controller) {
            controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3, 4])); controller.close();
        } }), { headers: { 'Content-Length': '4' } }));
        const entries = await pending;
        expect(progress.mock.calls.map(call => call[1].current)).toContain(0.5);
        expect(progress).toHaveBeenLastCalledWith(expect.any(String), { stage: 'downloading', current: 2, total: 2 });
        expect(entries[0].tileEntry.zipFiles['0.ktx2']).toEqual(new Uint8Array([1, 2, 3, 4]));
        expect(entries[0].tileEntry.zipFiles['1.ktx2']).toEqual(new Uint8Array([5, 6]));
    });
    it('does not report a failed download as complete', async () => {
        const progress = vi.fn();
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Unavailable' }, { status: 503 })));
        await expect(preparePresetTextures('saved', scene(), progress)).rejects.toThrow('Unavailable');
        expect(progress.mock.calls.map(call => call[1].current)).toEqual([0]);
    });
});
