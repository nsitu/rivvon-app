const KEY = 'auth_redirect';

export function saveAuthRedirect(location = window.location, storage = sessionStorage) {
    storage.setItem(KEY, location.pathname + location.search + location.hash);
}

export function consumeAuthRedirect(storage = sessionStorage, origin = window.location.origin) {
    const saved = storage.getItem(KEY);
    storage.removeItem(KEY);
    if (!saved?.startsWith('/') || saved.startsWith('//')) return null;
    try {
        const destination = new URL(saved, origin);
        if (destination.origin !== origin || ['/login', '/callback'].includes(destination.pathname)) return null;
        return destination.pathname + destination.search + destination.hash;
    } catch { return null; }
}

export function authErrorRedirect(error) {
    const destination = new URL(consumeAuthRedirect() || '/', window.location.origin);
    if (error) destination.searchParams.set('auth_error', String(error));
    return destination.pathname + destination.search + destination.hash;
}
