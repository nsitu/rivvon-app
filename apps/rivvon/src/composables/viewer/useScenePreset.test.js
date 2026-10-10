import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref, shallowRef } from 'vue';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import { useScenePreset } from './useScenePreset.js';
import { useViewerMotion } from './useViewerMotion.js';
import { normalizeArtworkSettings } from '../../../../../packages/shared-types/src/scenePreset.js';

function harness() {
    const manager = () => ({ currentTextureSet: { id: 'texture', name: 'Texture', tile_resolution: 512 },
        getTileCount: () => 1, getLayerCount: () => 60, getLayerCycleProgress: () => 0.3,
        variant: 'waves', flowOffset: 0.2, tileFlowOffset: 3, sharedFilmstripOffsetUniform: { value: 0.1 },
        dispose: vi.fn(), restorePresetAnimation: vi.fn() });
    const series = () => ({ sourcePathsPoints: [[new Vector3(), new Vector3(1, 1, 0)]], lastWidth: 1.2,
        update: vi.fn(), initFlowMaterials: vi.fn(), dispose: vi.fn() });
    const oldManager = manager(), oldSeries = series();
    const app = { contrast: 1, rendererType: 'webgpu', proceduralPathMode: null,
        getArtworkSettingsSnapshot() { return normalizeArtworkSettings(this); },
        applyArtworkSettingsSnapshot(settings) { Object.assign(this, normalizeArtworkSettings(settings)); } };
    const ctx = { app, camera: shallowRef(new PerspectiveCamera(45)),
        controls: shallowRef({ target: new Vector3(), enableDamping: true, update: vi.fn() }),
        tileManager: shallowRef(oldManager), tileManagers: shallowRef([]), ribbonSeries: shallowRef(oldSeries), ribbon: shallowRef(null),
        cinematicCamera: { getInstance: () => null, stopPlayback: vi.fn(), restoreSnapshot: vi.fn() },
        cameraMotion: { isRecording: ref(false), getTrack: () => null, stopPlayback: vi.fn(), loadRecording: vi.fn() } };
    const staged = [manager(), manager()];
    const deps = { textures: { stagePresetTextures: vi.fn(async () => staged) },
        ribbons: { createRibbonSeries: vi.fn(async () => { ctx.ribbonSeries.value = series(); }) },
        renderLoop: { getArtworkTime: () => 42, setArtworkTime: vi.fn(), pauseRenderLoop: vi.fn(), resumeRenderLoop: vi.fn() },
        updateBackground: vi.fn(async () => {}) };
    return { ctx, deps, staged, oldManager, oldSeries, engine: useScenePreset(ctx, deps) };
}
describe('scene restoration boundary', () => {
    it('recreates the same artwork motion pose when opening it at a later wall-clock time', async () => {
        const h = harness(); let now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        h.ctx.app.artworkMotionMode = 'tumbleOrbit'; h.ctx.app.viewerControlMode = 'orbit'; h.ctx.app.viewerMotionLoopCount = 1;
        h.ctx.cinematicCamera.isPlaying = ref(false);
        h.ctx.camera.value.position.set(0, 0, 5);
        const root = new Group(); h.oldSeries.getTransformRoot = () => root;
        const motion = useViewerMotion(h.ctx);
        try {
            motion.tick(now); now = 1800; motion.tick(now);
            const rotation = root.quaternion.clone(); const position = root.position.clone();
            const saved = motion.captureSnapshot();
            const restoredRoot = new Group();
            h.ctx.ribbonSeries.value = { getTransformRoot: () => restoredRoot };
            await nextTick(); now = 5000;
            motion.restoreSnapshot(saved);
            expect(restoredRoot.quaternion.angleTo(rotation)).toBeCloseTo(0, 6);
            expect(restoredRoot.position.distanceTo(position)).toBeCloseTo(0, 6);
        } finally { motion.deactivate(); vi.restoreAllMocks(); }
    });
    it('leaves the current scene intact when staging textures fails', async () => {
        const h = harness(); const snapshot = h.engine.captureScene({ includeAssets: false }).scene;
        h.deps.textures.stagePresetTextures.mockRejectedValue(new Error('Decode failed'));
        await expect(h.engine.restoreScene(snapshot, [])).rejects.toThrow('Decode failed');
        expect(h.ctx.ribbonSeries.value).toBe(h.oldSeries);
        expect(h.oldManager.dispose).not.toHaveBeenCalled();
        expect(h.deps.renderLoop.pauseRenderLoop).not.toHaveBeenCalled();
    });
    it('rolls back artwork and GPU references if rebuilding fails, disposing only the staged managers', async () => {
        const h = harness(); const snapshot = h.engine.captureScene({ includeAssets: false }).scene;
        snapshot.artwork.contrast = 1.8;
        h.deps.ribbons.createRibbonSeries.mockRejectedValue(new Error('Geometry failed'));
        await expect(h.engine.restoreScene(snapshot, [])).rejects.toThrow('Geometry failed');
        expect(h.ctx.app.contrast).toBe(1);
        expect(h.ctx.app.rendererType).toBe('webgpu');
        expect(h.ctx.ribbonSeries.value).toBe(h.oldSeries);
        expect(h.ctx.tileManager.value).toBe(h.oldManager);
        expect(h.oldSeries.dispose).not.toHaveBeenCalled();
        expect(h.staged.every(manager => manager.dispose.mock.calls.length === 1)).toBe(true);
        expect(h.ctx.app.isRestoringPreset).toBe(false);
        expect(h.deps.renderLoop.resumeRenderLoop).toHaveBeenCalledOnce();
    });
    it('restores artwork and texture phases and releases the old scene only after success', async () => {
        const h = harness(); const snapshot = h.engine.captureScene({ includeAssets: false }).scene;
        snapshot.artwork.contrast = 1.8;
        await h.engine.restoreScene(snapshot, []);
        expect(h.ctx.app.contrast).toBe(1.8);
        expect(h.ctx.app.rendererType).toBe('webgpu');
        expect(h.staged[0].restorePresetAnimation).toHaveBeenCalledWith(expect.objectContaining({ tileFlowOffset: 3, flowOffset: 0.2, layerProgress: 0.3 }));
        expect(h.deps.renderLoop.setArtworkTime).toHaveBeenCalledWith(42);
        expect(h.oldSeries.dispose).toHaveBeenCalledOnce();
        expect(h.oldManager.dispose).toHaveBeenCalledOnce();
        expect(h.staged.every(manager => manager.dispose.mock.calls.length === 0)).toBe(true);
    });
});
