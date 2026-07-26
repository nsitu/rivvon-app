import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import { applyRendererDisplayConfig } from './rendererConfig.js';
import { createWebGPUDiagnostics } from './webgpuDiagnostics.js';

const OPTIONAL_WEBGPU_FEATURES = [
    'texture-compression-etc2',
    'texture-compression-astc',
    'texture-compression-astc-sliced-3d',
    'timestamp-query',
    'shader-f16',
];

/**
 * Initialize Three.js with WebGPU renderer
 * @returns {Promise<Object>} { scene, camera, renderer, controls, resetCamera, rendererType }
 */
export async function initThreeWebGPU({
    antialias = true,
    pixelRatio = window.devicePixelRatio,
} = {}) {
    // Check WebGPU availability
    if (!WebGPU.isAvailable()) {
        throw new Error('WebGPU not available');
    }

    const scene = new THREE.Scene();
    scene.background = null; // Transparent - CSS blurred background shows through

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 10);

    // Own adapter selection so Three cannot independently choose Chrome's
    // OpenGLES compatibility adapter when a native Vulkan adapter is available.
    const adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance',
    });
    if (!adapter) {
        throw new Error('Unable to acquire a high-performance WebGPU adapter');
    }

    const requiredFeatures = OPTIONAL_WEBGPU_FEATURES.filter(feature => adapter.features.has(feature));
    const device = await adapter.requestDevice({ requiredFeatures });

    // Create WebGPU renderer with the exact device described by diagnostics.
    const renderer = new THREE.WebGPURenderer({
        device,
        antialias,
        alpha: true,
        // Required for Three to insert timestamp writes around render passes.
        // The diagnostic sampler resolves these asynchronously once per second.
        trackTimestamp: true,
    });
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    applyRendererDisplayConfig(renderer, null, 'webgpu');

    // CRITICAL: Wait for WebGPU backend to initialize
    await renderer.init();
    if (renderer.backend?.device !== device) {
        renderer.dispose();
        device.destroy();
        throw new Error('Three.js did not initialize with the selected WebGPU device');
    }
    const gpuDiagnostics = createWebGPUDiagnostics(renderer, adapter, device);

    document.body.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Handle window resize and fullscreen changes
    function handleResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    }
    
    window.addEventListener('resize', handleResize);
    document.addEventListener('fullscreenchange', () => {
        // Small delay to ensure dimensions are updated
        setTimeout(handleResize, 50);
    });

    // Function to reset camera view to initial position
    function resetCamera() {
        // Reset to initial position and orientation
        camera.position.set(0, 0, 10);
        camera.lookAt(0, 0, 0);
        controls.reset();
        controls.update();
    }

    // --- Device loss detection ---
    // Three.js exposes a public `onDeviceLost` callback that fires when the
    // WebGPU device (or WebGL context) is lost.  We wrap it so external code
    // (useThreeSetup composable) can register a handler.
    let _deviceLostHandler = null;
    let _deviceLostFired = false;

    function _fireDeviceLost(info) {
        if (_deviceLostFired) return; // prevent duplicate fires
        _deviceLostFired = true;
        if (_deviceLostHandler) _deviceLostHandler(info);
    }

    const _originalOnDeviceLost = renderer.onDeviceLost.bind(renderer);
    renderer.onDeviceLost = (info) => {
        // Run Three.js's default behaviour first (sets _isDeviceLost = true, logs)
        _originalOnDeviceLost(info);
        _fireDeviceLost(info);
    };

    // Also listen for the canvas contextlost event as a fallback
    renderer.domElement.addEventListener('contextlost', (e) => {
        e.preventDefault();
        _fireDeviceLost({ api: 'WebGPU', message: 'Canvas context lost', reason: 'context-lost' });
    });

    /**
     * Register a callback that fires when the GPU device is lost.
     * @param {Function} handler - Receives the info object { api, message, reason }.
     */
    function onDeviceLost(handler) {
        _deviceLostHandler = handler;
    }

    console.log('[ThreeSetup] WebGPU renderer initialized');

    return {
        scene,
        camera,
        renderer,
        controls,
        resetCamera,
        handleResize,
        onDeviceLost,
        gpuDiagnostics,
        rendererType: 'webgpu'
    };
}
