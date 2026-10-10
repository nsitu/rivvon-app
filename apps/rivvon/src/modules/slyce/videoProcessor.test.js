import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSlyceStore } from '../../stores/slyceStore.js';
import { processVideo } from './videoProcessor.js';
import { abortProcessing } from './videoProcessingControl.js';
import { runSamplingPipeline } from './samplingPipeline.js';
import { KTX2Assembler } from './ktx2-assembler.js';

vi.mock('../../stores/viewerStore', () => ({ useViewerStore: () => ({ suspendViewer() {}, resumeViewer() {} }) }));
vi.mock('./resourceMonitor.js', () => ({ resourceUsageReport: vi.fn() }));
vi.mock('./samplingPipeline.js', () => ({ runSamplingPipeline: vi.fn() }));
vi.mock('./samplingSources.js', () => ({ VideoFileFrameSource: class { constructor(options) { Object.assign(this, options); } } }));
vi.mock('./ktx2-assembler.js', () => ({ KTX2Assembler: { encodeParallelWithPool: vi.fn() } }));
vi.mock('./ktx2-worker-pool.js', () => ({ KTX2WorkerPool: class { async init() {} terminate() {} } }));

const settings = { tilePlan: { width: 256, height: 256, tiles: [{ start: 1, end: 10 }, { start: 11, end: 20 }] },
    fileInfo: { width: 256, height: 256 }, tileBuilderBackend: 'canvas' };

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

beforeEach(() => {
    setActivePinia(createPinia());
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:encoded');
});
afterEach(() => {
    abortProcessing();
    vi.restoreAllMocks();
    vi.resetAllMocks();
});

describe('video processing cancellation', () => {
    it('ignores late errors and callbacks from the previous video', async () => {
        const firstExit = deferred();
        const nextExit = deferred();
        let first;
        runSamplingPipeline.mockImplementationOnce(options => { first = options; return firstExit.promise; })
            .mockImplementationOnce(() => nextExit.promise);
        const store = useSlyceStore();
        const firstRun = processVideo(settings);
        store.resetForNewFileSelection();
        const nextRun = processVideo(settings);
        const nextPreview = { snapshot: vi.fn(), bake: vi.fn(), dispose: vi.fn() };
        store.tileSnapshotPreview = nextPreview;
        const status = { ...store.status };
        const progress = JSON.parse(JSON.stringify(store.processingProgress));
        const error = new DOMException('Video processing aborted.', 'AbortError');

        first.onError(error);
        first.source.onSeekProgress(5);
        first.source.onPreparationStatus('Old video');
        first.source.onInterpolationStatus('Old interpolation');
        await first.onItemProcessed({ builderKey: 0, builder: { getCurrentPreviewCanvas: () => ({}) } });
        await first.onTileComplete({ builderKey: 0, builder: {}, payload: {} });
        firstExit.reject(error);
        expect(await firstRun).toBe(false);

        expect(store.status).toEqual(status);
        expect(store.processingProgress).toEqual(progress);
        expect(store.readerIsFinished).toBe(false);
        expect(nextPreview.snapshot).not.toHaveBeenCalled();
        expect(nextPreview.bake).not.toHaveBeenCalled();
        store.resetProcessing();
        nextExit.resolve();
        expect(await nextRun).toBe(false);
        expect(store.status).toEqual({});
    });

    it('discards encoder results and progress that arrive after a new run starts', async () => {
        const firstExit = deferred();
        const nextExit = deferred();
        const encode = deferred();
        const encodingStarted = deferred();
        let first;
        let onProgress;
        runSamplingPipeline.mockImplementationOnce(options => { first = options; return firstExit.promise; })
            .mockImplementationOnce(() => nextExit.promise);
        KTX2Assembler.encodeParallelWithPool.mockImplementation((pool, images, progress) => {
            onProgress = progress;
            encodingStarted.resolve();
            return encode.promise;
        });
        const store = useSlyceStore();
        const firstRun = processVideo(settings);
        const builder = { dispose: vi.fn() };
        // Use tile 1 to exercise encoding without requiring thumbnail canvas APIs.
        const tileComplete = first.onTileComplete({ builderKey: 1, builder,
            payload: { readImages: async () => [{ rgba: new Uint8Array(4), width: 1, height: 1 }] } });
        await encodingStarted.promise;
        const nextRun = processVideo(settings);
        const status = { ...store.status };
        onProgress(1, 1);
        encode.resolve(new Uint8Array([1]));
        await tileComplete;
        firstExit.resolve();
        expect(await firstRun).toBe(false);

        expect(store.status).toEqual(status);
        expect(store.ktx2BlobURLs).toEqual({});
        expect(URL.createObjectURL).not.toHaveBeenCalled();
        expect(store.processingPhaseSummary).toBeNull();
        expect(builder.dispose).toHaveBeenCalled();
        store.resetProcessing();
        nextExit.resolve();
        await nextRun;
    });

    it('still reports an actual decoding failure', async () => {
        const error = new Error('Unable to decode video.');
        runSamplingPipeline.mockImplementation(async options => { options.onError(error); throw error; });
        expect(await processVideo(settings)).toBe(false);
        expect(useSlyceStore().status['Processing Error']).toBe(error.message);
    });
});
