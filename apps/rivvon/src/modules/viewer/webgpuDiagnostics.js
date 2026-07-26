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
export function createWebGPUDiagnostics(renderer, selectedAdapter = null, selectedDevice = null) {
    const backend = renderer?.backend ?? null;
    const adapter = selectedAdapter ?? backend?.adapter ?? null;
    const device = selectedDevice ?? backend?.device ?? null;
    const features = Array.from(adapter?.features ?? device?.features ?? []).sort();
    const adapterInfo = entriesToObject(adapter?.info);
    const limits = entriesToObject(adapter?.limits ?? device?.limits);
    const adapterVendor = adapterInfo.vendor || 'unknown';
    const adapterArchitecture = adapterInfo.architecture || 'unknown';
    const inferredAdapterDescription = [adapterVendor, adapterArchitecture]
        .filter(value => value !== 'unknown')
        .join(' ');

    const snapshot = {
        available: !!device,
        deviceInjectionVerified: !!selectedDevice && backend?.device === selectedDevice,
        backend: 'not exposed by WebGPU',
        adapterDescription: adapterInfo.description
            || adapterInfo.device
            || inferredAdapterDescription
            || 'unknown adapter',
        adapterVendor,
        adapterArchitecture,
        timestampQuerySupported: features.includes('timestamp-query'),
        timestampTrackingEnabled: backend?.trackTimestamp === true,
        features,
        limits,
        queuePending: false,
        queueDrainMs: null,
        queueDrainMaxMs: 0,
        queueSampleError: null,
        lastQueueSampleAt: 0,
        timestampPending: false,
        gpuPassMs: null,
        gpuPassMaxMs: 0,
        timestampSampleError: null,
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

        // Three inserts timestamp writes around its render passes when the
        // feature is available. Resolving through the backend preserves
        // Three's query-pool ownership and reports GPU execution time in ms.
        if (
            snapshot.timestampQuerySupported
            && snapshot.timestampTrackingEnabled
            && !snapshot.timestampPending
            && typeof backend?.resolveTimestampsAsync === 'function'
        ) {
            snapshot.timestampPending = true;
            backend.resolveTimestampsAsync('render')
                .then((durationMs) => {
                    if (Number.isFinite(durationMs) && durationMs >= 0) {
                        snapshot.gpuPassMs = durationMs;
                        snapshot.gpuPassMaxMs = Math.max(snapshot.gpuPassMaxMs, durationMs);
                        snapshot.timestampSampleError = null;
                    } else if (durationMs !== undefined) {
                        snapshot.timestampSampleError = `Invalid timestamp result: ${durationMs}`;
                    }
                })
                .catch((error) => {
                    snapshot.timestampSampleError = error?.message || String(error);
                })
                .finally(() => {
                    snapshot.timestampPending = false;
                });
        }
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
