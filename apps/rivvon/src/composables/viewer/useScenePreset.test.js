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
    it('restores the original image grant and scene when a preset background fails to load', async () => {
        const h = harness();
        h.ctx.app.backgroundImagePresetId = 'original-grant';
        h.ctx.app.backgroundTextureSource = { kind: 'image', id: 'original-image' };
        const input = h.engine.captureScene({ includeAssets: false }).scene;
        input.artwork.backgroundTextureSource = { kind: 'image', id: 'missing-image' };
        h.deps.updateBackground.mockRejectedValueOnce(new Error('Background unavailable'));
        await expect(h.engine.restoreScene(input, [], null, { backgroundPresetId: 'new-grant' })).rejects.toThrow('Background unavailable');
        expect(h.ctx.app.backgroundImagePresetId).toBe('original-grant');
        expect(h.ctx.app.backgroundTextureSource).toEqual({ kind: 'image', id: 'original-image' });
        expect(h.ctx.ribbonSeries.value).toBe(h.oldSeries);
        expect(h.deps.updateBackground).toHaveBeenCalledTimes(2);
        expect(h.deps.renderLoop.resumeRenderLoop).toHaveBeenCalled();
    });
    it('captures grid settings beside source geometry and restores or rolls them back with the scene', async () => {
        const h = harness();
        Object.assign(h.ctx.app, { gridRepeatEnabled: true, gridRepeatRows: 2, gridRepeatColumns: 3, gridRepeatCheckerboard: true, gridRepeatColumnSpacing: 0, gridRepeatRowSpacing: 2.35 });
        const saved = h.engine.captureScene({ includeAssets: false }).scene;
        expect(saved.geometry.paths).toHaveLength(1);
        expect(saved.artwork).toMatchObject({ gridRepeatEnabled: true, gridRepeatRows: 2, gridRepeatColumns: 3, gridRepeatCheckerboard: true });
        saved.artwork.gridRepeatRows = 4;
        saved.artwork.gridRepeatColumnSpacing = 5;
        saved.artwork.gridRepeatRowSpacing = 0;
        h.deps.ribbons.createRibbonSeries.mockRejectedValueOnce(new Error('Grid failed'));
        await expect(h.engine.restoreScene(saved, [])).rejects.toThrow('Grid failed');
        expect(h.ctx.app.gridRepeatRows).toBe(2);
        expect(h.ctx.app.gridRepeatColumnSpacing).toBe(0);
        expect(h.ctx.app.gridRepeatRowSpacing).toBe(2.35);
        await h.engine.restoreScene(saved, []);
        expect(h.ctx.app.gridRepeatRows).toBe(4);
        expect(h.ctx.app.gridRepeatColumnSpacing).toBe(5);
        expect(h.ctx.app.gridRepeatRowSpacing).toBe(0);
        expect(h.ctx.app.gridRepeatCheckerboard).toBe(true);
    });
    it('captures the canonical SVG paths and passes nodes through restoration for reversible switching', async () => {
        const h = harness();
        h.ctx.app.svgSmoothNodesEnabled = true;
        h.oldSeries.svgNodes = [{ closed: true, points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }] }];
        const saved = h.engine.captureScene({ kind: 'svg', source: { fileName: 'triangle.svg' }, includeAssets: false }).scene;
        expect(saved.geometry.paths).toEqual(h.oldSeries.sourcePathsPoints.map(path => path.map(({ x, y, z }) => ({ x, y, z }))));
        expect(saved.geometry.source.svgNodes).toEqual(h.oldSeries.svgNodes);
        expect(saved.artwork.svgSmoothNodesEnabled).toBe(true);
        await h.engine.restoreScene(saved, []);
        expect(h.deps.ribbons.createRibbonSeries).toHaveBeenCalledWith(expect.any(Array), {
            width: 1.2, source: saved.geometry.source,
        });
    });
    it('forwards texture decoding progress and reports scene setup only after decoding finishes', async () => {
        const h = harness(); const snapshot = h.engine.captureScene({ includeAssets: false }).scene;
        const progress = vi.fn();
        h.deps.textures.stagePresetTextures.mockImplementation(async (entries, artwork, report) => {
            expect(progress).not.toHaveBeenCalled();
            report('building', 1, 2); report('building', 2, 2);
            return h.staged;
        });
        await h.engine.restoreScene(snapshot, [], progress);
        expect(progress.mock.calls).toEqual([
            ['building', 1, 2], ['building', 2, 2], ['applying', 0, 3],
            ['applying', 1, 3], ['applying', 2, 3], ['applying', 3, 3],
        ]);
    });
    it('captures reusable nonempty local tile bytes for preset publication', async () => {
        const h = harness();
        h.oldManager.zipFiles = { '0.ktx2': new Uint8Array([1, 2, 3]) };
        const capture = h.engine.captureScene({ textureAssignments: [{ id: 'local', source: 'local' }] });
        expect(capture.uploads[0]).toMatchObject({ assignment: 0, localId: 'local' });
        expect(new Uint8Array(await capture.uploads[0].tiles[0].blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
        expect(h.oldManager.zipFiles['0.ktx2'].byteLength).toBe(3);
    });
    it('references a cached cloud texture even when its selection is labelled local', () => {
        const h = harness();
        h.oldManager.currentTextureSet = { id: 'local-cache', cached_from: 'published-variant', name: 'Cached texture', tile_resolution: 256 };
        h.oldManager.textureSourceLabel = 'local';
        const capture = h.engine.captureScene({ textureAssignments: [{ id: 'local-cache', source: 'local' }] });
        expect(capture.scene.textures[0]).toMatchObject({ id: 'published-variant', tileResolution: 256 });
        expect(capture.uploads).toEqual([]);
    });
    it('references the loaded cloud variant instead of uploading it or using its family root', () => {
        const h = harness();
        h.oldManager.currentTextureSet = { id: 'published-variant', name: 'Variant', tile_resolution: 256 };
        const capture = h.engine.captureScene({ textureAssignments: [{ id: 'family-root', source: 'cloud' }] });
        expect(capture.scene.textures[0].id).toBe('published-variant');
        expect(capture.uploads).toEqual([]);
    });
    it('rejects source buffers emptied by worker transfer instead of publishing zero-byte tiles', () => {
        const h = harness();
        const bytes = new Uint8Array([1, 2, 3]);
        h.oldManager.zipFiles = { '0.ktx2': bytes };
        structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
        expect(bytes.byteLength).toBe(0);
        expect(() => h.engine.captureScene({ textureAssignments: [{ id: 'local', source: 'local' }] }))
            .toThrow('missing or empty KTX2 tiles');
    });
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
