import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { effectScope, reactive, shallowRef } from 'vue';
import { useVideoDraftStore, videoDraftPublicationMetadata } from './videoDraftStore.js';
import { publishVideoBlob } from '../services/videoService.js';
import { IDBFactory } from 'fake-indexeddb';
import * as storage from '../services/videoDraftStorage.js';

vi.mock('../services/videoService.js', () => ({ publishVideoBlob: vi.fn() }));
let pinia;
beforeEach(async () => {
    await storage.closeVideoDraftDatabase();
    vi.stubGlobal('indexedDB', new IDBFactory());
    pinia = createPinia();
    setActivePinia(pinia);
    let index = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:draft-${++index}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    publishVideoBlob.mockReset();
});
afterEach(async () => {
    await useVideoDraftStore(pinia).flushPendingSaves().catch(() => {});
    disposePinia(pinia);
    await storage.closeVideoDraftDatabase();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function recording(filename = 'first.mp4') {
    return {
        blob: new Blob(['encoded-video'], { type: 'video/mp4' }), filename, format: 'mp4',
        thumbnailBlob: new Blob(['poster'], { type: 'image/webp' }),
        settings: { width: 1280, height: 720, fps: 30, duration: 2, resolvedDuration: 3 },
        sourceDrawingPayload: { paths: [[{ x: 1, y: 2, z: 0 }]] },
        renderSnapshot: { export: { quality: 'high' } },
        colourReport: { phase: 'complete' },
    };
}

describe('completed video drafts', () => {
    it('keeps multiple encodings when workflow refs reset and views unmount', () => {
        const screen = effectScope();
        let store;
        const currentExport = shallowRef(null);
        screen.run(() => {
            store = useVideoDraftStore();
            currentExport.value = store.addDraft(recording());
        });
        const first = currentExport.value;
        currentExport.value = null;
        screen.stop();
        const gallery = useVideoDraftStore();
        const second = gallery.addDraft(recording('second.mp4'));
        expect(gallery).toBe(store);
        expect(gallery.drafts.map(draft => draft.id)).toEqual([second.id, first.id]);
        expect(gallery.getDraft(first.id).playbackUrl).toBe(first.playbackUrl);
        expect(gallery.totalBytes).toBe(first.size + second.size);
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    });

    it('shares immutable bytes while freezing the original export metadata, including reactive inputs', () => {
        const input = recording();
        input.settings = reactive(input.settings);
        const draft = useVideoDraftStore().addDraft(input);
        input.settings.width = 99;
        input.sourceDrawingPayload.paths[0][0].x = 99;
        input.renderSnapshot.export.quality = 'low';
        input.colourReport.phase = 'changed';
        expect(draft.blob).toBe(input.blob);
        expect(draft.thumbnailBlob).toBe(input.thumbnailBlob);
        expect(draft.settings.width).toBe(1280);
        expect(draft.sourceDrawingPayload.paths[0][0].x).toBe(1);
        expect(draft.renderSnapshot.export.quality).toBe('high');
        expect(draft.colourReport.phase).toBe('complete');
    });

    it('retains the video without a thumbnail and releases replaced poster URLs only', () => {
        const store = useVideoDraftStore();
        const draft = store.addDraft({ ...recording(), thumbnailBlob: null });
        expect(draft.thumbnailUrl).toBe('');
        store.setThumbnail(draft.id, new Blob(['first poster']));
        const firstPoster = store.getDraft(draft.id).thumbnailUrl;
        store.setThumbnail(draft.id, new Blob(['new poster']));
        expect(URL.revokeObjectURL.mock.calls).toEqual([[firstPoster]]);
        expect(store.getDraft(draft.id).playbackUrl).toBe(draft.playbackUrl);
        expect(store.getDraft(draft.id).blob).toBe(draft.blob);
    });

    it('discards only the selected draft, revokes its URLs, and ignores late thumbnail completion', async () => {
        const store = useVideoDraftStore();
        const first = store.addDraft(recording());
        const second = store.addDraft(recording('second.mp4'));
        expect(await store.discardDraft(first.id)).toBe(true);
        expect(store.drafts.map(draft => draft.id)).toEqual([second.id]);
        expect(URL.revokeObjectURL.mock.calls).toEqual([[first.playbackUrl], [first.thumbnailUrl]]);
        expect(store.setThumbnail(first.id, new Blob(['late poster']))).toBeUndefined();
        expect(URL.createObjectURL).toHaveBeenCalledTimes(4);
        expect(await store.discardDraft(first.id)).toBe(false);
    });

    it('releases all remaining URLs when the session store is disposed', () => {
        const store = useVideoDraftStore();
        const draft = store.addDraft(recording());
        store.$dispose();
        expect(URL.revokeObjectURL.mock.calls).toEqual([[draft.playbackUrl], [draft.thumbnailUrl]]);
        expect(store.drafts).toEqual([]);
    });

    it('rejects incomplete encodings without creating an object URL', () => {
        const store = useVideoDraftStore();
        expect(() => store.addDraft({ blob: null })).toThrow('completed video');
        expect(() => store.addDraft({ blob: new Blob([]) })).toThrow('completed video');
        expect(URL.createObjectURL).not.toHaveBeenCalled();
        expect(store.drafts).toEqual([]);
    });
});

describe('draft publication', () => {
    it('publishes the original export snapshot and chosen visibility with the retained bytes', async () => {
        const store = useVideoDraftStore();
        const draft = store.addDraft(recording());
        publishVideoBlob.mockImplementation(async ({ onStatus, onProgress }) => {
            onStatus('Uploading…');
            onProgress(0.5);
            expect(store.getDraft(draft.id).publication).toMatchObject({ isPublishing: true, progress: 0.5 });
            return { videoId: 'published' };
        });
        const profile = { name: 'Artist' };
        await store.publishDraft(draft.id, { name: 'A loop', description: 'Description', isPublic: false, userProfile: profile });
        expect(publishVideoBlob).toHaveBeenCalledWith(expect.objectContaining({
            blob: draft.blob, thumbnailBlob: draft.thumbnailBlob,
            metadata: {
                name: 'A loop', description: 'Description', isPublic: false, userProfile: profile,
                mimeType: 'video/mp4', width: 1280, height: 720, fps: 30, duration: 3,
                exportSettings: draft.settings, sourceDrawingPayload: draft.sourceDrawingPayload, renderSnapshot: draft.renderSnapshot,
            },
        }));
        expect(store.getDraft(draft.id)).toBeUndefined();
        expect(URL.revokeObjectURL.mock.calls).toEqual([[draft.playbackUrl], [draft.thumbnailUrl]]);
        expect(videoDraftPublicationMetadata(draft).name).toBe('first');
    });

    it('joins concurrent uploads, blocks discard during upload, and prevents duplicate publication', async () => {
        const store = useVideoDraftStore();
        const draft = store.addDraft(recording());
        let complete;
        publishVideoBlob.mockReturnValue(new Promise(resolve => { complete = resolve; }));
        const first = store.publishDraft(draft.id);
        const second = store.publishDraft(draft.id);
        expect(await store.discardDraft(draft.id)).toBe(false);
        await vi.waitFor(() => expect(publishVideoBlob).toHaveBeenCalledOnce());
        expect(publishVideoBlob).toHaveBeenCalledOnce();
        expect(await storage.getVideoDraftBlob(draft.id)).toBeInstanceOf(Blob);
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
        complete({ videoId: 'published' });
        expect(await first).toEqual(await second);
        await expect(store.publishDraft(draft.id)).rejects.toThrow('no longer available');
        expect(publishVideoBlob).toHaveBeenCalledOnce();
    });

    it('retains failed uploads for retry and clears stale failure state after success', async () => {
        const store = useVideoDraftStore();
        const draft = store.addDraft(recording());
        publishVideoBlob.mockRejectedValueOnce(new Error('Network failed')).mockResolvedValueOnce({ videoId: 'retry' });
        await expect(store.publishDraft(draft.id)).rejects.toThrow('Network failed');
        expect(store.getDraft(draft.id).publication).toMatchObject({ isPublishing: false, error: 'Network failed', videoId: '' });
        expect(store.getDraft(draft.id).blob).toBe(draft.blob);
        expect(await storage.getVideoDraftBlob(draft.id)).toBeInstanceOf(Blob);
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
        await store.publishDraft(draft.id);
        expect(store.getDraft(draft.id)).toBeUndefined();
    });

    it('forwards cancellation without deleting the draft and rejects a pre-aborted upload locally', async () => {
        const store = useVideoDraftStore();
        const draft = store.addDraft(recording());
        const controller = new AbortController();
        controller.abort();
        await expect(store.publishDraft(draft.id, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
        expect(publishVideoBlob).not.toHaveBeenCalled();
        const upload = new AbortController();
        publishVideoBlob.mockImplementation(({ signal }) => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
        }));
        const pending = store.publishDraft(draft.id, { signal: upload.signal });
        await Promise.resolve();
        upload.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(store.getDraft(draft.id).publication).toMatchObject({ isPublishing: false, status: 'Upload cancelled.', error: '' });
        expect(store.getDraft(draft.id).blob).toBe(draft.blob);
    });

    it('does not upload a discarded draft', async () => {
        const store = useVideoDraftStore();
        const draft = store.addDraft(recording());
        await store.discardDraft(draft.id);
        await expect(store.publishDraft(draft.id)).rejects.toThrow('no longer available');
        expect(publishVideoBlob).not.toHaveBeenCalled();
    });

    it('aborts queued publication on session disposal before making a network request', async () => {
        const store = useVideoDraftStore();
        const draft = store.addDraft(recording());
        const pending = store.publishDraft(draft.id);
        store.$dispose();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(publishVideoBlob).not.toHaveBeenCalled();
        expect(URL.revokeObjectURL.mock.calls).toEqual([[draft.playbackUrl], [draft.thumbnailUrl]]);
    });
});

describe('persistent drafts', () => {
    it('restores original IDs, bytes, posters, and metadata in a new app session with lazy video reads', async () => {
        const store = useVideoDraftStore();
        const input = recording();
        const draft = store.addDraft(input);
        await store.flushPendingSaves();
        expect(store.getDraft(draft.id).storage.state).toBe('saved');
        disposePinia(pinia);
        pinia = createPinia();
        setActivePinia(pinia);
        const reopened = useVideoDraftStore();
        await reopened.hydrate();
        expect(reopened.drafts).toHaveLength(1);
        const restored = reopened.getDraft(draft.id);
        expect(restored).toMatchObject({ id: draft.id, createdAt: draft.createdAt, settings: input.settings, sourceDrawingPayload: input.sourceDrawingPayload });
        expect(restored.blob).toBeNull();
        expect(restored.playbackUrl).toBe('');
        expect(restored.thumbnailUrl).not.toBe(draft.thumbnailUrl);
        const ready = await reopened.prepareDraft(draft.id);
        expect(await ready.blob.text()).toBe(await input.blob.text());
        expect(ready.playbackUrl).not.toBe(draft.playbackUrl);
        reopened.releaseRestoredAssets();
        expect(reopened.getDraft(draft.id).blob).toBeNull();
        expect(await (await reopened.prepareDraft(draft.id)).blob.text()).toBe('encoded-video');
    });

    it('does not let sign-in leave before the transaction commits', async () => {
        let finish;
        vi.spyOn(storage, 'saveVideoDraft').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const store = useVideoDraftStore();
        const draft = store.addDraft(recording());
        let flushed = false;
        const flush = store.flushPendingSaves().then(() => { flushed = true; });
        await Promise.resolve();
        expect(flushed).toBe(false);
        expect(store.getDraft(draft.id).storage.state).toBe('saving');
        finish(true);
        await flush;
        expect(flushed).toBe(true);
        expect(store.getDraft(draft.id).storage.state).toBe('saved');
    });

    it('retains a successful encoding on quota failure, blocks navigation, and saves on retry', async () => {
        const save = vi.spyOn(storage, 'saveVideoDraft');
        save.mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'));
        const store = useVideoDraftStore();
        const draft = store.addDraft(recording());
        await expect(store.flushPendingSaves()).rejects.toThrow('has not been saved');
        expect(store.getDraft(draft.id).blob).toBe(draft.blob);
        expect(store.getDraft(draft.id).storage).toMatchObject({ state: 'memory-only', hasSaved: false });
        expect(store.getDraft(draft.id).storage.error).toContain('storage is full');
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
        await store.saveDraft(draft.id);
        await expect(store.flushPendingSaves()).resolves.toBeUndefined();
        expect(await storage.getVideoDraftBlob(draft.id)).toBeInstanceOf(Blob);
    });

    it('deletes after a pending save, ignores a late poster, and stays deleted on reload or stale retry', async () => {
        const store = useVideoDraftStore();
        const draft = store.addDraft(recording());
        store.setThumbnail(draft.id, new Blob(['queued poster']));
        const discarded = store.discardDraft(draft.id);
        expect(store.setThumbnail(draft.id, new Blob(['late poster']))).toBeDefined();
        expect(await discarded).toBe(true);
        expect(await storage.getVideoDraft(draft.id)).toBeNull();
        expect(await storage.getVideoDraftBlob(draft.id)).toBeNull();
        expect(await storage.saveVideoDraft(draft)).toBe(false);
        await store.hydrate({ refresh: true });
        expect(store.drafts).toEqual([]);
    });

    it('retains a saved draft when persistent deletion fails', async () => {
        const store = useVideoDraftStore();
        const draft = store.addDraft(recording());
        await store.flushPendingSaves();
        vi.spyOn(storage, 'deleteVideoDraft').mockRejectedValueOnce(new Error('Disk error'));
        expect(await store.discardDraft(draft.id)).toBe(false);
        expect(store.getDraft(draft.id).storage.actionError).toContain('Could not discard');
        expect(store.getDraft(draft.id).storage.isDeleting).toBe(false);
        expect(await storage.getVideoDraft(draft.id)).not.toBeNull();
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
        expect(await store.discardDraft(draft.id)).toBe(true);
    });

    it('can discard never-saved bytes even when browser storage is unavailable', async () => {
        vi.spyOn(storage, 'saveVideoDraft').mockRejectedValue(new Error('Unavailable'));
        vi.spyOn(storage, 'deleteVideoDraft').mockRejectedValue(new Error('Unavailable'));
        const store = useVideoDraftStore();
        const draft = store.addDraft(recording());
        await store.flushPendingSaves().catch(() => {});
        expect(await store.discardDraft(draft.id)).toBe(true);
        expect(store.drafts).toEqual([]);
    });

    it('preserves video saving through optional poster failure and retries poster metadata separately', async () => {
        const store = useVideoDraftStore();
        const draft = store.addDraft({ ...recording(), thumbnailBlob: null });
        await store.flushPendingSaves();
        vi.spyOn(storage, 'updateVideoDraft').mockRejectedValueOnce(new Error('Poster quota'));
        store.setThumbnail(draft.id, new Blob(['poster']));
        await expect(store.flushPendingSaves()).resolves.toBeUndefined();
        expect(store.getDraft(draft.id).storage.state).toBe('saved');
        expect(store.getDraft(draft.id).storage.thumbnailError).toContain('poster');
        await store.saveDraft(draft.id);
        expect(store.getDraft(draft.id).storage.thumbnailError).toBe('');
        expect(await (await storage.getVideoDraft(draft.id)).thumbnailBlob.text()).toBe('poster');
    });

    it('distinguishes restoration failure from an empty collection and supports retry', async () => {
        vi.spyOn(storage, 'listVideoDrafts').mockRejectedValueOnce(new Error('Read failed'));
        const store = useVideoDraftStore();
        expect(await store.hydrate()).toBe(false);
        expect(store.hasHydrated).toBe(false);
        expect(store.hydrationError).toContain('Could not read');
        expect(await store.hydrate()).toBe(true);
        expect(store.hasHydrated).toBe(true);
        expect(store.hydrationError).toBe('');
    });

    it('merges an encoding completed during restoration instead of replacing it', async () => {
        let finishRead;
        vi.spyOn(storage, 'listVideoDrafts').mockReturnValueOnce(new Promise(resolve => { finishRead = resolve; }));
        const store = useVideoDraftStore();
        const hydration = store.hydrate();
        const draft = store.addDraft(recording());
        await store.flushPendingSaves();
        finishRead([]);
        await hydration;
        expect(store.getDraft(draft.id)).toBeDefined();
    });

    it('deletes only the published draft and its saved bytes, including after reopening', async () => {
        const store = useVideoDraftStore();
        const draft = store.addDraft(recording());
        const other = store.addDraft(recording('other.mp4'));
        publishVideoBlob.mockResolvedValue({ videoId: 'published' });
        await store.publishDraft(draft.id);
        expect(store.drafts.map(entry => entry.id)).toEqual([other.id]);
        expect(store.totalBytes).toBe(other.size);
        expect(store.savedBytes).toBe(other.size);
        expect(await storage.getVideoDraft(draft.id)).toBeNull();
        expect(await storage.getVideoDraftBlob(draft.id)).toBeNull();
        // A late poster or stale save must not recreate the published draft.
        expect(store.setThumbnail(draft.id, new Blob(['late poster']))).toBeUndefined();
        expect(await storage.saveVideoDraft(draft)).toBe(false);
        disposePinia(pinia);
        pinia = createPinia();
        setActivePinia(pinia);
        const reopened = useVideoDraftStore();
        await reopened.hydrate();
        expect(reopened.drafts.map(entry => entry.id)).toEqual([other.id]);
        expect(publishVideoBlob).toHaveBeenCalledOnce();
    });

    it('deletes a published draft even if saving its publication status fails', async () => {
        const store = useVideoDraftStore();
        const draft = store.addDraft(recording());
        await store.flushPendingSaves();
        vi.spyOn(storage, 'updateVideoDraft').mockRejectedValueOnce(new Error('Disk error'));
        publishVideoBlob.mockResolvedValue({ videoId: 'published' });
        await expect(store.publishDraft(draft.id)).resolves.toEqual({ videoId: 'published' });
        expect(store.getDraft(draft.id)).toBeUndefined();
        expect(await storage.getVideoDraftBlob(draft.id)).toBeNull();
        await expect(store.flushPendingSaves()).resolves.toBeUndefined();
    });

    it('retains a confirmed publication when cleanup fails and retries cleanup without uploading again', async () => {
        const store = useVideoDraftStore();
        const draft = store.addDraft(recording());
        await store.flushPendingSaves();
        vi.spyOn(storage, 'deleteVideoDraft').mockRejectedValueOnce(new Error('Disk error'));
        publishVideoBlob.mockResolvedValue({ videoId: 'published' });
        await expect(store.publishDraft(draft.id)).resolves.toEqual({ videoId: 'published' });
        expect(store.getDraft(draft.id).storage.actionError).toContain('Could not discard');
        expect((await storage.getVideoDraft(draft.id)).videoId).toBe('published');
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
        await store.publishDraft(draft.id);
        expect(store.getDraft(draft.id)).toBeUndefined();
        expect(await storage.getVideoDraftBlob(draft.id)).toBeNull();
        expect(publishVideoBlob).toHaveBeenCalledOnce();
    });

    it('preserves a confirmed publication through metadata and cleanup failure until retry succeeds', async () => {
        const store = useVideoDraftStore();
        const draft = store.addDraft(recording());
        await store.flushPendingSaves();
        vi.spyOn(storage, 'updateVideoDraft').mockRejectedValueOnce(new Error('Disk error'));
        vi.spyOn(storage, 'deleteVideoDraft').mockRejectedValueOnce(new Error('Disk error'));
        publishVideoBlob.mockResolvedValue({ videoId: 'already-published' });
        await store.publishDraft(draft.id);
        expect(store.getDraft(draft.id).storage.publicationError).not.toBe('');
        await store.hydrate({ refresh: true });
        expect(store.getDraft(draft.id).publication.videoId).toBe('already-published');
        await expect(store.flushPendingSaves()).rejects.toThrow('published status');
        await store.saveDraft(draft.id);
        await expect(store.flushPendingSaves()).resolves.toBeUndefined();
        expect((await storage.getVideoDraft(draft.id)).videoId).toBe('already-published');
        expect(publishVideoBlob).toHaveBeenCalledOnce();
    });

    it('waits for discard queued behind another tab’s publication before allowing navigation', async () => {
        const store = useVideoDraftStore();
        const draft = store.addDraft(recording());
        await store.flushPendingSaves();
        let releaseLock;
        vi.spyOn(storage, 'withVideoDraftLock').mockImplementationOnce((_id, action) => new Promise(resolve => {
            releaseLock = () => resolve(action());
        }));
        const deletion = store.discardDraft(draft.id);
        let left = false;
        const navigation = store.flushPendingSaves().then(() => { left = true; });
        await Promise.resolve();
        expect(left).toBe(false);
        releaseLock();
        expect(await deletion).toBe(true);
        await navigation;
        expect(left).toBe(true);
        expect(store.drafts).toEqual([]);
    });

    it('refreshes another tab’s publication and discard before acting on cached video bytes', async () => {
        const store = useVideoDraftStore();
        const draft = store.addDraft(recording());
        await store.flushPendingSaves();
        await storage.updateVideoDraft(draft.id, { videoId: 'another-tab' });
        expect(await store.publishDraft(draft.id)).toEqual({ videoId: 'another-tab' });
        expect(publishVideoBlob).not.toHaveBeenCalled();
        expect(await storage.getVideoDraftBlob(draft.id)).toBeNull();
        expect(store.drafts).toEqual([]);
    });

    it('coordinates publication between two stores through a shared browser lock', async () => {
        const locks = new Map();
        vi.stubGlobal('navigator', { locks: { request: (id, action) => {
            const next = (locks.get(id) || Promise.resolve()).then(action);
            locks.set(id, next.catch(() => {}));
            return next;
        } } });
        const first = useVideoDraftStore();
        const draft = first.addDraft(recording());
        await first.flushPendingSaves();
        const secondPinia = createPinia();
        const second = useVideoDraftStore(secondPinia);
        try {
            await second.hydrate();
            let finish;
            publishVideoBlob.mockReturnValue(new Promise(resolve => { finish = resolve; }));
            const firstUpload = first.publishDraft(draft.id);
            await vi.waitFor(() => expect(publishVideoBlob).toHaveBeenCalledOnce());
            const secondUpload = second.publishDraft(draft.id);
            const secondResult = expect(secondUpload).rejects.toThrow('another tab');
            finish({ videoId: 'shared-publication' });
            expect(await firstUpload).toEqual({ videoId: 'shared-publication' });
            await secondResult;
            expect(first.drafts).toEqual([]);
            expect(second.drafts).toEqual([]);
            expect(publishVideoBlob).toHaveBeenCalledOnce();
        } finally { disposePinia(secondPinia); }
    });
});
