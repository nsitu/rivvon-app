import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it('returns cloud IDs rather than local primary keys from the cached_from index', async () => {
    const rows = [{ id: 'local-one', cached_from: 'cloud-one' }, { id: 'local-two', cached_from: 'cloud-two' }];
    const getAll = vi.fn(() => {
        const request = { result: rows };
        queueMicrotask(() => request.onsuccess());
        return request;
    });
    const db = { transaction: () => ({ objectStore: () => ({ index: () => ({ getAll }) }) }) };
    vi.stubGlobal('indexedDB', { open: () => {
        const request = { result: db };
        queueMicrotask(() => request.onsuccess());
        return request;
    } });
    const { getCachedCloudIds } = await import('./localStorage.js');
    expect(await getCachedCloudIds()).toEqual(new Set(['cloud-one', 'cloud-two']));
    expect(getAll).toHaveBeenCalledOnce();
});
