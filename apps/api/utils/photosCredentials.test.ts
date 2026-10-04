import { describe, expect, it } from 'vitest';
import { openPhotosCookie, sealPhotosCookie } from './photosCredentials';
import { normalizeSourceProvenance } from './sourceProvenance';

describe('encrypted Photos credentials', () => {
    it('rejects tampering, expired grants, different secrets and different purposes', async () => {
        const value = { token: 'secret', expiresAt: Date.now() + 60000 };
        const sealed = await sealPhotosCookie(value, 'key', 'grant');
        expect(await openPhotosCookie(sealed, 'key', 'grant')).toEqual(value);
        expect(await openPhotosCookie(`${sealed.slice(0, -5)}xxxxx`, 'key', 'grant')).toBeNull();
        expect(await openPhotosCookie(sealed, 'other-key', 'grant')).toBeNull();
        expect(await openPhotosCookie(sealed, 'key', 'flow')).toBeNull();
        expect(await openPhotosCookie(await sealPhotosCookie({ expiresAt: 1 }, 'key', 'grant'), 'key', 'grant')).toBeNull();
    });
});
describe('source provenance', () => {
    it('retains supported source fields while stripping credentials and temporary URLs', () => {
        const provenance = normalizeSourceProvenance({ version: 1, provider: 'google-photos', mediaItemId: 'id', originalFilename: 'film.mov',
            reportedWidth: 1920, baseUrl: 'temporary-url', accessToken: 'secret', sessionId: 'session' });
        expect(provenance).toEqual({ version: 1, provider: 'google-photos', mediaItemId: 'id', originalFilename: 'film.mov',
            reportedWidth: 1920, downloadVariant: 'google-photos-dv-transcode' });
    });
    it.each([{ version: 1, provider: 'other', mediaItemId: 'id' }, { version: 1, provider: 'google-photos' },
        { version: 1, provider: 'google-photos', mediaItemId: 'id', createTime: 'not-a-date' }])('rejects invalid provenance', (value) => {
        expect(() => normalizeSourceProvenance(value)).toThrow();
    });
});
