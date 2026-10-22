export class Ktx2TranscodeWorkerClient {
    constructor() {
        this.worker = new Worker(
            new URL('../../workers/ktx2TranscodeWorker.js', import.meta.url),
            { type: 'module' }
        );
        this.pendingRequests = new Map();
        this.nextRequestId = 1;

        this.worker.addEventListener('error', (event) => {
            this.rejectPending(new Error(event.message || 'KTX2 decoder worker failed'));
        });
        this.worker.addEventListener('messageerror', () => {
            this.rejectPending(new Error('Unable to read KTX2 decoder response'));
        });

        this.worker.addEventListener('message', (event) => {
            const { type, requestId, data, error } = event.data;
            const pending = this.pendingRequests.get(requestId);
            if (!pending) return;

            this.pendingRequests.delete(requestId);

            if (type === 'ERROR') {
                const workerError = new Error(error?.message || 'Unknown KTX2 transcode worker error');
                if (error?.stack) workerError.stack = error.stack;
                workerError.name = error?.name || 'Error';
                pending.reject(workerError);
                return;
            }

            pending.resolve(data);
        });
    }

    request(type, data, transfer = []) {
        const requestId = this.nextRequestId++;

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(requestId, { resolve, reject });
            try {
                this.worker.postMessage({ type, requestId, data }, transfer);
            } catch (error) {
                this.pendingRequests.delete(requestId);
                reject(error);
            }
        });
    }

    openFile(jobId, buffer) {
        return this.request('OPEN_FILE', { jobId, buffer }, [buffer]);
    }

    decodeLayer(jobId, layerIndex, mipLevel = 0) {
        return this.request('DECODE_LAYER', { jobId, layerIndex, mipLevel });
    }

    closeFile(jobId) {
        return this.request('CLOSE_FILE', { jobId });
    }

    rejectPending(error) {
        for (const pending of this.pendingRequests.values()) pending.reject(error);
        this.pendingRequests.clear();
    }

    terminate() {
        this.worker.terminate();
        this.rejectPending(new Error('KTX2 decoder stopped'));
    }
}
