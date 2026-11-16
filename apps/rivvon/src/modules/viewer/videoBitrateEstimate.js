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

// Export settings are a flat record of primitive values. Sort keys so callers
// can compare the same settings regardless of property insertion order.
export function getVideoPreflightKey(settings) {
    return JSON.stringify(Object.keys(settings).sort().map(key => [key, settings[key]]));
}

export function calculateVideoPreflight(sample, { settings, processingSeconds, setupSeconds = 0 }) {
    const estimate = calculateVideoBitrateEstimate(sample);
    if (!Number.isSafeInteger(sample.frames) || sample.frames <= 0
        || !Number.isSafeInteger(settings.totalFrames) || settings.totalFrames < sample.frames
        || !Number.isFinite(processingSeconds) || processingSeconds <= 0
        || !Number.isFinite(setupSeconds) || setupSeconds < 0) {
        throw new Error('The encoder did not produce a usable preflight timing sample.');
    }
    const encodingFps = sample.frames / processingSeconds;
    return { ...estimate, settingsKey: getVideoPreflightKey(settings), encodingFps, setupSeconds,
        processingSeconds, estimatedEncodingSeconds: setupSeconds + settings.totalFrames / encodingFps };
}

export function isVideoPreflightReady(preflight, settings) {
    return Boolean(preflight && preflight.settingsKey === getVideoPreflightKey(settings)
        && Number.isFinite(preflight.bitrate) && preflight.bitrate > 0
        && Number.isFinite(preflight.encodingFps) && preflight.encodingFps > 0
        && Number.isFinite(preflight.estimatedEncodingSeconds) && preflight.estimatedEncodingSeconds > 0);
}
