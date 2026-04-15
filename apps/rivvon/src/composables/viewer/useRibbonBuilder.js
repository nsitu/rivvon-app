// src/composables/viewer/useRibbonBuilder.js
// Ribbon creation, rebuilding, flow animation, and helix mode

import * as THREE from 'three';
import { Ribbon } from '../../modules/viewer/ribbon';
import { RibbonSeries } from '../../modules/viewer/ribbonSeries';

/**
 * Manages ribbon geometry lifecycle: creation from points / drawings,
 * texture rebinding, flow animation state, and helix mode toggling.
 *
 * @param {Object} ctx - Shared context refs from useThreeSetup
 */
export function useRibbonBuilder(ctx) {

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
        
        // Build from single path (wrapped in array)
        ctx.ribbonSeries.value.buildFromMultiplePaths([points], options.width || 1.2);
        ctx.ribbonSeries.value.initFlowMaterials();

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
        
        // Build from multiple paths
        ctx.ribbonSeries.value.buildFromMultiplePaths(pointsArray, options.width || 1.2);
        ctx.ribbonSeries.value.initFlowMaterials();

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
        
        // Build from processed points
        ctx.ribbonSeries.value.buildFromMultiplePaths([smoothedPoints], options.width || 1.2);
        ctx.ribbonSeries.value.initFlowMaterials();

        // New geometry invalidates all previous ROIs
        ctx.cinematicCamera.clearROIs();

        console.log('[ThreeSetup] Created ribbon from drawing (via series) with', drawPoints.length, 'input points');

        return ctx.ribbonSeries.value;
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
            ctx.ribbonSeries.value.setHelixOptions(ctx.app.helixOptions);
            // Rebuild ribbon series with new textures
            if (ctx.ribbonSeries.value.lastPathsPoints && ctx.ribbonSeries.value.lastPathsPoints.length > 0) {
                ctx.ribbonSeries.value.buildFromMultiplePaths(
                    ctx.ribbonSeries.value.lastPathsPoints, 
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
        for (const tm of targets) {
            if (state === 'off') {
                tm.setFlowEnabled(false);
            } else {
                const speed = state === 'forward' ? baseSpeed : -baseSpeed;
                tm.setFlowSpeed(speed);
                tm.setFlowEnabled(true);
            }
        }
        ctx.app.setFlowState(state);
    }

    /**
     * Set texture repeat mode.
     * @param {string} mode - 'wrap' | 'mirrorBounce'
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
     * Apply helix mode options and rebuild ribbons
     * Called when helix toggle or parameters change in the store
     * @param {object} options - { helixMode, helixRadius, helixPitch, helixStrandWidth }
     */
    function setHelixMode(options) {
        if (!ctx.ribbonSeries.value) return;

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
        rebuildRibbonsWithNewTextures,
        setFlowState,
        setTextureRepeatMode,
        setHelixMode
    };
}
