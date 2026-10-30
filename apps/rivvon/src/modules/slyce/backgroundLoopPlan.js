import { MAX_CLIP_SIDE, MAX_CLIP_DURATION } from '../../../../../packages/shared-types/src/clipAsset.js';

export const BACKGROUND_LOOP_FPS = 30;
export const BACKGROUND_LOOP_SURFACE_BUDGET_MIB = 256;
export const BACKGROUND_LOOP_BATCH_SIZE = 16;

export function planBackgroundLoop(source, { size, duration, batchSize = BACKGROUND_LOOP_BATCH_SIZE, sourceStartFrame = 1,
    surfaceBudgetMiB = BACKGROUND_LOOP_SURFACE_BUDGET_MIB, samplingSide = 'long' } = {}) {
    const { width, height, frameCount } = source;
    if (![width, height, frameCount, sourceStartFrame, batchSize].every(n => Number.isSafeInteger(n) && n > 0)) {
        throw new Error('Source dimensions, frame count, starting frame and batch size must be positive integers.');
    }
    if (!['long', 'short'].includes(samplingSide)) throw new Error('Choose the long or short side to sample.');
    // Source dimensions are already normalized to the displayed orientation.
    const samplingMode = (width >= height) === (samplingSide === 'long') ? 'rows' : 'columns';
    const spatialSide = samplingMode === 'rows' ? width : height;
    const distributionSide = samplingMode === 'rows' ? height : width;
    const maxSize = Math.floor(Math.min(spatialSide, frameCount - sourceStartFrame + 1, MAX_CLIP_SIDE) / 2) * 2;
    const maxPhases = Math.min(distributionSide, MAX_CLIP_DURATION * BACKGROUND_LOOP_FPS);
    if (maxSize < 2 || maxPhases < 30) throw new Error('The source needs at least two usable frames and a sampling range of at least 30 pixels.');
    const resolvedSize = size ?? maxSize;
    const phaseCount = duration === undefined ? Math.min(240, maxPhases) : Math.round(duration * BACKGROUND_LOOP_FPS);
    if (!Number.isSafeInteger(resolvedSize) || resolvedSize < 2 || resolvedSize % 2 || resolvedSize > maxSize) {
        throw new Error(`Choose an even square size between 2 and ${maxSize}, without enlarging source samples.`);
    }
    if (!Number.isFinite(duration ?? 8) || phaseCount < 30 || phaseCount > maxPhases) {
        throw new Error(`Choose a duration between 1 and ${maxPhases / BACKGROUND_LOOP_FPS} seconds.`);
    }
    if (!Number.isFinite(surfaceBudgetMiB) || surfaceBudgetMiB <= 0) throw new Error('Choose a positive sampling surface budget.');
    const framesWithinBudget = Math.floor(surfaceBudgetMiB * 1024 * 1024 / (resolvedSize * resolvedSize * 4));
    if (framesWithinBudget < 1) throw new Error('The sampling surface budget cannot hold one output frame.');
    const phasesPerBatch = Math.min(batchSize, phaseCount, framesWithinBudget);
    return { version: 1, size: resolvedSize, maxSize, samplingSide, samplingMode, sourceStartFrame,
        sourceFrames: resolvedSize, fps: BACKGROUND_LOOP_FPS, phaseCount, maxPhases,
        duration: phaseCount / BACKGROUND_LOOP_FPS, batchSize: phasesPerBatch,
        passes: Math.ceil(phaseCount / phasesPerBatch),
        phaseSurfaceBytes: resolvedSize * resolvedSize * 4 * phasesPerBatch };
}
