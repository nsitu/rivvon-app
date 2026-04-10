/**
 * Shared KTX2Loader for TileLinearRenderer instances.
 * Avoids "Multiple active KTX2 loaders" warnings by reusing a single
 * loader with reference counting. The loader is created on first acquire
 * and disposed when the last consumer releases it.
 */

import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

let sharedLoader = null;
let refCount = 0;

/**
 * Acquire a reference to the shared KTX2Loader.
 * Caller must pass a Three.js renderer for detectSupport on first init.
 * @param {import('three').WebGLRenderer|import('three/webgpu').WebGPURenderer} renderer
 * @returns {KTX2Loader}
 */
export function acquireKTX2Loader(renderer) {
    if (!sharedLoader) {
        sharedLoader = new KTX2Loader();
        sharedLoader.setTranscoderPath('./wasm/');
    }
    sharedLoader.detectSupport(renderer);
    refCount++;
    return sharedLoader;
}

/**
 * Release a reference to the shared KTX2Loader.
 * Disposes the loader when the last consumer releases it.
 */
export function releaseKTX2Loader() {
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0 && sharedLoader) {
        sharedLoader.dispose();
        sharedLoader = null;
    }
}
