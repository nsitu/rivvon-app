// src/routes/auth.ts

import { Hono } from 'hono';
import {
    getCookie,
    buildCookieString,
    setAuthCookies,
    clearAuthCookies,
    setOAuthStateCookie,
    clearOAuthStateCookie,
} from '../utils/cookies';
import { createSessionToken, verifySessionToken, type SessionUser } from '../utils/session';

type Bindings = {
    DB: D1Database;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    SESSION_SECRET: string;
    API_URL: string;
    APP_URL: string;
};

const authRoutes = new Hono<{ Bindings: Bindings }>();

// OAuth scopes for Google
const SCOPES = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/drive.file',
].join(' ');

/**
 * GET /api/auth/login
 * Initiate OAuth flow - generates CSRF state and redirects to Google
 */
authRoutes.get('/login', async (c) => {
    // Generate CSRF state token
    const state = crypto.randomUUID();

    // Store state in HTTP-only cookie for validation on callback
    setOAuthStateCookie(c, state);

    // Build Google OAuth URL
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', c.env.GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', `${c.env.API_URL}/api/auth/callback`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', SCOPES);
    authUrl.searchParams.set('access_type', 'offline'); // Request refresh token
    authUrl.searchParams.set('prompt', 'consent'); // Always show consent to get refresh token
    authUrl.searchParams.set('state', state); // CSRF protection

    return c.redirect(authUrl.toString());
});

/**
 * GET /api/auth/callback
 * Handle OAuth callback from Google
 * - Validates CSRF state
 * - Exchanges code for tokens
 * - Creates/updates user in database
 * - Sets session and refresh token cookies
 */
authRoutes.get('/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');

    // Handle OAuth errors from Google
    if (error) {
        console.error('OAuth error from Google:', error);
        return c.redirect(`${c.env.APP_URL}/login?error=${error}`);
    }

    if (!code) {
        return c.redirect(`${c.env.APP_URL}/login?error=missing_code`);
    }

    // Validate CSRF state
    const storedState = getCookie(c, 'oauth_state');
    if (!state || state !== storedState) {
        console.error('CSRF state mismatch:', { received: state, expected: storedState });
        return c.redirect(`${c.env.APP_URL}/login?error=invalid_state`);
    }

    try {
        // Exchange authorization code for tokens
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: c.env.GOOGLE_CLIENT_ID,
                client_secret: c.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: `${c.env.API_URL}/api/auth/callback`,
                grant_type: 'authorization_code',
            }),
        });

        const tokens = await tokenResponse.json() as {
            access_token?: string;
            refresh_token?: string;
            id_token?: string;
            error?: string;
            error_description?: string;
        };

        if (tokens.error) {
            console.error('Token exchange error:', tokens.error, tokens.error_description);
            return c.redirect(`${c.env.APP_URL}/login?error=token_exchange_failed`);
        }

        if (!tokens.id_token) {
            console.error('No ID token in response');
            return c.redirect(`${c.env.APP_URL}/login?error=missing_id_token`);
        }

        // Decode ID token to get user info
        // Note: No verification needed since it came directly from Google over HTTPS
        const idTokenParts = tokens.id_token.split('.');
        const payload = JSON.parse(atob(idTokenParts[1])) as {
            sub: string;
            email: string;
            name: string;
            picture?: string;
        };

        // Upsert user in database
        const user = await upsertUser(c.env.DB, {
            googleId: payload.sub,
            email: payload.email,
            name: payload.name,
            picture: payload.picture,
        });

        // Create session token
        const sessionToken = await createSessionToken(user, c.env.SESSION_SECRET);

        // Build redirect response with cookies
        // Note: c.redirect() doesn't include headers set via c.header(), so we build manually
        const headers = new Headers();
        headers.set('Location', c.env.APP_URL);

        // Session cookie
        headers.append('Set-Cookie', buildCookieString('session', sessionToken, {
            maxAge: 7 * 24 * 60 * 60,
            path: '/',
        }));

        // Refresh token cookie (if provided)
        if (tokens.refresh_token) {
            headers.append('Set-Cookie', buildCookieString('google_refresh_token', tokens.refresh_token, {
                maxAge: 30 * 24 * 60 * 60,
                path: '/api/auth',
            }));
        }

        // Clear the oauth_state cookie
        headers.append('Set-Cookie', buildCookieString('oauth_state', '', {
            maxAge: 0,
            path: '/api/auth',
        }));

        return new Response(null, {
            status: 302,
            headers,
        });
    } catch (err) {
        console.error('OAuth callback error:', err);
        return c.redirect(`${c.env.APP_URL}/login?error=callback_failed`);
    }
});

/**
 * GET /api/auth/me
 * Get current user info from session cookie
 */
authRoutes.get('/me', async (c) => {
    // Debug: log incoming headers
    const cookieHeader = c.req.header('Cookie');
    console.log('Cookie header received:', cookieHeader ? 'present' : 'missing', cookieHeader?.substring(0, 50));

    const sessionToken = getCookie(c, 'session');
    console.log('Session token parsed:', sessionToken ? 'present' : 'missing');

    if (!sessionToken) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const user = await verifySessionToken(sessionToken, c.env.SESSION_SECRET);
    console.log('User verified:', user ? 'success' : 'failed');

    if (!user) {
        return c.json({ error: 'Invalid session' }, 401);
    }

    return c.json({ user });
});

/**
 * GET /api/auth/drive-token
 * Get fresh Google access token for Drive operations
 * Reads refresh token from HTTP-only cookie
 */
authRoutes.get('/drive-token', async (c) => {
    // Verify session first
    const sessionToken = getCookie(c, 'session');
    if (!sessionToken) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const user = await verifySessionToken(sessionToken, c.env.SESSION_SECRET);
    if (!user) {
        return c.json({ error: 'Invalid session' }, 401);
    }

    // Read refresh token from HTTP-only cookie
    const refreshToken = getCookie(c, 'google_refresh_token');
    if (!refreshToken) {
        return c.json({ error: 'No refresh token', needsReauth: true }, 401);
    }

    try {
        // Exchange refresh token for fresh access token
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: c.env.GOOGLE_CLIENT_ID,
                client_secret: c.env.GOOGLE_CLIENT_SECRET,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            }),
        });

        const tokens = await tokenResponse.json() as {
            access_token?: string;
            expires_in?: number;
            error?: string;
        };

        if (tokens.error) {
            console.error('Token refresh error:', tokens.error);
            return c.json({ error: 'Token expired', needsReauth: true }, 401);
        }

        // Get user's cached Drive folder ID
        const userRecord = await c.env.DB.prepare(
            'SELECT drive_folder_id FROM users WHERE google_id = ?'
        ).bind(user.googleId).first() as { drive_folder_id?: string } | null;

        return c.json({
            accessToken: tokens.access_token,
            expiresIn: tokens.expires_in || 3600,
            slyceFolderId: userRecord?.drive_folder_id || null,
        });
    } catch (err) {
        console.error('Drive token refresh error:', err);
        return c.json({ error: 'Token refresh failed' }, 500);
    }
});

/**
 * POST /api/auth/drive-folder
 * Save the user's Slyce folder ID in Google Drive
 */
authRoutes.post('/drive-folder', async (c) => {
    // Verify session first
    const sessionToken = getCookie(c, 'session');
    if (!sessionToken) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const user = await verifySessionToken(sessionToken, c.env.SESSION_SECRET);
    if (!user) {
        return c.json({ error: 'Invalid session' }, 401);
    }

    const body = await c.req.json() as { folderId?: string };
    const { folderId } = body;

    if (!folderId) {
        return c.json({ error: 'folderId is required' }, 400);
    }

    // Update user's Drive folder ID
    await c.env.DB.prepare(`
        UPDATE users SET drive_folder_id = ? WHERE google_id = ?
    `).bind(folderId, user.googleId).run();

    return c.json({ success: true, folderId });
});

/**
 * POST /api/auth/logout
 * Clear all auth cookies
 */
authRoutes.post('/logout', (c) => {
    clearAuthCookies(c);
    return c.json({ success: true });
});

/**
 * Upsert user in database
 * Creates new user or updates existing user by google_id
 */
async function upsertUser(
    db: D1Database,
    userData: {
        googleId: string;
        email: string;
        name: string;
        picture?: string;
    }
): Promise<SessionUser> {
    // Check if user exists
    const existingUser = await db.prepare(
        'SELECT id, google_id, email, name, picture FROM users WHERE google_id = ?'
    ).bind(userData.googleId).first() as {
        id: string;
        google_id: string;
        email: string;
        name: string;
        picture?: string;
    } | null;

    if (existingUser) {
        // Update existing user
        await db.prepare(`
            UPDATE users 
            SET name = ?, email = ?, picture = ?, last_login = unixepoch()
            WHERE google_id = ?
        `).bind(
            userData.name,
            userData.email,
            userData.picture || null,
            userData.googleId
        ).run();

        return {
            id: existingUser.id,
            googleId: userData.googleId,
            email: userData.email,
            name: userData.name,
            picture: userData.picture,
        };
    }

    // Create new user
    const userId = crypto.randomUUID();

    await db.prepare(`
        INSERT INTO users (id, google_id, name, email, picture, created_at, last_login)
        VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())
    `).bind(
        userId,
        userData.googleId,
        userData.name,
        userData.email,
        userData.picture || null
    ).run();

    return {
        id: userId,
        googleId: userData.googleId,
        email: userData.email,
        name: userData.name,
        picture: userData.picture,
    };
}

export { authRoutes };
