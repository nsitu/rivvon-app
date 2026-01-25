// src/utils/session.ts

/**
 * User data stored in session
 */
export interface SessionUser {
    id: string;          // Internal user ID
    googleId: string;    // Google user ID (sub)
    email: string;
    name: string;
    picture?: string;
}

/**
 * Session token payload
 */
interface SessionPayload {
    user: SessionUser;
    exp: number;         // Expiration timestamp (seconds)
    iat: number;         // Issued at timestamp (seconds)
}

/**
 * Create a signed session token using Web Crypto API
 * Uses HMAC-SHA256 for signing
 */
export async function createSessionToken(
    user: SessionUser,
    secret: string
): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload: SessionPayload = {
        user,
        iat: now,
        exp: now + 7 * 24 * 60 * 60, // 7 days
    };

    const payloadStr = JSON.stringify(payload);
    const payloadB64 = btoa(payloadStr);

    // Sign with HMAC-SHA256
    const signature = await sign(payloadB64, secret);

    return `${payloadB64}.${signature}`;
}

/**
 * Verify and decode a session token
 * Returns null if invalid or expired
 */
export async function verifySessionToken(
    token: string,
    secret: string
): Promise<SessionUser | null> {
    try {
        const parts = token.split('.');
        if (parts.length !== 2) {
            console.log('Session verify: invalid parts count', parts.length);
            return null;
        }

        const [payloadB64, signature] = parts;

        // Verify signature
        const expectedSignature = await sign(payloadB64, secret);
        if (signature !== expectedSignature) {
            console.log('Session verify: signature mismatch');
            console.log('  received:', signature.substring(0, 20) + '...');
            console.log('  expected:', expectedSignature.substring(0, 20) + '...');
            return null;
        }

        // Decode payload
        const payloadStr = atob(payloadB64);
        const payload: SessionPayload = JSON.parse(payloadStr);

        // Check expiration
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp < now) {
            console.log('Session verify: token expired', { exp: payload.exp, now });
            return null;
        }

        return payload.user;
    } catch (e) {
        console.log('Session verify: exception', e);
        return null;
    }
}

/**
 * HMAC-SHA256 signing using Web Crypto API
 */
async function sign(data: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(data);

    const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', key, messageData);
    const signatureArray = new Uint8Array(signature);

    // Convert to base64url (URL-safe base64)
    return btoa(String.fromCharCode(...signatureArray))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}
