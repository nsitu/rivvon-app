// src/composables/viewer/useRibbonBuilder.js
// Ribbon creation, rebuilding, flow animation, and helix mode

import * as THREE from 'three';
import { Ribbon } from '../../modules/viewer/ribbon';
import { RibbonSeries } from '../../modules/viewer/ribbonSeries';
import { GridRepeatLimitError } from '../../modules/viewer/gridRepeat.js';
import { GRID_REPEAT_DEFAULTS, normalizeGridRepeatSettings } from '../../../../../packages/shared-types/src/gridRepeat.js';
import { normalizeSvgNodes } from '../../../../../packages/shared-types/src/svgNodes.js';
import {
    DEFAULT_CLOCK_SETTINGS,
    DEFAULT_MOBIUS_SETTINGS,
    normalizeMobiusSettings,
    DEFAULT_SINE_WAVE_SETTINGS,
    normalizeProceduralSourceType,
} from '../../modules/viewer/proceduralPaths';

/**
 * Manages ribbon geometry lifecycle: creation from points / drawings,
 * texture rebinding, flow animation state, and helix mode toggling.
 *
 * @param {Object} ctx - Shared context refs from useThreeSetup
 */
export function useRibbonBuilder(ctx) {

    function configureSvgNodes(series, source = null) {
        series.svgNodes = normalizeSvgNodes(source?.svgNodes);
        ctx.app.svgNodesAvailable = !!series.svgNodes?.length;
        if (!ctx.app.isRestoringPreset) {
            ctx.app.svgSmoothNodesEnabled = ctx.app.svgNodesAvailable && source?.svgSmoothNodesEnabled === true;
        }
    }

    function syncProjectionAspect(series) {
        ctx.app.updateSphericalProjectionArtworkAspectRatio?.(series.projectionArtworkAspectRatio);
    }

    function getDefaultProceduralSettings(type) {
        if (type === 'mobius') return DEFAULT_MOBIUS_SETTINGS;
        return type === 'clock'
            ? DEFAULT_CLOCK_SETTINGS
            : DEFAULT_SINE_WAVE_SETTINGS;
    }

    function getStoredProceduralSettings(type) {
        if (type === 'mobius') return ctx.app.mobiusSettings || DEFAULT_MOBIUS_SETTINGS;
        return type === 'clock'
            ? (ctx.app.clockSettings || DEFAULT_CLOCK_SETTINGS)
            : (ctx.app.sineWaveSettings || DEFAULT_SINE_WAVE_SETTINGS);
    }

    function getMergedProceduralSettings(type, overrides = {}) {
        if (type === 'mobius') return normalizeMobiusSettings({ ...getStoredProceduralSettings(type), ...overrides });
        return {
            ...getDefaultProceduralSettings(type),
            ...getStoredProceduralSettings(type),
            ...overrides,
        };
    }

    function syncProceduralSourceToStore(type, settings) {
        if (ctx.app.isRestoringPreset) {
            ctx.app.proceduralSourceType = type;
            ctx.app.proceduralPathMode = type;
            ctx.app[type === 'mobius' ? 'mobiusSettings' : type === 'clock' ? 'clockSettings' : 'sineWaveSettings'] = { ...settings };
            return;
        }
        ctx.app.setProceduralSourceType?.(type);
        ctx.app.setProceduralPathMode?.(type);

        if (type === 'mobius') {
            ctx.app.setMobiusSettings?.(settings);
            return;
        }

        if (type === 'clock') {
            ctx.app.setClockSettings?.(settings);
            return;
        }

        ctx.app.setSineWaveSettings?.(settings);
    }

    /**
     * Apply the current TileManager(s) to a RibbonSeries.
     * Uses the multi-TileManager array when available, otherwise the single primary.
     */
    function applyTileManagersToSeries(series) {
        if (ctx.tileManagers.value.length > 1) {
            series.setTileManagers(ctx.tileManagers.value);
        } else {
            series.setTileManager(ctx.tileManager.value);
        }
    }

    // Stage the new series before releasing the current scene. In particular,
    // repeat preflight failures must not destroy the last working artwork.
    function buildStaticSeries(paths, options = {}) {
        if (!ctx.scene.value || !ctx.tileManager.value || !paths?.length) return null;
        const svgNodes = normalizeSvgNodes(options.source?.svgNodes);
        const candidate = new RibbonSeries(ctx.scene.value);
        candidate.svgNodes = svgNodes;
        const smooth = ctx.app.isRestoringPreset
            ? ctx.app.svgSmoothNodesEnabled : !!svgNodes?.length && options.source?.svgSmoothNodesEnabled === true;
        const geometryOptions = {
            ...ctx.app.helixOptions,
            ...(ctx.app.gridRepeatEnabled ? normalizeGridRepeatSettings(ctx.app) : GRID_REPEAT_DEFAULTS),
            svgSmoothNodesEnabled: smooth,
            ...(ctx.app.isRestoringPreset ? {} : { sphericalProjectionVerticalWrapAuto: true }),
        };
        try {
            candidate.setHelixOptions(geometryOptions);
            candidate.setNormalizeTextureOrientation(ctx.app.normalizeTextureOrientation);
            const width = options.width || 1.2;
            const prepared = candidate._resolveGeometryPaths(paths, width);
            // TileManagers own shared material caches. Release the old series
            // after preflight but before populating the new material cache.
            ctx.ribbon.value?.dispose();
            ctx.ribbonSeries.value?.dispose();
            applyTileManagersToSeries(candidate);
            candidate.buildFromMultiplePaths(paths, width, 0, prepared);
            candidate.initFlowMaterials();
        } catch (error) {
            candidate.dispose();
            throw error;
        }
        ctx.ribbon.value = null;
        ctx.ribbonSeries.value = candidate;
        ctx.app.svgNodesAvailable = !!svgNodes?.length;
        ctx.app.svgSmoothNodesEnabled = smooth;
        ctx.app.gridRepeatError = '';
        if (!ctx.app.isRestoringPreset) ctx.app.sphericalProjectionVerticalWrapAuto = true;
        syncProjectionAspect(candidate);
        if (ctx.app.isRestoringPreset) ctx.app.proceduralPathMode = null;
        else ctx.app.setProceduralPathMode?.(null);
        ctx.cinematicCamera.clearROIs();
        return candidate;
    }

    async function createRibbon(points, options = {}) {
        return buildStaticSeries([points], options);
    }

    async function createRibbonSeries(pointsArray, options = {}) {
        return buildStaticSeries(pointsArray, options);
    }

    async function createRibbonFromDrawing(drawPoints, options = {}) {
        if (!drawPoints || drawPoints.length < 2 || !ctx.scene.value || !ctx.tileManager.value) return null;
        const processor = new Ribbon(ctx.scene.value);
        const normalized = processor.normalizeDrawingPoints(drawPoints);
        const points = processor.sanitizePoints(normalized.map(p => new THREE.Vector3(p.x, p.y, 0)));
        const smoothed = processor.smoothPoints(points, 150);
        return buildStaticSeries([smoothed], options);
    }

    async function createProceduralRibbon(sourceConfig = {}) {
        if (!ctx.scene.value || !ctx.tileManager.value) {
            console.error('[ThreeSetup] Cannot create procedural ribbon - not initialized');
            return null;
        }

        if (ctx.ribbon.value) {
            ctx.ribbon.value.dispose();
            ctx.ribbon.value = null;
        }

        if (ctx.ribbonSeries.value) {
            ctx.ribbonSeries.value.dispose();
            ctx.ribbonSeries.value = null;
        }

        const type = normalizeProceduralSourceType(sourceConfig.type || ctx.app.proceduralSourceType);
        const settings = getMergedProceduralSettings(type, sourceConfig.settings || {});

        ctx.ribbonSeries.value = new RibbonSeries(ctx.scene.value);
        configureSvgNodes(ctx.ribbonSeries.value);
        applyTileManagersToSeries(ctx.ribbonSeries.value);
        ctx.ribbonSeries.value.setHelixOptions(ctx.app.isRestoringPreset ? ctx.app.helixOptions : {
            ...ctx.app.helixOptions,
            helixMode: false,
            sphericalProjectionEnabled: false,
        });
        ctx.ribbonSeries.value.setNormalizeTextureOrientation(ctx.app.normalizeTextureOrientation);
        ctx.ribbonSeries.value.buildFromProceduralSource({ type, settings }, sourceConfig.width || 1.2, 0);

        ctx.cinematicCamera.clearROIs();
        syncProceduralSourceToStore(type, settings);

        console.log('[ThreeSetup] Created procedural ribbon:', type, ctx.ribbonSeries.value.getProceduralDebugInfo?.());

        return ctx.ribbonSeries.value;
    }

    function updateProceduralRibbon(time = 0) {
        return ctx.ribbonSeries.value?.updateProcedural?.(time) ?? null;
    }

    async function updateProceduralRibbonSettings(input = {}) {
        if (!ctx.scene.value || !ctx.tileManager.value) {
            return null;
        }

        const series = ctx.ribbonSeries.value;
        const proceduralSource = series?.proceduralSource;
        const payload = input && (
            Object.prototype.hasOwnProperty.call(input, 'type')
            || Object.prototype.hasOwnProperty.call(input, 'settings')
        )
            ? input
            : { settings: input };
        const type = normalizeProceduralSourceType(
            payload.type || proceduralSource?.type || ctx.app.proceduralSourceType
        );
        const nextSettings = getMergedProceduralSettings(type, payload.settings || {});

        if (!series || !proceduralSource || proceduralSource.type !== type) {
            return createProceduralRibbon({
                type,
                settings: nextSettings,
                width: proceduralSource?.width || series?.lastWidth || 1.2,
            });
        }

        const width = proceduralSource.width || series.lastWidth || 1.2;
        const time = proceduralSource.lastTime || 0;

        series.buildFromProceduralSource({ type, settings: nextSettings }, width, time);
        syncProceduralSourceToStore(type, nextSettings);

        return series;
    }

    /**
     * Rebuild existing ribbons with new textures
     */
    function rebuildRibbonsWithNewTextures() {
        console.log('[ThreeSetup] Rebuilding ribbons with new textures');

        // Update ribbon/series with new tileManager
        if (ctx.ribbon.value) {
            ctx.ribbon.value.setTileManager(ctx.tileManager.value);
            // Rebuild ribbon with new textures
            if (ctx.ribbon.value.lastPoints && ctx.ribbon.value.lastPoints.length >= 2) {
                ctx.ribbon.value.buildFromPoints(ctx.ribbon.value.lastPoints, ctx.ribbon.value.lastWidth || 1.2);
                console.log(`[ThreeSetup] Rebuilt single ribbon: ${ctx.ribbon.value.meshSegments?.length || 0} segments`);
            }
        }
        if (ctx.ribbonSeries.value) {
            applyTileManagersToSeries(ctx.ribbonSeries.value);
            const proceduralSource = ctx.ribbonSeries.value.proceduralSource;
            ctx.ribbonSeries.value.setHelixOptions(proceduralSource
                ? { ...ctx.app.helixOptions, helixMode: false, sphericalProjectionEnabled: false }
                : ctx.app.helixOptions
            );

            if (proceduralSource) {
                ctx.ribbonSeries.value.buildFromProceduralSource(
                    { type: proceduralSource.type, settings: proceduralSource.settings },
                    proceduralSource.width || ctx.ribbonSeries.value.lastWidth || 1.2,
                    proceduralSource.lastTime || 0
                );
                console.log(`[ThreeSetup] Rebuilt procedural ribbon texture bindings: ${ctx.ribbonSeries.value.getTotalSegmentCount()} pooled segments`);
                return;
            }

            // Rebuild ribbon series with new textures
            const sourcePaths = ctx.ribbonSeries.value.sourcePathsPoints?.length
                ? ctx.ribbonSeries.value.sourcePathsPoints
                : ctx.ribbonSeries.value.lastPathsPoints;

            if (sourcePaths && sourcePaths.length > 0) {
                ctx.ribbonSeries.value.buildFromMultiplePaths(
                    sourcePaths,
                    ctx.ribbonSeries.value.lastWidth || 1.2
                );
                syncProjectionAspect(ctx.ribbonSeries.value);
                ctx.ribbonSeries.value.initFlowMaterials();
                console.log(`[ThreeSetup] Rebuilt ribbon series: ${ctx.ribbonSeries.value.getTotalSegmentCount()} segments`);
            }
        }
    }

    /**
     * Set flow animation state
     * @param {string} state - 'off' | 'forward' | 'backward'
     */
    let flowTransitionToken = 0;

    function yieldToBrowser() {
        return new Promise((resolve) => {
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => setTimeout(resolve, 0));
                return;
            }

            setTimeout(resolve, 0);
        });
    }

    async function setFlowState(state) {
        const transitionToken = ++flowTransitionToken;
        const ribbonSeries = ctx.ribbonSeries.value;

        // Remove the old artwork before starting the expensive material rebuild.
        // The caller has already updated the store, so the loading overlay can
        // render during the browser yield below.
        ribbonSeries?.setVisible?.(false);
        await yieldToBrowser();

        if (transitionToken !== flowTransitionToken) {
            return;
        }

        try {
            const baseSpeed = ctx.app.flowSpeed || 0.25;
            // Apply flow state to ALL TileManagers (multi-texture mode)
            const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);
            for (const tm of targets) {
                if (state === 'off') {
                    tm.setFlowSpeed(baseSpeed);
                    tm.setFlowEnabled(false);
                } else {
                    const speed = state === 'forward' ? baseSpeed : -baseSpeed;
                    tm.setFlowSpeed(speed);
                    tm.setFlowEnabled(true);
                }
            }

            if (ribbonSeries?.initFlowMaterialsAsync) {
                await ribbonSeries.initFlowMaterialsAsync();
            } else if (ribbonSeries) {
                ribbonSeries.initFlowMaterials();
            }

        } catch (error) {
            console.error('[ThreeSetup] Failed to apply flow state:', error);
        }

        if (transitionToken === flowTransitionToken && ctx.app.flowState === state) {
            ribbonSeries?.setVisible?.(true);
            ctx.app.finishFlowTransition?.();
        }
    }

    /**
     * Set the base flow speed while preserving the current flow direction.
     * @param {number} speed - Positive tiles per second magnitude
     */
    function setFlowSpeed(speed) {
        const parsed = Number(speed);
        if (!Number.isFinite(parsed)) {
            return;
        }

        const baseSpeed = Math.max(0.05, parsed);
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);
        const directionMultiplier = ctx.app.flowState === 'backward' ? -1 : 1;

        for (const tm of targets) {
            tm.setFlowSpeed(directionMultiplier * baseSpeed);
        }

        ctx.app.setFlowSpeed(baseSpeed);
    }

    /**
     * Enable or disable automatic flow-cycle alignment to the texture cycle.
     * @param {boolean} enabled
     */
    function setFlowCycleAlignmentEnabled(enabled) {
        const nextEnabled = !!enabled;
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);

        for (const tm of targets) {
            tm.setFlowAlignmentEnabled?.(nextEnabled);
        }

        ctx.app.setFlowCycleAlignmentEnabled(nextEnabled);
    }

    /**
     * Enable or disable KTX2 layer animation across all active TileManagers.
     * @param {boolean} enabled
     */
    function setTextureAnimationEnabled(enabled) {
        const nextEnabled = !!enabled;
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);

        for (const tm of targets) {
            tm.setLayerAnimationEnabled?.(nextEnabled);
        }

        ctx.app.setTextureAnimationEnabled(nextEnabled);
    }

    /**
     * Reverse or restore the KTX2 layer-cycle direction across all active TileManagers.
     * @param {boolean} reversed
     */
    function setTextureAnimationReversed(reversed) {
        const nextReversed = !!reversed;
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);

        for (const tm of targets) {
            tm.setLayerAnimationReversed?.(nextReversed);
        }

        ctx.app.setTextureAnimationReversed(nextReversed);
    }

    /**
     * Set texture repeat mode.
     * @param {string} mode - 'wrap' | 'mirrorTile'
     */
    function setTextureRepeatMode(mode) {
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);
        for (const tm of targets) {
            tm.setRepeatMode?.(mode);
        }

        ctx.app.setTextureRepeatMode(mode);

        if (ctx.ribbonSeries.value) {
            ctx.ribbonSeries.value.initFlowMaterials();
        }
    }

    /**
     * Flip or restore the vertical texture orientation across all active TileManagers.
     * @param {boolean} enabled
     */
    function setTextureFlipVertical(enabled) {
        const nextEnabled = !!enabled;
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);

        for (const tm of targets) {
            tm.setVerticalFlip?.(nextEnabled);
        }

        ctx.app.setTextureFlipVertical(nextEnabled);
    }

    function setNormalizeTextureOrientation(enabled) {
        const nextEnabled = !!enabled;
        ctx.app.setNormalizeTextureOrientation(nextEnabled);

        if (ctx.ribbonSeries.value) {
            ctx.ribbonSeries.value.setNormalizeTextureOrientation(nextEnabled);
            ctx.ribbonSeries.value.initFlowMaterials();
        }
    }

    /**
     * Sync the current scene color-adjustment spike state into ribbon materials.
     * While gradient mapping is active, the fullscreen path remains authoritative.
     */
    function syncSceneColorAdjustments() {
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);
        const useRibbonAdjustments = ctx.app.renderFilterMode !== 'gradientMap';
        const contrast = useRibbonAdjustments ? ctx.app.contrast : 1;
        const saturation = useRibbonAdjustments ? ctx.app.saturation : 1;

        for (const tm of targets) {
            tm.setContrast?.(contrast);
            tm.setSaturation?.(saturation);
        }
    }

    /**
     * Set ribbon-local contrast for the current spike path.
     * @param {number} value
     */
    function setContrast(value) {
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);
        const normalized = Number.isFinite(Number(value)) ? Number(value) : ctx.app.contrast;

        for (const tm of targets) {
            tm.setContrast?.(ctx.app.renderFilterMode !== 'gradientMap' ? normalized : 1);
        }

        return normalized;
    }

    /**
     * Set ribbon-local saturation for the current spike path.
     * @param {number} value
     */
    function setSaturation(value) {
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);
        const normalized = Number.isFinite(Number(value)) ? Number(value) : ctx.app.saturation;

        for (const tm of targets) {
            tm.setSaturation?.(ctx.app.renderFilterMode !== 'gradientMap' ? normalized : 1);
        }

        return normalized;
    }

    /**
     * Set the maximum shader edge-noise cut-in across all active TileManagers.
     * @param {number} value - Fraction of total ribbon width, 0..0.5
     */
    function setEdgeNoiseTransparencyMax(value) {
        const normalized = ctx.app.setEdgeNoiseTransparencyMax(value);
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);

        for (const tm of targets) {
            tm.setEdgeNoiseTransparencyMax?.(normalized);
        }
    }

    /**
     * Set whether Edge Drift is active across all TileManagers.
     * @param {boolean} enabled
     */
    function setEdgeDriftEnabled(enabled) {
        const normalized = ctx.app.setEdgeDriftEnabled(enabled);
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);

        for (const tm of targets) {
            tm.setEdgeDriftEnabled?.(normalized);
        }
    }

    /**
     * Set the shader edge-noise pattern length across all active TileManagers.
     * @param {number} value - Ribbon segments per full noise loop
     */
    function setEdgeNoisePatternLength(value) {
        const normalized = ctx.app.setEdgeNoisePatternLength(value);
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);

        for (const tm of targets) {
            tm.setEdgeNoisePatternLength?.(normalized);
        }
    }

    /**
     * Set whether the edge-noise shape mirrors across both ribbon edges.
     * @param {boolean} enabled
     */
    function setEdgeNoiseMirrored(enabled) {
        const normalized = ctx.app.setEdgeNoiseMirrored(enabled);
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);

        for (const tm of targets) {
            tm.setEdgeNoiseMirrored?.(normalized);
        }
    }

    /**
     * Set whether Filmstrip Style cutouts are active across all TileManagers.
     * @param {boolean} enabled
     */
    function setFilmstripStyleEnabled(enabled) {
        const normalized = ctx.app.setFilmstripStyleEnabled(enabled);
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);

        for (const tm of targets) {
            tm.setFilmstripStyleEnabled?.(normalized);
        }
    }

    /** Apply filmstrip motion settings across all active TileManagers. */
    function setFilmstripMotionEnabled(enabled) {
        const normalized = ctx.app.setFilmstripMotionEnabled(enabled);
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);
        for (const tm of targets) tm.setFilmstripMotionEnabled(normalized);
    }

    function setFilmstripMotionSpeed(value) {
        const normalized = ctx.app.setFilmstripMotionSpeed(value);
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);
        for (const tm of targets) tm.setFilmstripMotionSpeed(normalized);
    }

    /**
     * Set filmstrip hole spacing across all TileManagers.
     * @param {number} value
     */
    function setFilmstripGapLength(value) {
        const normalized = ctx.app.setFilmstripGapLength(value);
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);

        for (const tm of targets) {
            tm.setFilmstripGapLength?.(normalized);
        }
    }

    /**
     * Set filmstrip hole length across all TileManagers.
     * @param {number} value
     */
    function setFilmstripHoleLength(value) {
        const normalized = ctx.app.setFilmstripHoleLength(value);
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);

        for (const tm of targets) {
            tm.setFilmstripHoleLength?.(normalized);
        }
    }

    /**
     * Set filmstrip aperture across all TileManagers.
     * @param {number} value
     */
    function setFilmstripAperture(value) {
        const normalized = ctx.app.setFilmstripAperture(value);
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);

        for (const tm of targets) {
            tm.setFilmstripAperture?.(normalized);
        }
    }

    /**
     * Set filmstrip hole roundedness across all TileManagers.
     * @param {number} value
     */
    function setFilmstripHoleRoundedness(value) {
        const normalized = ctx.app.setFilmstripHoleRoundedness(value);
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);

        for (const tm of targets) {
            tm.setFilmstripHoleRoundedness?.(normalized);
        }
    }

    /**
     * Apply helix mode options and rebuild ribbons
     * Called when helix toggle or parameters change in the store
     * @param {object} options - { helixMode, helixRadius, helixPitch, helixStrandWidth }
     */
    function setHelixMode(options) {
        const series = ctx.ribbonSeries.value;
        if (!series) return true;
        if (series.proceduralSource) {
            series.setHelixOptions({ ...options, gridRepeatEnabled: false, helixMode: false, sphericalProjectionEnabled: false });
            return true;
        }
        if (Object.entries(options).every(([key, value]) => series._helixOptions[key] === value)) return true;
        const previous = { ...series._helixOptions };
        const next = { ...previous, ...options };
        let prepared;
        try {
            prepared = series._resolveGeometryPaths(series.sourcePathsPoints, series.lastWidth, next);
        } catch (error) {
            if (!(error instanceof GridRepeatLimitError)) throw error;
            // Restore the recipe too, so a later export/preset cannot save
            // rejected settings while showing the previous geometry.
            const rollback = Object.fromEntries(Object.entries(previous)
                .filter(([key, value]) => key in ctx.app && value != null));
            if (ctx.app.$patch) ctx.app.$patch(rollback);
            else Object.assign(ctx.app, rollback);
            syncProjectionAspect(series);
            ctx.app.gridRepeatError = error.message;
            return false;
        }
        const changedSvgMode = previous.svgSmoothNodesEnabled !== next.svgSmoothNodesEnabled;
        const changedGrid = Object.keys(GRID_REPEAT_DEFAULTS)
            .some(key => previous[key] !== next[key]);
        series.setHelixOptions(next);
        series.rebuildUpdate(performance.now() / 1000, prepared);
        syncProjectionAspect(series);
        ctx.app.gridRepeatError = '';
        if (changedSvgMode && series.svgNodes?.length) ctx.cinematicCamera.clearROIs();
        else if (changedGrid) ctx.cinematicCamera.invalidateAutoROIs?.();
        return true;
    }

    return {
        applyTileManagersToSeries,
        createRibbon,
        createRibbonSeries,
        createRibbonFromDrawing,
        createProceduralRibbon,
        updateProceduralRibbon,
        updateProceduralRibbonSettings,
        rebuildRibbonsWithNewTextures,
        setFlowState,
        setFlowSpeed,
        setFlowCycleAlignmentEnabled,
        setTextureAnimationEnabled,
        setTextureAnimationReversed,
        setTextureRepeatMode,
        setTextureFlipVertical,
        setNormalizeTextureOrientation,
        syncSceneColorAdjustments,
        setContrast,
        setSaturation,
        setEdgeDriftEnabled,
        setEdgeNoiseTransparencyMax,
        setEdgeNoisePatternLength,
        setEdgeNoiseMirrored,
        setFilmstripStyleEnabled,
        setFilmstripGapLength,
        setFilmstripMotionEnabled,
        setFilmstripMotionSpeed,
        setFilmstripHoleLength,
        setFilmstripAperture,
        setFilmstripHoleRoundedness,
        setHelixMode
    };
}
