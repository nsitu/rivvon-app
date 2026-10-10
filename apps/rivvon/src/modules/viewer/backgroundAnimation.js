import { getSeamlessLoopDuration, normalizeMotionLoopDurationMultiplier } from './seamlessLoop.js';

export const DEFAULT_BACKGROUND_CYCLE_DURATION = 12;
export const MIN_BACKGROUND_CYCLE_DURATION = 0.25;
export const MAX_BACKGROUND_CYCLE_DURATION = 120;

export function normalizeBackgroundCycleDuration(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed)
        ? Math.max(MIN_BACKGROUND_CYCLE_DURATION, Math.min(MAX_BACKGROUND_CYCLE_DURATION, parsed))
        : DEFAULT_BACKGROUND_CYCLE_DURATION;
}

const modulo = (value, divisor) => ((value % divisor) + divisor) % divisor;

// Shared with export. Camera alignment follows the existing export duration policy.
export function alignSceneLoopDuration(cameraDuration, materialDuration, fps = 30) {
    if (!(cameraDuration > 0) || !(materialDuration > 0)) return cameraDuration;
    const candidate = Math.round(Math.ceil(cameraDuration / materialDuration) * materialDuration * fps) / fps;
    return candidate > cameraDuration * 2 ? cameraDuration : candidate;
}

export function getBackgroundSceneLoopDuration(ctx) {
    if (ctx.getBackgroundLoopDuration) return ctx.getBackgroundLoopDuration();
    const materialDuration = getSeamlessLoopDuration(
        ctx.tileManager.value,
        ctx.app.proceduralPathMode !== 'mobius' && !!ctx.app.undulationEnabled,
        3,
    );
    const mode = ctx.app.artworkMotionMode;
    if (mode === 'cinematic' && ctx.cinematicCamera?.hasROIs?.value) {
        return alignSceneLoopDuration(ctx.cinematicCamera.getLoopDuration(), materialDuration);
    }
    if (mode === 'recordedOrbit' && ctx.cameraMotion?.hasRecording?.value) {
        return alignSceneLoopDuration(ctx.cameraMotion.getLoopDuration(), materialDuration);
    }
    const motionModes = ['circularTilt', 'circularOrbit', 'circularOrbitReverse', 'tumbleOrbit'];
    return materialDuration * (motionModes.includes(mode)
        ? Math.max(1, normalizeMotionLoopDurationMultiplier(ctx.app.viewerMotionLoopCount))
        : 1);
}

// Interpolate along the sequence, including its closing segment. Array layers
// themselves are discrete; the renderer must sample and mix these two layers.
export function getBackgroundLayerFrame({ layerCount, variant, reversed = false, progress }) {
    const count = Math.max(1, Math.floor(Number(layerCount) || 1));
    if (count === 1) return { currentLayer: 0, nextLayer: 0, layerBlend: 0 };
    const steps = variant === 'waves' ? count : 2 * (count - 1);
    const position = modulo((reversed ? -1 : 1) * progress, 1) * steps;
    const index = Math.floor(position);
    const layerAt = (step) => {
        const frame = modulo(step, steps);
        return variant === 'waves' ? frame : Math.min(frame, steps - frame);
    };
    return { currentLayer: layerAt(index), nextLayer: layerAt(index + 1), layerBlend: position - index };
}

// Keep a live phase anchor across duration changes. Export evaluates absolute
// synthetic time without changing that anchor or borrowing the preview phase.
export function createBackgroundLayerTimeline() {
    let previous = null;
    let phaseOffset = 0;
    return {
        reset() { previous = null; phaseOffset = 0; },
        snapshot() { return previous ? modulo(previous.phase, 1) : null; },
        restore(progress, timeSeconds, duration, enabled) {
            if (!Number.isFinite(progress)) return;
            const phase = modulo(progress, 1);
            const period = Math.max(0.001, duration);
            phaseOffset = phase - timeSeconds / period;
            previous = { phase, time: timeSeconds, period, enabled };
        },
        getProgress(timeSeconds, duration, { deterministic = false, enabled = true } = {}) {
            const time = Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0;
            const period = Math.max(0.001, Number(duration) || DEFAULT_BACKGROUND_CYCLE_DURATION);
            if (deterministic) return time / period;
            if (previous && time >= previous.time) {
                const phase = previous.phase + (previous.enabled ? (time - previous.time) / previous.period : 0);
                phaseOffset = phase - time / period;
            } else if (previous) {
                phaseOffset = 0; // A restored/reset artwork clock starts a new timeline.
            }
            const phase = time / period + phaseOffset;
            previous = { time, period, phase, enabled };
            return phase;
        },
    };
}
