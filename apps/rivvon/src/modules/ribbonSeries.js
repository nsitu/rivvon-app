/**
 * RibbonSeries - Manages multiple ribbons rendered together with continuous texturing
 */

import { Ribbon } from './ribbon.js';

export class RibbonSeries {
    /**
     * Create a new ribbon series
     * @param {THREE.Scene} scene - The Three.js scene to add ribbons to
     */
    constructor(scene) {
        this.scene = scene;
        this.ribbons = [];           // Array of Ribbon instances
        this.tileManager = null;
        this.totalSegmentCount = 0;  // For tracking total segments across all ribbons
        this.lastPathsPoints = [];   // Store for animation updates
        this.lastWidth = 1;
    }

    /**
     * Set the tile manager for texturing
     * @param {TileManager} tileManager - The tile manager instance
     * @returns {RibbonSeries} this for chaining
     */
    setTileManager(tileManager) {
        this.tileManager = tileManager;
        return this;
    }

    /**
     * Build ribbons from multiple path point arrays
     * @param {Array<Array<THREE.Vector3>>} pathsPoints - Array of point arrays (one per path)
     * @param {number} width - Ribbon width
     * @param {number} time - Animation time
     * @returns {Array<Ribbon>} The created ribbons
     */
    buildFromMultiplePaths(pathsPoints, width = 1, time = 0) {
        if (!pathsPoints || pathsPoints.length === 0) {
            console.warn('[RibbonSeries] No paths provided');
            return [];
        }

        console.log('[RibbonSeries] Building from', pathsPoints.length, 'paths');

        // Clean up existing ribbons first
        this.cleanup();

        // Store for animation updates (after cleanup so we don't lose the new data)
        this.lastPathsPoints = pathsPoints.map(points =>
            points.map(p => p.clone())
        );
        this.lastWidth = width;

        let segmentOffset = 0;  // Track cumulative segment count for texture continuity

        for (let i = 0; i < pathsPoints.length; i++) {
            const points = pathsPoints[i];

            if (points.length < 2) {
                console.warn(`[RibbonSeries] Path ${i} has insufficient points, skipping`);
                continue;
            }

            const ribbon = new Ribbon(this.scene);

            if (this.tileManager) {
                ribbon.setTileManager(this.tileManager);
            }

            // Set segment offset for continuous texture indexing
            ribbon.setSegmentOffset(segmentOffset);

            // Build the ribbon
            ribbon.buildFromPoints(points, width, time);

            // Update offset for next ribbon
            segmentOffset += ribbon.meshSegments.length;

            this.ribbons.push(ribbon);

            console.log(`[RibbonSeries] Ribbon ${i}: ${ribbon.meshSegments.length} segments, offset was ${segmentOffset - ribbon.meshSegments.length}`);
        }

        this.totalSegmentCount = segmentOffset;
        console.log(`[RibbonSeries] Total segments across all ribbons: ${this.totalSegmentCount}`);

        return this.ribbons;
    }

    /**
     * Build a single ribbon (for backward compatibility)
     * @param {Array<THREE.Vector3>} points - Array of points for a single path
     * @param {number} width - Ribbon width
     * @param {number} time - Animation time
     * @returns {Array<Ribbon>} The created ribbon (in array for consistency)
     */
    buildFromPoints(points, width = 1, time = 0) {
        return this.buildFromMultiplePaths([points], width, time);
    }

    /**
     * Update all ribbons (for animation)
     * @param {number} time - Animation time
     */
    update(time) {
        if (this.lastPathsPoints.length > 0) {
            this.buildFromMultiplePaths(this.lastPathsPoints, this.lastWidth, time);
        }
    }

    /**
     * Initialize materials for all segments.
     * Uses dual-texture flow materials when flow is enabled,
     * or shared single-texture materials when flow is disabled (optimized).
     * Should be called once after building ribbons.
     */
    initFlowMaterials() {
        if (!this.tileManager) return;

        // Clear any existing flow materials tracked by TileManager
        this.tileManager.clearFlowMaterials?.();

        // Track segment info for later updates
        this._flowMaterials = [];

        // Check if flow animation is active
        const flowActive = this.tileManager.isFlowEnabled?.() && this.tileManager.getFlowSpeed?.() !== 0;

        let globalSegmentIndex = 0;

        for (const ribbon of this.ribbons) {
            for (const mesh of ribbon.meshSegments) {
                let material;
                
                if (flowActive) {
                    // Flow enabled: create dual-texture material for smooth animation
                    material = this.tileManager.createFlowMaterial(globalSegmentIndex);
                } else {
                    // Flow disabled: use shared single-texture material (optimized)
                    const textureIndex = globalSegmentIndex + this.tileManager.getTileFlowOffset();
                    material = this.tileManager.getMaterial(textureIndex);
                }
                
                if (material) {
                    mesh.material = material;
                    this._flowMaterials.push({
                        mesh,
                        material,
                        baseIndex: globalSegmentIndex
                    });
                }

                globalSegmentIndex++;
            }
        }

        // Store state for detecting changes
        this._lastTileOffset = this.tileManager.getTileFlowOffset?.() || 0;
        this._flowWasActive = flowActive;

        console.log(`[RibbonSeries] Initialized ${this._flowMaterials.length} materials (flow ${flowActive ? 'enabled - dual texture' : 'disabled - single texture'})`);
    }

    /**
     * Update flow materials when tile offset changes (texture pair swap).
     * This creates the continuous conveyor belt effect.
     * Call this from the animation loop after tileManager.tick().
     */
    updateFlowMaterials() {
        if (!this.tileManager || !this._flowMaterials) return;

        // Check if flow state has changed (enabled/disabled)
        const flowActive = this.tileManager.isFlowEnabled?.() && this.tileManager.getFlowSpeed?.() !== 0;
        
        if (flowActive !== this._flowWasActive) {
            // Flow state changed - reinitialize with appropriate material type
            console.log(`[RibbonSeries] Flow state changed, reinitializing materials`);
            this.initFlowMaterials();
            return;
        }

        // If flow is not active, nothing to update each frame
        if (!flowActive) return;

        // Check if flowOffset has crossed 1.0 (or gone below 0.0 for reverse)
        const flowOffset = this.tileManager.getFlowOffset?.() || 0;
        
        if (flowOffset >= 1.0 || flowOffset < 0.0) {
            // Need to swap texture pairs and wrap the offset
            
            // Calculate how many whole tiles to shift
            let wholeTiles;
            if (flowOffset >= 1.0) {
                wholeTiles = Math.floor(flowOffset);
            } else {
                wholeTiles = Math.ceil(flowOffset) - 1; // negative
            }

            // Update tile offset in TileManager
            this.tileManager.wrapFlowOffset(wholeTiles);

            // Clear tracked materials from TileManager
            this.tileManager.clearFlowMaterials?.();

            // Create new materials for each segment with updated tile pairs
            for (const entry of this._flowMaterials) {
                const { mesh, baseIndex } = entry;
                
                // Create new dual-texture material with updated tile pair
                const newMaterial = this.tileManager.createFlowMaterial(baseIndex);
                
                if (newMaterial) {
                    mesh.material = newMaterial;
                    entry.material = newMaterial;
                }
            }
        }

        // The continuous flow offset is handled by the shared uniform in shaders
        // WebGPU uniforms are updated in TileManager.tick()
    }

    /**
     * Get the total number of segments across all ribbons
     * @returns {number} Total segment count
     */
    getTotalSegmentCount() {
        return this.totalSegmentCount;
    }

    /**
     * Get all ribbon instances
     * @returns {Array<Ribbon>} Array of ribbons
     */
    getRibbons() {
        return this.ribbons;
    }

    /**
     * Get a specific ribbon by index
     * @param {number} index - Ribbon index
     * @returns {Ribbon|null} The ribbon or null if not found
     */
    getRibbon(index) {
        return this.ribbons[index] || null;
    }

    /**
     * Clean up all ribbons and clear cached path data
     */
    cleanup() {
        this.ribbons.forEach(ribbon => ribbon.dispose());
        this.ribbons = [];
        this._flowMaterials = [];
        this._lastTileOffset = 0;
        this._flowWasActive = false;
        this.totalSegmentCount = 0;
        this.lastPathsPoints = [];
        this.lastWidth = 1;
    }

    /**
     * Dispose of all resources
     */
    dispose() {
        this.cleanup();
    }
}
