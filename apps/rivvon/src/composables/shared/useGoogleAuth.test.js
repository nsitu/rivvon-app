import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { useGoogleAuth } from './useGoogleAuth.js';
import { useAuthStore } from '../../stores/authStore.js';
import { useVideoDraftStore } from '../../stores/videoDraftStore.js';

vi.mock('../../stores/videoDraftStore.js', () => ({ useVideoDraftStore: vi.fn() }));
let pinia;
let flush;
let location;
let saved;
beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    flush = vi.fn().mockResolvedValue(undefined);
    useVideoDraftStore.mockReturnValue({ flushPendingSaves: flush });
    location = { origin: 'https://rivvon.ca', pathname: '/videos', search: '?tab=drafts', hash: '', href: 'https://rivvon.ca/videos?tab=drafts' };
    saved = new Map();
    vi.stubGlobal('window', { location });
    vi.stubGlobal('sessionStorage', { setItem: (key, value) => saved.set(key, value) });
});
afterEach(() => { disposePinia(pinia); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('sign-in with completed video drafts', () => {
    it('waits for saving before leaving and preserves the selected gallery tab', async () => {
        let finish;
        flush.mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const auth = useGoogleAuth();
        const signingIn = auth.login();
        expect(location.href).toBe('https://rivvon.ca/videos?tab=drafts');
        expect(saved.size).toBe(0);
        expect(auth.isSigningIn.value).toBe(true);
        expect(await auth.login()).toBe(false);
        expect(flush).toHaveBeenCalledOnce();
        finish();
        expect(await signingIn).toBe(true);
        expect(saved.get('auth_redirect')).toBe('/videos?tab=drafts');
        expect(location.href).toContain('/api/auth/login?redirect_to=https%3A%2F%2Frivvon.ca');
    });

    it('keeps the page open with an actionable notice if a video has not been saved', async () => {
        flush.mockRejectedValue(new Error('Open Video Gallery → Drafts to retry saving or download.'));
        const auth = useGoogleAuth();
        expect(await auth.login()).toBe(false);
        expect(location.href).toBe('https://rivvon.ca/videos?tab=drafts');
        expect(saved.size).toBe(0);
        expect(useAuthStore().error).toContain('retry saving or download');
        expect(auth.isSigningIn.value).toBe(false);
        flush.mockResolvedValue(undefined);
        expect(await auth.login()).toBe(true);
        expect(useAuthStore().error).toBeNull();
    });
});
