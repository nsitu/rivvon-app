import { afterEach, describe, expect, it, vi } from 'vitest';
import { savePreset } from './presetService.js';
vi.mock('./localStorage.js', () => ({ promoteTextureSetToCachedCloudTexture: vi.fn(async () => {}) }));
const scene = () => ({ schemaVersion: 1,
    geometry: { paths: [[{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }]], width: 1.2 },
    textures: [{ id: 'existing', name: 'Texture', tileCount: 1, tileResolution: 512, layerCount: 60 }],
    camera: { position: [0, 0, 5], target: [0, 0, 0], quaternion: [0, 0, 0, 1], fov: 45 } });
afterEach(() => vi.unstubAllGlobals());
describe('preset publication', () => {
    it('never republishes existing media, uploads only the thumbnail and passes references to the API', async () => {
        const fetch = vi.fn(async () => Response.json({ preset: { id: 'saved' } }));
        vi.stubGlobal('fetch', fetch);
        const uploadTexture = vi.fn();
        await savePreset({ scene: scene(), thumbnail: new Blob(['image'], { type: 'image/webp' }), name: 'Ribbon', uploadTexture });
        expect(uploadTexture).not.toHaveBeenCalled();
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
    });
});
