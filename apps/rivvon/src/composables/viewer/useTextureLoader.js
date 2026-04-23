// src/composables/viewer/useTextureLoader.js
// Texture loading: local files, remote API, and multi-texture mode

import { TileManager } from '../../modules/viewer/tileManager';

/**
 * Handles loading KTX2 texture sets from various sources into TileManagers.
 *
 * @param {Object} ctx  - Shared context refs from useThreeSetup
 * @param {Object} deps - Cross-composable dependencies
 * @param {Function} deps.rebuildRibbonsWithNewTextures - Rebuild ribbons after texture swap
 * @param {Function} deps.setBackgroundFromTileManager  - Update scene background
 * @param {Function} deps.setFlowState                  - Sync flow animation state
 */
export function useTextureLoader(ctx, deps = {}) {

    /**
     * Dispose any extra TileManagers from multi-texture mode,
     * keeping only the primary tileManager.value.
     */
    function clearMultiTextureState() {
        for (const tm of ctx.tileManagers.value) {
            if (tm !== ctx.tileManager.value) tm.dispose?.();
        }
        ctx.tileManagers.value = [];
    }

    /**
     * Load new texture set
     */
    async function loadTextures(source) {
        if (!ctx.renderer.value) {
            console.error('[ThreeSetup] Cannot load textures - not initialized');
            return;
        }

        // Create new TileManager with the specified source
        ctx.tileManager.value = new TileManager({
            source,
            renderer: ctx.renderer.value,
            rendererType: ctx.app.rendererType,
            rotate90: true,
            repeatMode: ctx.app.textureRepeatMode,
            flowAlignmentEnabled: ctx.app.flowCycleAlignmentEnabled,
            layerAnimationEnabled: ctx.app.textureAnimationEnabled,
            webgpuMaterialMode: 'node'
        });
        await ctx.tileManager.value.loadAllTiles();

        // Single texture replaces any multi-texture state
        clearMultiTextureState();

        // Sync flow animation state from store
        deps.setFlowState?.(ctx.app.flowState);
        
        // Rebuild ribbons with new textures
        deps.rebuildRibbonsWithNewTextures?.();

        // Update scene background from new textures
        await deps.setBackgroundFromTileManager?.();
    }

    /**
     * Load textures from remote API (texture browser)
     * @param {Object} textureSet - Texture set data from API
     * @param {Function} onProgress - Progress callback (stage, current, total)
     */
    async function loadTexturesFromRemote(textureSet, onProgress = null) {
        if (!ctx.tileManager.value) {
            console.error('[ThreeSetup] Cannot load remote textures - not initialized');
            return false;
        }

        try {
            const success = await ctx.tileManager.value.loadFromRemote(textureSet, onProgress);

            if (success) {
                console.log(`[ThreeSetup] Remote texture loaded: ${ctx.tileManager.value.getTileCount()} tiles`);

                // Single texture replaces any multi-texture state
                clearMultiTextureState();
                
                // Rebuild ribbons with new textures
                deps.rebuildRibbonsWithNewTextures?.();

                // Update scene background from new textures
                await deps.setBackgroundFromTileManager?.();
            }

            return success;
        } catch (error) {
            console.error('[ThreeSetup] Failed to load remote textures:', error);
            throw error;
        }
    }

    /**
     * Load textures from local IndexedDB storage
     * @param {Object} textureSet - Texture set metadata from localStorage service
     * @param {Function} getTiles - Function to get tiles: (textureSetId) => Promise<Array>
     * @param {Function} onProgress - Progress callback (stage, current, total)
     */
    async function loadTexturesFromLocal(textureSet, getTiles, onProgress = null) {
        if (!ctx.tileManager.value) {
            console.error('[ThreeSetup] Cannot load local textures - not initialized');
            return false;
        }

        try {
            const success = await ctx.tileManager.value.loadFromLocal(textureSet, getTiles, onProgress);

            if (success) {
                console.log(`[ThreeSetup] Local texture loaded: ${ctx.tileManager.value.getTileCount()} tiles`);

                // Single texture replaces any multi-texture state
                clearMultiTextureState();
                
                // Rebuild ribbons with new textures
                deps.rebuildRibbonsWithNewTextures?.();

                // Update scene background from new textures
                await deps.setBackgroundFromTileManager?.();
            }

            return success;
        } catch (error) {
            console.error('[ThreeSetup] Failed to load local textures:', error);
            throw error;
        }
    }

    /**
     * Load multiple texture sets simultaneously (multi-texture mode).
     * Creates one TileManager per texture set, distributes via round-robin to ribbon strands.
     * @param {Array<{textureSet: Object, source: string, tiles?: Array, getTiles?: Function}>} textureSetsWithMeta
     *   Each entry needs: textureSet (metadata), source ('remote'|'local').
     *   For local: also getTiles function. For remote: textureSet has tile URLs.
     * @param {Function} onProgress - Optional progress callback (index, total)
     */
    async function loadMultipleTextures(textureSetsWithMeta, onProgress = null) {
        if (!ctx.renderer.value) {
            console.error('[ThreeSetup] Cannot load textures - not initialized');
            return false;
        }

        console.log(`[ThreeSetup] Loading ${textureSetsWithMeta.length} texture sets for multi-texture mode`);

        // Dispose all existing TileManagers
        for (const tm of ctx.tileManagers.value) {
            tm.dispose?.();
        }
        if (ctx.tileManager.value && !ctx.tileManagers.value.includes(ctx.tileManager.value)) {
            ctx.tileManager.value.dispose?.();
        }

        try {
            // Create and load all TileManagers in parallel
            const newTileManagers = await Promise.all(
                textureSetsWithMeta.map(async (entry, index) => {
                    const tm = new TileManager({
                        renderer: ctx.renderer.value,
                        rendererType: ctx.app.rendererType,
                        rotate90: true,
                        repeatMode: ctx.app.textureRepeatMode,
                        flowAlignmentEnabled: ctx.app.flowCycleAlignmentEnabled,
                        layerAnimationEnabled: ctx.app.textureAnimationEnabled,
                        webgpuMaterialMode: 'node'
                    });

                    let success = false;
                    if (entry.source === 'local' && entry.getTiles) {
                        success = await tm.loadFromLocal(entry.textureSet, entry.getTiles);
                    } else {
                        success = await tm.loadFromRemote(entry.textureSet);
                    }

                    if (!success) {
                        console.warn(`[ThreeSetup] Failed to load texture set ${index}`);
                        tm.dispose();
                        return null;
                    }

                    onProgress?.(index + 1, textureSetsWithMeta.length);
                    return tm;
                })
            );

            // Filter out failed loads
            const validTileManagers = newTileManagers.filter(Boolean);
            if (validTileManagers.length === 0) {
                console.error('[ThreeSetup] All texture sets failed to load');
                return false;
            }

            // Store references
            ctx.tileManagers.value = validTileManagers;
            ctx.tileManager.value = validTileManagers[0]; // Primary for background, single-texture compat

            console.log(`[ThreeSetup] Loaded ${validTileManagers.length} TileManagers`);

            // Sync flow state on all TileManagers
            deps.setFlowState?.(ctx.app.flowState);

            // Rebuild ribbons with multi-texture distribution
            deps.rebuildRibbonsWithNewTextures?.();

            // Update background from first texture
            await deps.setBackgroundFromTileManager?.();

            return true;
        } catch (error) {
            console.error('[ThreeSetup] Failed to load multiple textures:', error);
            return false;
        }
    }

    return {
        clearMultiTextureState,
        loadTextures,
        loadTexturesFromRemote,
        loadTexturesFromLocal,
        loadMultipleTextures
    };
}
