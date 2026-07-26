const QUEUE_SAMPLE_INTERVAL_MS = 1000;

function entriesToObject(source) {
    if (!source) return {};

    const result = {};
    for (const key in source) {
        const value = source[key];
        if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Lightweight WebGPU diagnostics for the technical overlay. WebGPU does not
 * expose Dawn's selected native backend (Vulkan, Metal, OpenGLES compatibility,
 * etc.), so chrome://gpu is still the authority for compatibility mode.
 */
export function createWebGPUDiagnostics(renderer) {
    const backend = renderer?.backend ?? null;
    const adapter = backend?.adapter ?? null;
    const device = backend?.device ?? null;
    const features = Array.from(adapter?.features ?? device?.features ?? []).sort();
    const adapterInfo = entriesToObject(adapter?.info);
    const limits = entriesToObject(adapter?.limits ?? device?.limits);

    const snapshot = {
        available: !!device,
        backend: 'not exposed by WebGPU',
        adapterDescription: adapterInfo.description || adapterInfo.device || 'unknown adapter',
        adapterVendor: adapterInfo.vendor || 'unknown',
        adapterArchitecture: adapterInfo.architecture || 'unknown',
        timestampQuerySupported: features.includes('timestamp-query'),
        features,
        limits,
        queuePending: false,
        queueDrainMs: null,
        queueDrainMaxMs: 0,
        queueSampleError: null,
        lastQueueSampleAt: 0,
    };

    function sampleQueue(now = performance.now()) {
        const queue = device?.queue;
        if (
            !queue?.onSubmittedWorkDone
            || snapshot.queuePending
            || now - snapshot.lastQueueSampleAt < QUEUE_SAMPLE_INTERVAL_MS
        ) {
            return;
        }

        snapshot.queuePending = true;
        snapshot.lastQueueSampleAt = now;
        const startedAt = performance.now();

        queue.onSubmittedWorkDone()
            .then(() => {
                const elapsed = performance.now() - startedAt;
                snapshot.queueDrainMs = elapsed;
                snapshot.queueDrainMaxMs = Math.max(snapshot.queueDrainMaxMs, elapsed);
                snapshot.queueSampleError = null;
            })
            .catch((error) => {
                snapshot.queueSampleError = error?.message || String(error);
            })
            .finally(() => {
                snapshot.queuePending = false;
            });
    }

    function getSnapshot() {
        const canvas = renderer?.domElement;
        return {
            ...snapshot,
            canvasWidth: canvas?.width || 0,
            canvasHeight: canvas?.height || 0,
            pixelRatio: renderer?.getPixelRatio?.() ?? window.devicePixelRatio ?? 1,
        };
    }

    console.info('[WebGPU Diagnostics]', getSnapshot());
    return { sampleQueue, getSnapshot };
}
