import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import JSZip from 'jszip';

// TSL imports for WebGPU materials
import { texture, uniform, uv, float, vec2 } from 'three/tsl';

// Default texture ID from CDN (used when no source specified)
export const DEFAULT_TEXTURE_ID = 'wv-ywyV14qYSbrzgYga4l';

export class TileManager {
    constructor(options = {}) {
        const {
            source = null, // null means load from CDN using DEFAULT_TEXTURE_ID
            renderer = null,
            rendererType = 'webgl',
            tileCount = 32,
            rotate90 = false,
            onProgress = null // Callback for progress updates: (stage, current, total) => {}
        } = options;

        // Progress callback
        this.onProgress = onProgress;

        // General
        this.tileCount = tileCount;
        this.tileSize = 512;
        this.loadedCount = 0;
        this.renderer = renderer;
        this.rendererType = rendererType; // Store renderer type for material creation

        // JPG path
        this.tiles = [];

        // KTX2 path
        this.materials = [];
        this.arrayTextures = []; // Raw array textures for dual-texture flow materials

        // Check if source is a zip file
        this.isZip = typeof source === 'string' && source.endsWith('.zip');
        // Use GitHub Releases for large zip files, local path for others
        this.zipUrl = this.isZip ? this.#getZipUrl(source) : null;
        this.zipFiles = null; // Will store extracted files as { '0.ktx2': Uint8Array, ... }
        this.metadata = null; // Will store parsed metadata.json from zip

        // If source is null, we'll load from CDN in loadAllTiles()
        this.loadFromCDN = source === null;

        this.isKTX2 = source === null || (typeof source === 'string' && (source.startsWith('ktx2') || source.endsWith('.zip')));
        // For zip files, variant will be determined from metadata.json after extraction
        // For folder-based sources, check the path for 'planes' vs 'waves'
        // For CDN loading (source === null), variant will be set later from texture set metadata
        this.variant = this.isKTX2 && !this.isZip && source !== null
            ? (source.endsWith('planes') || source.includes('planes') ? 'planes' : 'waves')
            : null;
        this.folder = this.isKTX2 && !this.isZip && source !== null
            ? (this.variant === 'planes' ? './tiles-ktx2-planes' : './tiles-ktx2-waves')
            : './tiles-numbered';

        // Cycling state (KTX2 only)
        this.sharedLayerUniform = { value: 0 };
        this.sharedRotateUniform = { value: rotate90 ? 1 : 0 };
        this.currentLayer = 0;
        this.layerCount = 0;
        this.direction = 1; // for ping-pong in planes mode
        this.fps = 30; // fixed cadence
        this.lastFrameTime = 0;
        this.rotate90 = !!rotate90;

        // Flow animation state (continuous dual-texture approach)
        // flowOffset: 0.0 to 1.0 representing progress sliding to next tile
        // When flowOffset reaches 1.0, we swap tile pairs and reset to 0.0
        this.sharedFlowOffsetUniform = { value: 0.0 };
        this.flowOffset = 0.0;         // Current fractional offset (0.0 to 1.0)
        this.tileFlowOffset = 0;       // Current base tile offset (integer)
        this.flowSpeed = -0.25;          // Tiles per second (negative and positive imply opposite direciotn. )
        this.flowEnabled = false;       // Can be toggled
        this.flowMaterials = [];       // Track all dual-texture materials for uniform updates

        // WebGPU material mode: 'node' (NodeMaterial) or 'basic' (MeshBasicMaterial)
        // Can be set externally (e.g., via URL param) before loading tiles.
        this.webgpuMaterialMode = options.webgpuMaterialMode || 'node';

        // Current texture set metadata (for CDN-loaded textures)
        this.currentTextureSet = null;

        this._ktx2Loader = null;
    }

    /**
     * Get the thumbnail URL for the currently loaded texture set
     * @returns {string|null} Thumbnail URL or null if not available
     */
    getThumbnailUrl() {
        return this.currentTextureSet?.thumbnail_url || null;
    }

    /**
     * Set a callback for progress updates (for CDN loading)
     * @param {Function} callback - (stage, current, total) => {}
     */
    setProgressCallback(callback) {
        this.onProgress = callback;
    }

    async loadAllTiles() {
        // If loading from CDN (no local source specified), fetch from API
        if (this.loadFromCDN) {
            console.log(`[TileManager] Loading default texture from CDN: ${DEFAULT_TEXTURE_ID}`);
            // Import fetchTextureSet dynamically to avoid circular dependency
            const { fetchTextureSet } = await import('./textureService.js');

            try {
                if (this.onProgress) {
                    this.onProgress('downloading', 0, 1);
                }

                const textureSet = await fetchTextureSet(DEFAULT_TEXTURE_ID);

                if (!textureSet || !textureSet.tiles || textureSet.tiles.length === 0) {
                    throw new Error('No tiles found in default texture set');
                }

                console.log(`[TileManager] Fetched default texture set: ${textureSet.tiles.length} tiles`);

                // Store texture set metadata for thumbnail access
                this.currentTextureSet = textureSet;

                const success = await this.loadFromRemote(textureSet, this.onProgress);
                return success;
            } catch (error) {
                console.error('[TileManager] Failed to load default texture from CDN:', error);
                // Fall through to local loading as fallback
                this.loadFromCDN = false;
                this.isKTX2 = false;
            }
        }

        // If using zip, extract files first
        if (this.isZip) {
            const extracted = await this.#extractZipFile();
            if (!extracted) {
                console.warn('[TileManager] Failed to extract zip file, falling back to JPG textures');
                this.isKTX2 = false;
                this.isZip = false;
            }
        }

        if (this.isKTX2) {
            const ok = await this.#initKTX2();
            if (!ok) {
                console.warn('[TileManager] Falling back to JPG textures');
                this.isKTX2 = false;
            }
        }

        // Report initial building progress
        if (this.onProgress) {
            this.onProgress('building', 0, this.tileCount);
        }

        const promises = [];
        for (let i = 0; i < this.tileCount; i++) {
            const promise = (this.isKTX2 ? this.#loadKTX2Tile(i) : this.#loadJPGTile(i)).then(result => {
                // Report progress after each tile is loaded
                if (this.onProgress) {
                    this.onProgress('building', i + 1, this.tileCount);
                }
                return result;
            });
            promises.push(promise);
        }

        const results = await Promise.all(promises);

        if (this.isKTX2) {
            this.materials = results;
            console.log(`[TileManager] Loaded ${this.materials.length} KTX2 materials, layerCount=${this.layerCount}`);
            return this.materials;
        } else {
            this.tiles = results;
            console.log(`[TileManager] Loaded ${this.tiles.length} JPG textures`);
            return this.tiles;
        }
    }

    // Map zip filenames to their URLs (GitHub Releases for large files)
    // Note: GitHub Releases doesn't support CORS, so we use a proxy for cross-origin requests
    #getZipUrl(source) {
        const GITHUB_RELEASES = {
            'skating-512.zip': 'https://github.com/nsitu/rivvon/releases/download/textures/skating-512.zip'
        };

        const releaseUrl = GITHUB_RELEASES[source];
        if (releaseUrl) {
            // Check if we're on the same origin (local dev) or need CORS proxy
            const isLocalDev = window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1';

            if (isLocalDev) {
                // Local development can use the URL directly (or local file)
                return `./${source}`;
            }

            // For production (GitHub Pages), use corsproxy.io to bypass CORS
            return `https://corsproxy.io/?${encodeURIComponent(releaseUrl)}`;
        }

        // Fall back to local path
        return `./${source}`;
    }

    async #extractZipFile() {
        try {
            console.log(`[TileManager] Fetching zip file: ${this.zipUrl}`);

            // Report downloading stage
            if (this.onProgress) {
                this.onProgress('downloading', 0, 1);
            }

            const response = await fetch(this.zipUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch zip file: ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            console.log(`[TileManager] Zip file fetched, size: ${arrayBuffer.byteLength} bytes`);

            const zip = new JSZip();
            const zipData = await zip.loadAsync(arrayBuffer);

            // Extract and parse metadata.json if present
            const metadataFile = zipData.file('metadata.json');
            if (metadataFile) {
                try {
                    const metadataText = await metadataFile.async('text');
                    this.metadata = JSON.parse(metadataText);

                    // Determine variant from metadata
                    const crossSectionType = this.metadata?.settings?.crossSectionType;
                    if (crossSectionType) {
                        this.variant = crossSectionType; // 'planes' or 'waves'
                        console.log(`[TileManager] Variant set from metadata: ${this.variant}`);
                    }
                } catch (error) {
                    console.warn('[TileManager] Failed to parse metadata.json:', error);
                }
            } else {
                console.warn('[TileManager] No metadata.json found in zip, defaulting to "waves" variant');
                this.variant = 'waves'; // Default fallback
            }

            // Count ktx2 files first
            const ktx2Files = [];
            zipData.forEach((relativePath, file) => {
                if (relativePath.endsWith('.ktx2')) {
                    ktx2Files.push({ relativePath, file });
                }
            });

            const totalFiles = ktx2Files.length;
            console.log(`[TileManager] Found ${totalFiles} KTX2 files to extract`);

            // Extract all ktx2 files into memory with progress tracking
            this.zipFiles = {};
            let extractedCount = 0;

            // Report initial extraction progress
            if (this.onProgress) {
                this.onProgress('extracting', 0, totalFiles);
            }

            for (const { relativePath, file } of ktx2Files) {
                const data = await file.async('uint8array');
                this.zipFiles[relativePath] = data;
                extractedCount++;

                // Report progress after each file
                if (this.onProgress) {
                    this.onProgress('extracting', extractedCount, totalFiles);
                }
            }

            console.log(`[TileManager] Extracted ${Object.keys(this.zipFiles).length} KTX2 files from zip`);
            return true;
        } catch (error) {
            console.error('[TileManager] Failed to extract zip file:', error);
            return false;
        }
    }

    async #initKTX2() {
        // For WebGL: Require WebGL2 for sampler2DArray
        if (this.rendererType === 'webgl') {
            const gl2 = document.createElement('canvas').getContext('webgl2');
            if (!gl2) {
                console.warn('[TileManager] WebGL2 not available; cannot use KTX2 array textures');
                return false;
            }
        }

        try {
            // Use the same KTX2Loader for both renderer types
            this._ktx2Loader = new KTX2Loader();
            this._ktx2Loader.setTranscoderPath('./wasm/');

            if (this.renderer) {
                // For WebGPU, renderer.init() should already be awaited before this point
                // For WebGL, detectSupport works synchronously
                // Both now use the synchronous detectSupport() method
                this._ktx2Loader.detectSupport(this.renderer);
                console.log(`[TileManager] KTX2 support detected for ${this.rendererType}`);
            } else {
                // Best-effort: create a temporary renderer to detect support
                const tempRenderer = new THREE.WebGLRenderer({ antialias: false });
                this._ktx2Loader.detectSupport(tempRenderer);
                tempRenderer.dispose();
            }
            return true;
        } catch (err) {
            console.error('[TileManager] Failed to initialize KTX2Loader:', err);
            return false;
        }
    }

    #createArrayMaterial(arrayTexture) {
        if (this.rendererType === 'webgpu') {
            return this.#createArrayMaterialWebGPU(arrayTexture);
        } else {
            return this.#createArrayMaterialWebGL(arrayTexture);
        }
    }

    /**
     * Create a dual-texture material for smooth flow animation (WebGL).
     * Samples from two adjacent tiles and uses flowOffset to slide between them.
     * @param {THREE.DataArrayTexture} textureCurrent - Current tile's array texture
     * @param {THREE.DataArrayTexture} textureNext - Next tile's array texture
     * @returns {THREE.ShaderMaterial} Dual-texture material
     */
    #createDualTextureMaterialWebGL(textureCurrent, textureNext) {
        const layerCount = textureCurrent.image?.depth || 1;

        const material = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: {
                uTexArrayCurrent: { value: textureCurrent },
                uTexArrayNext: { value: textureNext },
                uLayer: this.sharedLayerUniform,
                uLayerCount: { value: layerCount },
                uRotate90: this.sharedRotateUniform,
                uFlowOffset: this.sharedFlowOffsetUniform
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
                uniform sampler2DArray uTexArrayCurrent;
                uniform sampler2DArray uTexArrayNext;
                uniform int uLayer;
                uniform int uRotate90;
                uniform float uFlowOffset;
                out vec4 outColor;
                void main() {
                    // Apply flow offset to U coordinate (slides along ribbon)
                    float shiftedU = vUv.x + uFlowOffset;
                    
                    vec2 sampleUV;
                    vec4 texColor;
                    
                    if (shiftedU >= 1.0) {
                        // This region shows the NEXT tile
                        sampleUV = vec2(shiftedU - 1.0, vUv.y);
                        // Optionally rotate by 90 degrees (clockwise)
                        vec2 uvR = (uRotate90 == 1) ? vec2(sampleUV.y, 1.0 - sampleUV.x) : sampleUV;
                        // Flip V to match texture orientation
                        vec2 flippedUv = vec2(uvR.x, 1.0 - uvR.y);
                        texColor = texture(uTexArrayNext, vec3(flippedUv, float(uLayer)));
                    } else {
                        // This region shows the CURRENT tile
                        sampleUV = vec2(shiftedU, vUv.y);
                        // Optionally rotate by 90 degrees (clockwise)
                        vec2 uvR = (uRotate90 == 1) ? vec2(sampleUV.y, 1.0 - sampleUV.x) : sampleUV;
                        // Flip V to match texture orientation
                        vec2 flippedUv = vec2(uvR.x, 1.0 - uvR.y);
                        texColor = texture(uTexArrayCurrent, vec3(flippedUv, float(uLayer)));
                    }
                    
                    outColor = texColor;
                }
            `,
            transparent: false,
            depthWrite: true,
            side: THREE.DoubleSide
        });

        // Store texture references for swapping
        material._textureCurrent = textureCurrent;
        material._textureNext = textureNext;

        return material;
    }

    /**
     * Create a dual-texture material for smooth flow animation (WebGPU).
     * @param {THREE.DataArrayTexture} textureCurrent - Current tile's array texture
     * @param {THREE.DataArrayTexture} textureNext - Next tile's array texture
     * @returns {THREE_WEBGPU.NodeMaterial} Dual-texture material
     */
    #createDualTextureMaterialWebGPU(textureCurrent, textureNext) {
        const layerCount = textureCurrent.image?.depth || 1;

        // For now, fall back to simple material in WebGPU
        // TSL conditional texture sampling is complex; we'll use a simpler approach
        // TODO: Implement proper TSL dual-texture sampling
        
        // Create uniforms
        const layerUniform = uniform(this.sharedLayerUniform.value);
        const rotateUniform = uniform(this.sharedRotateUniform.value);
        const flowOffsetUniform = uniform(this.sharedFlowOffsetUniform.value);

        // For WebGPU, we'll create a material that updates its texture based on flowOffset
        // Since TSL doesn't easily support conditional texture selection, we'll use a blend approach
        const baseUV = uv();
        
        // Apply flow offset
        const shiftedU = baseUV.x.add(flowOffsetUniform);
        
        // Create two UV sets
        const uvCurrent = vec2(shiftedU, baseUV.y);
        const uvNext = vec2(shiftedU.sub(1.0), baseUV.y);
        
        // Apply rotation and flip for current
        const rotatedCurrent = rotateUniform.equal(1).select(
            vec2(uvCurrent.y, float(1).sub(uvCurrent.x)),
            uvCurrent
        );
        const finalUVCurrent = vec2(rotatedCurrent.x, float(1).sub(rotatedCurrent.y));
        
        // Apply rotation and flip for next
        const rotatedNext = rotateUniform.equal(1).select(
            vec2(uvNext.y, float(1).sub(uvNext.x)),
            uvNext
        );
        const finalUVNext = vec2(rotatedNext.x, float(1).sub(rotatedNext.y));
        
        // Sample both textures
        const colorCurrent = texture(textureCurrent, finalUVCurrent).depth(layerUniform);
        const colorNext = texture(textureNext, finalUVNext).depth(layerUniform);
        
        // Select based on whether shiftedU >= 1.0
        const useNext = shiftedU.greaterThanEqual(1.0);
        const finalColor = useNext.select(colorNext, colorCurrent);

        const material = new THREE_WEBGPU.NodeMaterial();
        material.colorNode = finalColor;
        material.transparent = false;
        material.depthWrite = true;
        material.side = THREE.DoubleSide;

        // Store references for updates
        material._layerUniform = layerUniform;
        material._rotateUniform = rotateUniform;
        material._flowOffsetUniform = flowOffsetUniform;
        material._textureCurrent = textureCurrent;
        material._textureNext = textureNext;

        return material;
    }

    /**
     * Create a dual-texture material for a specific segment.
     * @param {number} segmentIndex - The segment's base tile index
     * @returns {THREE.Material} Dual-texture material for smooth flow
     */
    createFlowMaterial(segmentIndex) {
        if (!this.isKTX2 || this.arrayTextures.length === 0) {
            return this.getMaterial(segmentIndex);
        }

        const currentIdx = (segmentIndex + this.tileFlowOffset) % this.tileCount;
        const nextIdx = (currentIdx + 1) % this.tileCount;

        const textureCurrent = this.arrayTextures[currentIdx];
        const textureNext = this.arrayTextures[nextIdx];

        if (!textureCurrent || !textureNext) {
            console.warn(`[TileManager] Missing textures for flow material: ${currentIdx}, ${nextIdx}`);
            return this.getMaterial(segmentIndex);
        }

        let material;
        if (this.rendererType === 'webgpu') {
            material = this.#createDualTextureMaterialWebGPU(textureCurrent, textureNext);
        } else {
            material = this.#createDualTextureMaterialWebGL(textureCurrent, textureNext);
        }

        // Track this material for uniform updates
        if (material) {
            this.flowMaterials.push(material);
        }

        return material;
    }

    /**
     * Get a raw array texture by index.
     * @param {number} index - Tile index
     * @returns {THREE.DataArrayTexture|null} The array texture or null
     */
    getArrayTexture(index) {
        return this.arrayTextures[index % this.tileCount] || null;
    }

    /**
     * Clear tracked flow materials (call before rebuilding ribbons).
     */
    clearFlowMaterials() {
        this.flowMaterials = [];
    }

    #createArrayMaterialWebGL(arrayTexture) {
        const layerCount = arrayTexture.image?.depth || 1;

        const material = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: {
                uTexArray: { value: arrayTexture },
                uLayer: this.sharedLayerUniform,
                uLayerCount: { value: layerCount },
                uRotate90: this.sharedRotateUniform
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
                uniform int uRotate90;
                out vec4 outColor;
                void main() {
                    // Optionally rotate by 90 degrees (clockwise)
                    vec2 uvR = (uRotate90 == 1) ? vec2(vUv.y, 1.0 - vUv.x) : vUv;
                    
                    // Flip V to match texture orientation
                    vec2 flippedUv = vec2(uvR.x, 1.0 - uvR.y);
                    
                    outColor = texture(uTexArray, vec3(flippedUv, float(uLayer)));
                }
            `,
            transparent: false,
            depthWrite: true,
            side: THREE.DoubleSide
        });

        return material;
    }

    #createArrayMaterialWebGPU(arrayTexture) {
        const layerCount = arrayTexture.image?.depth || 1;

        // Simple fallback path: use a non-array texture in a MeshBasicMaterial
        // for debugging, instead of the KTX2 array texture.
        if (this.webgpuMaterialMode === 'basic') {
            const debugTex = new THREE.CanvasTexture(Object.assign(
                document.createElement('canvas'),
                {
                    width: 2,
                    height: 2
                }
            ));
            const ctx = debugTex.image.getContext('2d');
            ctx.fillStyle = '#ff00ff';
            ctx.fillRect(0, 0, 2, 2);
            debugTex.needsUpdate = true;

            const basicMat = new THREE.MeshBasicMaterial({
                map: debugTex,
                side: THREE.DoubleSide
            });

            console.log('[TileManager] WebGPU BASIC debug material created (non-array texture)', {
                layerCount,
                textureDepth: arrayTexture.image?.depth,
                textureFormat: arrayTexture.format
            });

            return basicMat;
        }

        // Create uniforms for layer and rotation
        const layerUniform = uniform(this.sharedLayerUniform.value);
        const rotateUniform = uniform(this.sharedRotateUniform.value);

        // Get base UV coordinates
        const baseUV = uv();

        // Step 1: Optionally rotate by 90 degrees clockwise
        // Rotation: (x, y) → (y, 1 - x)
        // Using TSL's select() for conditional: condition.select(valueIfTrue, valueIfFalse)
        const rotatedUV = rotateUniform.equal(1).select(
            // If rotate is enabled: create vec2(y, 1-x)
            vec2(baseUV.y, float(1).sub(baseUV.x)),
            // If rotate is disabled: keep original UV
            baseUV
        );

        // Step 2: Flip V coordinate to match texture orientation
        const finalUV = vec2(
            rotatedUV.x,
            float(1).sub(rotatedUV.y)
        );

        // Create NodeMaterial with texture array sampling using .depth()
        const material = new THREE_WEBGPU.NodeMaterial();
        material.colorNode = texture(arrayTexture, finalUV).depth(layerUniform);
        material.transparent = false;
        material.depthWrite = true;
        material.side = THREE.DoubleSide;

        // Store references to uniforms for updates
        material._layerUniform = layerUniform;
        material._rotateUniform = rotateUniform;

        console.log('[TileManager] WebGPU material created:', {
            layerCount,
            textureDepth: arrayTexture.image?.depth,
            textureFormat: arrayTexture.format,
            rotate90: this.rotate90
        });

        return material;
    }

    /**
     * Toggle WebGPU material mode between 'node' (NodeMaterial) and 'basic' (MeshBasicMaterial).
     * This only affects newly created materials; existing meshes keep their current material.
     */
    setWebGPUMaterialMode(mode) {
        if (mode !== 'node' && mode !== 'basic') return;
        if (this.rendererType !== 'webgpu') return;

        if (this.webgpuMaterialMode !== mode) {
            console.log('[TileManager] Switching WebGPU material mode to', mode);
        }
        this.webgpuMaterialMode = mode;
    }

    async #loadKTX2Tile(index) {
        return new Promise((resolve, reject) => {
            if (!this._ktx2Loader) {
                reject(new Error('KTX2Loader not initialized'));
                return;
            }

            // If loading from zip, use the extracted data
            if (this.isZip && this.zipFiles) {
                const filename = `${index}.ktx2`;
                const fileData = this.zipFiles[filename];

                if (!fileData) {
                    console.error(`[TileManager] File ${filename} not found in zip`);
                    const fallback = new THREE.MeshBasicMaterial({ color: new THREE.Color(`hsl(${index * 11}, 70%, 50%)`) });
                    resolve(fallback);
                    return;
                }

                // Parse the KTX2 file from the Uint8Array buffer
                this._ktx2Loader.parse(
                    fileData.buffer,
                    (arrayTexture) => {
                        // Configure array texture
                        arrayTexture.flipY = false; // shader flips V
                        arrayTexture.generateMipmaps = false;
                        const hasMips = Array.isArray(arrayTexture.mipmaps) && arrayTexture.mipmaps.length > 1;
                        arrayTexture.minFilter = hasMips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
                        arrayTexture.magFilter = THREE.LinearFilter;
                        arrayTexture.wrapS = THREE.ClampToEdgeWrapping;
                        arrayTexture.wrapT = THREE.ClampToEdgeWrapping;

                        // Set color space for WebGL to match WebGPU brightness
                        if (this.rendererType === 'webgl') {
                            arrayTexture.colorSpace = THREE.LinearSRGBColorSpace;
                        }

                        if (this.layerCount === 0) {
                            this.layerCount = arrayTexture.image?.depth || 1;
                            // Reset cycling state
                            this.currentLayer = 0;
                            this.direction = 1;
                            this.sharedLayerUniform.value = 0;
                        } else {
                            const depth = arrayTexture.image?.depth || 1;
                            if (depth !== this.layerCount) {
                                console.warn(`[TileManager] Tile ${index} depth (${depth}) != layerCount (${this.layerCount}); will clamp when cycling`);
                            }
                        }

                        // Store raw texture for dual-texture flow materials
                        this.arrayTextures[index] = arrayTexture;

                        const material = this.#createArrayMaterial(arrayTexture);
                        resolve(material);
                    },
                    (error) => {
                        console.error(`[TileManager] Failed to parse KTX2 tile ${index} from zip:`, error);
                        console.error(`[TileManager] Error details:`, {
                            message: error?.message,
                            stack: error?.stack,
                            name: error?.name,
                            errorString: String(error)
                        });
                        // Create a fallback solid-color material to keep app running
                        const fallback = new THREE.MeshBasicMaterial({ color: new THREE.Color(`hsl(${index * 11}, 70%, 50%)`) });
                        resolve(fallback);
                    }
                );
            } else {
                // Loading from folder (original behavior)
                const url = `${this.folder}/${index}.ktx2`;
                this._ktx2Loader.load(
                    url,
                    (arrayTexture) => {
                        // Configure array texture
                        arrayTexture.flipY = false; // shader flips V
                        arrayTexture.generateMipmaps = false;
                        const hasMips = Array.isArray(arrayTexture.mipmaps) && arrayTexture.mipmaps.length > 1;
                        arrayTexture.minFilter = hasMips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
                        arrayTexture.magFilter = THREE.LinearFilter;
                        arrayTexture.wrapS = THREE.ClampToEdgeWrapping;
                        arrayTexture.wrapT = THREE.ClampToEdgeWrapping;

                        // Set color space for WebGL to match WebGPU brightness
                        if (this.rendererType === 'webgl') {
                            arrayTexture.colorSpace = THREE.LinearSRGBColorSpace;
                        }

                        if (this.layerCount === 0) {
                            this.layerCount = arrayTexture.image?.depth || 1;
                            // Reset cycling state
                            this.currentLayer = 0;
                            this.direction = 1;
                            this.sharedLayerUniform.value = 0;
                        } else {
                            const depth = arrayTexture.image?.depth || 1;
                            if (depth !== this.layerCount) {
                                console.warn(`[TileManager] Tile ${index} depth (${depth}) != layerCount (${this.layerCount}); will clamp when cycling`);
                            }
                        }

                        // Store raw texture for dual-texture flow materials
                        this.arrayTextures[index] = arrayTexture;

                        const material = this.#createArrayMaterial(arrayTexture);
                        resolve(material);
                    },
                    undefined,
                    (error) => {
                        console.error(`[TileManager] Failed to load KTX2 tile ${index}:`, error);
                        console.error(`[TileManager] Error details:`, {
                            message: error?.message,
                            stack: error?.stack,
                            name: error?.name,
                            errorString: String(error)
                        });
                        // Create a fallback solid-color material to keep app running
                        const fallback = new THREE.MeshBasicMaterial({ color: new THREE.Color(`hsl(${index * 11}, 70%, 50%)`) });
                        resolve(fallback);
                    }
                );
            }
        });
    }

    async #loadJPGTile(index) {
        return new Promise((resolve, reject) => {
            const loader = new THREE.TextureLoader();
            loader.load(
                `./tiles-numbered/${index}.jpg`,
                (texture) => {
                    texture.wrapS = THREE.RepeatWrapping;
                    texture.wrapT = THREE.RepeatWrapping;
                    texture.minFilter = THREE.LinearFilter;
                    texture.magFilter = THREE.LinearFilter;

                    // Set color space for WebGL to match WebGPU brightness
                    if (this.rendererType === 'webgl') {
                        texture.colorSpace = THREE.LinearSRGBColorSpace;
                    }

                    resolve(texture);
                },
                undefined,
                (error) => {
                    console.error(`Failed to load tile ${index}:`, error);
                    // Create a fallback colored texture
                    const canvas = document.createElement('canvas');
                    canvas.width = canvas.height = this.tileSize;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = `hsl(${index * 11}, 70%, 50%)`;
                    ctx.fillRect(0, 0, this.tileSize, this.tileSize);
                    const fallbackTexture = new THREE.CanvasTexture(canvas);
                    resolve(fallbackTexture);
                }
            );
        });
    }

    getTile(index) {
        const tile = this.tiles[index % this.tileCount];
        // console.log('[TileManager] getTile', index, {
        //     tileExists: !!tile,
        //     totalTiles: this.tiles.length
        // });
        return tile;
    }

    getMaterial(index) {
        if (!this.isKTX2) return undefined;
        const material = this.materials[index % this.tileCount];
        // console.log('[TileManager] getMaterial', index, {
        //     isKTX2: this.isKTX2,
        //     materialExists: !!material,
        //     materialType: material?.constructor?.name || 'undefined'
        // });
        return material;
    }

    getTileSequence(startIndex, count) {
        const sequence = [];
        for (let i = 0; i < count; i++) {
            sequence.push(this.getTile(startIndex + i));
        }
        return sequence;
    }

    getLayerCount() {
        return this.layerCount || 0;
    }

    /**
     * Get the layer cycling FPS
     * @returns {number} Frames per second for layer cycling
     */
    getFps() {
        return this.fps || 30;
    }

    /**
     * Get the layer cycle period (time to complete one full animation cycle)
     * Accounts for different cycling modes:
     * - 'waves': wraps around (0 → layerCount-1 → 0), cycle = layerCount frames
     * - 'planes': ping-pong (0 → layerCount-1 → 0), cycle = 2*(layerCount-1) frames
     * @returns {number} Cycle period in seconds
     */
    getLayerCyclePeriod() {
        const layerCount = this.getLayerCount();
        const fps = this.getFps();
        if (layerCount <= 1 || fps <= 0) return 1; // Default 1 second if no cycling
        
        if (this.variant === 'waves') {
            // Waves: simple wrap-around cycle
            return layerCount / fps;
        } else {
            // Planes: ping-pong cycle (0 → max → 0)
            // Full cycle is 2 * (layerCount - 1) frames
            return (2 * (layerCount - 1)) / fps;
        }
    }

    /**
     * Get the optimal undulation period for smooth wave animation.
     * Finds the nearest multiple of the layer cycle period to a target duration,
     * ensuring the undulation and texture cycling eventually sync up.
     * @param {number} targetPeriod - Target period in seconds (default 3.0)
     * @returns {number} Optimal period in seconds (multiple of layer cycle)
     */
    getOptimalUndulationPeriod(targetPeriod = 3.0) {
        const layerCycle = this.getLayerCyclePeriod();
        
        if (layerCycle <= 0) return targetPeriod;
        
        // Find the number of layer cycles that gets closest to target
        const numCycles = Math.max(1, Math.round(targetPeriod / layerCycle));
        
        return numCycles * layerCycle;
    }

    tick(nowMs) {
        if (!this.isKTX2) return;

        if (this.lastFrameTime === 0) this.lastFrameTime = nowMs;
        const elapsed = nowMs - this.lastFrameTime;
        const elapsedSec = elapsed / 1000;

        // --- Flow animation (continuous dual-texture approach) ---
        if (this.flowEnabled && this.flowSpeed !== 0) {
            // Accumulate fractional offset based on elapsed time
            // Let flowOffset exceed 1.0 - wrapping is handled by updateFlowMaterials()
            // to avoid 1-frame glitches when texture pairs are swapped
            this.flowOffset += this.flowSpeed * elapsedSec;
            
            // Update shared uniform for continuous animation
            this.sharedFlowOffsetUniform.value = this.flowOffset;

            // For WebGPU, also update TSL uniform nodes on all flow materials
            if (this.rendererType === 'webgpu') {
                for (const material of this.flowMaterials) {
                    if (material._flowOffsetUniform) {
                        material._flowOffsetUniform.value = this.flowOffset;
                    }
                }
            }
        }

        // --- Layer cycling animation (frame-rate limited) ---
        if (this.layerCount <= 1) {
            this.lastFrameTime = nowMs;
            return;
        }

        const frameInterval = 1000 / this.fps;

        if (elapsed >= frameInterval) {
            this.lastFrameTime = nowMs;

            if (this.variant === 'waves') {
                this.currentLayer = (this.currentLayer + 1) % this.layerCount;
            } else {
                // planes: ping-pong
                this.currentLayer += this.direction;
                if (this.currentLayer >= this.layerCount - 1) {
                    this.currentLayer = this.layerCount - 1;
                    this.direction = -1;
                } else if (this.currentLayer <= 0) {
                    this.currentLayer = 0;
                    this.direction = 1;
                }
            }

            // Update shared uniform (clamped)
            const clamped = Math.max(0, Math.min(this.currentLayer, Math.max(0, this.layerCount - 1)));
            this.sharedLayerUniform.value = clamped | 0; // ensure int

            // For WebGPU, also update TSL uniform nodes on BOTH regular and flow materials
            if (this.rendererType === 'webgpu') {
                // Update regular materials
                this.materials.forEach(material => {
                    if (material._layerUniform) {
                        material._layerUniform.value = clamped;
                    }
                });
                // Update flow materials
                for (const material of this.flowMaterials) {
                    if (material._layerUniform) {
                        material._layerUniform.value = clamped;
                    }
                }
            }
        }
    }

    /**
     * Enable or disable a 90-degree UV rotation for KTX2 materials to adjust tile alignment.
     * @param {boolean} flag
     */
    setRotate90(flag) {
        this.rotate90 = !!flag;
        this.sharedRotateUniform.value = this.rotate90 ? 1 : 0;

        // For WebGPU, also update TSL uniform nodes
        if (this.rendererType === 'webgpu') {
            this.materials.forEach(material => {
                if (material._rotateUniform) {
                    material._rotateUniform.value = this.rotate90 ? 1 : 0;
                }
            });
        }
    }

    /**
     * Set the flow animation speed (tile streaming along ribbon).
     * @param {number} tilesPerSecond - Speed in tiles per second. Positive = forward, negative = backward, 0 = disabled.
     */
    setFlowSpeed(tilesPerSecond) {
        this.flowSpeed = tilesPerSecond;
        console.log(`[TileManager] Flow speed set to ${tilesPerSecond} tiles/second`);
    }

    /**
     * Get the current flow speed.
     * @returns {number} Flow speed in tiles per second
     */
    getFlowSpeed() {
        return this.flowSpeed;
    }

    /**
     * Get the current tile flow offset (integer).
     * Used by RibbonSeries to offset material assignments for conveyor effect.
     * @returns {number} Current tile offset
     */
    getTileFlowOffset() {
        return this.tileFlowOffset;
    }

    /**
     * Get the current fractional flow offset (0.0 to 1.0).
     * Used for continuous UV-based animation within dual-texture materials.
     * @returns {number} Current fractional offset
     */
    getFlowOffset() {
        return this.flowOffset;
    }

    /**
     * Wrap the flow offset after texture pairs have been swapped.
     * Called by RibbonSeries.updateFlowMaterials() after creating new materials.
     * @param {number} wholeTiles - Number of whole tiles to shift (can be negative)
     */
    wrapFlowOffset(wholeTiles) {
        // Update tile base offset
        this.tileFlowOffset = (this.tileFlowOffset + wholeTiles + this.tileCount) % this.tileCount;
        
        // Wrap flowOffset to [0, 1) range
        this.flowOffset -= wholeTiles;
        
        // Update uniforms with wrapped value
        this.sharedFlowOffsetUniform.value = this.flowOffset;
        
        // For WebGPU, update TSL uniform nodes
        if (this.rendererType === 'webgpu') {
            for (const material of this.flowMaterials) {
                if (material._flowOffsetUniform) {
                    material._flowOffsetUniform.value = this.flowOffset;
                }
            }
        }
    }

    /**
     * Check if tile base offset has changed since last check.
     * Used by RibbonSeries to know when to swap texture pairs.
     * @returns {boolean} True if tile offset changed
     */
    didTileOffsetChange() {
        if (this._lastCheckedTileOffset !== this.tileFlowOffset) {
            this._lastCheckedTileOffset = this.tileFlowOffset;
            return true;
        }
        return false;
    }

    /**
     * Enable or disable flow animation.
     * When disabled, uses optimized single-texture materials.
     * @param {boolean} enabled - Whether flow animation is enabled
     * @returns {boolean} Whether the state actually changed
     */
    setFlowEnabled(enabled) {
        const wasEnabled = this.flowEnabled;
        this.flowEnabled = !!enabled;
        
        if (!this.flowEnabled) {
            // Reset flow offset when disabled
            this.tileFlowOffset = 0;
            this.flowOffset = 0;
            this.sharedFlowOffsetUniform.value = 0;
        }
        
        const stateChanged = wasEnabled !== this.flowEnabled;
        console.log(`[TileManager] Flow animation ${enabled ? 'enabled' : 'disabled'}${stateChanged ? ' (state changed)' : ''}`);
        
        return stateChanged;
    }

    /**
     * Check if flow animation is enabled.
     * @returns {boolean} Whether flow is enabled
     */
    isFlowEnabled() {
        return this.flowEnabled;
    }

    /**
     * Load textures from a user-provided zip file (ArrayBuffer).
     * This replaces the current textures with those from the uploaded file.
     * @param {ArrayBuffer} arrayBuffer - The zip file as an ArrayBuffer
     * @param {Function} onProgress - Optional progress callback: (stage, current, total) => {}
     * @returns {Promise<boolean>} True if successful, false otherwise
     */
    async loadFromUserZip(arrayBuffer, onProgress = null) {
        try {
            console.log(`[TileManager] Loading user-uploaded zip, size: ${arrayBuffer.byteLength} bytes`);

            // Clean up existing materials
            this.#disposeMaterials();

            const zip = new JSZip();
            const zipData = await zip.loadAsync(arrayBuffer);

            // Extract and parse metadata.json if present
            const metadataFile = zipData.file('metadata.json');
            if (metadataFile) {
                try {
                    const metadataText = await metadataFile.async('text');
                    this.metadata = JSON.parse(metadataText);

                    // Determine variant from metadata
                    const crossSectionType = this.metadata?.settings?.crossSectionType;
                    if (crossSectionType) {
                        this.variant = crossSectionType; // 'planes' or 'waves'
                        console.log(`[TileManager] Variant set from metadata: ${this.variant}`);
                    }
                } catch (error) {
                    console.warn('[TileManager] Failed to parse metadata.json:', error);
                }
            } else {
                console.warn('[TileManager] No metadata.json found in zip, defaulting to "waves" variant');
                this.variant = 'waves';
            }

            // Count ktx2 files first
            const ktx2Files = [];
            zipData.forEach((relativePath, file) => {
                if (relativePath.endsWith('.ktx2')) {
                    ktx2Files.push({ relativePath, file });
                }
            });

            const totalFiles = ktx2Files.length;
            if (totalFiles === 0) {
                console.error('[TileManager] No KTX2 files found in uploaded zip');
                return false;
            }

            console.log(`[TileManager] Found ${totalFiles} KTX2 files to extract`);

            // Update tile count based on actual files
            this.tileCount = totalFiles;

            // Extract all ktx2 files into memory with progress tracking
            this.zipFiles = {};
            let extractedCount = 0;

            if (onProgress) {
                onProgress('extracting', 0, totalFiles);
            }

            for (const { relativePath, file } of ktx2Files) {
                const data = await file.async('uint8array');
                this.zipFiles[relativePath] = data;
                extractedCount++;

                if (onProgress) {
                    onProgress('extracting', extractedCount, totalFiles);
                }
            }

            console.log(`[TileManager] Extracted ${Object.keys(this.zipFiles).length} KTX2 files from user zip`);

            // Mark as KTX2 and zip mode
            this.isZip = true;
            this.isKTX2 = true;

            // Reset layer state
            this.layerCount = 0;
            this.currentLayer = 0;
            this.direction = 1;
            this.sharedLayerUniform.value = 0;

            // Reset flow state
            this.tileFlowOffset = 0;
            this.flowAccumulator = 0;

            // Initialize KTX2 loader if not already done
            if (!this._ktx2Loader) {
                const ok = await this.#initKTX2();
                if (!ok) {
                    console.error('[TileManager] Failed to initialize KTX2 loader for user zip');
                    return false;
                }
            }

            // Load all tiles
            if (onProgress) {
                onProgress('building', 0, this.tileCount);
            }

            const promises = [];
            for (let i = 0; i < this.tileCount; i++) {
                const promise = this.#loadKTX2Tile(i).then(result => {
                    if (onProgress) {
                        onProgress('building', i + 1, this.tileCount);
                    }
                    return result;
                });
                promises.push(promise);
            }

            const results = await Promise.all(promises);
            this.materials = results;

            console.log(`[TileManager] Loaded ${this.materials.length} KTX2 materials from user zip, layerCount=${this.layerCount}`);
            return true;
        } catch (error) {
            console.error('[TileManager] Failed to load user zip:', error);
            return false;
        }
    }

    /**
     * Dispose of all current materials to free GPU memory
     */
    #disposeMaterials() {
        this.materials.forEach(material => {
            if (material) {
                // Dispose texture if it exists
                if (material.map) {
                    material.map.dispose();
                }
                // For array textures stored in uniforms
                if (material.uniforms?.uTexArray?.value) {
                    material.uniforms.uTexArray.value.dispose();
                }
                material.dispose();
            }
        });
        this.materials = [];

        // Also dispose tiles (for JPG mode)
        this.tiles.forEach(texture => {
            if (texture && texture.dispose) {
                texture.dispose();
            }
        });
        this.tiles = [];

        // Clear zip files from memory
        this.zipFiles = null;
    }

    /**
     * Get the current tile count
     * @returns {number} The number of tiles
     */
    getTileCount() {
        return this.tileCount;
    }

    /**
     * Load textures from a remote texture set (via Rivvon API).
     * Downloads KTX2 tiles from CDN URLs and builds materials.
     * @param {Object} textureSet - Texture set metadata from API
     * @param {Array} textureSet.tiles - Array of { tileIndex, url, fileSize }
     * @param {number} textureSet.tile_count - Number of tiles
     * @param {number} textureSet.layer_count - Layers per tile
     * @param {string} textureSet.cross_section_type - 'planes' or 'waves'
     * @param {Function} onProgress - Optional progress callback: (stage, current, total) => {}
     * @returns {Promise<boolean>} True if successful, false otherwise
     */
    async loadFromRemote(textureSet, onProgress = null) {
        try {
            const { tiles, tile_count, layer_count, cross_section_type } = textureSet;

            if (!tiles || tiles.length === 0) {
                console.error('[TileManager] No tiles in remote texture set');
                return false;
            }

            console.log(`[TileManager] Loading remote texture set: ${tiles.length} tiles`);

            // Clean up existing materials
            this.#disposeMaterials();

            // Update state from texture set metadata
            this.tileCount = tile_count || tiles.length;
            this.variant = cross_section_type || 'waves';
            this.isKTX2 = true;
            this.isZip = true; // Use zip-like flow to parse from downloaded buffers

            // Reset layer state
            this.layerCount = 0;
            this.currentLayer = 0;
            this.direction = 1;
            this.sharedLayerUniform.value = 0;

            // Reset flow state
            this.tileFlowOffset = 0;
            this.flowAccumulator = 0;

            // Initialize KTX2 loader if not already done
            if (!this._ktx2Loader) {
                const ok = await this.#initKTX2();
                if (!ok) {
                    console.error('[TileManager] Failed to initialize KTX2 loader for remote textures');
                    return false;
                }
            }

            // Track download progress across all tiles
            const totalTiles = tiles.length;
            let completedDownloads = 0;

            if (onProgress) {
                onProgress('downloading', 0, totalTiles);
            }

            // Download all tile data in parallel with cumulative progress tracking
            const tileDataArray = await Promise.all(
                tiles.map(async (tile) => {
                    try {
                        const tileIndex = tile.index ?? tile.tileIndex ?? 0;
                        let data;

                        // Check if this is a Google Drive URL (needs API fetch) or direct URL (CDN)
                        if (tile.driveFileId) {
                            // Use Drive API via auth module
                            const { fetchDriveFile } = await import('./auth.js');
                            data = await fetchDriveFile(tile.driveFileId);
                        } else if (tile.url && tile.url.includes('drive.google.com')) {
                            // Extract file ID from Drive URL and use API
                            const fileIdMatch = tile.url.match(/[?&]id=([^&]+)/);
                            if (fileIdMatch) {
                                const { fetchDriveFile } = await import('./auth.js');
                                data = await fetchDriveFile(fileIdMatch[1]);
                            } else {
                                throw new Error('Invalid Drive URL format');
                            }
                        } else {
                            // Direct URL (R2/CDN) - standard fetch
                            const response = await fetch(tile.url);
                            if (!response.ok) {
                                throw new Error(`Failed to fetch tile ${tileIndex}: ${response.statusText}`);
                            }
                            data = await response.arrayBuffer();
                        }

                        // Increment completed count and report progress
                        completedDownloads++;
                        if (onProgress) {
                            onProgress('downloading', completedDownloads, totalTiles);
                        }

                        return { index: tileIndex, data: new Uint8Array(data) };
                    } catch (err) {
                        const tileIndex = tile.index ?? tile.tileIndex ?? 0;
                        console.error(`[TileManager] Failed to download tile ${tileIndex}:`, err);

                        // Still increment to avoid stuck progress
                        completedDownloads++;
                        if (onProgress) {
                            onProgress('downloading', completedDownloads, totalTiles);
                        }

                        return { index: tileIndex, data: null };
                    }
                })
            );

            // Store in zipFiles format for compatibility with #loadKTX2Tile
            this.zipFiles = {};
            for (const { index, data } of tileDataArray) {
                if (data) {
                    this.zipFiles[`${index}.ktx2`] = data;
                }
            }

            // Build materials with cumulative progress tracking
            let completedBuilds = 0;
            if (onProgress) {
                onProgress('building', 0, this.tileCount);
            }

            const promises = [];
            for (let i = 0; i < this.tileCount; i++) {
                const promise = this.#loadKTX2Tile(i).then(result => {
                    completedBuilds++;
                    if (onProgress) {
                        onProgress('building', completedBuilds, this.tileCount);
                    }
                    return result;
                });
                promises.push(promise);
            }

            const results = await Promise.all(promises);
            this.materials = results;

            console.log(`[TileManager] Loaded ${this.materials.length} KTX2 materials from remote, layerCount=${this.layerCount}`);
            return true;
        } catch (error) {
            console.error('[TileManager] Failed to load remote textures:', error);
            return false;
        }
    }
}