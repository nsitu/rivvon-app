import { computed, onScopeDispose, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import { publishVideoBlob } from '../services/videoService.js';

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

/** Session-owned blobs: closing an export or navigating never releases a draft. */
export const useVideoDraftStore = defineStore('videoDrafts', () => {
    // Replace records rather than deeply proxying immutable video bytes.
    const drafts = shallowRef([]);
    const totalBytes = computed(() => drafts.value.reduce((sum, draft) => sum + draft.size, 0));
    const publications = new Map();
    const getDraft = id => drafts.value.find(draft => draft.id === id);

    function patchDraft(id, changes) {
        const draft = getDraft(id);
        if (!draft) return null;
        const updated = { ...draft, ...changes };
        drafts.value = drafts.value.map(entry => entry.id === id ? updated : entry);
        return updated;
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
                publication: { isPublishing: false, progress: 0, status: '', error: '', videoId: '' },
            };
            drafts.value = [draft, ...drafts.value];
            return draft;
        } catch (error) {
            URL.revokeObjectURL(playbackUrl);
            if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
            throw error;
        }
    }

    function setThumbnail(id, thumbnailBlob) {
        const draft = getDraft(id);
        if (!draft || !thumbnailBlob) return draft;
        const thumbnailUrl = URL.createObjectURL(thumbnailBlob);
        if (draft.thumbnailUrl) URL.revokeObjectURL(draft.thumbnailUrl);
        return patchDraft(id, { thumbnailBlob, thumbnailUrl });
    }

    function discardDraft(id) {
        const draft = getDraft(id);
        if (!draft || draft.publication.isPublishing) return false;
        drafts.value = drafts.value.filter(entry => entry.id !== id);
        URL.revokeObjectURL(draft.playbackUrl);
        if (draft.thumbnailUrl) URL.revokeObjectURL(draft.thumbnailUrl);
        return true;
    }

    async function publishDraft(id, { signal, onProgress, onStatus, ...details } = {}) {
        const draft = getDraft(id);
        if (!draft) throw new Error('This draft is no longer available.');
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
        const task = Promise.resolve().then(async () => {
            try {
                if (controller.signal.aborted) throw new DOMException('Video upload cancelled', 'AbortError');
                const publication = await publishVideoBlob({
                    metadata: videoDraftPublicationMetadata(draft, details),
                    blob: draft.blob, thumbnailBlob: draft.thumbnailBlob,
                    signal: controller.signal,
                    onProgress: progress => {
                        setPublication({ progress, status: `Uploading video… ${Math.round(progress * 100)}%` });
                        onProgress?.(progress);
                    },
                    onStatus: status => { setPublication({ status }); onStatus?.(status); },
                });
                setPublication({ videoId: publication.videoId, progress: 1, status: 'Published to the video gallery.' });
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
        });
        publications.set(id, { controller, promise: task });
        return task;
    }

    onScopeDispose(() => {
        for (const { controller } of publications.values()) controller.abort();
        for (const draft of drafts.value) {
            URL.revokeObjectURL(draft.playbackUrl);
            if (draft.thumbnailUrl) URL.revokeObjectURL(draft.thumbnailUrl);
        }
        drafts.value = [];
    });

    return { drafts, totalBytes, getDraft, addDraft, setThumbnail, discardDraft, publishDraft };
});
