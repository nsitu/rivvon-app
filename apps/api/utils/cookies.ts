// src/utils/cookies.ts

import type { Context } from 'hono';

/**
 * Parse a cookie value from the Cookie header
 */
export function getCookie(c: Context, name: string): string | undefined {
    const cookieHeader = c.req.header('Cookie');
    if (!cookieHeader) return undefined;

    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
        const [key, value] = cookie.trim().split('=');
        if (key) acc[key] = value || '';
        return acc;
    }, {} as Record<string, string>);

    return cookies[name];
}

/**
 * Cookie options with secure defaults
 */
interface CookieOptions {
    maxAge?: number;
    path?: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * Build a Set-Cookie header value
 */
export function buildCookieString(
    name: string,
    value: string,
    options: CookieOptions = {}
): string {
    const {
        maxAge,
        path = '/',
        httpOnly = true,
        secure = true,
        sameSite = 'Lax',
    } = options;

    let cookie = `${name}=${value}`;
    if (maxAge !== undefined) cookie += `; Max-Age=${maxAge}`;
    cookie += `; Path=${path}`;
    if (httpOnly) cookie += '; HttpOnly';
    if (secure) cookie += '; Secure';
    cookie += `; SameSite=${sameSite}`;

    return cookie;
}

/**
 * Set auth cookies after successful login
 * - session: User session token (Path=/)
 * - google_refresh_token: Google refresh token (Path=/api/auth only)
 */
export function setAuthCookies(
    c: Context,
    sessionToken: string,
    refreshToken?: string
): void {
    // Session cookie - 7 days, accessible to all API routes
    c.header(
        'Set-Cookie',
        buildCookieString('session', sessionToken, {
            maxAge: 7 * 24 * 60 * 60, // 7 days
            path: '/',
        })
    );

    // Refresh token cookie - 30 days, only sent to /api/auth endpoints
    if (refreshToken) {
        c.header(
            'Set-Cookie',
            buildCookieString('google_refresh_token', refreshToken, {
                maxAge: 30 * 24 * 60 * 60, // 30 days
                path: '/api/auth',
            })
        );
    }
}

/**
 * Clear all auth cookies on logout
 */
export function clearAuthCookies(c: Context): void {
    // Clear session cookie
    c.header(
        'Set-Cookie',
        buildCookieString('session', '', {
            maxAge: 0,
            path: '/',
        })
    );

    // Clear refresh token cookie
    c.header(
        'Set-Cookie',
        buildCookieString('google_refresh_token', '', {
            maxAge: 0,
            path: '/api/auth',
        })
    );
}

/**
 * Set CSRF state cookie for OAuth flow
 */
export function setOAuthStateCookie(c: Context, state: string): void {
    c.header(
        'Set-Cookie',
        buildCookieString('oauth_state', state, {
            maxAge: 600, // 10 minutes
            path: '/api/auth',
        })
    );
}

/**
 * Clear CSRF state cookie after validation
 */
export function clearOAuthStateCookie(c: Context): void {
    c.header(
        'Set-Cookie',
        buildCookieString('oauth_state', '', {
            maxAge: 0,
            path: '/api/auth',
        })
    );
}
