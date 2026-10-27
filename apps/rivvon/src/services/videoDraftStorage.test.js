import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import {
    closeVideoDraftDatabase, saveVideoDraft, listVideoDrafts, getVideoDraft,
    getVideoDraftBlob, updateVideoDraft, deleteVideoDraft,
} from './videoDraftStorage.js';

beforeEach(async () => {
    await closeVideoDraftDatabase();
    vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(async () => {
    await closeVideoDraftDatabase();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function recording() {
    return {
        id: 'draft-1', createdAt: 123, filename: 'loop.webm', name: 'loop', format: 'webm',
        mimeType: 'video/webm', size: 11, settings: { width: 1280, fps: 30 },
        sourceDrawingPayload: { paths: [[{ x: 1 }]] }, renderSnapshot: { schemaVersion: 1 }, colourReport: null,
        blob: new Blob(['video bytes'], { type: 'video/webm' }), thumbnailBlob: new Blob(['poster']),
        playbackUrl: 'blob:stale', thumbnailUrl: 'blob:stale-poster',
        publication: { videoId: '', isPublishing: true, progress: 0.5 }, storage: { state: 'saving' },
    };
}

describe('video draft IndexedDB transactions', () => {
    it('lists portable metadata and posters without reading full videos or storing transient state', async () => {
        const draft = recording();
        await saveVideoDraft(draft);
        const records = await listVideoDrafts();
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ id: draft.id, settings: draft.settings, videoId: '' });
        for (const field of ['blob', 'playbackUrl', 'thumbnailUrl', 'publication', 'storage']) {
            expect(records[0]).not.toHaveProperty(field);
        }
        expect(await records[0].thumbnailBlob.text()).toBe('poster');
        expect(await (await getVideoDraftBlob(draft.id)).text()).toBe('video bytes');
        draft.settings.width = 1;
        expect((await getVideoDraft(draft.id)).settings.width).toBe(1280);
    });

    it('resolves a save only after commit, rather than individual request success', async () => {
        let resolved = false;
        let sawRequestSuccess = false;
        const originalAdd = IDBObjectStore.prototype.add;
        vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (...args) {
            const request = originalAdd.apply(this, args);
            if (this.name === 'videos') request.addEventListener('success', () => {
                sawRequestSuccess = true;
                expect(resolved).toBe(false);
            });
            return request;
        });
        await saveVideoDraft(recording()).then(() => { resolved = true; });
        expect(sawRequestSuccess).toBe(true);
        expect(resolved).toBe(true);
    });

    it('rolls back metadata and video together when the transaction is aborted', async () => {
        const originalAdd = IDBObjectStore.prototype.add;
        vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (...args) {
            const request = originalAdd.apply(this, args);
            if (this.name === 'videos') this.transaction.abort();
            return request;
        });
        await expect(saveVideoDraft(recording())).rejects.toBeDefined();
        expect(await getVideoDraft('draft-1')).toBeNull();
        expect(await getVideoDraftBlob('draft-1')).toBeNull();
    });

    it('updates posters without rewriting videos or erasing another tab’s publication', async () => {
        const draft = recording();
        await saveVideoDraft(draft);
        await updateVideoDraft(draft.id, { videoId: 'published' });
        await updateVideoDraft(draft.id, { thumbnailBlob: new Blob(['updated']), videoId: '' });
        await saveVideoDraft(draft); // A stale initial write is also harmless.
        expect((await getVideoDraft(draft.id)).videoId).toBe('published');
        expect(await (await getVideoDraft(draft.id)).thumbnailBlob.text()).toBe('updated');
        expect(await (await getVideoDraftBlob(draft.id)).text()).toBe('video bytes');
    });

    it('atomically deletes bytes and metadata and prevents stale tabs from recreating them', async () => {
        const draft = recording();
        await saveVideoDraft(draft);
        await deleteVideoDraft(draft.id);
        expect(await getVideoDraft(draft.id)).toBeNull();
        expect(await getVideoDraftBlob(draft.id)).toBeNull();
        expect(await updateVideoDraft(draft.id, { videoId: 'late' })).toBe(false);
        expect(await saveVideoDraft(draft)).toBe(false);
        expect(await listVideoDrafts()).toEqual([]);
    });

    it('fails clearly when storage is unavailable and opens successfully after retry', async () => {
        vi.stubGlobal('indexedDB', undefined);
        await expect(saveVideoDraft(recording())).rejects.toThrow('unavailable');
        vi.stubGlobal('indexedDB', new IDBFactory());
        expect(await saveVideoDraft(recording())).toBe(true);
    });
});
