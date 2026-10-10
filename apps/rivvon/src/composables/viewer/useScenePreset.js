import { nextTick } from 'vue';
import { normalizeScenePreset } from '../../../../../packages/shared-types/src/scenePreset.js';
import { serializeDrawingPaths, inflateDrawingPaths } from '../../modules/shared/drawingLibrary.js';

/** Owns the capture/restore boundary, including transactional GPU texture loading. */
export function useScenePreset(ctx, { textures, ribbons, renderLoop, updateBackground, background }) {
    const managers = () => ctx.tileManagers.value.length ? ctx.tileManagers.value : [ctx.tileManager.value];
    function captureScene({ kind = 'gesture', title = '', source = null, audio = null, textureAssignments = [], includeAssets = true } = {}) {
        const series = ctx.ribbonSeries.value;
        const camera = ctx.camera.value;
        if (!series || !camera || ctx.cameraMotion.isRecording.value) throw new Error('Finish creating the ribbon before saving a preset.');
        const active = managers();
        const uploads = [];
        const manifest = active.map((manager, assignment) => {
            const count = manager.getTileCount();
            const selection = textureAssignments[assignment];
            const isCloud = !selection || selection.source !== 'local';
            // Freeze the actually loaded variant, even if selection names its family root.
            const loaded = manager.currentTextureSet;
            const id = isCloud ? loaded?.cached_from || (manager.textureSourceLabel === 'local' ? selection?.id : loaded?.id) || selection?.id || '' : '';
            if (includeAssets && !id) {
                const tiles = [];
                for (let tile = 0; tile < count; tile++) {
                    const bytes = manager.zipFiles?.[`${tile}.ktx2`];
                    if (bytes) tiles.push({ index: tile, blob: new Blob([bytes], { type: 'image/ktx2' }) });
                }
                if (tiles.length !== count) throw new Error('Finish capturing the texture before saving a preset. This texture has no reusable KTX2 tiles.');
                uploads.push({ assignment, tiles, localId: selection?.id || null });
            }
            return { id, name: manager.currentTextureSet?.name || selection?.name || ctx.app.currentTextureName || 'Texture',
                tileCount: count, tileResolution: manager.currentTextureSet?.tile_resolution || manager.tileResolution || 512,
                layerCount: manager.getLayerCount() || 1, variant: manager.variant };
        });
        const cinematic = ctx.cinematicCamera.getInstance();
        const scene = normalizeScenePreset({
            schemaVersion: 1,
            geometry: { paths: serializeDrawingPaths(series.sourcePathsPoints), kind, title, source,
                width: series.lastWidth || 1.2,
                procedural: series.proceduralSource ? { type: series.proceduralSource.type, settings: series.proceduralSource.settings,
                    baseTimeMs: series.proceduralSource.runtimeState?.baseTimeMs } : null },
            artwork: ctx.app.getArtworkSettingsSnapshot(), textures: manifest,
            camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), up: camera.up.toArray(),
                target: ctx.controls.value.target.toArray(), fov: camera.fov,
                cinematic: { rois: (cinematic?.getROIs() || []).map(roi => ({ position: roi.position.toArray(), target: roi.target.toArray(), fov: roi.fov })),
                    minSpeedRatio: cinematic?.minSpeedRatio, dwellRadiusFraction: cinematic?.dwellRadiusFraction, microMotionEnabled: cinematic?.microMotionEnabled },
                motion: ctx.cameraMotion.getTrack()?.toJSON() || null },
            animation: { time: renderLoop.getArtworkTime(), backgroundLayerProgress: background?.getLayerProgress?.() ?? null,
                textures: active.map(manager => ({
                layerProgress: manager.getLayerCycleProgress(), flowOffset: manager.flowOffset, tileFlowOffset: manager.tileFlowOffset,
                filmstripOffset: manager.sharedFilmstripOffsetUniform.value,
            })), motion: ctx.viewerMotion?.captureSnapshot?.() || null }, audio,
        });
        return { scene, uploads };
    }

    function restoreCamera(snapshot) {
        const camera = ctx.camera.value, controls = ctx.controls.value;
        ctx.cinematicCamera.restoreSnapshot(snapshot.cinematic);
        ctx.cameraMotion.loadRecording(snapshot.motion);
        camera.position.fromArray(snapshot.position);
        controls.target.fromArray(snapshot.target);
        camera.up.fromArray(snapshot.up);
        camera.fov = snapshot.fov;
        camera.updateProjectionMatrix();
        // Flush any residual damping before restoring the exact saved orientation.
        const damping = controls.enableDamping;
        controls.enableDamping = false;
        controls.update();
        controls.enableDamping = damping;
        camera.quaternion.fromArray(snapshot.quaternion);
        camera.updateMatrixWorld(true);
    }

    async function restoreScene(input, textureEntries) {
        const scene = normalizeScenePreset(input);
        const previous = captureScene({ includeAssets: false }).scene;
        // Decode every tile in separate managers before touching the working scene.
        const prepared = await textures.stagePresetTextures(textureEntries, scene.artwork);
        const old = { managers: ctx.tileManagers.value, manager: ctx.tileManager.value,
            series: ctx.ribbonSeries.value, ribbon: ctx.ribbon.value,
            snapshot: previous, proceduralPathMode: ctx.app.proceduralPathMode,
            proceduralSourceType: ctx.app.proceduralSourceType, sineWaveSettings: ctx.app.sineWaveSettings,
            clockSettings: ctx.app.clockSettings, mobiusSettings: ctx.app.mobiusSettings };
        renderLoop.pauseRenderLoop();
        ctx.app.isRestoringPreset = true;
        ctx.cinematicCamera.stopPlayback();
        ctx.cameraMotion.stopPlayback();
        let committed = false;
        try {
            ctx.app.applyArtworkSettingsSnapshot(scene.artwork);
            await nextTick();
            ctx.tileManagers.value = prepared;
            ctx.tileManager.value = prepared[0];
            // Keep the previous GPU scene alive until the new geometry is ready.
            ctx.ribbonSeries.value = null;
            ctx.ribbon.value = null;
            if (scene.geometry.procedural) {
                await ribbons.createProceduralRibbon({ ...scene.geometry.procedural, width: scene.geometry.width });
                if (scene.geometry.procedural.baseTimeMs !== null && ctx.ribbonSeries.value?.proceduralSource) {
                    ctx.ribbonSeries.value.proceduralSource.runtimeState.baseTimeMs = scene.geometry.procedural.baseTimeMs;
                }
            } else {
                await ribbons.createRibbonSeries(inflateDrawingPaths(scene.geometry.paths), { width: scene.geometry.width });
            }
            if (!ctx.ribbonSeries.value) throw new Error('Could not rebuild the preset geometry.');
            for (const [index, manager] of prepared.entries()) manager.restorePresetAnimation(scene.animation.textures[index]);
            ctx.ribbonSeries.value.initFlowMaterials?.();
            renderLoop.setArtworkTime(scene.animation.time);
            ctx.ribbonSeries.value.updateProcedural?.(scene.animation.time);
            ctx.ribbonSeries.value.update(scene.animation.time);
            await updateBackground();
            restoreCamera(scene.camera);
            ctx.viewerMotion?.restoreSnapshot?.(scene.animation.motion);
            background?.restoreLayerProgress?.(scene.animation.backgroundLayerProgress, scene.animation.time);
            committed = true;
            old.series?.dispose();
            old.ribbon?.dispose();
            for (const manager of new Set([old.manager, ...old.managers])) manager?.dispose();
        } catch (error) {
            ctx.ribbonSeries.value?.dispose();
            ctx.ribbon.value?.dispose();
            ctx.tileManagers.value = old.managers;
            ctx.tileManager.value = old.manager;
            ctx.ribbonSeries.value = old.series;
            ctx.ribbon.value = old.ribbon;
            ctx.app.applyArtworkSettingsSnapshot(old.snapshot.artwork);
            ctx.app.proceduralPathMode = old.proceduralPathMode;
            ctx.app.proceduralSourceType = old.proceduralSourceType;
            ctx.app.sineWaveSettings = old.sineWaveSettings;
            ctx.app.clockSettings = old.clockSettings;
            ctx.app.mobiusSettings = old.mobiusSettings;
            await nextTick();
            renderLoop.setArtworkTime(old.snapshot.animation.time);
            await updateBackground();
            restoreCamera(old.snapshot.camera);
            ctx.viewerMotion?.restoreSnapshot?.(old.snapshot.animation.motion);
            background?.restoreLayerProgress?.(old.snapshot.animation.backgroundLayerProgress, old.snapshot.animation.time);
            throw error;
        } finally {
            if (!committed) prepared.forEach(manager => manager.dispose());
            ctx.app.isRestoringPreset = false;
            renderLoop.resumeRenderLoop();
        }
        return scene;
    }
    return { captureScene, restoreScene };
}
