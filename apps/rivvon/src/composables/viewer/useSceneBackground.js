// src/composables/viewer/useSceneBackground.js
// Scene background management: GPU-accelerated Kawase blur from URLs and tile textures

import * as THREE from 'three';

/**
 * Manages the Three.js scene background with GPU-accelerated blur effects.
 * Supports both WebGL (GLSL ShaderMaterial) and WebGPU (TSL NodeMaterial).
 *
 * @param {Object} ctx - Shared context refs from useThreeSetup
 */
export function useSceneBackground(ctx) {

    /**
     * Dispose the current background texture and clear the scene background
     */
    function disposeBackground() {
        if (ctx.backgroundTexture.value) {
            ctx.backgroundTexture.value.dispose();
            ctx.backgroundTexture.value = null;
            if (ctx.scene.value) ctx.scene.value.background = null;
        }
    }

    // ── Public API ─────────────────────────────────────────────────────

    /**
     * Set scene background from the first tile of the current tileManager
     * This avoids CORS issues since the KTX2 textures are already loaded via fetch()
     * Uses the first layer of the first tile as the background source
     * @param {Object} options - Blur options
     * @param {number} options.blurRadius - Blur radius in pixels (default: 15)
     * @param {number} options.saturation - Saturation multiplier (default: 1.2)
     * @param {number} options.opacity - Background opacity 0-1 (default: 0.7)
     */
    async function setBackgroundFromTileManager(options = {}) {
        const {
            blurRadius = 40,
            saturation = 1,
            opacity = 0.7
        } = options;

        disposeBackground();

        if (!ctx.scene.value || !ctx.renderer.value || !ctx.tileManager.value) {
            console.warn('[ThreeSetup] Cannot set background - not initialized');
            return;
        }

        // Get the first array texture from the tile manager
        const arrayTexture = ctx.tileManager.value.getArrayTexture(0);
        if (!arrayTexture) {
            console.warn('[ThreeSetup] No array texture available for background');
            return;
        }

        const isWebGPU = ctx.app.rendererType === 'webgpu';

        try {
            if (isWebGPU) {
                await _setBackgroundFromArrayTextureWebGPU(arrayTexture, blurRadius, saturation, opacity);
            } else {
                await _setBackgroundFromArrayTextureWebGL(arrayTexture, blurRadius, saturation, opacity);
            }
        } catch (error) {
            console.error('[ThreeSetup] Failed to set background from tile:', error);
        }
    }

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

        disposeBackground();

        if (!imageUrl) {
            if (ctx.scene.value) {
                ctx.scene.value.background = null;
            }
            return;
        }

        if (!ctx.scene.value || !ctx.renderer.value) {
            console.warn('[ThreeSetup] Cannot set background - scene/renderer not initialized');
            return;
        }

        const isWebGPU = ctx.app.rendererType === 'webgpu';

        try {
            if (isWebGPU) {
                await _setBackgroundWithNodeShaderBlur(imageUrl, blurRadius, saturation, opacity);
            } else {
                await _setBackgroundWithShaderBlur(imageUrl, blurRadius, saturation, opacity);
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

    // ── Private: WebGPU blur implementations ───────────────────────────

    /**
     * GPU shader blur for WebGPU using TSL (Three Shading Language) NodeMaterial
     * Uses Kawase blur for efficient high-quality results
     */
    async function _setBackgroundWithNodeShaderBlur(imageUrl, blurRadius, saturation, opacity) {
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

        ctx.renderer.value.setRenderTarget(rtA);
        ctx.renderer.value.render(blurScene, blurCamera);

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

            ctx.renderer.value.setRenderTarget(rtA);
            ctx.renderer.value.render(blurScene, blurCamera);

            // Clean up pass material
            blurScene.remove(blurQuad);
            blurMaterial.dispose();
        }

        ctx.renderer.value.setRenderTarget(null);

        // Use the render target texture directly as background
        ctx.backgroundTexture.value = rtA.texture;
        ctx.scene.value.background = rtA.texture;

        // Cleanup
        sourceTexture.dispose();
        rtB.dispose();
        blurGeometry.dispose();

        console.log('[ThreeSetup] Background set with GPU shader blur (WebGPU TSL mode)');
    }

    /**
     * Set background from DataArrayTexture using WebGPU TSL
     * Samples the first layer and applies Kawase blur
     */
    async function _setBackgroundFromArrayTextureWebGPU(arrayTexture, blurRadius, saturation, opacity) {
        const {
            texture: textureNode,
            uv,
            uniform,
            vec2,
            vec3,
            vec4,
            float,
            int,
            dot,
            mix,
            add,
            div,
            mul
        } = await import('three/tsl');
        const { MeshBasicNodeMaterial } = await import('three/webgpu');

        const maxSize = 512;
        const width = Math.min(arrayTexture.image.width, maxSize);
        const height = Math.min(arrayTexture.image.height, maxSize);

        const rtOptions = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            colorSpace: THREE.SRGBColorSpace
        };
        const sampleRT = new THREE.RenderTarget(width, height, rtOptions);
        let rtA = new THREE.RenderTarget(width, height, rtOptions);
        let rtB = new THREE.RenderTarget(width, height, rtOptions);

        // Use the existing tileManager material to sample layer 0
        // This correctly handles array texture sampling for WebGPU
        const existingMaterial = ctx.tileManager.value.getMaterial(0);
        if (!existingMaterial) {
            console.warn('[ThreeSetup] No material available from tileManager');
            return;
        }

        // Clone the material and set layer to 0
        const sampleMaterial = existingMaterial.clone();
        if (sampleMaterial.uniforms?.uLayer) {
            sampleMaterial.uniforms.uLayer.value = 0;
        }

        const sampleScene = new THREE.Scene();
        const sampleCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const sampleGeometry = new THREE.PlaneGeometry(2, 2);
        const sampleQuad = new THREE.Mesh(sampleGeometry, sampleMaterial);
        sampleScene.add(sampleQuad);

        ctx.renderer.value.setRenderTarget(sampleRT);
        ctx.renderer.value.render(sampleScene, sampleCamera);

        sampleScene.remove(sampleQuad);
        sampleMaterial.dispose();

        // Now blur the sampled 2D texture
        const createBlurMaterial = (inputTexture, offsetVal, saturationVal, opacityVal) => {
            const material = new MeshBasicNodeMaterial();
            const uvCoord = uv();
            const uOffset = uniform(float(offsetVal));
            const uResolution = uniform(vec2(width, height));
            const uSaturation = uniform(float(saturationVal));
            const uOpacity = uniform(float(opacityVal));

            const texelSize = div(uOffset, uResolution);

            const sample1 = textureNode(inputTexture, add(uvCoord, vec2(mul(texelSize.x, float(-1)), mul(texelSize.y, float(-1)))));
            const sample2 = textureNode(inputTexture, add(uvCoord, vec2(texelSize.x, mul(texelSize.y, float(-1)))));
            const sample3 = textureNode(inputTexture, add(uvCoord, vec2(mul(texelSize.x, float(-1)), texelSize.y)));
            const sample4 = textureNode(inputTexture, add(uvCoord, vec2(texelSize.x, texelSize.y)));

            const blurredColor = div(add(add(add(sample1, sample2), sample3), sample4), float(4.0));
            const gray = dot(blurredColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            const saturatedColor = mix(vec3(gray, gray, gray), blurredColor.rgb, uSaturation);
            const finalColor = vec4(saturatedColor, mul(blurredColor.a, uOpacity));

            material.colorNode = finalColor;
            return material;
        };

        const blurScene = new THREE.Scene();
        const blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const blurGeometry = new THREE.PlaneGeometry(2, 2);

        const passes = Math.max(1, Math.round(blurRadius / 3));
        console.log(`[ThreeSetup] Applying GPU blur from tile (WebGPU TSL): ${passes} passes at ${width}x${height}`);

        // First blur pass
        let blurMaterial = createBlurMaterial(sampleRT.texture, 1.0, 1.0, 1.0);
        let blurQuad = new THREE.Mesh(blurGeometry, blurMaterial);
        blurScene.add(blurQuad);

        ctx.renderer.value.setRenderTarget(rtA);
        ctx.renderer.value.render(blurScene, blurCamera);
        blurScene.remove(blurQuad);
        blurMaterial.dispose();

        // Ping-pong blur passes
        for (let i = 0; i < passes; i++) {
            const isLastPass = i === passes - 1;
            const temp = rtA;
            rtA = rtB;
            rtB = temp;

            const offsetVal = i + 0.5;
            const satVal = isLastPass ? saturation : 1.0;
            const opacVal = isLastPass ? opacity : 1.0;

            blurMaterial = createBlurMaterial(rtB.texture, offsetVal, satVal, opacVal);
            blurQuad = new THREE.Mesh(blurGeometry, blurMaterial);
            blurScene.add(blurQuad);

            ctx.renderer.value.setRenderTarget(rtA);
            ctx.renderer.value.render(blurScene, blurCamera);
            blurScene.remove(blurQuad);
            blurMaterial.dispose();
        }

        ctx.renderer.value.setRenderTarget(null);

        ctx.backgroundTexture.value = rtA.texture;
        ctx.scene.value.background = rtA.texture;

        // Cleanup
        sampleRT.dispose();
        rtB.dispose();
        sampleGeometry.dispose();
        blurGeometry.dispose();

        console.log('[ThreeSetup] Background set from tile texture (WebGPU TSL mode)');
    }

    // ── Private: WebGL blur implementations ────────────────────────────

    /**
     * GPU shader blur for WebGL using GLSL ShaderMaterial
     * Uses Kawase blur for efficient high-quality results
     */
    async function _setBackgroundWithShaderBlur(imageUrl, blurRadius, saturation, opacity) {
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

        ctx.renderer.value.setRenderTarget(rtA);
        ctx.renderer.value.render(blurScene, blurCamera);

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

            ctx.renderer.value.setRenderTarget(rtA);
            ctx.renderer.value.render(blurScene, blurCamera);
        }

        ctx.renderer.value.setRenderTarget(null);

        // Copy result to texture
        const resultTexture = rtA.texture.clone();
        resultTexture.needsUpdate = true;
        ctx.backgroundTexture.value = resultTexture;

        ctx.scene.value.background = resultTexture;

        // Cleanup
        sourceTexture.dispose();
        rtA.dispose();
        rtB.dispose();
        blurMaterial.dispose();
        blurQuad.geometry.dispose();

        console.log('[ThreeSetup] Background set with GPU shader blur (WebGL GLSL mode)');
    }

    /**
     * Set background from DataArrayTexture using WebGL
     * Samples the first layer and applies Kawase blur
     */
    async function _setBackgroundFromArrayTextureWebGL(arrayTexture, blurRadius, saturation, opacity) {
        // Create shader that samples from layer 0 of the array texture
        // Must use GLSL ES 3.0 for sampler2DArray support
        // Note: Swap and flip UV to match WebGPU/tileManager orientation (90° CCW rotation)
        const sampleShader = {
            uniforms: {
                tArray: { value: arrayTexture },
                uLayer: { value: 0 }
            },
            glslVersion: THREE.GLSL3,
            vertexShader: `
                precision highp float;
                out vec2 vUv;
                void main() {
                    vUv = vec2(1.0 - uv.y, uv.x);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                precision highp sampler2DArray;
                uniform sampler2DArray tArray;
                uniform int uLayer;
                in vec2 vUv;
                out vec4 fragColor;
                void main() {
                    fragColor = texture(tArray, vec3(vUv, float(uLayer)));
                }
            `
        };

        // Use the array texture dimensions (or a reasonable max)
        const maxSize = 512;
        const width = Math.min(arrayTexture.image.width, maxSize);
        const height = Math.min(arrayTexture.image.height, maxSize);

        // Create render target to sample the array texture layer
        const rtOptions = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            colorSpace: THREE.SRGBColorSpace
        };
        const sampleRT = new THREE.WebGLRenderTarget(width, height, rtOptions);
        let rtA = new THREE.WebGLRenderTarget(width, height, rtOptions);
        let rtB = new THREE.WebGLRenderTarget(width, height, rtOptions);

        // Sample the array texture to a 2D texture
        const sampleScene = new THREE.Scene();
        const sampleCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const sampleMaterial = new THREE.ShaderMaterial(sampleShader);
        const sampleQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sampleMaterial);
        sampleScene.add(sampleQuad);

        ctx.renderer.value.setRenderTarget(sampleRT);
        ctx.renderer.value.render(sampleScene, sampleCamera);

        // Now apply blur using the sampled texture
        const blurShader = {
            uniforms: {
                tDiffuse: { value: null },
                uResolution: { value: new THREE.Vector2(width, height) },
                uOffset: { value: 1.0 },
                uSaturation: { value: 1.0 },
                uOpacity: { value: 1.0 }
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

        const blurScene = new THREE.Scene();
        const blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const blurMaterial = new THREE.ShaderMaterial(blurShader);
        const blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMaterial);
        blurScene.add(blurQuad);

        const passes = Math.max(1, Math.round(blurRadius / 3));
        console.log(`[ThreeSetup] Applying GPU blur from tile (WebGL): ${passes} passes at ${width}x${height}`);

        // First blur pass from sampled texture
        blurMaterial.uniforms.tDiffuse.value = sampleRT.texture;
        blurMaterial.uniforms.uOffset.value = 1.0;
        ctx.renderer.value.setRenderTarget(rtA);
        ctx.renderer.value.render(blurScene, blurCamera);

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

            ctx.renderer.value.setRenderTarget(rtA);
            ctx.renderer.value.render(blurScene, blurCamera);
        }

        ctx.renderer.value.setRenderTarget(null);

        // Use result as background - keep rtA alive, don't dispose it!
        ctx.backgroundTexture.value = rtA.texture;
        ctx.scene.value.background = rtA.texture;

        // Cleanup - but NOT rtA since we're using its texture as background
        sampleRT.dispose();
        rtB.dispose();
        sampleMaterial.dispose();
        sampleQuad.geometry.dispose();
        blurMaterial.dispose();
        blurQuad.geometry.dispose();

        console.log('[ThreeSetup] Background set from tile texture (WebGL mode)');
    }

    return {
        disposeBackground,
        setBackgroundFromTileManager,
        setBackgroundFromUrl
    };
}
