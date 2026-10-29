import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTexture, TextureLoader } from 'three';
import { acquireBackgroundImage, invalidateBackgroundImage, setBackgroundImageAccessScope } from './backgroundImageCache.js';
import { fetchImageBlob } from './imageService.js';
vi.mock('./imageService.js', () => ({ fetchImageBlob: vi.fn(async () => new Blob(['image'])) }));
afterEach(() => { setBackgroundImageAccessScope(crypto.randomUUID()); vi.restoreAllMocks(); vi.clearAllMocks(); });
const source = id => ({ kind: 'image', id });
function loader() {
    return vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((_url, onLoad) => {
        const texture = new DataTexture(new Uint8Array(4), 1, 1); texture.dispose = vi.fn(); onLoad(texture); return texture;
    });
}
describe('background image ownership and access', () => {
    it('deduplicates concurrent consumers and pins textures through invalidation until both release', async () => {
        const load = loader();
        const [main, preview] = await Promise.all([acquireBackgroundImage(source('shared')), acquireBackgroundImage(source('shared'))]);
        expect(main.texture).toBe(preview.texture); expect(load).toHaveBeenCalledTimes(1); expect(fetchImageBlob).toHaveBeenCalledTimes(1);
        invalidateBackgroundImage('shared'); main.release(); expect(main.texture.dispose).not.toHaveBeenCalled();
        preview.release(); expect(main.texture.dispose).toHaveBeenCalledTimes(1);
        preview.release(); expect(main.texture.dispose).toHaveBeenCalledTimes(1);
    });
    it('separates preset grants and account scopes, and discards stale pending loads', async () => {
        loader(); setBackgroundImageAccessScope('owner');
        const mine = await acquireBackgroundImage(source('asset'));
        const preset = await acquireBackgroundImage(source('asset'), { presetId: 'public-preset' });
        expect(mine.texture).not.toBe(preset.texture);
        expect(fetchImageBlob).toHaveBeenCalledWith('asset', expect.objectContaining({ presetId: 'public-preset' }));
        setBackgroundImageAccessScope('other');
        expect(mine.texture.dispose).not.toHaveBeenCalled(); mine.release(); preset.release();
        expect(mine.texture.dispose).toHaveBeenCalledTimes(1);
        let finish;
        fetchImageBlob.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const pending = acquireBackgroundImage(source('pending'));
        setBackgroundImageAccessScope('signed-out'); finish(new Blob(['pending']));
        await expect(pending).rejects.toThrow('Image access changed');
    });
    it('evicts unpinned entries and rejects images beyond the active renderer limit', async () => {
        loader();
        const first = await acquireBackgroundImage(source('first')); first.release();
        for (let i = 0; i < 5; i++) { const lease = await acquireBackgroundImage(source(`next-${i}`)); lease.release(); }
        expect(first.texture.dispose).toHaveBeenCalledTimes(1);
        await expect(acquireBackgroundImage(source('oversized'), { maxTextureSize: 0 })).rejects.toThrow('texture limit');
    });
});
