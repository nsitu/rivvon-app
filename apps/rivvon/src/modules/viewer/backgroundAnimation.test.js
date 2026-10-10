import { describe, expect, it } from 'vitest';
import { createBackgroundLayerTimeline, getBackgroundLayerFrame, getBackgroundSceneLoopDuration } from './backgroundAnimation.js';

const frame = (progress, variant = 'waves', reversed = false, layerCount = 4) =>
    getBackgroundLayerFrame({ progress, variant, reversed, layerCount });

describe('background layer interpolation', () => {
    it('crossfades the closing wrap segment and lands exactly on the first layer after a cycle', () => {
        expect(frame(0.875)).toEqual({ currentLayer: 3, nextLayer: 0, layerBlend: 0.5 });
        expect(frame(1)).toEqual({ currentLayer: 0, nextLayer: 1, layerBlend: 0 });
        expect(frame(2)).toEqual(frame(0));
    });
    it('ping-pongs without duplicating endpoints or blending the last layer straight to the first', () => {
        expect(frame(0.5, 'planes')).toEqual({ currentLayer: 3, nextLayer: 2, layerBlend: 0 });
        expect(frame(0.75, 'planes')).toEqual({ currentLayer: 2, nextLayer: 1, layerBlend: 0.5 });
        expect(frame(1, 'planes')).toEqual(frame(0, 'planes'));
    });
    it('supports reversed traversal and static arrays', () => {
        expect(frame(0.125, 'waves', true)).toEqual({ currentLayer: 3, nextLayer: 0, layerBlend: 0.5 });
        expect(frame(0.875, 'planes', true)).toEqual(frame(0.125, 'planes'));
        expect(frame(0.8, 'waves', false, 1)).toEqual({ currentLayer: 0, nextLayer: 0, layerBlend: 0 });
    });
});

describe('background timeline', () => {
    it('changes duration without changing the currently displayed phase', () => {
        const timeline = createBackgroundLayerTimeline();
        expect(timeline.getProgress(3, 12)).toBe(0.25);
        expect(timeline.getProgress(3, 60)).toBe(0.25);
        expect(timeline.getProgress(9, 60)).toBeCloseTo(0.35);
    });
    it('holds phase while animation is disabled and resets when the artwork clock is restored', () => {
        const timeline = createBackgroundLayerTimeline();
        timeline.getProgress(3, 12, { enabled: false });
        expect(timeline.getProgress(30, 12)).toBe(0.25);
        expect(timeline.getProgress(0, 12)).toBe(0);
    });
    it('exports absolute synthetic time without changing the preview anchor', () => {
        const timeline = createBackgroundLayerTimeline();
        timeline.getProgress(3, 12);
        timeline.getProgress(3, 60);
        expect(timeline.getProgress(0, 60, { deterministic: true })).toBe(0);
        expect(timeline.getProgress(60, 60, { deterministic: true })).toBe(1);
        expect(timeline.getProgress(9, 60)).toBeCloseTo(0.35);
    });
    it('restores a saved phase after changing duration without losing the interpolation', () => {
        const timeline = createBackgroundLayerTimeline();
        timeline.getProgress(3, 12);
        timeline.getProgress(3, 60);
        const saved = timeline.snapshot();
        timeline.reset();
        timeline.restore(saved, 3, 60, true);
        expect(timeline.getProgress(3, 60)).toBeCloseTo(0.25);
        expect(timeline.getProgress(9, 60)).toBeCloseTo(0.35);
    });
});

describe('background scene synchronization', () => {
    const context = () => ({ app: { undulationEnabled: true }, tileManager: {
        value: { getSeamlessLoopDuration: () => 12 },
    } });
    it('uses the common material loop, extending it only for slower artwork motion', () => {
        const ctx = context();
        expect(getBackgroundSceneLoopDuration(ctx)).toBe(12);
        ctx.app.artworkMotionMode = 'circularOrbit';
        ctx.app.viewerMotionLoopCount = 2;
        expect(getBackgroundSceneLoopDuration(ctx)).toBe(24);
        ctx.app.viewerMotionLoopCount = 0.5;
        expect(getBackgroundSceneLoopDuration(ctx)).toBe(12);
    });
    it('aligns recorded camera motion and lets the overview supply its texture-only loop', () => {
        const ctx = context();
        ctx.app.artworkMotionMode = 'recordedOrbit';
        ctx.cameraMotion = { hasRecording: { value: true }, getLoopDuration: () => 20 };
        expect(getBackgroundSceneLoopDuration(ctx)).toBe(24);
        ctx.getBackgroundLoopDuration = () => 6;
        expect(getBackgroundSceneLoopDuration(ctx)).toBe(6);
    });
});
