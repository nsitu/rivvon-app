import { describe, expect, it } from 'vitest';

import { buildCookieString } from './cookies';
import { isAdminUser } from './user';

describe('buildCookieString', () => {
    it('uses secure cross-site defaults outside local development', () => {
        const cookie = buildCookieString('session', 'token-123');

        expect(cookie).toContain('session=token-123');
        expect(cookie).toContain('; Path=/');
        expect(cookie).toContain('; HttpOnly');
        expect(cookie).toContain('; Secure');
        expect(cookie).toContain('; SameSite=None');
    });

    it('uses localhost-safe defaults when local development is enabled', () => {
        const cookie = buildCookieString('session', 'token-123', {
            isLocalDev: true,
            maxAge: 60,
        });

        expect(cookie).toContain('; Max-Age=60');
        expect(cookie).toContain('; SameSite=Lax');
        expect(cookie).not.toContain('; Secure');
    });
});

describe('isAdminUser', () => {
    it('matches configured admins case-insensitively', () => {
        expect(
            isAdminUser(' Admin@Example.com , second@example.com ', 'admin@example.com')
        ).toBe(true);
    });

    it('returns false when either input is missing', () => {
        expect(isAdminUser(undefined, 'admin@example.com')).toBe(false);
        expect(isAdminUser('admin@example.com', null)).toBe(false);
    });
});