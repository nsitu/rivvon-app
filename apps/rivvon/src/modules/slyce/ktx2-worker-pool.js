/**
 * KTX2 Worker Pool
 * Manages multiple workers to encode KTX2 frames in parallel
 */
const ENCODE_FRAME_TIMEOUT_MS = 60_000;

export class KTX2WorkerPool {
    constructor(workerCount = navigator.hardwareConcurrency || 4) {
        this.workerCount = workerCount;
        this.workers = [];
        this.availableWorkers = [];
        this.taskQueue = [];
        this.pendingTasks = new Set();
        this.poolError = null;
        this.initialized = false;

        console.log(`[KTX2 Worker Pool] Creating pool with ${workerCount} workers`);
    }

    /**
     * Initialize the worker pool
     */
    async init() {
        if (this.initialized) {
            return;
        }

        this.poolError = null;

        // Create worker pool
        for (let i = 0; i < this.workerCount; i++) {
            const worker = new Worker(
                new URL('../../workers/ktx2EncoderWorker.js', import.meta.url),
                { type: 'module' }
            );

            const workerSlot = {
                id: i,
                worker,
                busy: false,
                currentTask: null
            };

            this.workers.push(workerSlot);
            this.availableWorkers.push(workerSlot);
        }

        this.initialized = true;
        console.log(`[KTX2 Worker Pool] Pool initialized with ${this.workerCount} workers`);
    }

    /**
     * Get an available worker, or wait for one to become available
     */
    async getAvailableWorker() {
        if (this.poolError) {
            throw this.poolError;
        }

        // If worker is available, return it immediately
        if (this.availableWorkers.length > 0) {
            return this.availableWorkers.shift();
        }

        // Otherwise, wait for a worker to become available
        return new Promise((resolve, reject) => {
            this.taskQueue.push({ resolve, reject });
        });
    }

    /**
     * Mark worker as available and process queue
     */
    releaseWorker(workerSlot) {
        workerSlot.busy = false;
        workerSlot.currentTask = null;

        if (this.poolError) {
            return;
        }

        // If there are queued tasks, assign this worker to the next task
        if (this.taskQueue.length > 0) {
            const waiter = this.taskQueue.shift();
            waiter.resolve(workerSlot);
        } else {
            // Otherwise, add to available pool
            this.availableWorkers.push(workerSlot);
        }
    }

    /**
     * Encode a single frame
     */
    async encodeFrame(rgba, width, height, frameIndex) {
        const workerSlot = await this.getAvailableWorker();
        workerSlot.busy = true;

        return new Promise((resolve, reject) => {
            let settled = false;
            let timeoutId = null;

            const cleanup = () => {
                if (timeoutId !== null) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                workerSlot.worker.removeEventListener('message', handleMessage);
                workerSlot.worker.removeEventListener('error', handleWorkerError);
                workerSlot.worker.removeEventListener('messageerror', handleWorkerError);
                this.pendingTasks.delete(task);
            };

            const resolveTask = (data) => {
                if (settled) return;
                settled = true;
                cleanup();
                this.releaseWorker(workerSlot);
                resolve(data);
            };

            const rejectTask = (error) => {
                if (settled) return;
                settled = true;
                cleanup();
                this.releaseWorker(workerSlot);
                reject(error);
            };

            const handleMessage = (e) => {
                const { type, data, error } = e.data;

                if (type === 'FRAME_DONE' && data?.frameIndex === frameIndex) {
                    resolveTask(data);
                } else if (type === 'ERROR' && e.data.frameIndex === frameIndex) {
                    rejectTask(new Error(error || `KTX2 worker failed on frame ${frameIndex}.`));
                }
            };

            const handleWorkerError = (event) => {
                const message = event?.message || `KTX2 worker failed on frame ${frameIndex}.`;
                this.fail(new Error(message));
            };

            const task = { cleanup, reject: rejectTask };
            this.pendingTasks.add(task);

            workerSlot.worker.addEventListener('message', handleMessage);
            workerSlot.worker.addEventListener('error', handleWorkerError);
            workerSlot.worker.addEventListener('messageerror', handleWorkerError);
            timeoutId = setTimeout(() => {
                this.fail(new Error(`KTX2 worker timed out while encoding frame ${frameIndex}.`));
            }, ENCODE_FRAME_TIMEOUT_MS);

            try {
                // Send encoding task to worker
                workerSlot.worker.postMessage({
                    type: 'ENCODE_FRAME',
                    data: {
                        rgba,
                        width,
                        height,
                        frameIndex
                    }
                }, [rgba.buffer]);
            } catch (error) {
                rejectTask(error);
            }
        });
    }

    /**
     * Reject all work if a worker dies. Leaving any of these promises pending
     * would deadlock the tile backpressure queue and make processing appear to
     * stop during a later tile.
     */
    fail(error) {
        if (this.poolError) {
            return;
        }

        this.poolError = error;
        console.error('[KTX2 Worker Pool] Worker pool failed:', error);

        const waiters = this.taskQueue.splice(0);
        for (const waiter of waiters) {
            waiter.reject(error);
        }

        const pendingTasks = [...this.pendingTasks];
        for (const task of pendingTasks) {
            task.reject(error);
        }

        for (const workerSlot of this.workers) {
            workerSlot.worker.terminate();
        }

        this.workers = [];
        this.availableWorkers = [];
    }

    /**
     * Encode all frames in parallel
     * @param {Array} frames - Array of {rgba, width, height} objects
     * @param {Function} onProgress - Progress callback (frameIndex, totalFrames, encodedData)
     * @returns {Promise<Array>} Array of encoded KTX2 buffers in order
     */
    async encodeAllFrames(frames, onProgress) {
        // Ensure pool is initialized
        if (!this.initialized) {
            await this.init();
        }

        console.log(`[KTX2 Worker Pool] Encoding ${frames.length} frames across ${this.workerCount} workers`);
        const startTime = performance.now();

        // Create array to store results in correct order
        const results = new Array(frames.length);
        let completedCount = 0;
        let totalWorkerElapsed = 0;
        let maxWorkerElapsed = 0;
        let totalEncodedBytes = 0;

        // Encode all frames in parallel
        const promises = frames.map((frame, index) =>
            this.encodeFrame(frame.rgba, frame.width, frame.height, index)
                .then(data => {
                    results[index] = data;
                    completedCount++;
                    totalWorkerElapsed += data.elapsed || 0;
                    maxWorkerElapsed = Math.max(maxWorkerElapsed, data.elapsed || 0);
                    totalEncodedBytes += data.size || 0;

                    if (onProgress) {
                        onProgress(completedCount, frames.length, data);
                    }

                    return data;
                })
        );

        await Promise.all(promises);

        const elapsed = performance.now() - startTime;
        const wallAvgTime = elapsed / frames.length;
        const workerAvgTime = totalWorkerElapsed / frames.length;
        const totalEncodedMiB = totalEncodedBytes / (1024 * 1024);
        console.log(
            `[KTX2 Worker Pool] Encoded ${frames.length} frames in ${elapsed.toFixed(1)}ms ` +
            `(wall avg ${wallAvgTime.toFixed(1)}ms/frame, worker avg ${workerAvgTime.toFixed(1)}ms/frame, ` +
            `slowest worker frame ${maxWorkerElapsed.toFixed(1)}ms, output ${totalEncodedMiB.toFixed(1)} MiB)`
        );

        return results;
    }

    /**
     * Terminate all workers and clean up
     */
    terminate() {
        console.log('[KTX2 Worker Pool] Terminating all workers');

        const abortError = new DOMException('KTX2 worker pool terminated.', 'AbortError');
        const waiters = this.taskQueue.splice(0);
        for (const waiter of waiters) {
            waiter.reject(abortError);
        }

        const pendingTasks = [...this.pendingTasks];
        for (const task of pendingTasks) {
            task.reject(abortError);
        }

        for (const workerSlot of this.workers) {
            workerSlot.worker.terminate();
        }
        this.workers = [];
        this.availableWorkers = [];
        this.pendingTasks.clear();
        this.poolError = abortError;
        this.initialized = false;
    }
}
