import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAuthRedirect, consumeAuthRedirect, authErrorRedirect } from './authRedirect.js';

let storage;
beforeEach(() => {
    const values = new Map();
    storage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key) || null, removeItem: key => values.delete(key) };
    vi.stubGlobal('sessionStorage', storage);
    vi.stubGlobal('window', { location: { origin: 'https://rivvon.ca', pathname: '/videos', search: '?tab=drafts', hash: '#video' } });
});
afterEach(() => vi.unstubAllGlobals());

describe('OAuth return destination', () => {
    it('preserves the drafts query and hash and consumes the destination once', () => {
        saveAuthRedirect();
        expect(consumeAuthRedirect()).toBe('/videos?tab=drafts#video');
        expect(consumeAuthRedirect()).toBeNull();
    });

    it('preserves existing query parameters when returning from a sign-in error', () => {
        saveAuthRedirect();
        expect(authErrorRedirect('access_denied')).toBe('/videos?tab=drafts&auth_error=access_denied#video');
    });

    it.each(['https://other.example/path', '//other.example', '/\\other.example', '/callback?again=yes', '/login', 'garbage'])('rejects unsafe or looping destination %s', destination => {
        storage.setItem('auth_redirect', destination);
        expect(consumeAuthRedirect()).toBeNull();
        expect(storage.getItem('auth_redirect')).toBeNull();
    });
});
