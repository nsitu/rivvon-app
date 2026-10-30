import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useBackgroundLoopStore } from './backgroundLoopStore.js';
import { inspectBackgroundLoopSource, generateBackgroundLoop } from '../modules/slyce/backgroundLoop.js';
import { uploadClip } from '../services/clipService.js';
import { saveBackgroundLoopJob } from '../services/backgroundLoopStorage.js';

const mocks = vi.hoisted(() => ({ jobs: new Map(), suspend: vi.fn(), resume: vi.fn() }));
vi.mock('../modules/slyce/backgroundLoop.js', () => ({ inspectBackgroundLoopSource: vi.fn(), generateBackgroundLoop: vi.fn(), assembleBackgroundLoop: vi.fn() }));
vi.mock('../services/clipService.js', () => ({ uploadClip: vi.fn() }));
vi.mock('./viewerStore.js', () => ({ useViewerStore: () => ({ suspendViewer: mocks.suspend, resumeViewer: mocks.resume }) }));
vi.mock('../services/backgroundLoopStorage.js', () => ({
    saveBackgroundLoopJob: vi.fn(async job => { mocks.jobs.set(job.id, job); }),
    listBackgroundLoopJobs: vi.fn(async () => [...mocks.jobs.values()]),
    getBackgroundLoopJob: vi.fn(async id => mocks.jobs.get(id)),
    getBackgroundLoopBlob: vi.fn(async () => new Blob(['mp4'], { type: 'video/mp4' })),
    discardBackgroundLoop: vi.fn(async id => { mocks.jobs.delete(id); }),
}));
const source = { name: 'ocean.mov', width: 1920, height: 1080, frameCount: 2000 };
const completed = () => ({ job: { id: 'loop-1', sourceName: source.name, createdAt: 1, status: 'complete',
    plan: { size: 1920, phaseCount: 240, duration: 8, passes: 15 }, batches: Array.from({ length: 15 }, () => ({ frames: 16 })) },
blob: new Blob(['mp4'], { type: 'video/mp4' }) });
beforeEach(() => {
    setActivePinia(createPinia()); vi.clearAllMocks(); mocks.jobs.clear();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:loop'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    inspectBackgroundLoopSource.mockResolvedValue(source);
    generateBackgroundLoop.mockImplementation(async () => completed());
});

describe('background creation workflow', () => {
    it('generates a retained video using the larger default batch without changing the source', async () => {
        const store = useBackgroundLoopStore(), file = new File(['source'], 'ocean.mov');
        await store.prepare(file);
        expect(store.plan).toMatchObject({ batchSize: 16, passes: 15, phaseSurfaceBytes: 225 * 1024 * 1024 });
        expect(await store.generate()).toBe(true);
        expect(store.resultReady).toBe(true); expect(store.previewUrl).toBe('blob:loop');
        expect(mocks.suspend).toHaveBeenCalledWith(true); expect(mocks.resume).toHaveBeenCalledOnce();
        await store.prepare(file);
        expect(inspectBackgroundLoopSource).toHaveBeenCalledOnce(); expect(store.resultReady).toBe(true);
        expect(saveBackgroundLoopJob).toHaveBeenCalledWith(expect.objectContaining({ clipName: 'ocean background' }));
    });
    it('keeps the local result after an upload failure and permits a retry', async () => {
        const store = useBackgroundLoopStore(); await store.prepare(new File(['a'], 'a.mov')); await store.generate();
        uploadClip.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ id: 'clip-1', name: 'ocean background' });
        expect(await store.saveToClips()).toBe(false); expect(store.error).toBe('Offline'); expect(store.resultReady).toBe(true);
        expect(await store.saveToClips()).toBe(true); expect(store.savedClip.id).toBe('clip-1');
        expect(await store.saveToClips()).toBe(false); expect(uploadClip).toHaveBeenCalledTimes(2);
    });
    it('does not upload twice when recording a successful upload locally fails', async () => {
        const store = useBackgroundLoopStore(); await store.prepare(new File(['a'], 'a.mov')); await store.generate();
        uploadClip.mockResolvedValueOnce({ id: 'clip-1', name: 'ocean background' });
        saveBackgroundLoopJob.mockRejectedValueOnce(new Error('Storage full'));
        expect(await store.saveToClips()).toBe(false); expect(store.savedClip.id).toBe('clip-1');
        await store.saveToClips(); expect(uploadClip).toHaveBeenCalledOnce();
    });
    it('ignores metadata from a replaced source even when the earlier read finishes late', async () => {
        let finish;
        inspectBackgroundLoopSource.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const store = useBackgroundLoopStore();
        const old = store.prepare(new File(['old'], 'old.mov'));
        await store.prepare(new File(['new'], 'new.mov'));
        finish({ ...source, name: 'old.mov', width: 640 }); await old;
        expect(store.source.name).toBe('ocean.mov'); expect(store.size).toBe(1920); expect(store.error).toBe('');
    });
    it('does not attach a late upload response to a newly selected source', async () => {
        const store = useBackgroundLoopStore(); await store.prepare(new File(['a'], 'a.mov')); await store.generate();
        let finish;
        uploadClip.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const upload = store.saveToClips();
        await store.prepare(new File(['b'], 'b.mov'));
        finish({ id: 'old-clip', name: 'Old clip' }); await upload;
        expect(store.savedClip).toBeNull(); expect(store.job).toBeNull(); expect(store.resultReady).toBe(false);
    });
    it('cancels generation while preserving committed batches and releasing the viewer', async () => {
        const store = useBackgroundLoopStore(); await store.prepare(new File(['a'], 'a.mov'));
        const partial = { ...completed().job, status: 'sampling', batches: [{ frames: 16 }] };
        mocks.jobs.set(partial.id, partial);
        generateBackgroundLoop.mockImplementationOnce((_source, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(Object.assign(new DOMException('cancel', 'AbortError'), { backgroundLoopJobId: partial.id })));
        }));
        const pending = store.generate(); store.cancel(); await pending;
        expect(store.busy).toBe(false); expect(store.resultReady).toBe(false); expect(store.job.batches).toHaveLength(1);
        expect(store.source).toBe(source); expect(mocks.resume).toHaveBeenCalledOnce();
    });
});
