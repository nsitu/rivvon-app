/**
 * Linear Tile Renderer - Displays KTX2 tiles in a linear, document-like layout
 * Canvas sizes to match content, no orbit controls, seamless page integration
 */

import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

export class TileLinearRenderer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.tiles = new Map(); // tileId -> { mesh, texture, material, geometry }
        this.ktx2Loader = null;
        this.animationId = null;
        this.container = null;

        // Layout configuration
        this.tileSize = 512; // Native tile size in pixels
        this.maxViewportWidth = 2560; // Maximum viewport width before scaling
        this.maxViewportHeight = 800; // Maximum viewport height
        this.flowDirection = 'horizontal'; // 'horizontal' or 'vertical'

        // Computed layout state
        this.displayScale = 1; // Scale factor for display
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        this.naturalWidth = 0;
        this.naturalHeight = 0;

        // Playback state
        this.currentLayer = 0;
        this.layerCount = 0;
        this.isPlaying = false;
        this.fps = 30;
        this.direction = 1;
        this.lastFrameTime = 0;
        this.cyclingMode = 'waves';

        // Debounce layout updates
        this._layoutUpdatePending = false;
    }

    /**
     * Initialize the renderer
     * @param {HTMLElement} container - Container element (scrollable wrapper)
     * @param {Object} options - Configuration options
     */
    async init(container, options = {}) {
        const {
            tileSize = 512,
            maxViewportWidth = 2560,
            maxViewportHeight = 800,
            flowDirection = 'horizontal'
        } = options;

        this.container = container;
        this.tileSize = tileSize;
        this.maxViewportWidth = maxViewportWidth;
        this.maxViewportHeight = maxViewportHeight;
        this.flowDirection = flowDirection;

        // Create scene with transparent background (blends with page)
        this.scene = new THREE.Scene();
        this.scene.background = null; // Transparent

        // Create renderer with alpha for transparency
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: true
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 0); // Transparent clear
        this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

        // Setup KTX2 loader
        this.ktx2Loader = new KTX2Loader();
        this.ktx2Loader.setTranscoderPath('./wasm/');
        this.ktx2Loader.detectSupport(this.renderer);

        // Initially hide canvas until we have tiles
        this.renderer.domElement.style.display = 'none';
        this.renderer.domElement.classList.add('linear-renderer-canvas');
        container.appendChild(this.renderer.domElement);

        // Handle window resize
        window.addEventListener('resize', () => this.resize());

        console.log('[TileLinearRenderer] Initialized with options:', {
            tileSize,
            maxViewportWidth,
            maxViewportHeight,
            flowDirection
        });
    }

    /**
     * Calculate layout based on current tiles
     * @returns {Object} Layout info: { canvasWidth, canvasHeight, scale, positions }
     */
    calculateLayout() {
        const tileCount = this.tiles.size;
        if (tileCount === 0) {
            return { canvasWidth: 0, canvasHeight: 0, scale: 1, positions: [], naturalWidth: 0, naturalHeight: 0 };
        }

        const tileIds = Array.from(this.tiles.keys()).sort((a, b) => Number(a) - Number(b));

        // Calculate natural dimensions (unscaled)
        let naturalWidth, naturalHeight;
        if (this.flowDirection === 'horizontal') {
            naturalWidth = this.tileSize * tileCount;
            naturalHeight = this.tileSize;
        } else {
            naturalWidth = this.tileSize;
            naturalHeight = this.tileSize * tileCount;
        }

        // Determine scale factor to fit within constraints
        let scale = 1;
        const containerWidth = this.container.clientWidth || this.maxViewportWidth;

        if (this.flowDirection === 'horizontal') {
            // Scale to fit container width, but cap at maxViewportWidth
            const targetWidth = Math.min(containerWidth, this.maxViewportWidth);
            if (naturalWidth > targetWidth) {
                scale = targetWidth / naturalWidth;
            }
            // Also check height constraint
            if (naturalHeight * scale > this.maxViewportHeight) {
                scale = this.maxViewportHeight / naturalHeight;
            }
        } else {
            // For vertical flow, scale to container width first
            if (naturalWidth > containerWidth) {
                scale = containerWidth / naturalWidth;
            }
            // Cap minimum scale to keep tiles readable
            scale = Math.max(scale, 0.25);
        }

        // Compute final canvas dimensions
        const canvasWidth = Math.round(naturalWidth * scale);
        const canvasHeight = Math.round(naturalHeight * scale);

        // Calculate tile positions (in world units, centered at origin)
        const positions = tileIds.map((_, index) => {
            if (this.flowDirection === 'horizontal') {
                return {
                    x: (index + 0.5) * this.tileSize - (naturalWidth / 2),
                    y: 0
                };
            } else {
                return {
                    x: 0,
                    y: -((index + 0.5) * this.tileSize - (naturalHeight / 2))
                };
            }
        });

        return { canvasWidth, canvasHeight, scale, positions, naturalWidth, naturalHeight };
    }

    /**
     * Update renderer and camera to match current layout
     */
    updateLayout() {
        const { canvasWidth, canvasHeight, scale, positions, naturalWidth, naturalHeight } = this.calculateLayout();

        if (canvasWidth === 0 || canvasHeight === 0) {
            this.renderer.domElement.style.display = 'none';
            return;
        }

        this.displayScale = scale;
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.naturalWidth = naturalWidth;
        this.naturalHeight = naturalHeight;

        // Update renderer size
        this.renderer.setSize(canvasWidth, canvasHeight);
        this.renderer.domElement.style.display = 'block';

        // Create/update orthographic camera to match natural dimensions
        // Camera views the natural size, renderer scales via canvas size
        const halfWidth = naturalWidth / 2;
        const halfHeight = naturalHeight / 2;

        if (!this.camera) {
            this.camera = new THREE.OrthographicCamera(
                -halfWidth, halfWidth,
                halfHeight, -halfHeight,
                0.1, 10
            );
            this.camera.position.z = 1;
        } else {
            this.camera.left = -halfWidth;
            this.camera.right = halfWidth;
            this.camera.top = halfHeight;
            this.camera.bottom = -halfHeight;
            this.camera.updateProjectionMatrix();
        }

        // Update tile mesh positions
        const tileIds = Array.from(this.tiles.keys()).sort((a, b) => Number(a) - Number(b));
        tileIds.forEach((tileId, index) => {
            const tile = this.tiles.get(tileId);
            if (tile && positions[index]) {
                tile.mesh.position.set(positions[index].x, positions[index].y, 0);
            }
        });

        // Update container scroll behavior
        this.updateScrollBehavior(canvasWidth, canvasHeight);

        console.log('[TileLinearRenderer] Layout updated:', {
            tileCount: this.tiles.size,
            naturalSize: `${naturalWidth}x${naturalHeight}`,
            canvasSize: `${canvasWidth}x${canvasHeight}`,
            scale: scale.toFixed(3)
        });
    }

    /**
     * Debounced layout update - batches rapid tile additions
     */
    scheduleLayoutUpdate() {
        if (this._layoutUpdatePending) return;
        this._layoutUpdatePending = true;

        requestAnimationFrame(() => {
            this._layoutUpdatePending = false;
            this.updateLayout();
        });
    }

    /**
     * Configure container scrolling based on content size
     */
    updateScrollBehavior(canvasWidth, canvasHeight) {
        const containerWidth = this.container.clientWidth;
        const containerHeight = this.container.clientHeight;

        // Enable scrolling if canvas exceeds container
        if (this.flowDirection === 'horizontal' && canvasWidth > containerWidth) {
            this.container.style.overflowX = 'auto';
            this.container.style.overflowY = 'hidden';
        } else if (this.flowDirection === 'vertical' && canvasHeight > containerHeight) {
            this.container.style.overflowX = 'hidden';
            this.container.style.overflowY = 'auto';
        } else {
            this.container.style.overflow = 'hidden';
        }
    }

    /**
     * Create shader material for texture array
     * @param {THREE.Texture} texture - KTX2 array texture
     * @returns {THREE.ShaderMaterial}
     */
    createArrayMaterial(texture) {
        const material = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: {
                uTexArray: { value: texture },
                uLayer: { value: 0 },
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
                    vec2 flippedUv = vec2(vUv.x, 1.0 - vUv.y);
                    outColor = texture(uTexArray, vec3(flippedUv, float(uLayer)));
                }
            `,
            transparent: false,
            depthWrite: true,
            side: THREE.FrontSide
        });

        return material;
    }

    /**
     * Add or update a tile
     * @param {string|number} tileId - Unique tile identifier
     * @param {string} blobURL - Blob URL of KTX2 file
     */
    async upsertTile(tileId, blobURL) {
        return new Promise((resolve, reject) => {
            // Remove existing tile if present
            this.removeTile(tileId);

            this.ktx2Loader.load(
                blobURL,
                (texture) => {
                    texture.flipY = false;
                    texture.generateMipmaps = false;
                    texture.colorSpace = THREE.LinearSRGBColorSpace;
                    texture.minFilter = THREE.LinearFilter;
                    texture.magFilter = THREE.LinearFilter;

                    // Get layer count from first tile
                    if (this.tiles.size === 0) {
                        this.layerCount = texture.image?.depth || 1;
                    }

                    const material = this.createArrayMaterial(texture);
                    const geometry = new THREE.PlaneGeometry(this.tileSize, this.tileSize);
                    const mesh = new THREE.Mesh(geometry, material);

                    this.scene.add(mesh);
                    this.tiles.set(tileId, { mesh, texture, material, geometry });

                    // Schedule layout update (batched)
                    this.scheduleLayoutUpdate();

                    console.log(`[TileLinearRenderer] Tile ${tileId} loaded (${this.tiles.size} tiles total)`);
                    resolve();
                },
                undefined,
                (error) => {
                    console.error(`[TileLinearRenderer] Failed to load tile ${tileId}:`, error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Remove a tile
     * @param {string|number} tileId - Tile identifier
     */
    removeTile(tileId) {
        const tile = this.tiles.get(tileId);
        if (!tile) return;

        this.scene.remove(tile.mesh);
        tile.geometry?.dispose();
        tile.material?.dispose();
        tile.texture?.dispose();
        this.tiles.delete(tileId);

        // Schedule layout update after removal
        if (this.tiles.size > 0) {
            this.scheduleLayoutUpdate();
        }
    }

    /**
     * Clear all tiles
     */
    clearAllTiles() {
        const tileIds = Array.from(this.tiles.keys());
        tileIds.forEach(tileId => this.removeTile(tileId));
        this.renderer.domElement.style.display = 'none';
    }

    /**
     * Set current layer for animation
     * @param {number} layer - Layer index (0 to layerCount-1)
     */
    setLayer(layer) {
        this.currentLayer = Math.max(0, Math.min(layer, this.layerCount - 1));
        this.tiles.forEach(tile => {
            if (tile.material?.uniforms) {
                tile.material.uniforms.uLayer.value = this.currentLayer;
            }
        });
    }

    /**
     * Start playback animation
     * @param {Object} options - Playback options
     */
    startPlayback(options = {}) {
        this.fps = options.fps || 30;
        this.cyclingMode = options.mode || 'waves';
        this.isPlaying = true;
        this.lastFrameTime = performance.now();
    }

    /**
     * Stop playback animation
     */
    stopPlayback() {
        this.isPlaying = false;
    }

    /**
     * Update layer cycling based on playback state
     * 'waves' mode: cycles linearly through layers
     * 'planes' mode: cycles back and forth (ping-pong)
     */
    updateLayerCycling() {
        if (!this.isPlaying || this.layerCount <= 1) return;

        const now = performance.now();
        const elapsed = now - this.lastFrameTime;
        const frameInterval = 1000 / this.fps;

        if (elapsed >= frameInterval) {
            this.lastFrameTime = now;

            if (this.cyclingMode === 'waves') {
                // Linear cycling (wrap around)
                this.currentLayer = (this.currentLayer + 1) % this.layerCount;
            } else {
                // Ping-pong cycling
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
            this.updateLayerCycling();
            if (this.renderer && this.scene && this.camera) {
                this.renderer.render(this.scene, this.camera);
            }
        };
        animate();
    }

    /**
     * Stop animation loop
     */
    stopAnimation() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    /**
     * Handle container resize
     */
    resize() {
        this.updateLayout();
    }

    /**
     * Clean up resources
     */
    dispose() {
        this.stopAnimation();
        this.clearAllTiles();

        window.removeEventListener('resize', () => this.resize());

        if (this.ktx2Loader) {
            this.ktx2Loader.dispose();
            this.ktx2Loader = null;
        }

        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.domElement?.remove();
            this.renderer = null;
        }

        this.scene = null;
        this.camera = null;
        this.container = null;
    }
}
