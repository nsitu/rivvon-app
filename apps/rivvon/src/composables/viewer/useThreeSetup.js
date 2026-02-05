// src/composables/viewer/useThreeSetup.js
// Three.js initialization composable for rivvon

import { ref, shallowRef, onUnmounted } from 'vue';
import { useViewerStore } from '../../stores/viewerStore';
import * as THREE from 'three';

// Import existing modules (these work as-is)
import { initThree as initThreeModule } from '../../modules/viewer/threeSetup';
import { TileManager } from '../../modules/viewer/tileManager';
import { Ribbon } from '../../modules/viewer/ribbon';
import { RibbonSeries } from '../../modules/viewer/ribbonSeries';

export function useThreeSetup() {
    const app = useViewerStore();
    
    // Use shallowRef for complex objects to avoid deep reactivity overhead
    const scene = shallowRef(null);
    const camera = shallowRef(null);
    const renderer = shallowRef(null);
    const controls = shallowRef(null);
    const tileManager = shallowRef(null);
    const ribbon = shallowRef(null);
    const ribbonSeries = shallowRef(null);
    
    const isInitialized = ref(false);
    const resetCamera = ref(null);
    const backgroundTexture = shallowRef(null);
    
    let animationId = null;
    let renderCallback = null;

    /**
     * Initialize Three.js scene
     */
    async function initThree(rendererType, container) {
        if (isInitialized.value) {
            console.warn('[ThreeSetup] Already initialized');
            return;
        }

        try {
            const ctx = await initThreeModule(rendererType);
            scene.value = ctx.scene;
            camera.value = ctx.camera;
            renderer.value = ctx.renderer;
            controls.value = ctx.controls;
            resetCamera.value = ctx.resetCamera;
            
            // Store context in app store for access by other components
            app.setThreeContext({
                scene: ctx.scene,
                camera: ctx.camera,
                renderer: ctx.renderer,
                controls: ctx.controls,
                rendererType: ctx.rendererType
            });

            // Initialize tile manager with default texture
            tileManager.value = new TileManager({
                renderer: ctx.renderer,
                rendererType: ctx.rendererType,
                rotate90: true,
                webgpuMaterialMode: 'node'
            });
            await tileManager.value.loadAllTiles();

            // Get thumbnail URL for blurred background
            const thumbnailUrl = tileManager.value.getThumbnailUrl();
            if (thumbnailUrl) {
                app.setThumbnailUrl(thumbnailUrl);
            }

            isInitialized.value = true;
            console.log(`[ThreeSetup] Initialized with ${ctx.rendererType}`);
            
            return ctx;
        } catch (error) {
            console.error('[ThreeSetup] Initialization failed:', error);
            throw error;
        }
    }

    /**
     * Start the render loop
     */
    function startRenderLoop(callback) {
        if (!renderer.value) {
            console.error('[ThreeSetup] Cannot start render loop - not initialized');
            return;
        }

        renderCallback = callback;
        
        function animate() {
            const elapsedTime = performance.now() / 1000; // or use a clock
            
            animationId = requestAnimationFrame(animate);
            
            // Advance KTX2 layer cycling and tile flow (for texture animation)
            if (tileManager.value?.tick) {
                tileManager.value.tick(performance.now());
            }
            
            // Update ribbon materials for tile flow effect (conveyor belt animation)
            if (ribbonSeries.value?.updateFlowMaterials) {
                ribbonSeries.value.updateFlowMaterials();
            }
            
            // Update ribbon with current time for wave animation
            if (ribbonSeries.value) {
                ribbonSeries.value.update(elapsedTime);
            }
            
            // Call custom render callback if provided
            if (renderCallback) {
                renderCallback();
            }
            
            // Update controls
            if (controls.value) {
                controls.value.update();
            }
            
            // Render scene
            if (renderer.value && scene.value && camera.value) {
                renderer.value.render(scene.value, camera.value);
            }
        }
        
        animate();
    }

    /**
     * Stop the render loop
     */
    function stopRenderLoop() {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        renderCallback = null;
    }

    /**
     * Export the current scene as a PNG image
     * @param {string} filename - Optional filename (default: 'rivvon-export.png')
     */
    function exportImage(filename = 'rivvon-export.png') {
        if (!renderer.value || !scene.value || !camera.value) {
            console.error('[ThreeSetup] Cannot export image - not initialized');
            return;
        }

        try {
            // Force a render to ensure the latest frame is captured
            renderer.value.render(scene.value, camera.value);

            // Get the canvas data URL
            const canvas = renderer.value.domElement;
            const dataURL = canvas.toDataURL('image/png');

            // Create a download link and trigger download
            const link = document.createElement('a');
            link.download = filename;
            link.href = dataURL;
            link.click();

            console.log('[ThreeSetup] Image exported:', filename);
        } catch (error) {
            console.error('[ThreeSetup] Failed to export image:', error);
        }
    }

    /**
     * Export the current scene as a video clip using MediaRecorder
     * @param {Object} options - Export options
     * @param {number} options.duration - Duration in seconds (default: 5)
     * @param {number} options.fps - Frames per second (default: 30)
     * @param {string} options.filename - Output filename (default: 'rivvon-export.webm')
     * @param {Function} options.onProgress - Progress callback receiving value 0-1
     * @param {Function} options.onStart - Called when recording starts
     * @param {Function} options.onComplete - Called when recording completes with blob
     * @returns {Promise<Blob>} The recorded video blob
     */
    async function exportVideo(options = {}) {
        const {
            duration = 5,
            fps = 30,
            filename = 'rivvon-export.webm',
            onProgress = null,
            onStart = null,
            onComplete = null
        } = options;

        if (!renderer.value || !scene.value || !camera.value) {
            console.error('[ThreeSetup] Cannot export video - not initialized');
            return null;
        }

        const canvas = renderer.value.domElement;
        const stream = canvas.captureStream(fps);

        // Check for codec support - prefer VP9 for better quality
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
            ? 'video/webm;codecs=vp9'
            : 'video/webm';

        const recorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: 8000000 // 8 Mbps for good quality
        });

        const chunks = [];

        console.log(`[ThreeSetup] Starting video export: ${duration}s at ${fps}fps, codec: ${mimeType}`);

        return new Promise((resolve, reject) => {
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunks.push(e.data);
                }
            };

            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: mimeType });
                const url = URL.createObjectURL(blob);

                // Trigger download
                const link = document.createElement('a');
                link.download = filename;
                link.href = url;
                link.click();

                // Clean up
                setTimeout(() => URL.revokeObjectURL(url), 1000);

                console.log('[ThreeSetup] Video exported:', filename, `(${(blob.size / 1024 / 1024).toFixed(2)} MB)`);

                if (onComplete) onComplete(blob);
                resolve(blob);
            };

            recorder.onerror = (event) => {
                console.error('[ThreeSetup] Video export failed:', event.error);
                reject(event.error);
            };

            // Start recording
            recorder.start(100); // Collect data every 100ms for smoother progress
            if (onStart) onStart();

            // Progress tracking
            const startTime = performance.now();
            const durationMs = duration * 1000;

            const progressInterval = setInterval(() => {
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / durationMs, 1);
                if (onProgress) onProgress(progress);
            }, 100);

            // Stop after duration
            setTimeout(() => {
                clearInterval(progressInterval);
                if (recorder.state === 'recording') {
                    recorder.stop();
                }
                if (onProgress) onProgress(1);
            }, durationMs);
        });
    }

    /**
     * Create a ribbon from points
     * Note: Uses RibbonSeries internally for consistent animation behavior
     */
    async function createRibbon(points, options = {}) {
        if (!scene.value || !tileManager.value) {
            console.error('[ThreeSetup] Cannot create ribbon - not initialized');
            return null;
        }

        // Remove existing ribbon if any
        if (ribbon.value) {
            ribbon.value.dispose();
            ribbon.value = null;
        }
        
        // Remove existing series if any
        if (ribbonSeries.value) {
            ribbonSeries.value.cleanup();
        }

        // Use RibbonSeries even for single path to ensure consistent animation
        // (wave undulation and texture flow work the same way)
        ribbonSeries.value = new RibbonSeries(scene.value);
        ribbonSeries.value.setTileManager(tileManager.value);
        
        // Build from single path (wrapped in array)
        ribbonSeries.value.buildFromMultiplePaths([points], options.width || 1.2);
        ribbonSeries.value.initFlowMaterials();

        console.log('[ThreeSetup] Created ribbon (via series) with 1 path');

        return ribbonSeries.value;
    }

    /**
     * Create ribbon series from multiple paths
     */
    async function createRibbonSeries(pointsArray, options = {}) {
        if (!scene.value || !tileManager.value) {
            console.error('[ThreeSetup] Cannot create ribbon series - not initialized');
            return null;
        }

        // Remove existing ribbon if any
        if (ribbon.value) {
            ribbon.value.dispose();
            ribbon.value = null;
        }
        
        // Remove existing series if any
        if (ribbonSeries.value) {
            ribbonSeries.value.cleanup();
        }

        // Create new ribbon series - constructor only takes scene
        ribbonSeries.value = new RibbonSeries(scene.value);
        ribbonSeries.value.setTileManager(tileManager.value);
        
        // Build from multiple paths
        ribbonSeries.value.buildFromMultiplePaths(pointsArray, options.width || 1.2);
        ribbonSeries.value.initFlowMaterials();

        console.log('[ThreeSetup] Created ribbon series with', pointsArray.length, 'paths');

        return ribbonSeries.value;
    }

    /**
     * Create ribbon from raw drawing points (2D screen coordinates)
     * This handles the conversion from {x,y} to THREE.Vector3 internally
     * Note: Uses RibbonSeries internally for consistent animation behavior
     */
    async function createRibbonFromDrawing(drawPoints, options = {}) {
        if (!scene.value || !tileManager.value) {
            console.error('[ThreeSetup] Cannot create ribbon - not initialized');
            return null;
        }

        if (!drawPoints || drawPoints.length < 2) {
            console.warn('[ThreeSetup] Not enough points for ribbon');
            return null;
        }

        // Remove existing ribbon if any
        if (ribbon.value) {
            ribbon.value.dispose();
            ribbon.value = null;
        }
        
        // Remove existing series if any
        if (ribbonSeries.value) {
            ribbonSeries.value.cleanup();
        }

        // Create a temporary Ribbon to process the drawing points
        // (normalization, smoothing, etc.)
        const tempRibbon = new Ribbon(scene.value);
        
        // Get the processed points without actually building the ribbon
        const normalizedPoints = tempRibbon.normalizeDrawingPoints(drawPoints);
        const points3D = normalizedPoints.map(p => new THREE.Vector3(p.x, p.y, 0));
        const sanitizedPoints = tempRibbon.sanitizePoints(points3D);
        const smoothedPoints = tempRibbon.smoothPoints(sanitizedPoints, 150);

        // Use RibbonSeries for consistent animation behavior
        ribbonSeries.value = new RibbonSeries(scene.value);
        ribbonSeries.value.setTileManager(tileManager.value);
        
        // Build from processed points
        ribbonSeries.value.buildFromMultiplePaths([smoothedPoints], options.width || 1.2);
        ribbonSeries.value.initFlowMaterials();

        console.log('[ThreeSetup] Created ribbon from drawing (via series) with', drawPoints.length, 'input points');

        return ribbonSeries.value;
    }

    /**
     * Load new texture set
     */
    async function loadTextures(source) {
        if (!renderer.value) {
            console.error('[ThreeSetup] Cannot load textures - not initialized');
            return;
        }

        // Create new TileManager with the specified source
        const oldTileManager = tileManager.value;
        
        tileManager.value = new TileManager({
            source,
            renderer: renderer.value,
            rendererType: app.rendererType,
            rotate90: true,
            webgpuMaterialMode: 'node'
        });
        await tileManager.value.loadAllTiles();
        
        // Update thumbnail
        const thumbnailUrl = tileManager.value.getThumbnailUrl();
        if (thumbnailUrl) {
            app.setThumbnailUrl(thumbnailUrl);
        }

        // Rebuild ribbons with new textures
        rebuildRibbonsWithNewTextures();
    }

    /**
     * Load textures from remote API (texture browser)
     * @param {Object} textureSet - Texture set data from API
     * @param {Function} onProgress - Progress callback (stage, current, total)
     */
    async function loadTexturesFromRemote(textureSet, onProgress = null) {
        if (!tileManager.value) {
            console.error('[ThreeSetup] Cannot load remote textures - not initialized');
            return false;
        }

        try {
            const success = await tileManager.value.loadFromRemote(textureSet, onProgress);

            if (success) {
                console.log(`[ThreeSetup] Remote texture loaded: ${tileManager.value.getTileCount()} tiles`);
                
                // Rebuild ribbons with new textures
                rebuildRibbonsWithNewTextures();
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
        if (!tileManager.value) {
            console.error('[ThreeSetup] Cannot load local textures - not initialized');
            return false;
        }

        try {
            const success = await tileManager.value.loadFromLocal(textureSet, getTiles, onProgress);

            if (success) {
                console.log(`[ThreeSetup] Local texture loaded: ${tileManager.value.getTileCount()} tiles`);
                
                // Update thumbnail from local texture set
                const thumbnailUrl = tileManager.value.getThumbnailUrl();
                if (thumbnailUrl) {
                    app.setThumbnailUrl(thumbnailUrl);
                }
                
                // Rebuild ribbons with new textures
                rebuildRibbonsWithNewTextures();
            }

            return success;
        } catch (error) {
            console.error('[ThreeSetup] Failed to load local textures:', error);
            throw error;
        }
    }

    /**
     * Rebuild existing ribbons with new textures
     */
    function rebuildRibbonsWithNewTextures() {
        console.log('[ThreeSetup] Rebuilding ribbons with new textures');

        // Update ribbon/series with new tileManager
        if (ribbon.value) {
            ribbon.value.setTileManager(tileManager.value);
            // Rebuild ribbon with new textures
            if (ribbon.value.lastPoints && ribbon.value.lastPoints.length >= 2) {
                ribbon.value.buildFromPoints(ribbon.value.lastPoints, ribbon.value.lastWidth || 1.2);
                console.log(`[ThreeSetup] Rebuilt single ribbon: ${ribbon.value.meshSegments?.length || 0} segments`);
            }
        }
        if (ribbonSeries.value) {
            ribbonSeries.value.setTileManager(tileManager.value);
            // Rebuild ribbon series with new textures
            if (ribbonSeries.value.lastPathsPoints && ribbonSeries.value.lastPathsPoints.length > 0) {
                ribbonSeries.value.buildFromMultiplePaths(
                    ribbonSeries.value.lastPathsPoints, 
                    ribbonSeries.value.lastWidth || 1.2
                );
                ribbonSeries.value.initFlowMaterials();
                console.log(`[ThreeSetup] Rebuilt ribbon series: ${ribbonSeries.value.getTotalSegmentCount()} segments`);
            }
        }
    }

    /**
     * Set flow animation state
     * @param {string} state - 'off' | 'forward' | 'backward'
     */
    function setFlowState(state) {
        if (tileManager.value) {
            const baseSpeed = app.flowSpeed || 0.25;
            if (state === 'off') {
                tileManager.value.setFlowEnabled(false);
            } else {
                // Set speed based on direction
                const speed = state === 'forward' ? baseSpeed : -baseSpeed;
                tileManager.value.setFlowSpeed(speed);
                tileManager.value.setFlowEnabled(true);
            }
        }
        app.setFlowState(state);
    }

    /**
     * Clean up on unmount
     */
    onUnmounted(() => {
        stopRenderLoop();
        
        if (backgroundTexture.value) {
            backgroundTexture.value.dispose();
            backgroundTexture.value = null;
            if (scene.value) {
                scene.value.background = null;
            }
        }
        if (ribbon.value) {
            ribbon.value.dispose();
            ribbon.value = null;
        }
        if (ribbonSeries.value) {
            ribbonSeries.value.dispose();
            ribbonSeries.value = null;
        }
        if (tileManager.value) {
            tileManager.value.dispose?.();
            tileManager.value = null;
        }
        if (controls.value) {
            controls.value.dispose?.();
            controls.value = null;
        }
        if (renderer.value) {
            // Remove canvas from DOM
            if (renderer.value.domElement && renderer.value.domElement.parentNode) {
                renderer.value.domElement.parentNode.removeChild(renderer.value.domElement);
            }
            renderer.value.dispose?.();
            renderer.value = null;
        }
        if (scene.value) {
            // Dispose all objects in scene
            scene.value.traverse((object) => {
                if (object.geometry) {
                    object.geometry.dispose();
                }
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(m => m.dispose?.());
                    } else {
                        object.material.dispose?.();
                    }
                }
            });
            scene.value = null;
        }
        camera.value = null;
        isInitialized.value = false;
        
        // Clear the context from app store
        app.setThreeContext(null);
        
        console.log('[ThreeSetup] Cleanup complete');
    });

    return {
        // State
        scene,
        camera,
        renderer,
        controls,
        tileManager,
        ribbon,
        ribbonSeries,
        isInitialized,
        resetCamera,
        
        // Methods
        initThree,
        startRenderLoop,
        stopRenderLoop,
        createRibbon,
        createRibbonSeries,
        createRibbonFromDrawing,
        loadTextures,
        loadTexturesFromRemote,
        loadTexturesFromLocal,
        setFlowState,
        exportImage,
        exportVideo,
        setBackgroundFromUrl
    };

    /**
     * Set scene background from an image URL with pre-applied blur
     * This renders the background as part of the Three.js scene so it appears in exports
     * Uses GPU shader blur for both WebGL (GLSL) and WebGPU (TSL/NodeMaterial)
     * @param {string|null} imageUrl - URL of the image, or null to clear
     * @param {Object} options - Blur options
     * @param {number} options.blurRadius - Blur radius in pixels (default: 15)
     * @param {number} options.saturation - Saturation multiplier (default: 1.2)
     * @param {number} options.opacity - Background opacity 0-1 (default: 0.7)
     */
    async function setBackgroundFromUrl(imageUrl, options = {}) {
        const {
            blurRadius = 15,
            saturation = 1.2,
            opacity = 0.7
        } = options;

        // Dispose previous background texture
        if (backgroundTexture.value) {
            backgroundTexture.value.dispose();
            backgroundTexture.value = null;
        }

        if (!imageUrl) {
            if (scene.value) {
                scene.value.background = null;
            }
            return;
        }

        if (!scene.value || !renderer.value) {
            console.warn('[ThreeSetup] Cannot set background - scene/renderer not initialized');
            return;
        }

        const isWebGPU = app.rendererType === 'webgpu';

        try {
            if (isWebGPU) {
                await setBackgroundWithNodeShaderBlur(imageUrl, blurRadius, saturation, opacity);
            } else {
                await setBackgroundWithShaderBlur(imageUrl, blurRadius, saturation, opacity);
            }
        } catch (error) {
            // CORS errors are common with CDN-served images, especially on iOS Safari
            // Log but don't crash - the app works fine without the blurred background
            const isCorsError = error.message?.includes('Failed to load') || 
                               error.message?.includes('CORS') ||
                               error.message?.includes('access control');
            
            if (isCorsError) {
                console.warn('[ThreeSetup] Background image blocked by CORS - skipping blur effect. This is usually a CDN caching issue.');
            } else {
                console.error('[ThreeSetup] Failed to set background:', error);
            }
            // Continue without background - don't throw
        }
    }

    /**
     * GPU shader blur for WebGPU using TSL (Three Shading Language) NodeMaterial
     * Uses Kawase blur for efficient high-quality results
     */
    async function setBackgroundWithNodeShaderBlur(imageUrl, blurRadius, saturation, opacity) {
        // Dynamic import of TSL nodes for WebGPU
        const {
            texture: textureNode,
            uv,
            uniform,
            vec2,
            vec3,
            vec4,
            float,
            dot,
            mix,
            add,
            div,
            mul
        } = await import('three/tsl');
        const { MeshBasicNodeMaterial } = await import('three/webgpu');

        // Load the image as a Three.js texture
        const loader = new THREE.TextureLoader();
        loader.crossOrigin = 'anonymous'; // Required for CORS when loading from CDN
        const sourceTexture = await new Promise((resolve, reject) => {
            loader.load(
                imageUrl,
                resolve,
                undefined,
                () => reject(new Error('Failed to load background image'))
            );
        });
        sourceTexture.colorSpace = THREE.SRGBColorSpace;

        // Use low resolution for blur (512px max)
        const maxSize = 512;
        const aspect = sourceTexture.image.width / sourceTexture.image.height;
        const width = aspect > 1 ? maxSize : Math.round(maxSize * aspect);
        const height = aspect > 1 ? Math.round(maxSize / aspect) : maxSize;

        // Create render targets for ping-pong blur
        const rtOptions = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            colorSpace: THREE.SRGBColorSpace
        };
        let rtA = new THREE.RenderTarget(width, height, rtOptions);
        let rtB = new THREE.RenderTarget(width, height, rtOptions);

        // Create Kawase blur node material factory
        // We need to create a new material for each texture since TSL texture() requires a concrete texture
        const createBlurMaterial = (inputTexture, offsetVal, saturationVal, opacityVal) => {
            const material = new MeshBasicNodeMaterial();
            
            // Get UV coordinates
            const uvCoord = uv();
            
            // Create uniforms for non-texture values
            const uOffset = uniform(float(offsetVal));
            const uResolution = uniform(vec2(width, height));
            const uSaturation = uniform(float(saturationVal));
            const uOpacity = uniform(float(opacityVal));
            
            // Calculate texel size based on offset and resolution
            const texelSize = div(uOffset, uResolution);
            
            // Kawase blur - sample at 4 corners using the actual texture
            const sample1 = textureNode(inputTexture, add(uvCoord, vec2(mul(texelSize.x, float(-1)), mul(texelSize.y, float(-1)))));
            const sample2 = textureNode(inputTexture, add(uvCoord, vec2(texelSize.x, mul(texelSize.y, float(-1)))));
            const sample3 = textureNode(inputTexture, add(uvCoord, vec2(mul(texelSize.x, float(-1)), texelSize.y)));
            const sample4 = textureNode(inputTexture, add(uvCoord, vec2(texelSize.x, texelSize.y)));
            
            // Average the samples
            const blurredColor = div(add(add(add(sample1, sample2), sample3), sample4), float(4.0));
            
            // Apply saturation adjustment
            const gray = dot(blurredColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            const saturatedColor = mix(vec3(gray, gray, gray), blurredColor.rgb, uSaturation);
            
            // Apply opacity
            const finalColor = vec4(saturatedColor, mul(blurredColor.a, uOpacity));
            
            material.colorNode = finalColor;
            
            return material;
        };

        // Create scene and camera for blur passes
        const blurScene = new THREE.Scene();
        const blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const blurGeometry = new THREE.PlaneGeometry(2, 2);

        // Calculate number of blur passes
        const passes = Math.max(1, Math.round(blurRadius / 3));

        console.log(`[ThreeSetup] Applying GPU blur (WebGPU TSL): ${passes} passes at ${width}x${height}`);

        // First pass: render source texture to rtA
        let blurMaterial = createBlurMaterial(sourceTexture, 1.0, 1.0, 1.0);
        let blurQuad = new THREE.Mesh(blurGeometry, blurMaterial);
        blurScene.add(blurQuad);

        renderer.value.setRenderTarget(rtA);
        renderer.value.render(blurScene, blurCamera);

        // Clean up first pass material
        blurScene.remove(blurQuad);
        blurMaterial.dispose();

        // Ping-pong blur passes
        for (let i = 0; i < passes; i++) {
            const isLastPass = i === passes - 1;

            // Swap render targets
            const temp = rtA;
            rtA = rtB;
            rtB = temp;

            // Create new material with the previous pass's texture
            const offsetVal = i + 0.5;
            const satVal = isLastPass ? saturation : 1.0;
            const opacVal = isLastPass ? opacity : 1.0;
            
            blurMaterial = createBlurMaterial(rtB.texture, offsetVal, satVal, opacVal);
            blurQuad = new THREE.Mesh(blurGeometry, blurMaterial);
            blurScene.add(blurQuad);

            renderer.value.setRenderTarget(rtA);
            renderer.value.render(blurScene, blurCamera);

            // Clean up pass material
            blurScene.remove(blurQuad);
            blurMaterial.dispose();
        }

        renderer.value.setRenderTarget(null);

        // Use the render target texture directly as background
        backgroundTexture.value = rtA.texture;
        scene.value.background = rtA.texture;

        // Cleanup
        sourceTexture.dispose();
        rtB.dispose();
        blurGeometry.dispose();

        console.log('[ThreeSetup] Background set with GPU shader blur (WebGPU TSL mode)');
    }

    /**
     * GPU shader blur for WebGL using GLSL ShaderMaterial
     * Uses Kawase blur for efficient high-quality results
     */
    async function setBackgroundWithShaderBlur(imageUrl, blurRadius, saturation, opacity) {
        // Load the image as a Three.js texture
        const loader = new THREE.TextureLoader();
        loader.crossOrigin = 'anonymous'; // Required for CORS when loading from CDN
        const sourceTexture = await new Promise((resolve, reject) => {
            loader.load(
                imageUrl,
                resolve,
                undefined,
                () => reject(new Error('Failed to load background image'))
            );
        });
        sourceTexture.colorSpace = THREE.SRGBColorSpace;

        // Create blur shader material (Kawase blur)
        const blurShader = {
            uniforms: {
                tDiffuse: { value: null },
                uResolution: { value: new THREE.Vector2() },
                uOffset: { value: 1.0 },
                uSaturation: { value: saturation },
                uOpacity: { value: opacity }
            },
            vertexShader: `
                precision highp float;
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                uniform sampler2D tDiffuse;
                uniform vec2 uResolution;
                uniform float uOffset;
                uniform float uSaturation;
                uniform float uOpacity;
                varying vec2 vUv;
                
                vec3 adjustSaturation(vec3 color, float saturation) {
                    float gray = dot(color, vec3(0.2126, 0.7152, 0.0722));
                    return mix(vec3(gray), color, saturation);
                }
                
                void main() {
                    vec2 texelSize = uOffset / uResolution;
                    
                    vec4 color = vec4(0.0);
                    color += texture2D(tDiffuse, vUv + vec2(-texelSize.x, -texelSize.y));
                    color += texture2D(tDiffuse, vUv + vec2( texelSize.x, -texelSize.y));
                    color += texture2D(tDiffuse, vUv + vec2(-texelSize.x,  texelSize.y));
                    color += texture2D(tDiffuse, vUv + vec2( texelSize.x,  texelSize.y));
                    color /= 4.0;
                    
                    color.rgb = adjustSaturation(color.rgb, uSaturation);
                    color.a *= uOpacity;
                    
                    gl_FragColor = color;
                }
            `
        };

        // Use low resolution for blur (512px max)
        const maxSize = 512;
        const aspect = sourceTexture.image.width / sourceTexture.image.height;
        const width = aspect > 1 ? maxSize : Math.round(maxSize * aspect);
        const height = aspect > 1 ? Math.round(maxSize / aspect) : maxSize;

        // Create render targets for ping-pong blur
        const rtOptions = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            colorSpace: THREE.SRGBColorSpace
        };
        let rtA = new THREE.WebGLRenderTarget(width, height, rtOptions);
        let rtB = new THREE.WebGLRenderTarget(width, height, rtOptions);

        // Create scene and camera for blur passes
        const blurScene = new THREE.Scene();
        const blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const blurMaterial = new THREE.ShaderMaterial(blurShader);
        const blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMaterial);
        blurScene.add(blurQuad);

        blurMaterial.uniforms.uResolution.value.set(width, height);

        // Calculate number of blur passes
        const passes = Math.max(1, Math.round(blurRadius / 3));

        console.log(`[ThreeSetup] Applying GPU blur (WebGL GLSL): ${passes} passes at ${width}x${height}`);

        // First pass: render source texture
        blurMaterial.uniforms.tDiffuse.value = sourceTexture;
        blurMaterial.uniforms.uOffset.value = 1.0;
        blurMaterial.uniforms.uSaturation.value = 1.0;
        blurMaterial.uniforms.uOpacity.value = 1.0;

        renderer.value.setRenderTarget(rtA);
        renderer.value.render(blurScene, blurCamera);

        // Ping-pong blur passes
        for (let i = 0; i < passes; i++) {
            const isLastPass = i === passes - 1;

            const temp = rtA;
            rtA = rtB;
            rtB = temp;

            blurMaterial.uniforms.tDiffuse.value = rtB.texture;
            blurMaterial.uniforms.uOffset.value = i + 0.5;

            if (isLastPass) {
                blurMaterial.uniforms.uSaturation.value = saturation;
                blurMaterial.uniforms.uOpacity.value = opacity;
            }

            renderer.value.setRenderTarget(rtA);
            renderer.value.render(blurScene, blurCamera);
        }

        renderer.value.setRenderTarget(null);

        // Copy result to texture
        const resultTexture = rtA.texture.clone();
        resultTexture.needsUpdate = true;
        backgroundTexture.value = resultTexture;

        scene.value.background = resultTexture;

        // Cleanup
        sourceTexture.dispose();
        rtA.dispose();
        rtB.dispose();
        blurMaterial.dispose();
        blurQuad.geometry.dispose();

        console.log('[ThreeSetup] Background set with GPU shader blur (WebGL GLSL mode)');
    }
}
