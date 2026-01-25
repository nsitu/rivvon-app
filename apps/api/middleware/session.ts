// src/middleware/session.ts

import type { Context, Next } from 'hono';
import { getCookie } from '../utils/cookies';
import { verifySessionToken, type SessionUser } from '../utils/session';

export interface SessionAuthContext {
    userId: string;
    googleId: string;
    email: string;
    name: string;
    picture?: string;
}

/**
 * Session-based authentication middleware
 * Verifies the session cookie and attaches user info to context
 */
export async function verifySession(c: Context, next: Next) {
    const sessionToken = getCookie(c, 'session');

    if (!sessionToken) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    try {
        const sessionSecret = c.env.SESSION_SECRET;
        if (!sessionSecret) {
            console.error('SESSION_SECRET not configured');
            return c.json({ error: 'Server configuration error' }, 500);
        }

        const user = await verifySessionToken(sessionToken, sessionSecret);

        if (!user) {
            return c.json({ error: 'Invalid or expired session' }, 401);
        }

        // Attach user info to context
        // Use 'auth' key for backwards compatibility with existing routes
        c.set('auth', {
            userId: user.id,
            googleId: user.googleId,
            email: user.email,
            name: user.name,
            picture: user.picture,
        } as SessionAuthContext);

        await next();
    } catch (error) {
        console.error('Session verification failed:', error);
        return c.json({ error: 'Authentication failed' }, 401);
    }
}

/**
 * Optional session middleware - doesn't fail if no session
 * Useful for routes that work for both authenticated and anonymous users
 */
export async function optionalSession(c: Context, next: Next) {
    const sessionToken = getCookie(c, 'session');

    if (sessionToken) {
        try {
            const sessionSecret = c.env.SESSION_SECRET;
            if (sessionSecret) {
                const user = await verifySessionToken(sessionToken, sessionSecret);
                if (user) {
                    c.set('auth', {
                        userId: user.id,
                        googleId: user.googleId,
                        email: user.email,
                        name: user.name,
                        picture: user.picture,
                    } as SessionAuthContext);
                }
            }
        } catch {
            // Ignore errors - session is optional
        }
    }

    await next();
}
