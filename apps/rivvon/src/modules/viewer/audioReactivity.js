export const VIEWER_AUDIO_KEY = Symbol('viewer-audio');

export function clampAudioValue(value, min, max, fallback = min) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

// Average energies, rather than waveforms, so opposite-phase stereo cannot cancel.
export function getAudioRms(channels) {
    let energy = 0;
    let count = 0;
    for (const samples of channels) {
        for (const sample of samples) {
            if (!Number.isFinite(sample)) continue;
            energy += sample * sample;
            count += 1;
        }
    }
    return count ? Math.sqrt(energy / count) : 0;
}

export function getAmplitudeTarget(rms, sensitivity = 3, noiseFloor = 0.005) {
    return clampAudioValue(
        Math.max(0, rms - noiseFloor) * clampAudioValue(sensitivity, 0.5, 12, 3),
        0, 1,
    );
}

export function smoothAudioAmplitude(previous, target, deltaSeconds) {
    const from = clampAudioValue(previous, 0, 1);
    const to = clampAudioValue(target, 0, 1);
    const delta = clampAudioValue(deltaSeconds, 0, 1);
    const timeConstant = to > from ? 0.03 : 0.2;
    return from + (to - from) * (1 - Math.exp(-delta / timeConstant));
}

// A render-only modifier: navigation, camera authoring and recordings see base state.
export function renderWithAudioZoom(camera, amplitude, amount, render) {
    if (!camera || !amplitude || !amount) return render();
    const baseZoom = camera.zoom;
    camera.zoom = baseZoom * (
        1 + clampAudioValue(amount, 0, 0.5) * clampAudioValue(amplitude, 0, 1)
    );
    try {
        camera.updateProjectionMatrix();
        return render();
    } finally {
        camera.zoom = baseZoom;
        camera.updateProjectionMatrix();
    }
}
