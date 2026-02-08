/**
 * Linear Tile Renderer - Factory module
 * Selects WebGL or WebGPU implementation based on device capabilities.
 * WebGPU is preferred when available (fixes ASTC array texture issues on Android).
 * Falls back to WebGL if WebGPU is unavailable or fails to initialize.
 */

import { TileLinearRendererWebGL } from './tileLinearRenderer-webgl.js';
import { TileLinearRendererWebGPU } from './tileLinearRenderer-webgpu.js';

/**
 * Create the appropriate TileLinearRenderer for the current device
 * @param {string} rendererType - 'webgl' or 'webgpu'
 * @returns {TileLinearRendererWebGL|TileLinearRendererWebGPU}
 */
export function createTileLinearRenderer(rendererType = 'webgl') {
    console.log(`[TileLinearRenderer] Creating ${rendererType.toUpperCase()} renderer`);

    if (rendererType === 'webgpu') {
        return new TileLinearRendererWebGPU();
    }

    return new TileLinearRendererWebGL();
}

/**
 * Create and initialize a TileLinearRenderer with WebGPU→WebGL fallback
 * @param {HTMLElement} container - Container element
 * @param {string} rendererType - 'webgl' or 'webgpu'
 * @param {Object} options - Init options passed to renderer.init()
 * @returns {Promise<TileLinearRendererWebGL|TileLinearRendererWebGPU>}
 */
export async function createAndInitTileLinearRenderer(container, rendererType = 'webgl', options = {}) {
    try {
        const renderer = createTileLinearRenderer(rendererType);
        await renderer.init(container, options);
        return renderer;
    } catch (error) {
        // If WebGPU fails, fall back to WebGL
        if (rendererType === 'webgpu') {
            console.warn('[TileLinearRenderer] WebGPU init failed, falling back to WebGL:', error.message);
            const fallback = createTileLinearRenderer('webgl');
            await fallback.init(container, options);
            return fallback;
        }
        throw error;
    }
}

// Re-export individual classes for direct usage
export { TileLinearRendererWebGL } from './tileLinearRenderer-webgl.js';
export { TileLinearRendererWebGPU } from './tileLinearRenderer-webgpu.js';
