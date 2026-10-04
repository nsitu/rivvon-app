// Short-lived Photos credentials stay in encrypted HttpOnly cookies. No refresh
// token is requested or substituted for the existing Drive grant.
async function encryptionKey(secret: string, purpose: string) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`rivvon:${purpose}:${secret}`));
    return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function encode(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sealPhotosCookie(value: object, secret: string, purpose: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret, purpose),
        new TextEncoder().encode(JSON.stringify(value)));
    return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}

export async function openPhotosCookie<T extends { expiresAt: number }>(value: string | undefined, secret: string, purpose: string): Promise<T | null> {
    try {
        if (!value || value.length > 4000) return null;
        const parts = value.split('.');
        if (parts.length !== 2) return null;
        const decode = (part: string) => Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(parts[0]) },
            await encryptionKey(secret, purpose), decode(parts[1]));
        const result = JSON.parse(new TextDecoder().decode(plain)) as T;
        return Number.isFinite(result.expiresAt) && result.expiresAt > Date.now() ? result : null;
    } catch {
        return null;
    }
}
