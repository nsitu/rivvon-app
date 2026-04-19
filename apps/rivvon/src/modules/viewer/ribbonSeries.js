/**
 * RibbonSeries - Manages multiple ribbons rendered together with continuous texturing
 */

import { Box3, Group, Vector3 } from 'three';
import { Ribbon } from './ribbon.js';
import { DEFAULT_CAP_STYLE } from './capProfiles.js';

export class RibbonSeries {
    /**
     * Create a new ribbon series
     * @param {THREE.Scene} scene - The Three.js scene to add ribbons to
     */
    constructor(scene) {
        this.scene = scene;
        this.ribbons = [];           // Array of Ribbon instances
        this.tileManager = null;
        this.tileManagers = [];      // Array of TileManagers for multi-texture mode
        this.totalSegmentCount = 0;  // For tracking total segments across all ribbons
        this.lastPathsPoints = [];   // Store for animation updates
        this.lastWidth = 1;
        this._flowMaterials = [];    // Track materials for flow updates
        this._flowWasActive = null;  // Track last flow state (null = not yet initialized)

        // Round-robin mapping: each entry is { ribbon, strand, tileManager }
        this._strandTileManagerMap = [];

        // Shared transform root so head tracking can move the artwork
        // without touching the background or other scene content.
        this._bounds = new Box3();
        this._pivotCenter = new Vector3();
        this._transformRoot = new Group();
        this._transformRoot.name = 'RibbonSeriesRoot';
        this._contentGroup = new Group();
        this._contentGroup.name = 'RibbonSeriesContent';
        this._transformRoot.add(this._contentGroup);
        this.scene.add(this._transformRoot);

        // Helix mode options (forwarded to each Ribbon)
        this._helixOptions = {
            helixMode: false,
            helixRadius: 0.4,
            helixPitch: 4,
            helixStrandWidth: 0.3,
            capStyle: DEFAULT_CAP_STYLE,
            cornerNarrowingEnabled: false,
        };
    }

    /**
     * Set helix mode parameters, forwarded to all child ribbons
     * @param {object} options - { helixMode, helixRadius, helixPitch, helixStrandWidth, capStyle, cornerNarrowingEnabled }
     * @returns {RibbonSeries} this for chaining
     */
    setHelixOptions(options = {}) {
        Object.assign(this._helixOptions, options);
        // Forward to all existing ribbons
        for (const ribbon of this.ribbons) {
            ribbon.setHelixOptions(this._helixOptions);
        }
        return this;
    }

    /**
     * Set the tile manager for texturing (single-texture mode)
     * @param {TileManager} tileManager - The tile manager instance
     * @returns {RibbonSeries} this for chaining
     */
    setTileManager(tileManager) {
        this.tileManager = tileManager;
        this.tileManagers = [tileManager];
        return this;
    }

    /**
     * Set multiple tile managers for multi-texture mode.
     * Textures are distributed round-robin across strands.
     * @param {TileManager[]} tileManagers - Array of TileManager instances
     * @returns {RibbonSeries} this for chaining
     */
    setTileManagers(tileManagers) {
        this.tileManagers = tileManagers;
        this.tileManager = tileManagers[0] || null;
        return this;
    }

    _updateTransformRoot(pathsPoints) {
        this._bounds.makeEmpty();

        for (const points of pathsPoints) {
            for (const point of points) {
                this._bounds.expandByPoint(point);
            }
        }

        if (this._bounds.isEmpty()) {
            this._pivotCenter.set(0, 0, 0);
        } else {
            this._bounds.getCenter(this._pivotCenter);
        }

        this._transformRoot.position.copy(this._pivotCenter);
        this._contentGroup.position.copy(this._pivotCenter).multiplyScalar(-1);
        this._contentGroup.quaternion.identity();
        this._contentGroup.scale.setScalar(1);
        this._transformRoot.updateMatrixWorld(true);
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

       // console.log('[RibbonSeries] Building from', pathsPoints.length, 'paths');

        // Clean up existing ribbons first
        this.cleanup();

        // Store for animation updates (after cleanup so we don't lose the new data)
        this.lastPathsPoints = pathsPoints.map(points =>
            points.map(p => p.clone())
        );
        this.lastWidth = width;
        this._updateTransformRoot(this.lastPathsPoints);

        let segmentOffset = 0;  // Track cumulative segment count for texture continuity
        const N = this.tileManagers.length; // Number of available TileManagers
        let textureIndex = 0; // Running index for round-robin TileManager assignment

        for (let i = 0; i < pathsPoints.length; i++) {
            const points = pathsPoints[i];

            if (points.length < 2) {
                console.warn(`[RibbonSeries] Path ${i} has insufficient points, skipping`);
                continue;
            }

            const ribbon = new Ribbon(this._contentGroup);

            // Assign TileManager for strand A via round-robin
            const tmA = N > 0 ? this.tileManagers[textureIndex % N] : this.tileManager;
            if (tmA) {
                ribbon.setTileManager(tmA);
            }
            this._strandTileManagerMap.push({ ribbon, strand: 'A', tileManager: tmA });
            textureIndex++;

            // Apply helix options before building
            ribbon.setHelixOptions(this._helixOptions);

            // If helix mode and multiple textures, assign strand B a different TileManager
            if (this._helixOptions.helixMode && N > 1) {
                const tmB = this.tileManagers[textureIndex % N];
                ribbon.setTileManagerB(tmB);
                this._strandTileManagerMap.push({ ribbon, strand: 'B', tileManager: tmB });
                textureIndex++;
            } else if (this._helixOptions.helixMode) {
                // Single texture: strand B uses same TileManager (existing behavior)
                this._strandTileManagerMap.push({ ribbon, strand: 'B', tileManager: tmA });
            }

            // Set segment offset for continuous texture indexing
            ribbon.setSegmentOffset(segmentOffset);

            // Build the ribbon
            ribbon.buildFromPoints(points, width, time);

            // Update offset for next ribbon
            segmentOffset += ribbon.meshSegments.length;

            this.ribbons.push(ribbon);

            // console.log(`[RibbonSeries] Ribbon ${i}: ${ribbon.meshSegments.length} segments, offset was ${segmentOffset - ribbon.meshSegments.length}`);
        }

        this.totalSegmentCount = segmentOffset;
        //console.log(`[RibbonSeries] Total segments across all ribbons: ${this.totalSegmentCount}`);

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
     * Uses efficient in-place position updates instead of full geometry rebuild
     * @param {number} time - Animation time
     */
    update(time) {
        if (this.ribbons.length === 0) return;

        // Use efficient in-place wave animation update
        for (const ribbon of this.ribbons) {
            ribbon.updateWaveAnimation(time);
        }
    }

    /**
     * Full rebuild update (expensive - recreates all geometry and materials)
     * Use this when ribbon paths change, not for regular animation
     * @param {number} time - Animation time
     */
    rebuildUpdate(time) {
        if (this.lastPathsPoints.length > 0) {
            // Preserve flow state before rebuild
            const wasActive = this._flowWasActive;
            
            this.buildFromMultiplePaths(this.lastPathsPoints, this.lastWidth, time);
            
            // Restore flow state
            this._flowWasActive = wasActive;
            this.initFlowMaterials();
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

        // Clear any existing flow materials tracked by all TileManagers
        for (const tm of this.tileManagers) {
            tm.clearFlowMaterials?.();
        }

        // Track segment info for later updates
        this._flowMaterials = [];

        // Check if flow animation is active
        const flowActive = this.tileManager.isFlowEnabled?.() && this.tileManager.getFlowSpeed?.() !== 0;

        let globalSegmentIndex = 0;

        for (const ribbon of this.ribbons) {
            // Determine TileManagers for each strand
            const tmA = ribbon.tileManager || this.tileManager;
            const tmB = ribbon.tileManagerB || tmA;

            for (let s = 0; s < ribbon.meshSegments.length; s++) {
                const mesh = ribbon.meshSegments[s];
                const material = tmA.getOrCreateMaterialForSegment(globalSegmentIndex, flowActive);
                
                if (material) {
                    mesh.material = material;
                    this._flowMaterials.push({
                        mesh,
                        material,
                        baseIndex: globalSegmentIndex,
                        tileManager: tmA
                    });

                    // Assign strand B material (may use different TileManager in multi-texture mode)
                    if (ribbon.helixMeshSegmentsB && ribbon.helixMeshSegmentsB[s]) {
                        const meshB = ribbon.helixMeshSegmentsB[s];
                        const materialB = tmB === tmA
                            ? material  // Same TileManager: reuse same material
                            : tmB.getOrCreateMaterialForSegment(globalSegmentIndex, flowActive);

                        if (materialB) {
                            meshB.material = materialB;
                            this._flowMaterials.push({
                                mesh: meshB,
                                material: materialB,
                                baseIndex: globalSegmentIndex,
                                tileManager: tmB
                            });
                        }
                    }
                }

                globalSegmentIndex++;
            }
        }

        // Store state for detecting changes
        this._lastTileOffset = this.tileManager.getTileFlowOffset?.() || 0;
        this._flowWasActive = flowActive;

        console.log(`[RibbonSeries] Initialized ${this._flowMaterials.length} materials (flow ${flowActive ? 'enabled - dual texture' : 'disabled - single texture'}, ${this.tileManagers.length} texture set(s))`);
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
        
        // Only reinitialize if flow state actually changed (and we've initialized before)
        if (this._flowWasActive !== null && flowActive !== this._flowWasActive) {
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

            // Update tile offset in all TileManagers
            for (const tm of this.tileManagers) {
                tm.wrapFlowOffset(wholeTiles);
                tm.clearFlowMaterials?.();
            }

            // Create new materials for each segment with updated tile pairs
            for (const entry of this._flowMaterials) {
                const { mesh, baseIndex, tileManager: entryTm } = entry;
                const tm = entryTm || this.tileManager;
                
                // Create a new material for this segment with the updated tile pair
                const newMaterial = tm.getOrCreateMaterialForSegment(baseIndex, true);
                
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
     * Get the shared transform root for the full ribbon series.
     * @returns {THREE.Group}
     */
    getTransformRoot() {
        return this._transformRoot;
    }

    /**
     * Clean up all ribbons and clear cached path data
     */
    cleanup() {
        this.ribbons.forEach(ribbon => ribbon.dispose());
        this.ribbons = [];
        this._flowMaterials = [];
        this._strandTileManagerMap = [];
        this._lastTileOffset = 0;
        // Note: Don't reset _flowWasActive here - it tracks across rebuilds
        this.totalSegmentCount = 0;
        this.lastPathsPoints = [];
        this.lastWidth = 1;
    }

    /**
     * Dispose of all resources
     */
    dispose() {
        this.cleanup();

        if (this._transformRoot) {
            this.scene.remove(this._transformRoot);
            this._transformRoot.clear();
            this._transformRoot = null;
            this._contentGroup = null;
        }
    }
}
