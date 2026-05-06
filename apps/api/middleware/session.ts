// src/middleware/session.ts

import type { MiddlewareHandler } from 'hono';
import type { AppEnv, SessionAuthContext } from '../types/hono';
import { getCookie } from '../utils/cookies';
import { serverErrorResponse, unauthorizedResponse } from '../utils/response';
import { verifySessionToken } from '../utils/session';

/**
 * Session-based authentication middleware
 * Verifies the session cookie and attaches user info to context
 */
export const verifySession: MiddlewareHandler<AppEnv> = async (c, next) => {
    const sessionToken = getCookie(c, 'session');

    if (!sessionToken) {
        return unauthorizedResponse('Not authenticated');
    }

    try {
        const sessionSecret = c.env.SESSION_SECRET;
        if (!sessionSecret) {
            console.error('SESSION_SECRET not configured');
            return serverErrorResponse('Server configuration error');
        }

        const user = await verifySessionToken(sessionToken, sessionSecret);

        if (!user) {
            return unauthorizedResponse('Invalid or expired session');
        }

        // Attach user info to context
        // Use 'auth' key for backwards compatibility with existing routes
        const auth: SessionAuthContext = {
            userId: user.id,
            googleId: user.googleId,
            email: user.email,
            name: user.name,
            picture: user.picture,
        };

        c.set('auth', auth);

        await next();
    } catch (error) {
        console.error('Session verification failed:', error);
        return unauthorizedResponse('Authentication failed');
    }
};

/**
 * Optional session middleware - doesn't fail if no session
 * Useful for routes that work for both authenticated and anonymous users
 */
export const optionalSession: MiddlewareHandler<AppEnv> = async (c, next) => {
    const sessionToken = getCookie(c, 'session');

    if (sessionToken) {
        try {
            const sessionSecret = c.env.SESSION_SECRET;
            if (sessionSecret) {
                const user = await verifySessionToken(sessionToken, sessionSecret);
                if (user) {
                    const auth: SessionAuthContext = {
                        userId: user.id,
                        googleId: user.googleId,
                        email: user.email,
                        name: user.name,
                        picture: user.picture,
                    };

                    c.set('auth', auth);
                }
            }
        } catch {
            // Ignore errors - session is optional
        }
    }

    await next();
};
