import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Initialize Three.js with WebGL renderer
 * @returns {Object} { scene, camera, renderer, controls, resetCamera, rendererType }
 */
export function initThreeWebGL() {
    const scene = new THREE.Scene();
    scene.background = null; // Transparent - CSS blurred background shows through

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 10);


    /***/
    const renderer = new THREE.WebGLRenderer({
                antialias: true,
                alpha: true,
                preserveDrawingBuffer: true // without this, video rendering fails on ipad
            }); 
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setClearColor(0x000000, 0); // Transparent background
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
        camera.position.set(0, 0, 10); // Set to your preferred default position
        camera.lookAt(0, 0, 0);
        controls.reset(); // Reset the orbit controls 
        // Optional: smooth transition to the reset position
        controls.update();
    }

    // --- Context loss detection ---
    // Listen for the native canvas event and forward to a registered handler.
    let _deviceLostHandler = null;
    renderer.domElement.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        console.error('[ThreeSetup] WebGL context lost');
        if (_deviceLostHandler) _deviceLostHandler({ api: 'WebGL', message: 'Context lost', reason: 'context-lost' });
    });

    /**
     * Register a callback that fires when the WebGL context is lost.
     * @param {Function} handler - Receives { api, message, reason }.
     */
    function onDeviceLost(handler) {
        _deviceLostHandler = handler;
    }

    console.log('[ThreeSetup] WebGL renderer initialized');

    return {
        scene,
        camera,
        renderer,
        controls,
        resetCamera,
        handleResize,
        onDeviceLost,
        rendererType: 'webgl'
    };
}
