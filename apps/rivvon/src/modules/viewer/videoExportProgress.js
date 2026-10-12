// Keep encoder phases and frame-loop metrics in one status message. The numeric
// callback retains the existing 95% frame / 5% finalization progress contract.
export function createVideoExportProgress({ totalFrames, onProgress, onStatus }) {
    let completedFrames = 0;
    let progress = 0;
    let startedAt = null;

    const status = (phase) => {
        const seconds = startedAt === null ? 0 : (performance.now() - startedAt) / 1000;
        // Average export throughput, including batch encoding, rather than the
        // playback frame rate selected in the export settings.
        const fps = seconds > 0 ? completedFrames / seconds : 0;
        onStatus?.(`${phase} · ${Math.round(progress * 100)}% · Frames ${completedFrames}/${totalFrames} · ${fps.toFixed(1)} fps`);
    };

    return {
        status,
        start() {
            startedAt = performance.now();
            status('Rendering and encoding…');
        },
        frameComplete(frameCount) {
            completedFrames = frameCount;
            progress = 0.95 * completedFrames / totalFrames;
            onProgress?.(progress);
            status('Rendering and encoding…');
        },
        complete() {
            progress = 1;
            onProgress?.(1);
            status('Export complete.');
        },
    };
}
