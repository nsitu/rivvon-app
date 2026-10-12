import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVideoExportProgress } from './videoExportProgress.js';

afterEach(() => vi.restoreAllMocks());

describe('video export progress', () => {
    it('keeps all metrics visible during loading, batch encoding, and finalization', () => {
        let now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        const onStatus = vi.fn(), onProgress = vi.fn();
        const progress = createVideoExportProgress({ totalFrames: 360, onStatus, onProgress });

        progress.status('Loading SDR video encoder…');
        expect(onStatus).toHaveBeenLastCalledWith('Loading SDR video encoder… · 0% · Frames 0/360 · 0.0 fps');
        now = 5000;
        progress.start();
        now = 15000;
        progress.frameComplete(192);
        expect(onStatus).toHaveBeenLastCalledWith('Rendering and encoding… · 51% · Frames 192/360 · 19.2 fps');

        now = 17000;
        progress.status('Encoding SDR frames 193–216…');
        expect(onStatus).toHaveBeenLastCalledWith('Encoding SDR frames 193–216… · 51% · Frames 192/360 · 16.0 fps');
        now = 25000;
        progress.frameComplete(216);
        expect(onStatus).toHaveBeenLastCalledWith('Rendering and encoding… · 57% · Frames 216/360 · 10.8 fps');

        now = 35000;
        progress.frameComplete(360);
        progress.status('Muxing and verifying SDR video…');
        expect(onStatus).toHaveBeenLastCalledWith('Muxing and verifying SDR video… · 95% · Frames 360/360 · 12.0 fps');
        now = 45000;
        progress.complete();
        expect(onStatus).toHaveBeenLastCalledWith('Export complete. · 100% · Frames 360/360 · 9.0 fps');
        expect(onProgress.mock.calls.map(([value]) => value)).toEqual([
            0.95 * 192 / 360, 0.95 * 216 / 360, 0.95, 1,
        ]);
    });

    it('handles an immediate first frame without reporting infinite fps', () => {
        vi.spyOn(performance, 'now').mockReturnValue(0);
        const onStatus = vi.fn();
        const progress = createVideoExportProgress({ totalFrames: 1, onStatus });
        progress.start();
        progress.frameComplete(1);
        expect(onStatus).toHaveBeenLastCalledWith('Rendering and encoding… · 95% · Frames 1/1 · 0.0 fps');
        progress.complete();
        expect(onStatus).toHaveBeenLastCalledWith('Export complete. · 100% · Frames 1/1 · 0.0 fps');
    });
});
