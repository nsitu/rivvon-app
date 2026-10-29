export function createClipTimingPlan(duration, targetDuration, mode = 'native') {
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(targetDuration) || targetDuration <= 0) throw new Error('A positive clip and loop duration are required.');
    const ratio = targetDuration / duration;
    // Avoid adding a repetition for floating-point noise at an exact multiple.
    const nearest = Math.round(ratio);
    const aligned = nearest > 0 && Math.abs(ratio - nearest) <= 16 * Number.EPSILON * Math.max(1, ratio);
    const repetitions = mode === 'alignLoop' ? Math.max(1, aligned ? nearest : Math.ceil(ratio)) : null;
    return Object.freeze({ mode, duration, targetDuration, repetitions,
        rate: repetitions == null ? 1 : Math.max(1, repetitions * duration / targetDuration) });
}

export function getClipLocalTime(time, plan) {
    const elapsed = Math.max(0, Number(time) || 0);
    const cycles = plan.mode === 'alignLoop' ? elapsed / plan.targetDuration * plan.repetitions : elapsed / plan.duration;
    if (Math.abs(cycles - Math.round(cycles)) <= 16 * Number.EPSILON * Math.max(1, cycles)) return 0;
    return (cycles - Math.floor(cycles)) * plan.duration;
}

// Quantize one automatic cycle once, then repeat exactly that many frames.
export function getClipExportPeriod(duration, fps, loopCount = 1, manual = false) {
    if (!(duration > 0) || !(fps > 0)) throw new Error('Invalid export timing.');
    const cycleFrames = Math.ceil(duration * fps);
    const totalFrames = cycleFrames * (manual ? 1 : Math.max(1, loopCount));
    return { cycleFrames, totalFrames, targetDuration: cycleFrames / fps, duration: totalFrames / fps };
}
