// Keep encoder phases and frame-loop metrics in one status message. The numeric
// callback retains the existing 95% frame / 5% finalization progress contract.
export function createVideoExportProgress({ totalFrames, onProgress, onStatus }) {
    let completedFrames = 0;
    let encodedFrames = null;
    let progress = 0;
    let startedAt = null;
    let encoderPhase = 'Rendering and encoding…';

    const publish = (phase) => {
        const seconds = startedAt === null ? 0 : (performance.now() - startedAt) / 1000;
        // Average export throughput, including batch encoding, rather than the
        // playback frame rate selected in the export settings.
        const fps = seconds > 0 ? completedFrames / seconds : 0;
        onStatus?.(`${phase} · ${Math.round(progress * 100)}% · Frames ${completedFrames}/${totalFrames} · ${fps.toFixed(1)} fps`);
    };
    const status = (phase, details) => {
        encoderPhase = phase;
        if (Number.isFinite(details?.encodedFrames)) {
            encodedFrames = details.encodedFrames;
            completedFrames = encodedFrames;
            progress = 0.95 * completedFrames / totalFrames;
            onProgress?.(progress);
        }
        publish(phase);
    };

    return {
        status,
        start() {
            startedAt = performance.now();
            encoderPhase = 'Rendering and encoding…';
            publish(encoderPhase);
        },
        frameComplete(frameCount) {
            // A concurrent WASM pool reports actual encoded completions. Frames
            // handed to its queue must not advance progress ahead of encoding.
            completedFrames = encodedFrames ?? frameCount;
            progress = 0.95 * completedFrames / totalFrames;
            onProgress?.(progress);
            publish(encodedFrames === null ? 'Rendering and encoding…' : encoderPhase);
        },
        complete() {
            progress = 1;
            onProgress?.(1);
            status('Export complete.');
        },
    };
}
