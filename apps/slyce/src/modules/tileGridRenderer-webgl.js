/**
 * Tile Grid Renderer (WebGL) - Manages multiple KTX2 textured planes in a Three.js scene
 * Provides consistent API for WebGL and WebGPU renderers
 */

import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class TileGridRendererWebGL {
    constructor() {
        this.rendererType = 'webgl';
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.tiles = new Map(); // tileId -> { mesh, texture, material }
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

        // Get dimensions - ensure they are valid
        let width = container.clientWidth;
        let height = container.clientHeight;

        // Validate dimensions
        if (width <= 0 || height <= 0) {
            console.error('[TileGridRenderer] Invalid container dimensions:', { width, height });
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

        console.log('[TileGridRenderer] Camera setup:', {
            left: frustumSize * aspect / -2,
            right: frustumSize * aspect / 2,
            top: frustumSize / 2,
            bottom: frustumSize / -2,
            aspect,
            width,
            height
        });

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // Linear workflow to match WebGPU
        container.appendChild(this.renderer.domElement);

        console.log('[TileGridRenderer] Renderer canvas size:', {
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
        this.ktx2Loader.detectSupport(this.renderer);

        // Setup OrbitControls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.screenSpacePanning = false;
        this.controls.minDistance = 1;
        this.controls.maxDistance = 100;

        // Handle window resize
        window.addEventListener('resize', () => this.handleResize(container));

        console.log('[TileGridRenderer] Initialized');
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

        console.log('[TileGridRenderer] Resize event:', {
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

        console.log('[TileGridRenderer] After resize - canvas:', {
            canvasWidth: this.renderer.domElement.width,
            canvasHeight: this.renderer.domElement.height
        });
    }

    /**
     * Create array texture material
     * @param {THREE.Texture} arrayTexture - KTX2 array texture
     * @returns {THREE.ShaderMaterial}
     */
    createArrayMaterial(arrayTexture) {
        const layerCount = arrayTexture.image?.depth || 1;

        const material = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: {
                uTexArray: { value: arrayTexture },
                uLayer: { value: 0 },
                uLayerCount: { value: layerCount }
            },
            vertexShader: /* glsl */`
                out vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                precision highp float;
                precision highp sampler2DArray;
                in vec2 vUv;
                uniform sampler2DArray uTexArray;
                uniform int uLayer;
                out vec4 outColor;
                void main() {
                    // Flip V coordinate to match WebM orientation
                    vec2 flippedUv = vec2(vUv.x, 1.0 - vUv.y);
                    outColor = texture(uTexArray, vec3(flippedUv, float(uLayer)));
                }
            `,
            transparent: false,
            depthWrite: true,
            side: THREE.DoubleSide // Make sure we can see it from both sides
        });

        console.log('[TileGridRenderer] Material created:', {
            layerCount,
            textureType: arrayTexture.type,
            textureFormat: arrayTexture.format
        });

        return material;
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
                (texture) => {
                    // Configure texture
                    texture.flipY = false;
                    texture.generateMipmaps = false;
                    texture.colorSpace = THREE.LinearSRGBColorSpace; // Linear workflow to match WebGPU
                    const hasMips = Array.isArray(texture.mipmaps) && texture.mipmaps.length > 1;
                    texture.minFilter = hasMips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
                    texture.magFilter = THREE.LinearFilter;
                    texture.wrapS = THREE.ClampToEdgeWrapping;
                    texture.wrapT = THREE.ClampToEdgeWrapping;

                    // Store layer count from first tile
                    if (this.tiles.size === 0) {
                        this.layerCount = texture.image?.depth || 1;
                        console.log(`[TileGridRenderer] Layer count: ${this.layerCount}`);
                    }

                    // Create material
                    const material = this.createArrayMaterial(texture);

                    // Create plane geometry
                    const geometry = new THREE.PlaneGeometry(size.width, size.height);
                    const mesh = new THREE.Mesh(geometry, material);
                    mesh.position.set(position.x, position.y, 0);

                    // Add to scene
                    this.scene.add(mesh);

                    // Store tile data
                    this.tiles.set(tileId, {
                        mesh,
                        texture,
                        material,
                        geometry
                    });

                    console.log(`[TileGridRenderer] Tile ${tileId} loaded:`, {
                        position: { x: position.x, y: position.y },
                        size: { width: size.width, height: size.height },
                        layers: texture.image?.depth || 1,
                        sceneChildren: this.scene.children.length
                    });
                    resolve();
                },
                undefined,
                (error) => {
                    console.error(`[TileGridRenderer] Failed to load tile ${tileId}:`, error);
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
        console.log(`[TileGridRenderer] Tile ${tileId} removed`);
    }

    /**
     * Remove all tiles from the grid (for reset)
     */
    clearAllTiles() {
        this.tiles.forEach((_, tileId) => this.removeTile(tileId));
        console.log('[TileGridRenderer] All tiles cleared');
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

        console.log(`[TileGridRenderer] Tile ${tileId} position updated:`, {
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

        // Update uniform for all tiles
        this.tiles.forEach(tile => {
            if (tile.material && tile.material.uniforms) {
                tile.material.uniforms.uLayer.value = this.currentLayer;
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

        console.log(`[TileGridRenderer] Playback started: ${fps} fps, mode: ${mode}`);
    }

    /**
     * Stop playback animation
     */
    stopPlayback() {
        this.isPlaying = false;
        console.log('[TileGridRenderer] Playback stopped');
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
        const animate = () => {
            this.animationId = requestAnimationFrame(animate);

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
        };

        animate();
        console.log('[TileGridRenderer] Animation loop started');
    }

    /**
     * Stop animation loop
     */
    stopAnimation() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        console.log('[TileGridRenderer] Animation loop stopped');
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

        console.log('[TileGridRenderer] Disposed');
    }
}
