// src/utils/cookies.ts

import type { Context } from 'hono';

/**
 * Parse a cookie value from the Cookie header
 */
export function getCookie(c: Context, name: string): string | undefined {
    const cookieHeader = c.req.header('Cookie');
    if (!cookieHeader) return undefined;

    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
        const trimmed = cookie.trim();
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
            const key = trimmed.substring(0, eqIndex);
            const value = trimmed.substring(eqIndex + 1);
            acc[key] = value;
        }
        return acc;
    }, {} as Record<string, string>);

    return cookies[name];
}

/**
 * Detect if running in local development environment
 * Used to adjust cookie settings for HTTP localhost
 */
export function isLocalDev(c: Context): boolean {
    const apiUrl = c.env?.API_URL || '';
    return apiUrl.includes('localhost') || apiUrl.includes('127.0.0.1');
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
    /** Pass true when running in local dev (http://localhost) */
    isLocalDev?: boolean;
}

/**
 * Build a Set-Cookie header value
 * 
 * Note: For cross-origin cookies (api.rivvon.ca -> slyce.rivvon.ca), we need:
 * - SameSite=None (to allow cross-site requests)
 * - Secure=true (required for SameSite=None)
 * 
 * For local development (localhost), we use:
 * - SameSite=Lax (more permissive for same-site, works over HTTP)
 * - Secure=false (localhost is HTTP, not HTTPS)
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
        isLocalDev = false,
    } = options;
    
    // For local dev, use Lax + no Secure (HTTP localhost)
    // For production, use None + Secure (HTTPS cross-origin)
    const secure = options.secure ?? !isLocalDev;
    const sameSite = options.sameSite ?? (isLocalDev ? 'Lax' : 'None');

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
    refreshToken?: string,
    localDev: boolean = false
): void {
    // Session cookie - 7 days, accessible to all API routes
    c.header(
        'Set-Cookie',
        buildCookieString('session', sessionToken, {
            maxAge: 7 * 24 * 60 * 60, // 7 days
            path: '/',
            isLocalDev: localDev,
        })
    );

    // Refresh token cookie - 30 days, only sent to /api/auth endpoints
    if (refreshToken) {
        c.header(
            'Set-Cookie',
            buildCookieString('google_refresh_token', refreshToken, {
                maxAge: 30 * 24 * 60 * 60, // 30 days
                path: '/api/auth',
                isLocalDev: localDev,
            }),
            { append: true }
        );
    }
}

/**
 * Clear all auth cookies on logout
 * Note: Must use { append: true } for multiple Set-Cookie headers in Hono
 */
export function clearAuthCookies(c: Context, localDev: boolean = false): void {
    // Build all Set-Cookie headers
    const clearSession = buildCookieString('session', '', {
        maxAge: 0,
        path: '/',
        isLocalDev: localDev,
    });
    
    const clearRefreshToken = buildCookieString('google_refresh_token', '', {
        maxAge: 0,
        path: '/api/auth',
        isLocalDev: localDev,
    });

    // Set multiple Set-Cookie headers using Hono's append option
    c.header('Set-Cookie', clearSession);
    c.header('Set-Cookie', clearRefreshToken, { append: true });
}

/**
 * Set CSRF state cookie for OAuth flow
 */
export function setOAuthStateCookie(c: Context, state: string, localDev: boolean = false): void {
    c.header(
        'Set-Cookie',
        buildCookieString('oauth_state', state, {
            maxAge: 600, // 10 minutes
            path: '/api/auth',
            isLocalDev: localDev,
        })
    );
}

/**
 * Clear CSRF state cookie after validation
 */
export function clearOAuthStateCookie(c: Context, localDev: boolean = false): void {
    c.header(
        'Set-Cookie',
        buildCookieString('oauth_state', '', {
            maxAge: 0,
            path: '/api/auth',
            isLocalDev: localDev,
        })
    );
}
