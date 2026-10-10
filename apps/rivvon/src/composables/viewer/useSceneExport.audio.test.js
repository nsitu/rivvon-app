import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSceneExport } from './useSceneExport.js';

vi.mock('mediabunny', () => ({}));
afterEach(() => vi.unstubAllGlobals());

function context() {
    return {
        audio: { setBlocked: vi.fn() },
        app: {}, renderer: { value: { domElement: { width: 100, height: 100 } } },
        scene: { value: {} }, camera: { value: {} },
        tileManager: { value: {} }, tileManagers: { value: [] }, ribbonSeries: { value: null },
    };
}

describe('video export with viewer audio', () => {
    it('renders synthetic frames without live audio modulation', () => {
        const renderScene = vi.fn();
        const exporter = useSceneExport(context(), { renderScene });
        exporter.renderFrameAtTime(2, 1 / 30, { audioReactive: true });
        expect(renderScene).toHaveBeenCalledWith(expect.objectContaining({ timeSeconds: 2, audioReactive: false }));
    });

    it('releases its audio blocker when video encoding fails before rendering', async () => {
        vi.stubGlobal('VideoEncoder', undefined);
        const ctx = context();
        await expect(useSceneExport(ctx).exportVideo({ format: 'webm' })).rejects.toThrow('WebCodecs API is not available');
        expect(ctx.audio.setBlocked.mock.calls).toEqual([['scene-export', true], ['scene-export', false]]);
    });
});
