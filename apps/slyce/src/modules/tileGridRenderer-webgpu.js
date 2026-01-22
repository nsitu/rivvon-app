/**
 * Tile Grid Renderer (WebGPU) - Manages multiple KTX2 textured planes in a Three.js/WebGPU scene
 * Provides consistent API with WebGL renderer for cross-platform compatibility
 */

import * as THREE from 'three/webgpu';
import { texture, uniform, uv, float } from 'three/tsl';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import WebGPU from 'three/addons/capabilities/WebGPU.js';

export class TileGridRendererWebGPU {
    constructor() {
        this.rendererType = 'webgpu';
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.tiles = new Map(); // tileId -> { mesh, texture, material, layerUniform }
        this.ktx2Loader = null;
        this.animationId = null;

        // Playback state
        this.currentLayer = 0;
        this.layerCount = 0;
        this.isPlaying = false;
        this.fps = 30;
        this.direction = 1; // 1 = forward, -1 = reverse
        this.lastFrameTime = 0;
        this.cyclingMode = 'waves'; // 'waves' or 'planes'
    }

    /**
     * Initialize the renderer and scene
     * @param {HTMLElement} container - DOM element to attach canvas
     * @param {Object} options - Configuration options
     */
    async init(container, options = {}) {
        const {
            backgroundColor = 0x1a1a1a
        } = options;

        // Check WebGPU availability
        if (!WebGPU.isAvailable()) {
            throw new Error('WebGPU not available');
        }

        // Get dimensions - ensure they are valid
        let width = container.clientWidth;
        let height = container.clientHeight;

        // Validate dimensions
        if (width <= 0 || height <= 0) {
            console.error('[TileGridRenderer WebGPU] Invalid container dimensions:', { width, height });
            throw new Error(`Invalid container dimensions: ${width}x${height}. Container must have non-zero width and height.`);
        }

        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(backgroundColor);

        // Create orthographic camera for 2D display
        const aspect = width / height;
        const frustumSize = 10;
        this.camera = new THREE.OrthographicCamera(
            frustumSize * aspect / -2,
            frustumSize * aspect / 2,
            frustumSize / 2,
            frustumSize / -2,
            0.1,
            1000
        );
        this.camera.position.set(0, 0, 5);
        this.camera.lookAt(0, 0, 0);

        console.log('[TileGridRenderer WebGPU] Camera setup:', {
            left: frustumSize * aspect / -2,
            right: frustumSize * aspect / 2,
            top: frustumSize / 2,
            bottom: frustumSize / -2,
            aspect,
            width,
            height
        });

        // Create WebGPU renderer
        this.renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(width, height);
        this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // Changed from SRGBColorSpace

        // Wait for WebGPU backend to initialize
        await this.renderer.init();

        container.appendChild(this.renderer.domElement);

        console.log('[TileGridRenderer WebGPU] Renderer canvas size:', {
            canvasWidth: this.renderer.domElement.width,
            canvasHeight: this.renderer.domElement.height,
            canvasStyleWidth: this.renderer.domElement.style.width,
            canvasStyleHeight: this.renderer.domElement.style.height,
            actualWidth: width,
            actualHeight: height
        });

        // Setup KTX2 loader
        this.ktx2Loader = new KTX2Loader();
        this.ktx2Loader.setTranscoderPath('./wasm/');
        await this.ktx2Loader.detectSupportAsync(this.renderer);

        // Setup OrbitControls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.screenSpacePanning = false;
        this.controls.minDistance = 1;
        this.controls.maxDistance = 100;

        // Handle window resize
        window.addEventListener('resize', () => this.handleResize(container));

        console.log('[TileGridRenderer WebGPU] Initialized');
    }

    /**
     * Handle window resize
     */
    handleResize(container) {
        if (!this.camera || !this.renderer) return;

        const width = container.clientWidth;
        const height = container.clientHeight;
        const aspect = width / height;
        const frustumSize = 10;

        console.log('[TileGridRenderer WebGPU] Resize event:', {
            width,
            height,
            aspect,
            oldCameraLeft: this.camera.left,
            oldCameraRight: this.camera.right,
            newCameraLeft: frustumSize * aspect / -2,
            newCameraRight: frustumSize * aspect / 2
        });

        this.camera.left = frustumSize * aspect / -2;
        this.camera.right = frustumSize * aspect / 2;
        this.camera.top = frustumSize / 2;
        this.camera.bottom = frustumSize / -2;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);

        console.log('[TileGridRenderer WebGPU] After resize - canvas:', {
            canvasWidth: this.renderer.domElement.width,
            canvasHeight: this.renderer.domElement.height
        });
    }

    /**
     * Create array texture material using TSL (Three.js Shading Language)
     * @param {THREE.Texture} arrayTexture - KTX2 array texture
     * @returns {THREE.NodeMaterial}
     */
    createArrayMaterial(arrayTexture) {
        const layerCount = arrayTexture.image?.depth || 1;

        // Create a uniform for the current layer
        const layerUniform = uniform(0);

        // Flip V coordinate to match WebM orientation
        const flippedUV = uv().setY(float(1).sub(uv().y));

        // Create NodeMaterial with texture array sampling using .depth()
        const material = new THREE.NodeMaterial();
        material.colorNode = texture(arrayTexture, flippedUV).depth(layerUniform);
        material.transparent = false;
        material.depthWrite = true;
        material.side = THREE.DoubleSide;

        console.log('[TileGridRenderer WebGPU] Material created:', {
            layerCount,
            textureType: arrayTexture.type,
            textureFormat: arrayTexture.format
        });

        return { material, layerUniform };
    }

    /**
     * Add or update a tile with KTX2 texture
     * @param {string|number} tileId - Unique tile identifier
     * @param {string} blobURL - Blob URL of KTX2 file
     * @param {Object} position - { x, y } position in grid
     * @param {Object} size - { width, height } of tile plane
     */
    async upsertTile(tileId, blobURL, position = { x: 0, y: 0 }, size = { width: 2, height: 2 }) {
        return new Promise((resolve, reject) => {
            // Remove existing tile if it exists
            this.removeTile(tileId);

            // Load KTX2 texture
            this.ktx2Loader.load(
                blobURL,
                (arrayTexture) => {
                    // Configure texture
                    // Note: flipY doesn't work for array textures, we flip in the shader instead
                    arrayTexture.flipY = false;
                    arrayTexture.generateMipmaps = false;
                    arrayTexture.colorSpace = THREE.LinearSRGBColorSpace; // Linear workflow to match WebGL
                    const hasMips = Array.isArray(arrayTexture.mipmaps) && arrayTexture.mipmaps.length > 1;
                    arrayTexture.minFilter = hasMips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
                    arrayTexture.magFilter = THREE.LinearFilter;
                    arrayTexture.wrapS = THREE.ClampToEdgeWrapping;
                    arrayTexture.wrapT = THREE.ClampToEdgeWrapping;

                    // Store layer count from first tile
                    if (this.tiles.size === 0) {
                        this.layerCount = arrayTexture.image?.depth || 1;
                        console.log(`[TileGridRenderer WebGPU] Layer count: ${this.layerCount}`);
                    }

                    // Create material with TSL
                    const { material, layerUniform } = this.createArrayMaterial(arrayTexture);

                    // Create plane geometry
                    const geometry = new THREE.PlaneGeometry(size.width, size.height);
                    const mesh = new THREE.Mesh(geometry, material);
                    mesh.position.set(position.x, position.y, 0);

                    // Add to scene
                    this.scene.add(mesh);

                    // Store tile data including layerUniform for updates
                    this.tiles.set(tileId, {
                        mesh,
                        texture: arrayTexture,
                        material,
                        geometry,
                        layerUniform
                    });

                    console.log(`[TileGridRenderer WebGPU] Tile ${tileId} loaded:`, {
                        position: { x: position.x, y: position.y },
                        size: { width: size.width, height: size.height },
                        layers: arrayTexture.image?.depth || 1,
                        sceneChildren: this.scene.children.length
                    });
                    resolve();
                },
                undefined,
                (error) => {
                    console.error(`[TileGridRenderer WebGPU] Failed to load tile ${tileId}:`, error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Remove a tile from the grid
     * @param {string|number} tileId - Tile identifier
     */
    removeTile(tileId) {
        const tile = this.tiles.get(tileId);
        if (!tile) return;

        // Remove from scene
        this.scene.remove(tile.mesh);

        // Dispose resources
        tile.geometry?.dispose();
        tile.material?.dispose();
        tile.texture?.dispose();

        this.tiles.delete(tileId);
        console.log(`[TileGridRenderer WebGPU] Tile ${tileId} removed`);
    }

    /**
     * Remove all tiles from the grid (for reset)
     */
    clearAllTiles() {
        this.tiles.forEach((_, tileId) => this.removeTile(tileId));
        console.log('[TileGridRenderer WebGPU] All tiles cleared');
    }

    /**
     * Update tile position and size without reloading texture
     * @param {string|number} tileId - Tile identifier
     * @param {Object} position - { x, y } position in grid
     * @param {Object} size - { width, height } of tile plane
     */
    updateTilePosition(tileId, position, size) {
        const tile = this.tiles.get(tileId);
        if (!tile) return false;

        // Update mesh position
        tile.mesh.position.set(position.x, position.y, 0);

        // Update geometry if size changed
        if (size && (tile.mesh.geometry.parameters.width !== size.width ||
            tile.mesh.geometry.parameters.height !== size.height)) {
            // Dispose old geometry
            tile.mesh.geometry.dispose();

            // Create new geometry with updated size
            const geometry = new THREE.PlaneGeometry(size.width, size.height);
            tile.mesh.geometry = geometry;
            tile.geometry = geometry;
        }

        console.log(`[TileGridRenderer WebGPU] Tile ${tileId} position updated:`, {
            position: { x: position.x, y: position.y },
            size: size || 'unchanged'
        });

        return true;
    }

    /**
     * Set current layer for all tiles
     * @param {number} layer - Layer index (0 to layerCount-1)
     */
    setLayer(layer) {
        this.currentLayer = Math.max(0, Math.min(layer, this.layerCount - 1));

        // Update uniform for all tiles (TSL uniform node)
        this.tiles.forEach(tile => {
            if (tile.layerUniform) {
                tile.layerUniform.value = this.currentLayer;
            }
        });
    }

    /**
     * Start playback animation
     * @param {Object} options - Playback options
     */
    startPlayback(options = {}) {
        const {
            fps = 30,
            mode = 'waves' // 'waves' or 'planes'
        } = options;

        this.fps = fps;
        this.cyclingMode = mode;
        this.isPlaying = true;
        this.lastFrameTime = performance.now();

        console.log(`[TileGridRenderer WebGPU] Playback started: ${fps} fps, mode: ${mode}`);
    }

    /**
     * Stop playback animation
     */
    stopPlayback() {
        this.isPlaying = false;
        console.log('[TileGridRenderer WebGPU] Playback stopped');
    }

    /**
     * Update layer cycling based on playback state
     */
    updateLayerCycling() {
        if (!this.isPlaying || this.layerCount <= 1) return;

        const now = performance.now();
        const elapsed = now - this.lastFrameTime;
        const frameInterval = 1000 / this.fps;

        if (elapsed >= frameInterval) {
            this.lastFrameTime = now;

            if (this.cyclingMode === 'waves') {
                // Linear cycling: 0 → (layerCount-1) → 0 (loop)
                this.currentLayer = (this.currentLayer + 1) % this.layerCount;
            } else if (this.cyclingMode === 'planes') {
                // Ping-pong cycling: 0 → (layerCount-1) → 0 (reverse direction at ends)
                this.currentLayer += this.direction;

                if (this.currentLayer >= this.layerCount - 1) {
                    this.currentLayer = this.layerCount - 1;
                    this.direction = -1;
                } else if (this.currentLayer <= 0) {
                    this.currentLayer = 0;
                    this.direction = 1;
                }
            }

            this.setLayer(this.currentLayer);
        }
    }

    /**
     * Start animation loop
     */
    startAnimation() {
        // Set animation loop for WebGPU renderer
        this.renderer.setAnimationLoop(() => {
            // Update controls
            if (this.controls) {
                this.controls.update();
            }

            // Update layer cycling
            this.updateLayerCycling();

            // Render scene
            if (this.renderer && this.scene && this.camera) {
                this.renderer.render(this.scene, this.camera);
            }
        });

        console.log('[TileGridRenderer WebGPU] Animation loop started');
    }

    /**
     * Stop animation loop
     */
    stopAnimation() {
        if (this.renderer) {
            this.renderer.setAnimationLoop(null);
        }
        console.log('[TileGridRenderer WebGPU] Animation loop stopped');
    }

    /**
     * Dispose all resources and cleanup
     */
    dispose() {
        // Stop animation
        this.stopAnimation();

        // Remove all tiles
        this.tiles.forEach((_, tileId) => this.removeTile(tileId));
        this.tiles.clear();

        // Dispose controls
        if (this.controls) {
            this.controls.dispose();
            this.controls = null;
        }

        // Dispose renderer
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.domElement?.remove();
            this.renderer = null;
        }

        // Clear scene
        if (this.scene) {
            this.scene.clear();
            this.scene = null;
        }

        this.camera = null;
        this.ktx2Loader = null;

        console.log('[TileGridRenderer WebGPU] Disposed');
    }
}
