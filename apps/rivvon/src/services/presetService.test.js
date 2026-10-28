import { afterEach, describe, expect, it, vi } from 'vitest';
import { savePreset, preparePresetTextures } from './presetService.js';
import { createTextureThumbnail } from '../modules/shared/textureThumbnail.js';
import { getCachedLocalId, getTextureSet, getTiles } from './localStorage.js';
import { cacheTextureTiles, getCachedTextureTiles, getOrFetchTextureTiles, invalidateTextureTiles } from './sessionTextureCache.js';
vi.mock('./localStorage.js', () => ({
    getCachedLocalId: vi.fn(async () => null),
    getTextureSet: vi.fn(async () => null),
    getTiles: vi.fn(async () => []),
    promoteTextureSetToCachedCloudTexture: vi.fn(async () => {}),
}));
vi.mock('../modules/shared/textureThumbnail.js', () => ({ createTextureThumbnail: vi.fn(async () => new Blob(['texture preview'], { type: 'image/jpeg' })) }));
const scene = () => ({ schemaVersion: 1,
    geometry: { paths: [[{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }]], width: 1.2 },
    textures: [{ id: 'existing', name: 'Texture', tileCount: 1, tileResolution: 512, layerCount: 60 }],
    camera: { position: [0, 0, 5], target: [0, 0, 0], quaternion: [0, 0, 0, 1], fov: 45 } });
afterEach(() => {
    invalidateTextureTiles('existing');
    invalidateTextureTiles('second');
    vi.mocked(getCachedLocalId).mockReset().mockResolvedValue(null);
    vi.mocked(getTextureSet).mockReset().mockResolvedValue(null);
    vi.mocked(getTiles).mockReset().mockResolvedValue([]);
    vi.restoreAllMocks();
    vi.unstubAllGlobals(); vi.clearAllMocks();
});
describe('preset publication', () => {
    it('requires an upload destination before publishing a local texture or creating its preset', async () => {
        const input = scene(); input.textures[0].id = '';
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        await expect(savePreset({ scene: input, uploads: [{ assignment: 0, tiles: [] }],
            thumbnail: new Blob(['preview']), name: 'Ribbon' })).rejects.toThrow('Choose an upload destination');
        expect(createTextureThumbnail).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });
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
    it('reuses a texture published after capture without creating a thumbnail or uploading tiles again', async () => {
        const input = scene(); input.textures[0].id = '';
        input.textures.push({ ...input.textures[0] });
        vi.mocked(getTextureSet).mockResolvedValueOnce({ id: 'local', cached_from: 'already-published' });
        const fetch = vi.fn(async () => Response.json({ preset: { id: 'saved' } }));
        vi.stubGlobal('fetch', fetch);
        const uploadTexture = vi.fn();
        await savePreset({ scene: input, uploads: [0, 1].map(assignment => ({ assignment, localId: 'local', tiles: [] })),
            uploadTexture, thumbnail: new Blob(['preset preview']), name: 'Ribbon' });
        expect(uploadTexture).not.toHaveBeenCalled();
        expect(createTextureThumbnail).not.toHaveBeenCalled();
        expect(getTextureSet).toHaveBeenCalledTimes(1);
        expect(JSON.parse(fetch.mock.calls[0][1].body).scene.textures.map(texture => texture.id))
            .toEqual(['already-published', 'already-published']);
    });
});

describe('preset texture download progress', () => {
    it('aggregates simultaneous streams without progress going backwards and preserves tile order', async () => {
        const input = scene(); input.textures[0].tileCount = 2;
        const progress = vi.fn();
        const streams = [];
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) {
            streams.push(controller);
        } }), { headers: { 'Content-Length': '4' } })));
        const pending = preparePresetTextures('saved', input, progress);
        expect(progress).toHaveBeenCalledWith(expect.any(String), { stage: 'downloading', current: 0, total: 2 });
        await vi.waitFor(() => expect(streams).toHaveLength(2));
        streams[1].enqueue(new Uint8Array([5, 6]));
        await vi.waitFor(() => expect(progress).toHaveBeenLastCalledWith(expect.any(String), { stage: 'downloading', current: 0.5, total: 2 }));
        streams[0].enqueue(new Uint8Array([1, 2]));
        await vi.waitFor(() => expect(progress).toHaveBeenLastCalledWith(expect.any(String), { stage: 'downloading', current: 1, total: 2 }));
        streams[1].enqueue(new Uint8Array([7, 8])); streams[1].close();
        streams[0].enqueue(new Uint8Array([3, 4])); streams[0].close();
        const entries = await pending;
        const values = progress.mock.calls.map(call => call[1].current);
        expect(values).toEqual([...values].sort((a, b) => a - b));
        expect(progress).toHaveBeenLastCalledWith(expect.any(String), { stage: 'downloading', current: 2, total: 2 });
        expect(entries[0].tileEntry.zipFiles['0.ktx2']).toEqual(new Uint8Array([1, 2, 3, 4]));
        expect(entries[0].tileEntry.zipFiles['1.ktx2']).toEqual(new Uint8Array([5, 6, 7, 8]));
    });
    it('does not report a failed download as complete', async () => {
        const progress = vi.fn();
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Unavailable' }, { status: 503 })));
        await expect(preparePresetTextures('saved', scene(), progress)).rejects.toThrow('Unavailable');
        expect(progress.mock.calls.map(call => call[1].current)).toEqual([0]);
    });
});

describe('preset texture download scheduling and cache reuse', () => {
    it.each([
        ['desktop', { userAgent: 'Chrome', deviceMemory: 8 }, 6],
        ['low memory', { userAgent: 'Chrome', deviceMemory: 4 }, 3],
        ['Safari', { userAgent: 'Version/18.0 Safari/605.1.15' }, 2],
    ])('uses the library concurrency limit on %s across texture assignments', async (_, navigator, limit) => {
        vi.stubGlobal('navigator', navigator);
        const input = scene(); input.textures[0].tileCount = 4;
        input.textures.push({ ...input.textures[0], id: 'second' });
        const waiting = [];
        const fetch = vi.fn(url => new Promise(resolve => waiting.push(() => resolve(new Response(new Uint8Array([Number(url.match(/-(\d+)\.ktx2$/)[1]) + 1]))))));
        vi.stubGlobal('fetch', fetch);
        const pending = preparePresetTextures('saved', input);
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(limit));
        // Free one slot: exactly one queued tile should start, even across textures.
        waiting.shift()();
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(limit + 1));
        while (fetch.mock.calls.length < 8 || waiting.length) {
            waiting.splice(0).reverse().forEach(release => release());
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        const entries = await pending;
        expect(entries.map(entry => entry.textureSet.id)).toEqual(['existing', 'second']);
        for (const entry of entries) for (let tile = 0; tile < 4; tile++) {
            expect(entry.tileEntry.zipFiles[`${tile}.ktx2`]).toEqual(new Uint8Array([tile + 1]));
        }
    });

    it('reuses library downloads, and makes preset downloads reusable by the library', async () => {
        const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2])));
        vi.stubGlobal('fetch', fetch);
        const textureSet = { id: 'existing', tile_count: 1, layer_count: 60, cross_section_type: 'waves', tiles: [{ url: 'https://example.test/tile' }] };
        const libraryEntry = await getOrFetchTextureTiles(textureSet);
        const [fromLibrary] = await preparePresetTextures('saved', scene());
        expect(fromLibrary.tileEntry).toBe(libraryEntry);
        expect(getCachedLocalId).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledTimes(1);

        invalidateTextureTiles('existing');
        const [fromPreset] = await preparePresetTextures('saved', scene());
        const reloadedLibraryEntry = await getOrFetchTextureTiles(textureSet);
        const [reloadedPreset] = await preparePresetTextures('saved', scene());
        expect(reloadedLibraryEntry).toBe(fromPreset.tileEntry);
        expect(reloadedPreset.tileEntry).toBe(fromPreset.tileEntry);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('downloads a texture assigned more than once only once', async () => {
        const input = scene(); input.textures.push({ ...input.textures[0], name: 'Second strand' });
        const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2])));
        vi.stubGlobal('fetch', fetch);
        const entries = await preparePresetTextures('saved', input);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(entries).toHaveLength(2);
        expect(entries[0].tileEntry).toBe(entries[1].tileEntry);
        expect(entries[1].textureSet.name).toBe('Second strand');
    });

    const localTexture = () => ({ id: 'local-cache', cached_from: 'existing', tile_count: 2,
        tile_resolution: 512, layer_count: 60, cross_section_type: 'waves' });
    const ktx2Bytes = () => new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
    const localTiles = () => [
        { tile_index: 1, blob: new Blob([ktx2Bytes()]) },
        { tile_index: 0, bytes: ktx2Bytes().buffer },
    ];

    it('reuses persistent library tiles after a page reload and warms the shared session cache', async () => {
        const input = scene(); input.textures[0].tileCount = 2;
        input.textures.push({ ...input.textures[0], name: 'Second strand' });
        vi.mocked(getCachedLocalId).mockResolvedValueOnce('local-cache');
        vi.mocked(getTextureSet).mockResolvedValueOnce(localTexture());
        vi.mocked(getTiles).mockResolvedValueOnce(localTiles());
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        const progress = vi.fn();
        const entries = await preparePresetTextures('saved', input, progress);

        expect(fetch).not.toHaveBeenCalled();
        expect(getCachedLocalId).toHaveBeenCalledExactlyOnceWith('existing');
        expect(getTiles).toHaveBeenCalledExactlyOnceWith('local-cache');
        expect(entries[0].textureSet.id).toBe('existing');
        expect(entries[0].tileEntry.zipFiles).toEqual({ '0.ktx2': ktx2Bytes(), '1.ktx2': ktx2Bytes() });
        expect(entries[1].tileEntry).toBe(entries[0].tileEntry);
        expect(getCachedTextureTiles('existing')).toBe(entries[0].tileEntry);
        expect(progress).toHaveBeenLastCalledWith(expect.any(String), { stage: 'downloading', current: 2, total: 2 });

        const [reloaded] = await preparePresetTextures('another-preset', input);
        expect(reloaded.tileEntry).toBe(entries[0].tileEntry);
        expect(getCachedLocalId).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['missing metadata', null],
        ['tile count', { tile_count: 1 }],
        ['resolution', { tile_resolution: 256 }],
        ['layers', { layer_count: 30 }],
        ['variant', { cross_section_type: 'rings' }],
    ])('downloads when persistent cache has mismatching %s', async (_, updates) => {
        const input = scene(); input.textures[0].tileCount = 2;
        vi.mocked(getCachedLocalId).mockResolvedValueOnce('local-cache');
        vi.mocked(getTextureSet).mockResolvedValueOnce(updates && { ...localTexture(), ...updates });
        const fetch = vi.fn(async () => new Response(ktx2Bytes())); vi.stubGlobal('fetch', fetch);
        await preparePresetTextures('saved', input);
        expect(getTiles).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['empty', () => []],
        ['partial', () => localTiles().slice(0, 1)],
        ['duplicate indices', () => localTiles().map(tile => ({ ...tile, tile_index: 0 }))],
        ['missing index', () => localTiles().map(tile => ({ ...tile, tile_index: tile.tile_index + 1 }))],
        ['corrupt bytes', () => [{ tile_index: 0, bytes: new Uint8Array([1, 2]) }, localTiles()[0]]],
        ['missing payload', () => [{ tile_index: 0 }, localTiles()[0]]],
    ])('downloads when persistent tiles are %s', async (_, tiles) => {
        const input = scene(); input.textures[0].tileCount = 2;
        vi.mocked(getCachedLocalId).mockResolvedValueOnce('local-cache');
        vi.mocked(getTextureSet).mockResolvedValueOnce(localTexture());
        vi.mocked(getTiles).mockResolvedValueOnce(tiles());
        const fetch = vi.fn(async () => new Response(ktx2Bytes())); vi.stubGlobal('fetch', fetch);
        const [entry] = await preparePresetTextures('saved', input);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(entry.tileEntry.source).toBe('preset');
    });

    it('downloads only uncached textures in a preset and keeps progress increasing', async () => {
        const input = scene(); input.textures[0].tileCount = 2;
        input.textures.push({ ...input.textures[0], id: 'second', tileCount: 1 });
        vi.mocked(getCachedLocalId).mockResolvedValueOnce('local-cache');
        vi.mocked(getTextureSet).mockResolvedValueOnce(localTexture());
        vi.mocked(getTiles).mockResolvedValueOnce(localTiles());
        const fetch = vi.fn(async () => new Response(ktx2Bytes())); vi.stubGlobal('fetch', fetch);
        const progress = vi.fn();
        const entries = await preparePresetTextures('saved', input, progress);
        expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('texture-1-0.ktx2'), expect.any(Object));
        expect(entries.map(entry => entry.tileEntry.source)).toEqual(['cached-local', 'preset']);
        const values = progress.mock.calls.map(call => call[1].current);
        expect(values).toEqual([...values].sort((a, b) => a - b));
        expect(progress).toHaveBeenLastCalledWith(expect.any(String), { stage: 'downloading', current: 3, total: 3 });
    });

    it.each(['lookup', 'metadata', 'tiles'])('falls back to downloading if persistent cache %s fails', async stage => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const input = scene(); input.textures[0].tileCount = 2;
        vi.mocked(getCachedLocalId).mockResolvedValue('local-cache');
        vi.mocked(getTextureSet).mockResolvedValue(localTexture());
        const operation = { lookup: getCachedLocalId, metadata: getTextureSet, tiles: getTiles }[stage];
        vi.mocked(operation).mockRejectedValueOnce(new Error('Storage unavailable'));
        const fetch = vi.fn(async () => new Response(ktx2Bytes())); vi.stubGlobal('fetch', fetch);
        await preparePresetTextures('saved', input);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('redownloads cached bytes when the metadata does not match', async () => {
        cacheTextureTiles('existing', { zipFiles: { '0.ktx2': new Uint8Array([9]) }, tileCount: 1, layerCount: 30, variant: 'waves', isComplete: true });
        const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2])));
        vi.stubGlobal('fetch', fetch);
        const [entry] = await preparePresetTextures('saved', scene());
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(entry.tileEntry.layerCount).toBe(60);
        expect(entry.tileEntry.zipFiles['0.ktx2']).toEqual(new Uint8Array([1, 2]));
    });

    it('aborts other downloads and leaves no partial cache when a tile fails', async () => {
        vi.stubGlobal('navigator', { userAgent: 'Chrome', deviceMemory: 8 });
        const input = scene(); input.textures[0].tileCount = 8;
        let rejectFirst;
        const fetch = vi.fn((url, { signal }) => new Promise((resolve, reject) => {
            if (!rejectFirst) rejectFirst = reject;
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }));
        vi.stubGlobal('fetch', fetch);
        const progress = vi.fn();
        const pending = preparePresetTextures('saved', input, progress);
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(6));
        rejectFirst(new Error('Network interrupted'));
        await expect(pending).rejects.toThrow('Network interrupted');
        expect(fetch.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
        expect(fetch).toHaveBeenCalledTimes(6);
        expect(getCachedTextureTiles('existing')).toBeNull();
        expect(progress.mock.calls.map(call => call[1].current)).toEqual([0]);
    });
});
