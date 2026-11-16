// Keep animation timing based on the full export, but encode only its prefix.
export function getVideoRenderFrameCount(totalFrames, fps, measurementOnly = false) {
    return measurementOnly ? Math.min(totalFrames, Math.max(1, Math.ceil(fps * 2))) : totalFrames;
}

export function calculateVideoBitrateEstimate(sample) {
    if (!sample?.measurementOnly || !Number.isSafeInteger(sample.size) || sample.size <= 0
        || !Number.isFinite(sample.duration) || sample.duration <= 0) {
        throw new Error('The encoder did not produce a usable bitrate sample.');
    }
    return { bitrate: sample.size * 8 / sample.duration, sampleDuration: sample.duration, sampleFrames: sample.frames };
}
