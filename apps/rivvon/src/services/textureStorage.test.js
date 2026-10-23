import { describe, expect, it, vi } from 'vitest';
import { getTextureStorageDestinations, resolveTextureUploader } from './textureStorage.js';

describe('texture storage choices shared by copies and preset uploads', () => {
    it.each([
        [{}, []],
        [{ isAuthenticated: true }, ['google-drive']],
        [{ isAuthenticated: true, isAdmin: true }, ['google-drive', 'r2']],
        [{ isAuthenticated: true, isAdmin: true, isLocal: false, storageProvider: 'google-drive' }, ['r2']],
        [{ isAuthenticated: true, isLocal: false, storageProvider: 'google-drive' }, []],
        [{ isAuthenticated: true, isAdmin: true, isLocal: false, storageProvider: 'r2' }, []],
    ])('offers only permitted destinations for %j', (access, expected) => {
        expect(getTextureStorageDestinations(access).map(option => option.value)).toEqual(expected);
    });

    it.each(['google-drive', 'r2'])('routes %s to the selected uploader', async destination => {
        const uploaders = { uploadTextureSet: vi.fn(), uploadTextureSetToR2: vi.fn() };
        const upload = resolveTextureUploader(destination, uploaders, { isAuthenticated: true, isAdmin: true });
        await upload({ name: 'Texture' });
        expect(destination === 'r2' ? uploaders.uploadTextureSetToR2 : uploaders.uploadTextureSet).toHaveBeenCalledOnce();
        expect(destination === 'r2' ? uploaders.uploadTextureSet : uploaders.uploadTextureSetToR2).not.toHaveBeenCalled();
    });

    it.each([null, 'local', 'r2'])('rejects an unavailable destination %s before uploading', destination => {
        const uploaders = { uploadTextureSet: vi.fn(), uploadTextureSetToR2: vi.fn() };
        expect(() => resolveTextureUploader(destination, uploaders, { isAuthenticated: true, isAdmin: false }))
            .toThrow('Choose an available upload destination');
        expect(uploaders.uploadTextureSet).not.toHaveBeenCalled();
        expect(uploaders.uploadTextureSetToR2).not.toHaveBeenCalled();
    });
});
