// src/composables/viewer/useRibbonBuilder.js
// Ribbon creation, rebuilding, flow animation, and helix mode

import * as THREE from 'three';
import { Ribbon } from '../../modules/viewer/ribbon';
import { RibbonSeries } from '../../modules/viewer/ribbonSeries';
import {
    DEFAULT_CLOCK_SETTINGS,
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

    function getDefaultProceduralSettings(type) {
        return type === 'clock'
            ? DEFAULT_CLOCK_SETTINGS
            : DEFAULT_SINE_WAVE_SETTINGS;
    }

    function getStoredProceduralSettings(type) {
        return type === 'clock'
            ? (ctx.app.clockSettings || DEFAULT_CLOCK_SETTINGS)
            : (ctx.app.sineWaveSettings || DEFAULT_SINE_WAVE_SETTINGS);
    }

    function getMergedProceduralSettings(type, overrides = {}) {
        return {
            ...getDefaultProceduralSettings(type),
            ...getStoredProceduralSettings(type),
            ...overrides,
        };
    }

    function syncProceduralSourceToStore(type, settings) {
        ctx.app.setProceduralSourceType?.(type);
        ctx.app.setProceduralPathMode?.(type);

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

    /**
     * Create a ribbon from points
     * Note: Uses RibbonSeries internally for consistent animation behavior
     */
    async function createRibbon(points, options = {}) {
        if (!ctx.scene.value || !ctx.tileManager.value) {
            console.error('[ThreeSetup] Cannot create ribbon - not initialized');
            return null;
        }

        // Remove existing ribbon if any
        if (ctx.ribbon.value) {
            ctx.ribbon.value.dispose();
            ctx.ribbon.value = null;
        }
        
        // Remove existing series if any
        if (ctx.ribbonSeries.value) {
            ctx.ribbonSeries.value.dispose();
            ctx.ribbonSeries.value = null;
        }

        // Use RibbonSeries even for single path to ensure consistent animation
        // (wave undulation and texture flow work the same way)
        ctx.ribbonSeries.value = new RibbonSeries(ctx.scene.value);
        applyTileManagersToSeries(ctx.ribbonSeries.value);
        ctx.ribbonSeries.value.setHelixOptions(ctx.app.helixOptions);
        ctx.ribbonSeries.value.setNormalizeTextureOrientation(ctx.app.normalizeTextureOrientation);
        
        // Build from single path (wrapped in array)
        ctx.ribbonSeries.value.buildFromMultiplePaths([points], options.width || 1.2);
        ctx.ribbonSeries.value.initFlowMaterials();
        ctx.app.setProceduralPathMode?.(null);

        // New geometry invalidates all previous ROIs
        ctx.cinematicCamera.clearROIs();

        console.log('[ThreeSetup] Created ribbon (via series) with 1 path');

        return ctx.ribbonSeries.value;
    }

    /**
     * Create ribbon series from multiple paths
     */
    async function createRibbonSeries(pointsArray, options = {}) {
        if (!ctx.scene.value || !ctx.tileManager.value) {
            console.error('[ThreeSetup] Cannot create ribbon series - not initialized');
            return null;
        }

        // Remove existing ribbon if any
        if (ctx.ribbon.value) {
            ctx.ribbon.value.dispose();
            ctx.ribbon.value = null;
        }
        
        // Remove existing series if any
        if (ctx.ribbonSeries.value) {
            ctx.ribbonSeries.value.dispose();
            ctx.ribbonSeries.value = null;
        }

        // Create new ribbon series - constructor only takes scene
        ctx.ribbonSeries.value = new RibbonSeries(ctx.scene.value);
        applyTileManagersToSeries(ctx.ribbonSeries.value);
        ctx.ribbonSeries.value.setHelixOptions(ctx.app.helixOptions);
        ctx.ribbonSeries.value.setNormalizeTextureOrientation(ctx.app.normalizeTextureOrientation);
        
        // Build from multiple paths
        ctx.ribbonSeries.value.buildFromMultiplePaths(pointsArray, options.width || 1.2);
        ctx.ribbonSeries.value.initFlowMaterials();
        ctx.app.setProceduralPathMode?.(null);

        // New geometry invalidates all previous ROIs
        ctx.cinematicCamera.clearROIs();

        console.log('[ThreeSetup] Created ribbon series with', pointsArray.length, 'paths');

        return ctx.ribbonSeries.value;
    }

    /**
     * Create ribbon from raw drawing points (2D screen coordinates)
     * This handles the conversion from {x,y} to THREE.Vector3 internally
     * Note: Uses RibbonSeries internally for consistent animation behavior
     */
    async function createRibbonFromDrawing(drawPoints, options = {}) {
        if (!ctx.scene.value || !ctx.tileManager.value) {
            console.error('[ThreeSetup] Cannot create ribbon - not initialized');
            return null;
        }

        if (!drawPoints || drawPoints.length < 2) {
            console.warn('[ThreeSetup] Not enough points for ribbon');
            return null;
        }

        // Remove existing ribbon if any
        if (ctx.ribbon.value) {
            ctx.ribbon.value.dispose();
            ctx.ribbon.value = null;
        }
        
        // Remove existing series if any
        if (ctx.ribbonSeries.value) {
            ctx.ribbonSeries.value.dispose();
            ctx.ribbonSeries.value = null;
        }

        // Create a temporary Ribbon to process the drawing points
        // (normalization, smoothing, etc.)
        const tempRibbon = new Ribbon(ctx.scene.value);
        
        // Get the processed points without actually building the ribbon
        const normalizedPoints = tempRibbon.normalizeDrawingPoints(drawPoints);
        const points3D = normalizedPoints.map(p => new THREE.Vector3(p.x, p.y, 0));
        const sanitizedPoints = tempRibbon.sanitizePoints(points3D);
        const smoothedPoints = tempRibbon.smoothPoints(sanitizedPoints, 150);

        // Use RibbonSeries for consistent animation behavior
        ctx.ribbonSeries.value = new RibbonSeries(ctx.scene.value);
        applyTileManagersToSeries(ctx.ribbonSeries.value);
        ctx.ribbonSeries.value.setHelixOptions(ctx.app.helixOptions);
        ctx.ribbonSeries.value.setNormalizeTextureOrientation(ctx.app.normalizeTextureOrientation);
        
        // Build from processed points
        ctx.ribbonSeries.value.buildFromMultiplePaths([smoothedPoints], options.width || 1.2);
        ctx.ribbonSeries.value.initFlowMaterials();
        ctx.app.setProceduralPathMode?.(null);

        // New geometry invalidates all previous ROIs
        ctx.cinematicCamera.clearROIs();

        console.log('[ThreeSetup] Created ribbon from drawing (via series) with', drawPoints.length, 'input points');

        return ctx.ribbonSeries.value;
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
        applyTileManagersToSeries(ctx.ribbonSeries.value);
        ctx.ribbonSeries.value.setHelixOptions({
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
                ctx.ribbonSeries.value.initFlowMaterials();
                console.log(`[ThreeSetup] Rebuilt ribbon series: ${ctx.ribbonSeries.value.getTotalSegmentCount()} segments`);
            }
        }
    }

    /**
     * Set flow animation state
     * @param {string} state - 'off' | 'forward' | 'backward'
     */
    function setFlowState(state) {
        const baseSpeed = ctx.app.flowSpeed || 0.25;
        // Apply flow state to ALL TileManagers (multi-texture mode)
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);
        let directionChanged = false;
        for (const tm of targets) {
            if (state === 'off') {
                tm.setFlowEnabled(false);
            } else {
                const speed = state === 'forward' ? baseSpeed : -baseSpeed;
                directionChanged = tm.setFlowSpeed(speed) || directionChanged;
                tm.setFlowEnabled(true);
            }
        }
        ctx.app.setFlowState(state);

        if (directionChanged && ctx.ribbonSeries.value) {
            ctx.ribbonSeries.value.initFlowMaterials();
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
     * While duotone is active, the fullscreen path remains authoritative.
     */
    function syncSceneColorAdjustments() {
        const targets = ctx.tileManagers.value.length > 0 ? ctx.tileManagers.value : (ctx.tileManager.value ? [ctx.tileManager.value] : []);
        const useRibbonAdjustments = ctx.app.renderFilterMode !== 'duotone';
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
            tm.setContrast?.(ctx.app.renderFilterMode !== 'duotone' ? normalized : 1);
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
            tm.setSaturation?.(ctx.app.renderFilterMode !== 'duotone' ? normalized : 1);
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
        if (!ctx.ribbonSeries.value) return;

        if (ctx.ribbonSeries.value.proceduralSource) {
            ctx.ribbonSeries.value.setHelixOptions({
                ...options,
                helixMode: false,
                sphericalProjectionEnabled: false,
            });
            return;
        }

        ctx.ribbonSeries.value.setHelixOptions(options);

        // Rebuild geometry with new helix params
        if (ctx.ribbonSeries.value.lastPathsPoints && ctx.ribbonSeries.value.lastPathsPoints.length > 0) {
            ctx.ribbonSeries.value.rebuildUpdate(performance.now() / 1000);
            ctx.ribbonSeries.value.initFlowMaterials();
            console.log(`[ThreeSetup] Rebuilt ribbons with helix mode: ${options.helixMode}`);
        }
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
        setFilmstripHoleLength,
        setFilmstripAperture,
        setFilmstripHoleRoundedness,
        setHelixMode
    };
}
