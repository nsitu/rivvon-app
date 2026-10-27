import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import { publishVideoBlob } from '../services/videoService.js';
import {
    saveVideoDraft, updateVideoDraft, listVideoDrafts, getVideoDraft,
    getVideoDraftBlob, deleteVideoDraft, withVideoDraftLock, videoDraftStorageError,
} from '../services/videoDraftStorage.js';

// These fields use the same portable JSON contract as video publications.
// JSON serialization also handles reactive inputs from the export UI.
const cloneMetadata = value => JSON.parse(JSON.stringify(value));

export function videoDraftPublicationMetadata(draft, { name, description = '', isPublic = true, userProfile = null } = {}) {
    const settings = draft.settings || {};
    return {
        name: name?.trim() || draft.name,
        description, isPublic, userProfile,
        mimeType: draft.mimeType,
        width: settings.width, height: settings.height,
        duration: settings.resolvedDuration || settings.duration,
        fps: settings.fps,
        exportSettings: settings,
        sourceDrawingPayload: draft.sourceDrawingPayload,
        renderSnapshot: draft.renderSnapshot,
    };
}

const publicationState = videoId => ({ isPublishing: false, progress: 0, status: '', error: '', videoId: videoId || '' });
const storageState = (state, hasSaved = false) => ({ state, hasSaved, error: '', actionError: '', thumbnailError: '', publicationError: '', isDeleting: false });

/** Browser-owned drafts with lazy video reads and session-owned object URLs. */
export const useVideoDraftStore = defineStore('videoDrafts', () => {
    // Replace records rather than deeply proxying immutable video bytes.
    const drafts = shallowRef([]);
    const totalBytes = computed(() => drafts.value.reduce((sum, draft) => sum + draft.size, 0));
    const savedBytes = computed(() => drafts.value.reduce((sum, draft) => sum + (draft.storage.hasSaved ? draft.size : 0), 0));
    const isHydrating = ref(false);
    const hasHydrated = ref(false);
    const hydrationError = ref('');
    const publications = new Map();
    const writes = new Map();
    const requiredSaves = new Map();
    const assetReads = new Map();
    const deletions = new Map();
    const discarded = new Set();
    let hydration;
    let refreshRequested = false;
    let disposed = false;
    const channel = typeof window !== 'undefined' && globalThis.BroadcastChannel
        ? new BroadcastChannel('rivvon-video-drafts') : null;
    const getDraft = id => drafts.value.find(draft => draft.id === id);

    function patchDraft(id, changes) {
        if (disposed) return null;
        const draft = getDraft(id);
        if (!draft) return null;
        const updated = { ...draft, ...changes };
        drafts.value = drafts.value.map(entry => entry.id === id ? updated : entry);
        return updated;
    }

    function patchStorage(id, changes) {
        const draft = getDraft(id);
        if (draft) return patchDraft(id, { storage: { ...draft.storage, ...changes } });
    }

    function releaseUrls(draft) {
        if (draft.playbackUrl) URL.revokeObjectURL(draft.playbackUrl);
        if (draft.thumbnailUrl) URL.revokeObjectURL(draft.thumbnailUrl);
    }

    function removeDraft(id) {
        const draft = getDraft(id);
        if (!draft) return;
        discarded.add(id);
        releaseUrls(draft);
        drafts.value = drafts.value.filter(entry => entry.id !== id);
    }

    function notifyChange() { if (!disposed) channel?.postMessage('changed'); }

    // All tasks handle their own failures, so the next mutation still runs.
    function enqueue(id, action) {
        const task = (writes.get(id) || Promise.resolve()).then(action);
        writes.set(id, task);
        void task.finally(() => { if (writes.get(id) === task) writes.delete(id); });
        return task;
    }

    function hydrate({ refresh = false } = {}) {
        if (hydration) {
            if (refresh) refreshRequested = true;
            return hydration;
        }
        if (hasHydrated.value && !refresh) return Promise.resolve(true);
        isHydrating.value = true;
        hydrationError.value = '';
        const startingDrafts = new Map(drafts.value.map(draft => [draft.id, draft]));
        hydration = (async () => {
            try {
                const records = await listVideoDrafts();
                if (disposed) return false;
                const persisted = new Set(records.map(record => record.id));
                for (const draft of [...drafts.value]) {
                    if (startingDrafts.get(draft.id) === draft && draft.storage.state === 'saved' && !writes.has(draft.id)
                        && !draft.publication.isPublishing && !persisted.has(draft.id)) removeDraft(draft.id);
                }
                for (const record of records) {
                    if (discarded.has(record.id)) continue;
                    const current = getDraft(record.id);
                    if (current && (startingDrafts.get(record.id) !== current || writes.has(record.id) || current.storage.state !== 'saved'
                        || current.storage.isDeleting || current.storage.thumbnailError || current.storage.publicationError
                        || current.publication.isPublishing)) continue;
                    const thumbnailChanged = !current || current.updatedAt !== record.updatedAt;
                    if (current?.thumbnailUrl && thumbnailChanged) URL.revokeObjectURL(current.thumbnailUrl);
                    const restored = {
                        ...record,
                        blob: current?.blob || null,
                        playbackUrl: current?.playbackUrl || '',
                        thumbnailUrl: thumbnailChanged
                            ? (record.thumbnailBlob ? URL.createObjectURL(record.thumbnailBlob) : '')
                            : current.thumbnailUrl,
                        publication: publicationState(record.videoId),
                        storage: storageState('saved', true),
                        restored: true,
                    };
                    if (current) patchDraft(record.id, restored);
                    else drafts.value = [...drafts.value, restored];
                }
                drafts.value = [...drafts.value].sort((a, b) => b.createdAt - a.createdAt);
                hasHydrated.value = true;
                return true;
            } catch {
                if (!disposed) hydrationError.value = 'Could not read saved video drafts. Retry to load them.';
                return false;
            } finally {
                isHydrating.value = false;
                hydration = null;
                if (refreshRequested && !disposed) {
                    refreshRequested = false;
                    queueMicrotask(() => { void hydrate({ refresh: true }); });
                }
            }
        })();
        return hydration;
    }

    function saveDraft(id) {
        const draft = getDraft(id);
        if (!draft || draft.storage.isDeleting) return Promise.resolve(false);
        if (draft.storage.state === 'saved') return retryMetadata(id);
        if (requiredSaves.has(id)) return requiredSaves.get(id);
        patchStorage(id, { state: 'saving', error: '' });
        const task = enqueue(id, async () => {
            const current = getDraft(id);
            if (!current) return false;
            try {
                const saved = await saveVideoDraft(current);
                if (!saved) { removeDraft(id); return false; }
                patchStorage(id, { state: 'saved', hasSaved: true, error: '' });
                notifyChange();
                return true;
            } catch (error) {
                patchStorage(id, { state: 'memory-only', error: videoDraftStorageError(error) });
                return false;
            }
        });
        requiredSaves.set(id, task);
        void task.finally(() => { if (requiredSaves.get(id) === task) requiredSaves.delete(id); });
        return task;
    }

    function persistMetadata(id, changes, errorField) {
        return enqueue(id, async () => {
            const draft = getDraft(id);
            if (!draft?.storage.hasSaved || draft.storage.isDeleting) return false;
            try {
                if (!await updateVideoDraft(id, changes)) { removeDraft(id); return false; }
                patchStorage(id, { [errorField]: '' });
                notifyChange();
                return true;
            } catch {
                patchStorage(id, { [errorField]: errorField === 'thumbnailError'
                    ? 'The video is saved, but its poster could not be saved.'
                    : 'The video is saved, but its published status could not be saved. Retry before leaving.' });
                return false;
            }
        });
    }

    function retryMetadata(id) {
        const draft = getDraft(id);
        if (!draft) return Promise.resolve(false);
        return Promise.all([
            persistMetadata(id, { thumbnailBlob: draft.thumbnailBlob }, 'thumbnailError'),
            persistMetadata(id, { videoId: draft.publication.videoId }, 'publicationError'),
        ]).then(results => results.every(Boolean));
    }

    async function flushPendingSaves() {
        // Drain queued storage transactions, never thumbnail generation itself.
        // Optional poster write failures do not prevent leaving a saved video.
        while (writes.size || deletions.size) await Promise.all([...writes.values(), ...deletions.values()]);
        if (drafts.value.some(draft => draft.storage.state !== 'saved')) {
            throw new Error('A video draft has not been saved. Open Video Gallery → Drafts to retry saving, or download and discard the unsaved copy before signing in.');
        }
        if (drafts.value.some(draft => draft.storage.publicationError)) {
            throw new Error('A video’s published status has not been saved. Open Video Gallery → Drafts and retry saving before signing in to avoid uploading it again.');
        }
    }

    async function prepareDraft(id) {
        if (assetReads.has(id)) return assetReads.get(id);
        const task = (async () => {
            let draft = getDraft(id);
            if (!draft || draft.storage.isDeleting) throw new Error('This draft is no longer available.');
            patchStorage(id, { actionError: '' });
            if (draft.storage.hasSaved) {
                const record = await getVideoDraft(id);
                if (!record) { removeDraft(id); throw new Error('This draft was discarded in another tab.'); }
                patchDraft(id, { publication: { ...draft.publication, videoId: record.videoId || draft.publication.videoId } });
            }
            draft = getDraft(id);
            if (!draft || draft.storage.isDeleting) throw new Error('This draft is no longer available.');
            if (draft.blob) return draft;
            const blob = await getVideoDraftBlob(id);
            if (!blob?.size) throw new Error('This saved video could not be read. Try reopening the gallery.');
            if (disposed || !getDraft(id) || getDraft(id).storage.isDeleting) throw new Error('This draft is no longer available.');
            return patchDraft(id, { blob, playbackUrl: URL.createObjectURL(blob) });
        })();
        assetReads.set(id, task);
        try { return await task; }
        catch (error) { patchStorage(id, { actionError: error.message }); throw error; }
        finally { assetReads.delete(id); }
    }

    function releaseRestoredAssets() {
        for (const draft of drafts.value) {
            if (!draft.restored || draft.publication.isPublishing || !draft.playbackUrl) continue;
            URL.revokeObjectURL(draft.playbackUrl);
            patchDraft(draft.id, { blob: null, playbackUrl: '' });
        }
    }

    function addDraft(record) {
        if (!(record.blob instanceof Blob) || !record.blob.size) throw new Error('A completed video is required.');
        const settings = cloneMetadata(record.settings || {});
        const filename = record.filename || `rivvon-export.${record.format === 'webm' ? 'webm' : 'mp4'}`;
        const playbackUrl = URL.createObjectURL(record.blob);
        let thumbnailUrl = '';
        try {
            thumbnailUrl = record.thumbnailBlob ? URL.createObjectURL(record.thumbnailBlob) : '';
            const draft = {
                ...record,
                settings,
                sourceDrawingPayload: cloneMetadata(record.sourceDrawingPayload ?? null),
                renderSnapshot: cloneMetadata(record.renderSnapshot ?? null),
                colourReport: cloneMetadata(record.colourReport ?? null),
                id: crypto.randomUUID(),
                createdAt: Date.now(),
                filename,
                name: filename.replace(/\.[^.]+$/, ''),
                format: record.format === 'webm' ? 'webm' : 'mp4',
                mimeType: record.mimeType || record.blob.type || (record.format === 'webm' ? 'video/webm' : 'video/mp4'),
                size: record.blob.size,
                playbackUrl, thumbnailUrl,
                publication: publicationState(),
                storage: storageState('saving'),
            };
            drafts.value = [draft, ...drafts.value];
            void saveDraft(draft.id);
            return draft;
        } catch (error) {
            URL.revokeObjectURL(playbackUrl);
            if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
            throw error;
        }
    }

    function setThumbnail(id, thumbnailBlob) {
        const draft = getDraft(id);
        if (!draft || draft.storage.isDeleting || !thumbnailBlob) return draft;
        const thumbnailUrl = URL.createObjectURL(thumbnailBlob);
        if (draft.thumbnailUrl) URL.revokeObjectURL(draft.thumbnailUrl);
        const updated = patchDraft(id, { thumbnailBlob, thumbnailUrl });
        void persistMetadata(id, { thumbnailBlob }, 'thumbnailError');
        return updated;
    }

    async function discardDraft(id) {
        const draft = getDraft(id);
        if (!draft || draft.publication.isPublishing || draft.storage.isDeleting) return false;
        patchStorage(id, { isDeleting: true, actionError: '' });
        const task = withVideoDraftLock(id, () => enqueue(id, async () => {
            try { await deleteVideoDraft(id); }
            catch {
                // Never-saved bytes can still be discarded when storage is disabled.
                if (getDraft(id)?.storage.hasSaved) {
                    patchStorage(id, { isDeleting: false, actionError: 'Could not discard this saved draft. Retry before leaving.' });
                    return false;
                }
            }
            removeDraft(id);
            notifyChange();
            return true;
        }));
        deletions.set(id, task);
        try { return await task; }
        finally { deletions.delete(id); }
    }

    async function publishDraft(id, { signal, onProgress, onStatus, ...details } = {}) {
        const draft = getDraft(id);
        if (!draft || draft.storage.isDeleting) throw new Error('This draft is no longer available.');
        if (draft.publication.videoId) return { videoId: draft.publication.videoId };
        if (publications.has(id)) return publications.get(id).promise;
        if (signal?.aborted) throw new DOMException('Video upload cancelled', 'AbortError');
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        const setPublication = changes => {
            const current = getDraft(id);
            if (current) patchDraft(id, { publication: { ...current.publication, ...changes } });
        };
        setPublication({ isPublishing: true, progress: 0, error: '', status: 'Preparing gallery publication…' });
        const task = Promise.resolve().then(() => withVideoDraftLock(id, async () => {
            try {
                if (controller.signal.aborted) throw new DOMException('Video upload cancelled', 'AbortError');
                if (requiredSaves.has(id)) await requiredSaves.get(id);
                const ready = await prepareDraft(id);
                if (ready.publication.videoId) return { videoId: ready.publication.videoId };
                if (controller.signal.aborted) throw new DOMException('Video upload cancelled', 'AbortError');
                const publication = await publishVideoBlob({
                    metadata: videoDraftPublicationMetadata(ready, details),
                    blob: ready.blob, thumbnailBlob: ready.thumbnailBlob,
                    signal: controller.signal,
                    onProgress: progress => {
                        setPublication({ progress, status: `Uploading video… ${Math.round(progress * 100)}%` });
                        onProgress?.(progress);
                    },
                    onStatus: status => { setPublication({ status }); onStatus?.(status); },
                });
                setPublication({ videoId: publication.videoId, progress: 1, status: 'Published to the video gallery.' });
                await persistMetadata(id, { videoId: publication.videoId }, 'publicationError');
                return publication;
            } catch (error) {
                const cancelled = error?.name === 'AbortError';
                setPublication({ progress: 0, status: cancelled ? 'Upload cancelled.' : '', error: cancelled ? '' : error.message || 'Gallery upload failed.' });
                throw error;
            } finally {
                signal?.removeEventListener('abort', abort);
                setPublication({ isPublishing: false });
                publications.delete(id);
            }
        }));
        publications.set(id, { controller, promise: task });
        return task;
    }

    const refresh = () => { void hydrate({ refresh: true }); };
    if (channel) channel.onmessage = refresh;
    if (typeof window !== 'undefined') window.addEventListener('focus', refresh);
    onScopeDispose(() => {
        disposed = true;
        channel?.close();
        if (typeof window !== 'undefined') window.removeEventListener('focus', refresh);
        for (const { controller } of publications.values()) controller.abort();
        for (const draft of drafts.value) {
            releaseUrls(draft);
        }
        drafts.value = [];
    });

    return {
        drafts, totalBytes, savedBytes, isHydrating, hasHydrated, hydrationError,
        getDraft, addDraft, setThumbnail, discardDraft, publishDraft, hydrate,
        saveDraft, flushPendingSaves, prepareDraft, releaseRestoredAssets,
    };
});
