import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { inspectBackgroundLoopSource, generateBackgroundLoop, assembleBackgroundLoop } from '../modules/slyce/backgroundLoop.js';
import { planBackgroundLoop } from '../modules/slyce/backgroundLoopPlan.js';
import { listBackgroundLoopJobs, getBackgroundLoopJob, getBackgroundLoopBlob,
    discardBackgroundLoop, saveBackgroundLoopJob } from '../services/backgroundLoopStorage.js';
import { uploadClip } from '../services/clipService.js';
import { useViewerStore } from './viewerStore.js';

export const useBackgroundLoopStore = defineStore('background-loop', () => {
    const source = shallowRef(null), job = shallowRef(null), blob = shallowRef(null);
    const size = ref(1920), duration = ref(8), sourceStartFrame = ref(1), name = ref('');
    const operation = ref(null), error = ref(''), status = ref(''), progress = ref(0), previewUrl = ref('');
    const jobs = ref([]), savedClip = shallowRef(null);
    let controller = null, selectedFile = null;
    const busy = computed(() => Boolean(operation.value));
    const generating = computed(() => ['generating', 'assembling'].includes(operation.value));
    const saving = computed(() => operation.value === 'saving');
    const resultReady = computed(() => Boolean(blob.value && job.value?.status === 'complete'));
    const canAssemble = computed(() => job.value && job.value.batches.reduce((n, batch) => n + batch.frames, 0) === job.value.plan.phaseCount);
    const limits = computed(() => {
        if (!source.value) return null;
        try { return planBackgroundLoop(source.value, { sourceStartFrame: sourceStartFrame.value }); }
        catch { return null; }
    });
    const planError = computed(() => {
        if (!source.value) return 'Choose a video source to generate a background.';
        try { planBackgroundLoop(source.value, settings()); return ''; }
        catch (failure) { return failure.message; }
    });
    const plan = computed(() => !planError.value ? planBackgroundLoop(source.value, settings()) : null);
    function settings() { return { size: size.value, duration: duration.value, sourceStartFrame: sourceStartFrame.value }; }
    function cancel() { controller?.abort(); }
    function clearPreview() {
        if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
        previewUrl.value = ''; blob.value = null; savedClip.value = null;
    }
    async function refreshJobs() { jobs.value = (await listBackgroundLoopJobs()).sort((a, b) => b.createdAt - a.createdAt); }
    async function run(kind, action) {
        const active = new AbortController();
        controller?.abort(); controller = active;
        operation.value = kind; error.value = ''; progress.value = 0;
        const viewer = kind === 'generating' ? useViewerStore() : null;
        viewer?.suspendViewer(true);
        try {
            await action(active.signal);
            return !active.signal.aborted;
        } catch (failure) {
            if (controller === active) {
                error.value = failure.name === 'AbortError' ? 'Cancelled. Completed work is retained on this device.' : failure.message;
                if (failure.backgroundLoopJobId) {
                    try { job.value = await getBackgroundLoopJob(failure.backgroundLoopJobId); }
                    catch { /* The original operation error remains visible when storage is unavailable. */ }
                }
            }
            return false;
        } finally {
            viewer?.resumeViewer();
            if (controller === active) {
                controller = null; operation.value = null;
                try { await refreshJobs(); } catch (failure) { error.value ||= failure.message; }
            }
        }
    }
    async function prepare(file) {
        if (file === selectedFile && source.value) return;
        selectedFile = file; source.value = null; job.value = null;
        clearPreview();
        if (!file) { cancel(); return; }
        await run('preparing', async signal => {
            status.value = 'Reading video source…';
            const next = await inspectBackgroundLoopSource(file, { signal });
            const defaults = planBackgroundLoop(next);
            signal.throwIfAborted();
            source.value = next; size.value = Math.min(1920, defaults.maxSize);
            duration.value = defaults.duration; sourceStartFrame.value = 1;
            name.value = `${next.name.replace(/\.[^.]+$/, '')} background`.slice(0, 120);
            status.value = '';
        });
    }
    function update(event) {
        const total = event.total, batch = plan.value?.batchSize ?? 1;
        const first = event.offset + 1, last = Math.min(total, event.offset + batch);
        if (event.phase === 'assembling') {
            status.value = 'Finishing background video…'; progress.value = Math.round(90 + 10 * event.offset / total);
        } else {
            status.value = `Generating video frames ${first}–${last} of ${total}…`;
            const fraction = event.phase === 'encoding' ? .8 : .7 * (event.sourceFrame ?? 0) / (plan.value?.sourceFrames ?? 1);
            progress.value = Math.round(90 * (event.offset + fraction * batch) / total);
        }
    }
    function useResult(result) {
        clearPreview(); job.value = result.job; blob.value = result.blob;
        previewUrl.value = URL.createObjectURL(result.blob);
        savedClip.value = result.job.savedClip ?? null;
        name.value = result.job.clipName || `${(result.job.sourceName || 'Sampled').replace(/\.[^.]+$/, '')} background`.slice(0, 120);
        progress.value = 100; status.value = 'Background video is ready. Saved on this device.';
    }
    async function generate() {
        if (busy.value || !plan.value) return false;
        return run('generating', async signal => {
            clearPreview(); job.value = null;
            const clipName = name.value.trim() || 'Sampled background';
            const result = await generateBackgroundLoop(source.value, { ...settings(), signal, onProgress: update });
            result.job.clipName = clipName;
            await saveBackgroundLoopJob(result.job);
            signal.throwIfAborted(); useResult(result);
        });
    }
    async function showJob(id) {
        if (busy.value) return false;
        return run('loading', async signal => {
            const stored = await getBackgroundLoopJob(id);
            if (!stored) throw new Error('This background video is no longer on this device.');
            const file = stored.status === 'complete' ? await getBackgroundLoopBlob(id) : null;
            signal.throwIfAborted(); clearPreview(); job.value = stored;
            if (file) useResult({ job: stored, blob: file });
        });
    }
    async function reassemble(id = job.value?.id) {
        if (busy.value || !id) return false;
        return run('assembling', async signal => {
            const result = await assembleBackgroundLoop(id, { signal, onProgress: update });
            signal.throwIfAborted(); useResult(result);
        });
    }
    async function saveToClips(ownerId = null) {
        if (busy.value || !resultReady.value || (savedClip.value && (job.value.savedClipOwnerId ?? null) === ownerId) || !name.value.trim()) return false;
        return run('saving', async signal => {
            const originalJob = job.value, clipName = name.value.trim();
            const clip = await uploadClip(new File([blob.value], `${clipName.replace(/[/\\]/g, '-')}.mp4`, { type: 'video/mp4' }), {
                signal, onStatus: value => { status.value = value; }, onProgress: value => { progress.value = Math.round(value * 100); },
            });
            signal.throwIfAborted();
            savedClip.value = clip;
            job.value = { ...originalJob, savedClip: clip, savedClipOwnerId: ownerId, clipName };
            status.value = `Saved to Clips: ${clip.name}`;
            // Keep the successful upload in state even if updating the local record fails.
            await saveBackgroundLoopJob(job.value);
        });
    }
    async function discard(id) {
        if (busy.value) return false;
        return run('discarding', async () => {
            await discardBackgroundLoop(id);
            if (job.value?.id === id) { clearPreview(); job.value = null; status.value = ''; }
        });
    }
    return { source, size, duration, sourceStartFrame, name, job, blob, jobs, savedClip, operation, busy, generating, saving,
        resultReady, canAssemble, limits, planError, plan, error, status, progress, previewUrl,
        prepare, generate, cancel, showJob, reassemble, saveToClips, discard, refreshJobs };
});
