/**
 * KTX2 Worker Pool
 * Manages multiple workers to encode KTX2 frames in parallel
 */
export class KTX2WorkerPool {
    constructor(workerCount = navigator.hardwareConcurrency || 4) {
        this.workerCount = workerCount;
        this.workers = [];
        this.availableWorkers = [];
        this.taskQueue = [];
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

        // Create worker pool
        for (let i = 0; i < this.workerCount; i++) {
            const worker = new Worker(
                new URL('../workers/ktx2EncoderWorker.js', import.meta.url),
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
        // If worker is available, return it immediately
        if (this.availableWorkers.length > 0) {
            return this.availableWorkers.shift();
        }

        // Otherwise, wait for a worker to become available
        return new Promise((resolve) => {
            this.taskQueue.push(resolve);
        });
    }

    /**
     * Mark worker as available and process queue
     */
    releaseWorker(workerSlot) {
        workerSlot.busy = false;
        workerSlot.currentTask = null;

        // If there are queued tasks, assign this worker to the next task
        if (this.taskQueue.length > 0) {
            const resolve = this.taskQueue.shift();
            resolve(workerSlot);
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
            const handleMessage = (e) => {
                const { type, data, error } = e.data;

                if (type === 'FRAME_DONE' && data.frameIndex === frameIndex) {
                    workerSlot.worker.removeEventListener('message', handleMessage);
                    this.releaseWorker(workerSlot);
                    resolve(data);
                } else if (type === 'ERROR' && e.data.frameIndex === frameIndex) {
                    workerSlot.worker.removeEventListener('message', handleMessage);
                    this.releaseWorker(workerSlot);
                    reject(new Error(error));
                }
            };

            workerSlot.worker.addEventListener('message', handleMessage);

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
        });
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

        // Encode all frames in parallel
        const promises = frames.map((frame, index) =>
            this.encodeFrame(frame.rgba, frame.width, frame.height, index)
                .then(data => {
                    results[index] = data;
                    completedCount++;

                    if (onProgress) {
                        onProgress(completedCount, frames.length, data);
                    }

                    return data;
                })
        );

        await Promise.all(promises);

        const elapsed = performance.now() - startTime;
        const avgTime = elapsed / frames.length;
        console.log(`[KTX2 Worker Pool] Encoded ${frames.length} frames in ${elapsed.toFixed(1)}ms (avg ${avgTime.toFixed(1)}ms/frame)`);

        return results;
    }

    /**
     * Terminate all workers and clean up
     */
    terminate() {
        console.log('[KTX2 Worker Pool] Terminating all workers');
        for (const workerSlot of this.workers) {
            workerSlot.worker.terminate();
        }
        this.workers = [];
        this.availableWorkers = [];
        this.taskQueue = [];
        this.initialized = false;
    }
}
