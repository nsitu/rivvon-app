import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { closeBackgroundLoopDatabase, saveBackgroundLoopJob, saveBackgroundLoopPart, getBackgroundLoopPart,
    listBackgroundLoopJobs, discardBackgroundLoop, getBackgroundLoopBlob, deleteBackgroundLoopParts } from './backgroundLoopStorage.js';

beforeEach(async () => {
    await closeBackgroundLoopDatabase();
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
});
afterEach(async () => { await closeBackgroundLoopDatabase(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('background-loop work files', () => {
    it('stores batches separately, assembles ordered Blob handles and isolates jobs', async () => {
        await saveBackgroundLoopJob({ id: 'a', status: 'complete', outputParts: 2 });
        await saveBackgroundLoopJob({ id: 'b', status: 'sampling' });
        await saveBackgroundLoopPart('a', 'batch', 0, new Blob(['encoded-batch']));
        await saveBackgroundLoopPart('a', 'output', 1, new Blob(['second']));
        await saveBackgroundLoopPart('a', 'output', 0, new Blob(['first']));
        await saveBackgroundLoopPart('b', 'batch', 0, new Blob(['other-job']));
        expect(await (await getBackgroundLoopBlob('a')).text()).toBe('firstsecond');
        expect(await listBackgroundLoopJobs()).toHaveLength(2);
        await discardBackgroundLoop('a');
        expect(await getBackgroundLoopPart('a', 'batch', 0)).toBeUndefined();
        expect(await getBackgroundLoopPart('a', 'output', 0)).toBeUndefined();
        expect(await (await getBackgroundLoopPart('b', 'batch', 0)).text()).toBe('other-job');
    });
    it('removes failed assembly parts while retaining original batches for retry', async () => {
        await saveBackgroundLoopJob({ id: 'a', status: 'sampled' });
        await saveBackgroundLoopPart('a', 'batch', 0, new Blob(['batch']));
        await saveBackgroundLoopPart('a', 'output', 0, new Blob(['partial']));
        await deleteBackgroundLoopParts('a', 'output');
        expect(await getBackgroundLoopPart('a', 'output', 0)).toBeUndefined();
        expect(await (await getBackgroundLoopPart('a', 'batch', 0)).text()).toBe('batch');
        await expect(getBackgroundLoopBlob('a')).rejects.toThrow('not been assembled');
    });
    it('reports storage failure instead of accepting an uncommitted encoded batch', async () => {
        await saveBackgroundLoopJob({ id: 'a', status: 'sampling' });
        const put = IDBObjectStore.prototype.put;
        const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (...args) {
            const request = put.apply(this, args);
            if (this.name === 'parts') request.addEventListener('success', () => this.transaction.abort());
            return request;
        });
        await expect(saveBackgroundLoopPart('a', 'batch', 0, new Blob(['not committed']))).rejects.toThrow();
        spy.mockRestore();
        expect(await getBackgroundLoopPart('a', 'batch', 0)).toBeUndefined();
        expect(await listBackgroundLoopJobs()).toHaveLength(1);
    });
});
