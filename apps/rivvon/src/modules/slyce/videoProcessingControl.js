import { useViewerStore } from '../../stores/viewerStore';

let ktx2WorkerPool = null;
let abortController = null;

export function getKtx2WorkerPool() {
    return ktx2WorkerPool;
}

export function registerKtx2WorkerPool(workerPool) {
    ktx2WorkerPool = workerPool;
    return ktx2WorkerPool;
}

export function createProcessingAbortController() {
    abortController = new AbortController();
    return abortController;
}

export function cleanupKTX2Workers() {
    if (ktx2WorkerPool) {
        console.log('[KTX2] Cleaning up worker pool');
        ktx2WorkerPool.terminate();
        ktx2WorkerPool = null;
    }
}

export function abortProcessing() {
    if (abortController) {
        console.log('[VideoProcessor] Aborting processing...');
        abortController.abort();
        abortController = null;
    }

    cleanupKTX2Workers();

    try {
        useViewerStore().resumeViewer();
    } catch (error) {
        // Store may not be initialized yet during early abort.
    }
}