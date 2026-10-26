import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { effectScope, reactive, shallowRef } from 'vue';
import { useVideoDraftStore, videoDraftPublicationMetadata } from './videoDraftStore.js';
import { publishVideoBlob } from '../services/videoService.js';

vi.mock('../services/videoService.js', () => ({ publishVideoBlob: vi.fn() }));
let pinia;
beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    let index = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:draft-${++index}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    publishVideoBlob.mockReset();
});
afterEach(() => { disposePinia(pinia); vi.restoreAllMocks(); });

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

    it('discards only the selected draft, revokes its URLs, and ignores late thumbnail completion', () => {
        const store = useVideoDraftStore();
        const first = store.addDraft(recording());
        const second = store.addDraft(recording('second.mp4'));
        expect(store.discardDraft(first.id)).toBe(true);
        expect(store.drafts.map(draft => draft.id)).toEqual([second.id]);
        expect(URL.revokeObjectURL.mock.calls).toEqual([[first.playbackUrl], [first.thumbnailUrl]]);
        expect(store.setThumbnail(first.id, new Blob(['late poster']))).toBeUndefined();
        expect(URL.createObjectURL).toHaveBeenCalledTimes(4);
        expect(store.discardDraft(first.id)).toBe(false);
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
        expect(store.getDraft(draft.id).publication).toMatchObject({ isPublishing: false, videoId: 'published', progress: 1 });
        expect(store.getDraft(draft.id).blob).toBe(draft.blob);
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
        expect(videoDraftPublicationMetadata(draft).name).toBe('first');
    });

    it('joins concurrent uploads, blocks discard during upload, and prevents duplicate publication', async () => {
        const store = useVideoDraftStore();
        const draft = store.addDraft(recording());
        let complete;
        publishVideoBlob.mockReturnValue(new Promise(resolve => { complete = resolve; }));
        const first = store.publishDraft(draft.id);
        const second = store.publishDraft(draft.id);
        expect(store.discardDraft(draft.id)).toBe(false);
        await Promise.resolve();
        expect(publishVideoBlob).toHaveBeenCalledOnce();
        complete({ videoId: 'published' });
        expect(await first).toEqual(await second);
        expect(await store.publishDraft(draft.id)).toEqual({ videoId: 'published' });
        expect(publishVideoBlob).toHaveBeenCalledOnce();
    });

    it('retains failed uploads for retry and clears stale failure state after success', async () => {
        const store = useVideoDraftStore();
        const draft = store.addDraft(recording());
        publishVideoBlob.mockRejectedValueOnce(new Error('Network failed')).mockResolvedValueOnce({ videoId: 'retry' });
        await expect(store.publishDraft(draft.id)).rejects.toThrow('Network failed');
        expect(store.getDraft(draft.id).publication).toMatchObject({ isPublishing: false, error: 'Network failed', videoId: '' });
        expect(store.getDraft(draft.id).blob).toBe(draft.blob);
        await store.publishDraft(draft.id);
        expect(store.getDraft(draft.id).publication).toMatchObject({ isPublishing: false, error: '', videoId: 'retry' });
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
        store.discardDraft(draft.id);
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
