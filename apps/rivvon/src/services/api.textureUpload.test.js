import { describe, expect, it, vi } from 'vitest';
import { useRivvonAPI } from './api.js';

vi.mock('../composables/shared/useGoogleAuth', () => ({ useGoogleAuth: () => ({ user: { value: null } }) }));
vi.mock('./googleDrive', () => ({ useGoogleDrive: () => ({ ensureRivvonFolder: () => { throw new Error('Unexpected Drive access'); } }) }));

describe('texture publication validation', () => {
    it.each(['uploadTextureSet', 'uploadTextureSetToR2'])('%s rejects empty tiles before creating a publication', async (uploader) => {
        const api = useRivvonAPI();
        await expect(api[uploader]({ tiles: [{ index: 0, blob: new Blob([]) }] })).rejects.toThrow('missing or empty KTX2 tiles');
        await expect(api[uploader]({ tiles: [] })).rejects.toThrow('missing or empty KTX2 tiles');
    });
});
