// src/composables/viewer/useSceneBackground.js
// Scene background management via a camera-locked textured plane.

import * as THREE from "three";

const BACKGROUND_DISTANCE = 100;
const BACKGROUND_RENDER_ORDER = -10000;
const REALTIME_BLUR_MAX_SIDE = 384;
const MAX_BACKGROUND_BLUR_AMOUNT = 100;
const MAX_BACKGROUND_BLUR_RADIUS_PASSES = 64;
const MAX_REALTIME_GAUSSIAN_PASSES = 6;
const BACKGROUND_FLOW_TIME_ORIGIN =
  typeof performance !== "undefined" ? performance.now() : Date.now();

function positiveModulo(value, modulus) {
  if (!modulus) return 0;
  return ((value % modulus) + modulus) % modulus;
}

function clampLayer(layerIndex, arrayTexture) {
  const layerCount = Math.max(1, arrayTexture?.image?.depth || 1);
  const parsedLayer = Number(layerIndex);

  if (!Number.isFinite(parsedLayer)) {
    return 0;
  }

  return Math.max(0, Math.min(Math.round(parsedLayer), layerCount - 1));
}

function resolveTileSample(tileManager, effectiveIndex = 0) {
  if (!tileManager) {
    return { tileIndex: 0, mirrorX: false };
  }

  const sample = tileManager.resolveSegmentToTile?.(effectiveIndex);
  if (sample && Number.isFinite(sample.tileIndex)) {
    return {
      tileIndex: sample.tileIndex,
      mirrorX: !!sample.mirrorX,
    };
  }

  const tileCount = Math.max(
    1,
    tileManager.tileCount || tileManager.arrayTextures?.length || 1,
  );
  return {
    tileIndex: positiveModulo(effectiveIndex, tileCount),
    mirrorX: false,
  };
}

function getTextureAt(tileManager, tileIndex) {
  const textures = tileManager?.arrayTextures || [];
  const count = textures.length;

  if (count <= 0) {
    return null;
  }

  return textures[positiveModulo(tileIndex, count)] || null;
}

function getBackgroundBlurRadius() {
  return 0;
}

function getBackgroundBlurAmount(ctx) {
  const amount = Number(ctx.app.backgroundBlurAmount);
  return Number.isFinite(amount)
    ? Math.max(1, Math.min(MAX_BACKGROUND_BLUR_AMOUNT, amount))
    : 8;
}

function getBlurTargetSize(ctx, renderOptions = {}) {
  const renderer = ctx.renderer.value;
  const canvas = renderer?.domElement;
  const sourceWidth = Math.max(
    1,
    Number(renderOptions.width) || canvas?.width || canvas?.clientWidth || 1,
  );
  const sourceHeight = Math.max(
    1,
    Number(renderOptions.height) ||
      canvas?.height ||
      canvas?.clientHeight ||
      1,
  );
  const aspect = sourceWidth / sourceHeight;
  const sourceMaxSide = Math.max(sourceWidth, sourceHeight);
  const maxSide =
    renderOptions.blurMode === "export"
      ? sourceMaxSide
      : Math.max(64, Math.min(REALTIME_BLUR_MAX_SIDE, sourceMaxSide));

  if (aspect >= 1) {
    return {
      width: maxSide,
      height: Math.max(64, Math.round(maxSide / aspect)),
    };
  }

  return {
    width: Math.max(64, Math.round(maxSide * aspect)),
    height: maxSide,
  };
}

function getBlurPassCount(ctx) {
  const amount = getBackgroundBlurAmount(ctx);
  return Math.max(
    1,
    Math.min(MAX_BACKGROUND_BLUR_RADIUS_PASSES, Math.round(2 + amount * 0.6)),
  );
}

function getGaussianPassCount(ctx, renderOptions = {}) {
  const amount = getBackgroundBlurAmount(ctx);
  const exportMode = renderOptions.blurMode === "export";
  const maximumPasses = exportMode ? 4 : MAX_REALTIME_GAUSSIAN_PASSES;
  const amountPerPass = exportMode ? 12 : 18;

  return Math.max(
    1,
    Math.min(maximumPasses, Math.ceil(amount / amountPerPass)),
  );
}

function getBlurPassOffset(passIndex, passCount) {
  const progress = passCount <= 1 ? 1 : passIndex / (passCount - 1);
  return 1 + passIndex * 0.75 + progress * 2.25;
}

function getBlurPassScale(width, height, renderOptions = {}) {
  if (renderOptions.blurMode !== "export") {
    return 1;
  }

  // The existing offsets are measured in texels of the 384px realtime target.
  // Scale them with the export target so the visible blur radius stays stable
  // as the target becomes denser instead of becoming narrower at export size.
  return Math.max(width, height) / REALTIME_BLUR_MAX_SIDE;
}

function createBackgroundRenderTarget(ctx, width, height) {
  const options = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    colorSpace: ctx.renderer.value?.outputColorSpace ?? THREE.SRGBColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
  };

  const target =
    ctx.app.rendererType === "webgpu"
      ? new THREE.RenderTarget(width, height, options)
      : new THREE.WebGLRenderTarget(width, height, options);

  target.texture.colorSpace = options.colorSpace;
  target.texture.generateMipmaps = false;
  return target;
}

function getBackgroundOpacity(options = {}) {
  const parsed = Number(options.opacity);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.7;
}

function getBackgroundOverlayState(ctx) {
  const color = new THREE.Color();
  color.set(ctx.app.backgroundOverlayColor || "#ffffff");

  return {
    enabled: !!ctx.app.backgroundOverlayEnabled,
    color,
    opacity: Math.max(
      0,
      Math.min(1, Number(ctx.app.backgroundOverlayOpacity) || 0),
    ),
  };
}

function createWebGLBackgroundDisplayMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uOverlayColor: { value: new THREE.Color(0xffffff) },
      uOverlayOpacity: { value: 0 },
    },
    vertexShader: /* glsl */ `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
    fragmentShader: /* glsl */ `
            precision highp float;
            uniform sampler2D tDiffuse;
            uniform vec3 uOverlayColor;
            uniform float uOverlayOpacity;
            varying vec2 vUv;

            void main() {
                vec4 background = texture2D(tDiffuse, vUv);
                vec3 color = mix(background.rgb, uOverlayColor, uOverlayOpacity);
                gl_FragColor = vec4(color, background.a);
            }
        `,
    transparent: false,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function updateWebGLBackgroundDisplayMaterial(material, ctx, texture) {
  if (!material) {
    return;
  }

  const overlayState = getBackgroundOverlayState(ctx);
  material.uniforms.tDiffuse.value = texture;
  material.uniforms.uOverlayColor.value.copy(overlayState.color);
  material.uniforms.uOverlayOpacity.value = overlayState.enabled
    ? overlayState.opacity
    : 0;
}

function getBackgroundFlowPosition(ctx, tileManager, timeSeconds = null) {
  if (!ctx.app.backgroundFlowEnabled) {
    return {
      active: false,
      baseIndex: 0,
      offset: 0,
      direction: 1,
    };
  }

  // Background flow owns its complete motion state. Ribbon flow direction,
  // speed, enabled state, and wrapped tile offset must not influence it.
  const speed = Math.max(0, Number(ctx.app.backgroundFlowSpeed) || 0);
  const direction = 1;
  if (speed <= 0) {
    return {
      active: false,
      baseIndex: 0,
      offset: 0,
      direction,
    };
  }

  const elapsedSeconds =
    Number.isFinite(Number(timeSeconds))
      ? Math.max(0, Number(timeSeconds))
      : Math.max(
          0,
          ((typeof performance !== "undefined"
            ? performance.now()
            : Date.now()) -
            BACKGROUND_FLOW_TIME_ORIGIN) /
            1000,
        );
  const position = elapsedSeconds * speed * direction;
  const baseIndex = direction < 0 ? Math.ceil(position) : Math.floor(position);

  return {
    active: true,
    baseIndex,
    offset: position - baseIndex,
    direction,
  };
}

/**
 * Manages the Three.js scene background as geometry locked to the active camera.
 *
 * Three's native scene.background accepts textures but not materials. The
 * camera-locked plane keeps background behavior visually similar while letting
 * the texture-set shader use the same multi-tile and mirror rules as ribbons.
 *
 * @param {Object} ctx - Shared context refs from useThreeSetup
 */
export function useSceneBackground(ctx) {
  let activeRuntime = null;
  let backgroundGenerationToken = 0;

  function disposeBackground() {
    backgroundGenerationToken += 1;
    activeRuntime?.dispose?.();
    activeRuntime = null;
    ctx.backgroundTexture.value = null;

    if (ctx.scene.value) {
      ctx.scene.value.background = null;
    }
  }

  async function setBackgroundFromTileManager(options = {}) {
    const requestToken = ++backgroundGenerationToken;
    activeRuntime?.dispose?.();
    activeRuntime = null;
    ctx.backgroundTexture.value = null;

    if (ctx.scene.value) {
      ctx.scene.value.background = null;
    }

    if (
      !ctx.scene.value ||
      !ctx.camera.value ||
      !ctx.renderer.value ||
      !ctx.tileManager.value
    ) {
      console.warn("[ThreeSetup] Cannot set background - not initialized");
      return;
    }

    const firstTexture =
      ctx.tileManager.value.getArrayTexture?.(0) ||
      getTextureAt(ctx.tileManager.value, 0);
    if (!firstTexture) {
      console.warn("[ThreeSetup] No array texture available for background");
      return;
    }

    const isWebGPU = ctx.app.rendererType === "webgpu";
    let runtime = null;

    try {
      runtime = isWebGPU
        ? await createTileBackgroundRuntimeWebGPU(ctx, options)
        : createTileBackgroundRuntimeWebGL(ctx, options);

      if (requestToken !== backgroundGenerationToken) {
        runtime.dispose();
        return;
      }

      activeRuntime = runtime;
      activeRuntime.update();
    } catch (error) {
      runtime?.dispose?.();
      if (requestToken !== backgroundGenerationToken) {
        return;
      }
      console.error("[ThreeSetup] Failed to set background from tile:", error);
    }
  }

  async function setBackgroundFromUrl(imageUrl, options = {}) {
    const requestToken = ++backgroundGenerationToken;
    activeRuntime?.dispose?.();
    activeRuntime = null;
    ctx.backgroundTexture.value = null;

    if (ctx.scene.value) {
      ctx.scene.value.background = null;
    }

    if (!imageUrl) {
      return;
    }

    if (!ctx.scene.value || !ctx.camera.value || !ctx.renderer.value) {
      console.warn(
        "[ThreeSetup] Cannot set background - scene/renderer not initialized",
      );
      return;
    }

    try {
      const runtime = await createUrlBackgroundRuntime(ctx, imageUrl, options);
      if (requestToken !== backgroundGenerationToken) {
        runtime.dispose();
        return;
      }

      activeRuntime = runtime;
      activeRuntime.update();
    } catch (error) {
      console.error("[ThreeSetup] Failed to set URL background:", error);
    }
  }

  function updateBackground(renderOptions = {}) {
    activeRuntime?.update?.(renderOptions);
  }

  return {
    disposeBackground,
    setBackgroundFromTileManager,
    setBackgroundFromUrl,
    updateBackground,
  };
}

function attachCameraBackgroundPlane(ctx, material) {
  const camera = ctx.camera.value;
  const scene = ctx.scene.value;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.Mesh(geometry, material);

  mesh.name = "RivvonCameraLockedBackground";
  mesh.frustumCulled = false;
  mesh.renderOrder = BACKGROUND_RENDER_ORDER;
  mesh.position.set(0, 0, -BACKGROUND_DISTANCE);

  if (!camera.parent && scene) {
    scene.add(camera);
  }

  camera.add(mesh);

  function syncSize() {
    if (camera.isPerspectiveCamera) {
      const height =
        2 *
        Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) *
        BACKGROUND_DISTANCE;
      mesh.scale.set(height * camera.aspect, height, 1);
      return;
    }

    if (camera.isOrthographicCamera) {
      mesh.position.z = -1;
      mesh.scale.set(camera.right - camera.left, camera.top - camera.bottom, 1);
    }
  }

  function dispose() {
    camera.remove(mesh);
    geometry.dispose();
    material?.dispose?.();
  }

  syncSize();

  return {
    mesh,
    syncSize,
    dispose,
  };
}

function resolveBackgroundFrame(ctx, renderOptions = {}) {
  const tileManager = ctx.tileManager.value;
  const currentLayer = ctx.app.animatedBackgroundEnabled
    ? clampLayer(tileManager?.currentLayer, getTextureAt(tileManager, 0))
    : 0;
  const backgroundFlow = getBackgroundFlowPosition(
    ctx,
    tileManager,
    renderOptions.timeSeconds,
  );
  const baseIndex = backgroundFlow.baseIndex;
  const flowActive = backgroundFlow.active;
  const flowStep = backgroundFlow.direction < 0 ? -1 : 1;
  const currentSample = resolveTileSample(tileManager, baseIndex);
  const nextSample = resolveTileSample(tileManager, baseIndex + flowStep);
  const currentTexture = getTextureAt(tileManager, currentSample.tileIndex);
  const nextTexture =
    getTextureAt(tileManager, nextSample.tileIndex) || currentTexture;

  return {
    currentLayer,
    flowActive,
    flowOffset: flowActive ? backgroundFlow.offset : 0,
    reverseFlow: flowStep < 0,
    rotate90: tileManager?.rotate90 ? 1 : 0,
    flipVertical: ctx.app.backgroundFlipVertical ? 1 : 0,
    blurRadius: getBackgroundBlurRadius(ctx),
    currentSample,
    nextSample,
    currentTexture,
    nextTexture,
  };
}

function createTileBackgroundRuntimeWebGL(ctx, options = {}) {
  const initialFrame = resolveBackgroundFrame(ctx);
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uTexArrayCurrent: { value: initialFrame.currentTexture },
      uTexArrayNext: { value: initialFrame.nextTexture },
      uLayer: { value: initialFrame.currentLayer },
      uFlowOffset: { value: initialFrame.flowOffset },
      uFlowActive: { value: initialFrame.flowActive ? 1 : 0 },
      uReverseFlow: { value: initialFrame.reverseFlow ? 1 : 0 },
      uMirrorCurrent: { value: initialFrame.currentSample.mirrorX ? 1 : 0 },
      uMirrorNext: { value: initialFrame.nextSample.mirrorX ? 1 : 0 },
      uRotate90: { value: initialFrame.rotate90 },
      uFlipVertical: { value: initialFrame.flipVertical },
      uBlurRadius: { value: initialFrame.blurRadius },
      uOverlayColor: { value: new THREE.Color(0xffffff) },
      uOverlayOpacity: { value: 0 },
      uSeamSafeBlend: { value: ctx.app.backgroundBlurEnabled ? 1 : 0 },
      uOpacity: { value: getBackgroundOpacity(options) },
    },
    vertexShader: /* glsl */ `
            out vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
    fragmentShader: /* glsl */ `
            precision highp float;
            precision highp sampler2DArray;

            uniform sampler2DArray uTexArrayCurrent;
            uniform sampler2DArray uTexArrayNext;
            uniform int uLayer;
            uniform float uFlowOffset;
            uniform int uFlowActive;
            uniform int uReverseFlow;
            uniform int uMirrorCurrent;
            uniform int uMirrorNext;
            uniform int uRotate90;
            uniform int uFlipVertical;
            uniform float uBlurRadius;
            uniform vec3 uOverlayColor;
            uniform float uOverlayOpacity;
            uniform int uSeamSafeBlend;
            uniform float uOpacity;

            in vec2 vUv;
            out vec4 outColor;

            vec2 orientUv(vec2 inputUv, int mirrorX) {
                vec2 sampleUv = inputUv;
                if (mirrorX == 1) {
                    sampleUv.x = 1.0 - sampleUv.x;
                }
                if (uRotate90 == 1) {
                    sampleUv = vec2(sampleUv.y, 1.0 - sampleUv.x);
                }
                if (uFlipVertical == 1) {
                    sampleUv.y = 1.0 - sampleUv.y;
                }
                return vec2(sampleUv.x, 1.0 - sampleUv.y);
            }

            vec4 sampleTile(sampler2DArray texArray, vec2 sourceUv, int mirrorX) {
                vec2 uv = orientUv(sourceUv, mirrorX);
                vec4 center = texture(texArray, vec3(uv, float(uLayer)));

                if (uBlurRadius <= 0.0001) {
                    return center;
                }

                vec2 b = vec2(uBlurRadius);
                vec2 h = b * 0.5;
                vec2 w = b * 1.45;
                vec4 color = center * 0.08;

                color += texture(texArray, vec3(orientUv(sourceUv + vec2(-h.x,  0.0), mirrorX), float(uLayer))) * 0.05;
                color += texture(texArray, vec3(orientUv(sourceUv + vec2( h.x,  0.0), mirrorX), float(uLayer))) * 0.05;
                color += texture(texArray, vec3(orientUv(sourceUv + vec2( 0.0, -h.y), mirrorX), float(uLayer))) * 0.05;
                color += texture(texArray, vec3(orientUv(sourceUv + vec2( 0.0,  h.y), mirrorX), float(uLayer))) * 0.05;

                color += texture(texArray, vec3(orientUv(sourceUv + vec2(-b.x, -b.y), mirrorX), float(uLayer))) * 0.06;
                color += texture(texArray, vec3(orientUv(sourceUv + vec2( b.x, -b.y), mirrorX), float(uLayer))) * 0.06;
                color += texture(texArray, vec3(orientUv(sourceUv + vec2(-b.x,  b.y), mirrorX), float(uLayer))) * 0.06;
                color += texture(texArray, vec3(orientUv(sourceUv + vec2( b.x,  b.y), mirrorX), float(uLayer))) * 0.06;

                color += texture(texArray, vec3(orientUv(sourceUv + vec2(-w.x,  0.0), mirrorX), float(uLayer))) * 0.08;
                color += texture(texArray, vec3(orientUv(sourceUv + vec2( w.x,  0.0), mirrorX), float(uLayer))) * 0.08;
                color += texture(texArray, vec3(orientUv(sourceUv + vec2( 0.0, -w.y), mirrorX), float(uLayer))) * 0.08;
                color += texture(texArray, vec3(orientUv(sourceUv + vec2( 0.0,  w.y), mirrorX), float(uLayer))) * 0.08;
                color += texture(texArray, vec3(orientUv(sourceUv + vec2(-w.x, -w.y), mirrorX), float(uLayer))) * 0.04;
                color += texture(texArray, vec3(orientUv(sourceUv + vec2( w.x, -w.y), mirrorX), float(uLayer))) * 0.04;
                color += texture(texArray, vec3(orientUv(sourceUv + vec2(-w.x,  w.y), mirrorX), float(uLayer))) * 0.04;
                color += texture(texArray, vec3(orientUv(sourceUv + vec2( w.x,  w.y), mirrorX), float(uLayer))) * 0.04;

                return color;
            }

            void main() {
                float shiftedU = vUv.x + (uFlowActive == 1 ? uFlowOffset : 0.0);
                float nextShiftedU = uReverseFlow == 1 ? shiftedU + 1.0 : shiftedU - 1.0;

                vec4 currentColor = sampleTile(uTexArrayCurrent, vec2(shiftedU, vUv.y), uMirrorCurrent);
                vec4 nextColor = sampleTile(uTexArrayNext, vec2(nextShiftedU, vUv.y), uMirrorNext);
                vec4 seamSafeColor = mix(currentColor, nextColor, 0.5);
                vec4 color = (uFlowActive == 1 && uSeamSafeBlend == 1)
                    ? seamSafeColor
                    : ((uFlowActive == 1)
                    ? ((uReverseFlow == 1)
                        ? (shiftedU < 0.0 ? nextColor : currentColor)
                        : (shiftedU >= 1.0 ? nextColor : currentColor))
                    : currentColor);

                vec3 compositedColor = mix(color.rgb, uOverlayColor, uOverlayOpacity);
                outColor = vec4(compositedColor, color.a * uOpacity);
            }
        `,
    transparent: false,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  if (ctx.app.backgroundBlurEnabled) {
    return createBlurredTileBackgroundRuntimeWebGL(ctx, material);
  }

  const plane = attachCameraBackgroundPlane(ctx, material);

  function update(renderOptions = {}) {
    const frame = resolveBackgroundFrame(ctx, renderOptions);
    if (!frame.currentTexture) {
      return;
    }

    plane?.syncSize?.();
    material.uniforms.uTexArrayCurrent.value = frame.currentTexture;
    material.uniforms.uTexArrayNext.value =
      frame.nextTexture || frame.currentTexture;
    material.uniforms.uLayer.value = frame.currentLayer;
    material.uniforms.uFlowOffset.value = frame.flowOffset;
    material.uniforms.uFlowActive.value = frame.flowActive ? 1 : 0;
    material.uniforms.uReverseFlow.value = frame.reverseFlow ? 1 : 0;
    material.uniforms.uMirrorCurrent.value = frame.currentSample.mirrorX
      ? 1
      : 0;
    material.uniforms.uMirrorNext.value = frame.nextSample.mirrorX ? 1 : 0;
    material.uniforms.uRotate90.value = frame.rotate90;
    material.uniforms.uFlipVertical.value = frame.flipVertical;
    material.uniforms.uBlurRadius.value = frame.blurRadius;
    updateWebGLTileBackgroundMaterial(material, frame, ctx, true);
  }

  return {
    update,
    dispose: plane.dispose,
  };
}

function updateWebGLTileBackgroundMaterial(material, frame, ctx, includeOverlay) {
  material.uniforms.uTexArrayCurrent.value = frame.currentTexture;
  material.uniforms.uTexArrayNext.value =
    frame.nextTexture || frame.currentTexture;
  material.uniforms.uLayer.value = frame.currentLayer;
  material.uniforms.uFlowOffset.value = frame.flowOffset;
  material.uniforms.uFlowActive.value = frame.flowActive ? 1 : 0;
  material.uniforms.uReverseFlow.value = frame.reverseFlow ? 1 : 0;
  material.uniforms.uMirrorCurrent.value = frame.currentSample.mirrorX ? 1 : 0;
  material.uniforms.uMirrorNext.value = frame.nextSample.mirrorX ? 1 : 0;
  material.uniforms.uRotate90.value = frame.rotate90;
  material.uniforms.uFlipVertical.value = frame.flipVertical;
  material.uniforms.uBlurRadius.value = frame.blurRadius;
  const overlayState = getBackgroundOverlayState(ctx);
  material.uniforms.uOverlayColor.value.copy(overlayState.color);
  material.uniforms.uOverlayOpacity.value =
    includeOverlay && overlayState.enabled ? overlayState.opacity : 0;
}

function createWebGLGaussianBlurMaterial(width, height, direction) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uResolution: { value: new THREE.Vector2(width, height) },
      uRadius: { value: 1 },
      uDirection: { value: new THREE.Vector2(...direction) },
    },
    vertexShader: /* glsl */ `
            precision highp float;
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
    fragmentShader: /* glsl */ `
            precision highp float;
            uniform sampler2D tDiffuse;
            uniform vec2 uResolution;
            uniform float uRadius;
            uniform vec2 uDirection;
            varying vec2 vUv;

            void main() {
                vec2 texelStep = uDirection * (uRadius / uResolution);
                vec4 color = texture2D(tDiffuse, vUv) * 0.1032;
                color += texture2D(tDiffuse, vUv + texelStep * 0.125) * 0.1000;
                color += texture2D(tDiffuse, vUv - texelStep * 0.125) * 0.1000;
                color += texture2D(tDiffuse, vUv + texelStep * 0.250) * 0.0910;
                color += texture2D(tDiffuse, vUv - texelStep * 0.250) * 0.0910;
                color += texture2D(tDiffuse, vUv + texelStep * 0.375) * 0.0779;
                color += texture2D(tDiffuse, vUv - texelStep * 0.375) * 0.0779;
                color += texture2D(tDiffuse, vUv + texelStep * 0.500) * 0.0626;
                color += texture2D(tDiffuse, vUv - texelStep * 0.500) * 0.0626;
                color += texture2D(tDiffuse, vUv + texelStep * 0.625) * 0.0472;
                color += texture2D(tDiffuse, vUv - texelStep * 0.625) * 0.0472;
                color += texture2D(tDiffuse, vUv + texelStep * 0.750) * 0.0335;
                color += texture2D(tDiffuse, vUv - texelStep * 0.750) * 0.0335;
                color += texture2D(tDiffuse, vUv + texelStep * 0.875) * 0.0223;
                color += texture2D(tDiffuse, vUv - texelStep * 0.875) * 0.0223;
                color += texture2D(tDiffuse, vUv + texelStep * 1.000) * 0.0140;
                color += texture2D(tDiffuse, vUv - texelStep * 1.000) * 0.0140;
                gl_FragColor = color;
            }
        `,
    depthTest: false,
    depthWrite: false,
  });
}

function createBlurredTileBackgroundRuntimeWebGL(ctx, sourceMaterial) {
  const sampleScene = new THREE.Scene();
  const sampleCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const sampleGeometry = new THREE.PlaneGeometry(2, 2);
  const sampleQuad = new THREE.Mesh(sampleGeometry, sourceMaterial);
  sampleQuad.frustumCulled = false;
  sampleScene.add(sampleQuad);

  const blurScene = new THREE.Scene();
  const blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const blurGeometry = new THREE.PlaneGeometry(2, 2);
  const blurQuad = new THREE.Mesh(blurGeometry, null);
  blurQuad.frustumCulled = false;
  blurScene.add(blurQuad);

  let sampleTarget = null;
  let rtA = null;
  let rtB = null;
  let targetWidth = 0;
  let targetHeight = 0;
  let outputTexture = null;
  let gaussianHorizontalMaterial = null;
  let gaussianVerticalMaterial = null;

  const displayMaterial = createWebGLBackgroundDisplayMaterial();
  const plane = attachCameraBackgroundPlane(ctx, displayMaterial);

  function ensureRenderTargets(renderOptions = {}) {
    const { width, height } = getBlurTargetSize(ctx, renderOptions);
    if (sampleTarget && targetWidth === width && targetHeight === height) {
      return;
    }

    sampleTarget?.dispose?.();
    rtA?.dispose?.();
    rtB?.dispose?.();
    gaussianHorizontalMaterial?.dispose?.();
    gaussianVerticalMaterial?.dispose?.();

    sampleTarget = createBackgroundRenderTarget(ctx, width, height);
    rtA = createBackgroundRenderTarget(ctx, width, height);
    rtB = createBackgroundRenderTarget(ctx, width, height);
    gaussianHorizontalMaterial = createWebGLGaussianBlurMaterial(width, height, [1, 0]);
    gaussianVerticalMaterial = createWebGLGaussianBlurMaterial(width, height, [0, 1]);
    targetWidth = width;
    targetHeight = height;
    outputTexture = null;
  }

  function update(renderOptions = {}) {
    const frame = resolveBackgroundFrame(ctx, renderOptions);
    if (!frame.currentTexture) {
      return;
    }

    plane.syncSize();
    updateWebGLTileBackgroundMaterial(sourceMaterial, frame, ctx, false);
    ensureRenderTargets(renderOptions);

    const renderer = ctx.renderer.value;
    if (
      !renderer ||
      !sampleTarget ||
      !rtA ||
      !rtB ||
      !gaussianHorizontalMaterial ||
      !gaussianVerticalMaterial
    ) {
      return;
    }

    renderer.setRenderTarget(sampleTarget);
    renderer.render(sampleScene, sampleCamera);

    const radiusPassCount = getBlurPassCount(ctx);
    const gaussianPassCount = getGaussianPassCount(ctx, renderOptions);
    const radius =
      (getBlurPassOffset(radiusPassCount - 1, radiusPassCount) *
        getBlurPassScale(targetWidth, targetHeight, renderOptions)) /
      Math.sqrt(gaussianPassCount);
    let inputTexture = sampleTarget.texture;
    let outputTarget = rtB;

    for (let i = 0; i < gaussianPassCount; i++) {
      gaussianHorizontalMaterial.uniforms.tDiffuse.value = inputTexture;
      gaussianHorizontalMaterial.uniforms.uRadius.value = radius;
      blurQuad.material = gaussianHorizontalMaterial;
      renderer.setRenderTarget(rtA);
      renderer.render(blurScene, blurCamera);

      gaussianVerticalMaterial.uniforms.tDiffuse.value = rtA.texture;
      gaussianVerticalMaterial.uniforms.uRadius.value = radius;
      blurQuad.material = gaussianVerticalMaterial;
      renderer.setRenderTarget(rtB);
      renderer.render(blurScene, blurCamera);

      inputTexture = rtB.texture;
      outputTarget = rtB;
    }

    renderer.setRenderTarget(null);

    if (outputTexture !== outputTarget.texture) {
      outputTexture = outputTarget.texture;
      updateWebGLBackgroundDisplayMaterial(displayMaterial, ctx, outputTexture);
      displayMaterial.needsUpdate = true;
      ctx.backgroundTexture.value = outputTexture;
    }

    updateWebGLBackgroundDisplayMaterial(displayMaterial, ctx, outputTarget.texture);
  }

  function dispose() {
    plane.dispose();
    sampleTarget?.dispose?.();
    rtA?.dispose?.();
    rtB?.dispose?.();
    sourceMaterial.dispose();
    sampleGeometry.dispose();
    gaussianHorizontalMaterial?.dispose?.();
    gaussianVerticalMaterial?.dispose?.();
    blurGeometry.dispose();
  }

  return {
    update,
    dispose,
  };
}

async function createTileBackgroundRuntimeWebGPU(ctx, options = {}) {
  const { MeshBasicNodeMaterial } = await import("three/webgpu");
  const {
    texture: textureNode,
    uniform,
    uv,
    float,
    mix,
    vec2,
    vec3,
    vec4,
  } = await import("three/tsl");

  let frame = resolveBackgroundFrame(ctx);
  let signature = "";
  let plane = null;

  function makeSignature(nextFrame) {
    return [
      nextFrame.currentSample.tileIndex,
      nextFrame.nextSample.tileIndex,
      nextFrame.currentSample.mirrorX ? 1 : 0,
      nextFrame.nextSample.mirrorX ? 1 : 0,
      nextFrame.reverseFlow ? 1 : 0,
    ].join(":");
  }

  function createMaterial(nextFrame, includeOverlay = false) {
    const material = new MeshBasicNodeMaterial();
    const baseUv = uv();
    const layerUniform = uniform(nextFrame.currentLayer);
    const flowOffsetUniform = uniform(float(nextFrame.flowOffset));
    const flowActiveUniform = uniform(nextFrame.flowActive ? 1 : 0);
    const rotateUniform = uniform(nextFrame.rotate90);
    const flipUniform = uniform(nextFrame.flipVertical);
    const blurUniform = uniform(float(nextFrame.blurRadius));
    const opacityUniform = uniform(float(getBackgroundOpacity(options)));
    const overlayState = getBackgroundOverlayState(ctx);
    const overlayRedUniform = uniform(float(overlayState.color.r));
    const overlayGreenUniform = uniform(float(overlayState.color.g));
    const overlayBlueUniform = uniform(float(overlayState.color.b));
    const overlayOpacityUniform = uniform(
      float(includeOverlay && overlayState.enabled ? overlayState.opacity : 0),
    );
    const overlayColor = vec3(
      overlayRedUniform,
      overlayGreenUniform,
      overlayBlueUniform,
    );

    const currentShiftedU = baseUv.x.add(
      flowActiveUniform.equal(1).select(flowOffsetUniform, float(0)),
    );
    const nextShiftedU = nextFrame.reverseFlow
      ? currentShiftedU.add(1)
      : currentShiftedU.sub(1);
    const currentSourceUv = vec2(
      nextFrame.currentSample.mirrorX
        ? float(1).sub(currentShiftedU)
        : currentShiftedU,
      baseUv.y,
    );
    const nextSourceUv = vec2(
      nextFrame.nextSample.mirrorX ? float(1).sub(nextShiftedU) : nextShiftedU,
      baseUv.y,
    );

    function orient(sourceUv) {
      const rotated = rotateUniform
        .equal(1)
        .select(vec2(sourceUv.y, float(1).sub(sourceUv.x)), sourceUv);
      const flipped = flipUniform
        .equal(1)
        .select(vec2(rotated.x, float(1).sub(rotated.y)), rotated);
      return vec2(flipped.x, float(1).sub(flipped.y));
    }

    function sample(textureValue, sourceUv) {
      const center = textureNode(textureValue, orient(sourceUv)).depth(
        layerUniform,
      );
      const offset = blurUniform;
      const negativeOffset = float(0).sub(offset);
      const halfOffset = offset.mul(0.5);
      const negativeHalfOffset = float(0).sub(halfOffset);
      const wideOffset = offset.mul(1.45);
      const negativeWideOffset = float(0).sub(wideOffset);

      function sampleAt(xOffset, yOffset) {
        return textureNode(
          textureValue,
          orient(sourceUv.add(vec2(xOffset, yOffset))),
        ).depth(layerUniform);
      }

      const blurred = center
        .mul(0.08)
        .add(sampleAt(negativeHalfOffset, float(0)).mul(0.05))
        .add(sampleAt(halfOffset, float(0)).mul(0.05))
        .add(sampleAt(float(0), negativeHalfOffset).mul(0.05))
        .add(sampleAt(float(0), halfOffset).mul(0.05))
        .add(sampleAt(negativeOffset, negativeOffset).mul(0.06))
        .add(sampleAt(offset, negativeOffset).mul(0.06))
        .add(sampleAt(negativeOffset, offset).mul(0.06))
        .add(sampleAt(offset, offset).mul(0.06))
        .add(sampleAt(negativeWideOffset, float(0)).mul(0.08))
        .add(sampleAt(wideOffset, float(0)).mul(0.08))
        .add(sampleAt(float(0), negativeWideOffset).mul(0.08))
        .add(sampleAt(float(0), wideOffset).mul(0.08))
        .add(sampleAt(negativeWideOffset, negativeWideOffset).mul(0.04))
        .add(sampleAt(wideOffset, negativeWideOffset).mul(0.04))
        .add(sampleAt(negativeWideOffset, wideOffset).mul(0.04))
        .add(sampleAt(wideOffset, wideOffset).mul(0.04));

      return blurUniform.greaterThan(float(0.0001)).select(blurred, center);
    }

    const currentColor = sample(nextFrame.currentTexture, currentSourceUv);
    const nextColor = sample(
      nextFrame.nextTexture || nextFrame.currentTexture,
      nextSourceUv,
    );
    const flowColor = nextFrame.reverseFlow
      ? currentShiftedU.lessThan(float(0)).select(nextColor, currentColor)
      : currentShiftedU
          .greaterThanEqual(float(1))
          .select(nextColor, currentColor);
    const seamSafeFlowColor = currentColor.add(nextColor).mul(0.5);
    const activeFlowColor = ctx.app.backgroundBlurEnabled
      ? seamSafeFlowColor
      : flowColor;
    const color = flowActiveUniform
      .equal(1)
      .select(activeFlowColor, currentColor);

    const outputColor = vec4(color.rgb, color.a.mul(opacityUniform));
    material.colorNode = includeOverlay
      ? vec4(
          mix(
            outputColor.rgb,
            overlayColor,
            overlayOpacityUniform,
          ),
          outputColor.a,
        )
      : outputColor;
    material.transparent = false;
    material.depthTest = false;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material._layerUniform = layerUniform;
    material._flowOffsetUniform = flowOffsetUniform;
    material._flowActiveUniform = flowActiveUniform;
    material._rotateUniform = rotateUniform;
    material._flipUniform = flipUniform;
    material._blurUniform = blurUniform;
    material._overlayRedUniform = overlayRedUniform;
    material._overlayGreenUniform = overlayGreenUniform;
    material._overlayBlueUniform = overlayBlueUniform;
    material._overlayOpacityUniform = overlayOpacityUniform;
    material._includeOverlay = includeOverlay;

    return material;
  }

  function syncOverlayMaterial(material, includeOverlay = false) {
    if (
      !material?._overlayRedUniform ||
      !material?._overlayGreenUniform ||
      !material?._overlayBlueUniform ||
      !material?._overlayOpacityUniform
    ) {
      return;
    }

    const overlayState = getBackgroundOverlayState(ctx);
    material._overlayRedUniform.value = overlayState.color.r;
    material._overlayGreenUniform.value = overlayState.color.g;
    material._overlayBlueUniform.value = overlayState.color.b;
    material._overlayOpacityUniform.value =
      includeOverlay && overlayState.enabled ? overlayState.opacity : 0;
  }

  if (ctx.app.backgroundBlurEnabled) {
    return await createBlurredTileBackgroundRuntimeWebGPU(
      ctx,
      frame,
      createMaterial,
      makeSignature,
    );
  }

  function installMaterial(nextFrame) {
    const material = createMaterial(nextFrame, true);

    if (!plane) {
      plane = attachCameraBackgroundPlane(ctx, material);
    } else {
      plane.mesh.material?.dispose?.();
      plane.mesh.material = material;
    }

    signature = makeSignature(nextFrame);
  }

  installMaterial(frame);

  function update(renderOptions = {}) {
    frame = resolveBackgroundFrame(ctx, renderOptions);
    if (!frame.currentTexture) {
      return;
    }

    plane.syncSize();
    const nextSignature = makeSignature(frame);
    if (nextSignature !== signature) {
      installMaterial(frame);
      return;
    }

    const material = plane.mesh.material;
    material._layerUniform.value = frame.currentLayer;
    material._flowOffsetUniform.value = frame.flowOffset;
    material._flowActiveUniform.value = frame.flowActive ? 1 : 0;
    material._rotateUniform.value = frame.rotate90;
    material._flipUniform.value = frame.flipVertical;
    material._blurUniform.value = frame.blurRadius;
    syncOverlayMaterial(material, true);
  }

  return {
    update,
    dispose: () => {
      plane?.dispose?.();
      plane = null;
    },
  };
}

function syncWebGPUTileBackgroundMaterial(material, frame, ctx, includeOverlay) {
  material._layerUniform.value = frame.currentLayer;
  material._flowOffsetUniform.value = frame.flowOffset;
  material._flowActiveUniform.value = frame.flowActive ? 1 : 0;
  material._rotateUniform.value = frame.rotate90;
  material._flipUniform.value = frame.flipVertical;
  material._blurUniform.value = frame.blurRadius;
  const overlayState = getBackgroundOverlayState(ctx);
  material._overlayRedUniform.value = overlayState.color.r;
  material._overlayGreenUniform.value = overlayState.color.g;
  material._overlayBlueUniform.value = overlayState.color.b;
  material._overlayOpacityUniform.value =
    includeOverlay && overlayState.enabled ? overlayState.opacity : 0;
}

async function createBlurredTileBackgroundRuntimeWebGPU(
  ctx,
  initialFrame,
  createMaterial,
  makeSignature,
) {
  const { MeshBasicNodeMaterial } = await import("three/webgpu");
  const {
    texture: textureNode,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
    float,
    add,
    div,
    mul,
    mix,
  } = await import("three/tsl");

  const sampleScene = new THREE.Scene();
  const sampleCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const sampleGeometry = new THREE.PlaneGeometry(2, 2);
  const sampleQuad = new THREE.Mesh(
    sampleGeometry,
    createMaterial(initialFrame),
  );
  sampleQuad.frustumCulled = false;
  sampleScene.add(sampleQuad);

  const blurScene = new THREE.Scene();
  const blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const blurGeometry = new THREE.PlaneGeometry(2, 2);
  const blurQuad = new THREE.Mesh(blurGeometry, null);
  blurQuad.frustumCulled = false;
  blurScene.add(blurQuad);

  let signature = makeSignature(initialFrame);
  let sampleTarget = null;
  let rtA = null;
  let rtB = null;
  let gaussianMaterials = null;
  let targetWidth = 0;
  let targetHeight = 0;
  let outputTexture = null;
  let displayMaterial = null;
  let plane = null;

  function createDisplayMaterial(inputTexture) {
    const overlayState = getBackgroundOverlayState(ctx);
    const material = new MeshBasicNodeMaterial();
    const overlayRedUniform = uniform(float(overlayState.color.r));
    const overlayGreenUniform = uniform(float(overlayState.color.g));
    const overlayBlueUniform = uniform(float(overlayState.color.b));
    const overlayOpacityUniform = uniform(float(0));
    const sampledColor = textureNode(inputTexture, uv());
    const compositedColor = mix(
      sampledColor.rgb,
      vec3(overlayRedUniform, overlayGreenUniform, overlayBlueUniform),
      overlayOpacityUniform,
    );

    material.colorNode = vec4(compositedColor, sampledColor.a);
    material.transparent = false;
    material.depthTest = false;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material._overlayRedUniform = overlayRedUniform;
    material._overlayGreenUniform = overlayGreenUniform;
    material._overlayBlueUniform = overlayBlueUniform;
    material._overlayOpacityUniform = overlayOpacityUniform;
    return material;
  }

  function installDisplayMaterial(texture) {
    const nextMaterial = createDisplayMaterial(texture);
    if (!plane) {
      plane = attachCameraBackgroundPlane(ctx, nextMaterial);
    } else {
      plane.mesh.material?.dispose?.();
      plane.mesh.material = nextMaterial;
    }
    displayMaterial = nextMaterial;
  }

  function syncDisplayMaterial() {
    if (!displayMaterial) {
      return;
    }

    const overlayState = getBackgroundOverlayState(ctx);
    displayMaterial._overlayRedUniform.value = overlayState.color.r;
    displayMaterial._overlayGreenUniform.value = overlayState.color.g;
    displayMaterial._overlayBlueUniform.value = overlayState.color.b;
    displayMaterial._overlayOpacityUniform.value = overlayState.enabled
      ? overlayState.opacity
      : 0;
  }

  function createGaussianBlurMaterial(inputTexture, width, height, direction) {
    const material = new MeshBasicNodeMaterial();
    const coord = uv();
    const radiusUniform = uniform(float(1));
    const resolutionUniform = uniform(vec2(width, height));
    const texelStep = div(radiusUniform, resolutionUniform);
    const axisStep = direction[0] === 1 ? texelStep.x : texelStep.y;

    function sampleAt(distance) {
      const offset = axisStep.mul(float(distance));
      const offsetUv =
        direction[0] === 1
          ? vec2(offset, float(0))
          : vec2(float(0), offset);
      return textureNode(inputTexture, add(coord, offsetUv));
    }

    material.colorNode = textureNode(inputTexture, coord)
      .mul(0.1032)
      .add(sampleAt(0.125).mul(0.1000))
      .add(sampleAt(-0.125).mul(0.1000))
      .add(sampleAt(0.250).mul(0.0910))
      .add(sampleAt(-0.250).mul(0.0910))
      .add(sampleAt(0.375).mul(0.0779))
      .add(sampleAt(-0.375).mul(0.0779))
      .add(sampleAt(0.500).mul(0.0626))
      .add(sampleAt(-0.500).mul(0.0626))
      .add(sampleAt(0.625).mul(0.0472))
      .add(sampleAt(-0.625).mul(0.0472))
      .add(sampleAt(0.750).mul(0.0335))
      .add(sampleAt(-0.750).mul(0.0335))
      .add(sampleAt(0.875).mul(0.0223))
      .add(sampleAt(-0.875).mul(0.0223))
      .add(sampleAt(1.000).mul(0.0140))
      .add(sampleAt(-1.000).mul(0.0140));
    material.depthTest = false;
    material.depthWrite = false;
    material._radiusUniform = radiusUniform;
    return material;
  }

  function disposeBlurMaterials() {
    gaussianMaterials?.forEach((material) => material.dispose());
    gaussianMaterials = null;
  }

  function ensureRenderTargets(renderOptions = {}) {
    const { width, height } = getBlurTargetSize(ctx, renderOptions);
    if (sampleTarget && targetWidth === width && targetHeight === height) {
      return;
    }

    sampleTarget?.dispose?.();
    rtA?.dispose?.();
    rtB?.dispose?.();
    disposeBlurMaterials();

    sampleTarget = createBackgroundRenderTarget(ctx, width, height);
    rtA = createBackgroundRenderTarget(ctx, width, height);
    rtB = createBackgroundRenderTarget(ctx, width, height);
    gaussianMaterials = [
      createGaussianBlurMaterial(sampleTarget.texture, width, height, [1, 0]),
      createGaussianBlurMaterial(rtA.texture, width, height, [0, 1]),
      createGaussianBlurMaterial(rtB.texture, width, height, [1, 0]),
    ];
    targetWidth = width;
    targetHeight = height;
    outputTexture = null;
  }

  function update(renderOptions = {}) {
    const frame = resolveBackgroundFrame(ctx, renderOptions);
    if (!frame.currentTexture) {
      return;
    }

    plane?.syncSize?.();
    const nextSignature = makeSignature(frame);
    if (nextSignature !== signature) {
      sampleQuad.material?.dispose?.();
      sampleQuad.material = createMaterial(frame, false);
      signature = nextSignature;
    } else {
      syncWebGPUTileBackgroundMaterial(sampleQuad.material, frame, ctx, false);
    }

    ensureRenderTargets(renderOptions);
    const renderer = ctx.renderer.value;
    if (
      !renderer ||
      !sampleTarget ||
      !rtA ||
      !rtB ||
      !gaussianMaterials
    ) {
      return;
    }

    renderer.setRenderTarget(sampleTarget);
    renderer.render(sampleScene, sampleCamera);

    const radiusPassCount = getBlurPassCount(ctx);
    const gaussianPassCount = getGaussianPassCount(ctx, renderOptions);
    const radius =
      (getBlurPassOffset(radiusPassCount - 1, radiusPassCount) *
        getBlurPassScale(targetWidth, targetHeight, renderOptions)) /
      Math.sqrt(gaussianPassCount);
    let outputTarget = rtB;

    for (let i = 0; i < gaussianPassCount; i++) {
      const horizontalMaterial = gaussianMaterials[i === 0 ? 0 : 2];
      horizontalMaterial._radiusUniform.value = radius;
      blurQuad.material = horizontalMaterial;
      renderer.setRenderTarget(rtA);
      renderer.render(blurScene, blurCamera);

      gaussianMaterials[1]._radiusUniform.value = radius;
      blurQuad.material = gaussianMaterials[1];
      renderer.setRenderTarget(rtB);
      renderer.render(blurScene, blurCamera);
      outputTarget = rtB;
    }

    renderer.setRenderTarget(null);

    if (outputTexture !== outputTarget.texture) {
      outputTexture = outputTarget.texture;
      installDisplayMaterial(outputTexture);
      ctx.backgroundTexture.value = outputTexture;
    }

    plane?.syncSize?.();
    syncDisplayMaterial();
  }

  function dispose() {
    plane?.dispose?.();
    sampleTarget?.dispose?.();
    rtA?.dispose?.();
    rtB?.dispose?.();
    disposeBlurMaterials();
    sampleQuad.material?.dispose?.();
    sampleGeometry.dispose();
    blurGeometry.dispose();
  }

  return {
    update,
    dispose,
  };
}

async function createUrlBackgroundRuntime(ctx, imageUrl, options = {}) {
  const loader = new THREE.TextureLoader();
  loader.crossOrigin = "anonymous";

  const texture = await new Promise((resolve, reject) => {
    loader.load(imageUrl, resolve, undefined, () =>
      reject(new Error("Failed to load background image")),
    );
  });
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: false,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const plane = attachCameraBackgroundPlane(ctx, material);

  return {
    update: plane.syncSize,
    dispose: () => {
      plane.dispose();
      texture.dispose();
    },
  };
}
