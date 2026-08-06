// src/composables/viewer/useSceneBackground.js
// Scene background management via a camera-locked textured plane.

import * as THREE from "three";
import { getBackgroundTextureOption } from "../../modules/viewer/backgroundTextures.js";

const BACKGROUND_DISTANCE = 100;
const BACKGROUND_RENDER_ORDER = -10000;
const REALTIME_BLUR_MAX_SIDE = 384;
const MAX_BACKGROUND_BLUR_AMOUNT = 200;
const MAX_BACKGROUND_BLUR_RADIUS_PASSES = 128;
const MAX_REALTIME_GAUSSIAN_PASSES = 6;
const BACKGROUND_FLOW_TIME_ORIGIN =
  typeof performance !== "undefined" ? performance.now() : Date.now();
const BACKGROUND_TEXTURE_CACHE = new Map();

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

function getBackgroundTimeSeconds(renderOptions = {}) {
  if (Number.isFinite(Number(renderOptions.timeSeconds))) {
    return Math.max(0, Number(renderOptions.timeSeconds));
  }

  return Math.max(
    0,
    ((typeof performance !== "undefined" ? performance.now() : Date.now()) -
      BACKGROUND_FLOW_TIME_ORIGIN) /
      1000,
  );
}

async function loadBackgroundTexture(ctx) {
  if (!ctx.app.backgroundTextureEnabled) {
    return null;
  }

  const option = getBackgroundTextureOption(ctx.app.backgroundTexture);
  if (option.type === "procedural" || !option.url) {
    return null;
  }
  if (BACKGROUND_TEXTURE_CACHE.has(option.url)) {
    return BACKGROUND_TEXTURE_CACHE.get(option.url);
  }

  const loader = new THREE.TextureLoader();
  loader.crossOrigin = "anonymous";
  const texture = await new Promise((resolve, reject) => {
    loader.load(option.url, resolve, undefined, reject);
  });

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  BACKGROUND_TEXTURE_CACHE.set(option.url, texture);
  return texture;
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

function getBackgroundLayerState(ctx) {
  const waterScale = Number(ctx.app.backgroundWaterScale);
  const waterSpeed = Number(ctx.app.backgroundWaterSpeed);
  const waterStrength = Number(ctx.app.backgroundWaterStrength);

  return {
    baseEnabled: ctx.app.backgroundBaseEnabled !== false,
    staticEnabled: !!ctx.app.backgroundTextureEnabled,
    waterEnabled: !!ctx.app.backgroundWaterEnabled,
    waterScale: Number.isFinite(waterScale)
      ? Math.max(2, Math.min(24, waterScale))
      : 8,
    waterSpeed: Number.isFinite(waterSpeed)
      ? Math.max(0, Math.min(3, waterSpeed))
      : 1,
    waterStrength: Number.isFinite(waterStrength)
      ? Math.max(0.05, Math.min(0.6, waterStrength))
      : 0.28,
  };
}

function createWebGLBackgroundDisplayMaterial(
  textureOverlay = null,
) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uTexture: { value: textureOverlay },
      uStaticTextureEnabled: { value: textureOverlay ? 1 : 0 },
      uWaterEnabled: { value: 0 },
      uWaterScale: { value: 8 },
      uWaterSpeed: { value: 1 },
      uWaterStrength: { value: 0.28 },
      uTime: { value: 0 },
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
            uniform sampler2D uTexture;
            uniform int uStaticTextureEnabled;
            uniform int uWaterEnabled;
            uniform float uWaterScale;
            uniform float uWaterSpeed;
            uniform float uWaterStrength;
            uniform float uTime;
            uniform vec3 uOverlayColor;
            uniform float uOverlayOpacity;
            varying vec2 vUv;

            vec3 softLightBlend(vec3 base, vec3 blend) {
                vec3 low = base - (1.0 - 2.0 * blend) * base * (1.0 - base);
                vec3 high = base + (2.0 * blend - 1.0) * (sqrt(base) - base);
                return mix(low, high, step(vec3(0.5), blend));
            }

            vec3 proceduralWater(vec2 uv, float time) {
                vec2 p = uv * uWaterScale;
                float waveSum = 0.0;
                float ridgeSum = 0.0;
                float weightSum = 0.0;
                float weight = 1.0;

                for (int i = 0; i < 4; i++) {
                    float iteration = float(i);
                    float frequency = 1.0 + iteration * 1.35;
                    vec2 direction = normalize(vec2(
                        1.0 + iteration * 0.7,
                        0.35 - iteration * 0.9
                    ));
                    float phase = time * (0.35 + iteration * 0.11) * uWaterSpeed;
                    float wave = sin(dot(direction, p) * frequency + phase);
                    float ridge = pow(max(wave, 0.0), 5.0);

                    p += direction * wave * weight * 0.13;
                    waveSum += wave * weight;
                    ridgeSum += ridge * weight;
                    weightSum += weight;
                    weight *= 0.58;
                }

                float centered = waveSum / weightSum;
                float ridge = ridgeSum / weightSum;
                float trough = pow(max(-centered * 1.6, 0.0), 1.35);
                float contrast = 0.55 + uWaterStrength * 1.8;
                float waterValue = clamp(
                    0.5 + centered * contrast + ridge * (0.08 + uWaterStrength * 0.38) - trough * 0.06,
                    0.02,
                    0.98
                );
                return vec3(waterValue);
            }

            void main() {
                vec4 background = texture2D(tDiffuse, vUv);
                vec3 color = mix(background.rgb, uOverlayColor, uOverlayOpacity);
                if (uStaticTextureEnabled == 1) {
                    color = softLightBlend(color, texture2D(uTexture, vUv).rgb);
                }
                if (uWaterEnabled == 1) {
                    color = softLightBlend(color, proceduralWater(vUv, uTime));
                }
                gl_FragColor = vec4(color, background.a);
            }
        `,
    transparent: false,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function updateWebGLBackgroundDisplayMaterial(
  material,
  ctx,
  texture,
  textureOverlay = null,
  timeSeconds = 0,
) {
  if (!material) {
    return;
  }

  const overlayState = getBackgroundOverlayState(ctx);
  const layerState = getBackgroundLayerState(ctx);
  material.uniforms.tDiffuse.value = texture;
  material.uniforms.uTexture.value = textureOverlay;
  material.uniforms.uStaticTextureEnabled.value =
    layerState.staticEnabled && !!textureOverlay ? 1 : 0;
  material.uniforms.uWaterEnabled.value = layerState.waterEnabled ? 1 : 0;
  material.uniforms.uWaterScale.value = layerState.waterScale;
  material.uniforms.uWaterSpeed.value = layerState.waterSpeed;
  material.uniforms.uWaterStrength.value = layerState.waterStrength;
  material.uniforms.uTime.value = timeSeconds;
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

    let textureOverlay = null;
    try {
      textureOverlay = await loadBackgroundTexture(ctx);
    } catch (error) {
      console.warn("[ThreeSetup] Failed to load background texture:", error);
    }

    if (requestToken !== backgroundGenerationToken) {
      return;
    }

    const isWebGPU = ctx.app.rendererType === "webgpu";
    let runtime = null;

    try {
      runtime = isWebGPU
        ? await createTileBackgroundRuntimeWebGPU(ctx, {
            ...options,
            textureOverlay,
          })
        : createTileBackgroundRuntimeWebGL(ctx, {
            ...options,
            textureOverlay,
          });

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
  const initialLayerState = getBackgroundLayerState(ctx);
  // When blur is enabled, this material is the KTX2-only source for the
  // Gaussian pass. The texture layer is applied by the final display material
  // after that pass so it remains crisp.
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
      uBaseEnabled: { value: initialLayerState.baseEnabled ? 1 : 0 },
      uTexture: { value: options.textureOverlay || null },
      uStaticTextureEnabled: {
        value:
          initialLayerState.staticEnabled && options.textureOverlay ? 1 : 0,
      },
      uWaterEnabled: { value: initialLayerState.waterEnabled ? 1 : 0 },
      uWaterScale: { value: initialLayerState.waterScale },
      uWaterSpeed: { value: initialLayerState.waterSpeed },
      uWaterStrength: { value: initialLayerState.waterStrength },
      uTime: { value: 0 },
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
            uniform int uBaseEnabled;
            uniform sampler2D uTexture;
            uniform int uStaticTextureEnabled;
            uniform int uWaterEnabled;
            uniform float uWaterScale;
            uniform float uWaterSpeed;
            uniform float uWaterStrength;
            uniform float uTime;
            uniform vec3 uOverlayColor;
            uniform float uOverlayOpacity;
            uniform int uSeamSafeBlend;
            uniform float uOpacity;

            in vec2 vUv;
            out vec4 outColor;

            vec3 softLightBlend(vec3 base, vec3 blend) {
                vec3 low = base - (1.0 - 2.0 * blend) * base * (1.0 - base);
                vec3 high = base + (2.0 * blend - 1.0) * (sqrt(base) - base);
                return mix(low, high, step(vec3(0.5), blend));
            }

            vec3 proceduralWater(vec2 uv, float time) {
                vec2 p = uv * uWaterScale;
                float waveSum = 0.0;
                float ridgeSum = 0.0;
                float weightSum = 0.0;
                float weight = 1.0;

                for (int i = 0; i < 4; i++) {
                    float iteration = float(i);
                    float frequency = 1.0 + iteration * 1.35;
                    vec2 direction = normalize(vec2(
                        1.0 + iteration * 0.7,
                        0.35 - iteration * 0.9
                    ));
                    float phase = time * (0.35 + iteration * 0.11) * uWaterSpeed;
                    float wave = sin(dot(direction, p) * frequency + phase);
                    float ridge = pow(max(wave, 0.0), 5.0);

                    p += direction * wave * weight * 0.13;
                    waveSum += wave * weight;
                    ridgeSum += ridge * weight;
                    weightSum += weight;
                    weight *= 0.58;
                }

                float centered = waveSum / weightSum;
                float ridge = ridgeSum / weightSum;
                float trough = pow(max(-centered * 1.6, 0.0), 1.35);
                float contrast = 0.55 + uWaterStrength * 1.8;
                float waterValue = clamp(
                    0.5 + centered * contrast + ridge * (0.08 + uWaterStrength * 0.38) - trough * 0.06,
                    0.02,
                    0.98
                );
                return vec3(waterValue);
            }

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

                if (uBaseEnabled == 0) {
                    color = vec4(0.5, 0.5, 0.5, 1.0);
                }

                vec3 compositedColor = mix(color.rgb, uOverlayColor, uOverlayOpacity);
                if (uStaticTextureEnabled == 1) {
                    compositedColor = softLightBlend(compositedColor, texture(uTexture, vUv).rgb);
                }
                if (uWaterEnabled == 1) {
                    compositedColor = softLightBlend(compositedColor, proceduralWater(vUv, uTime));
                }
                outColor = vec4(compositedColor, color.a * uOpacity);
            }
        `,
    transparent: false,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  if (ctx.app.backgroundBlurEnabled) {
    // The display material owns the water/paper layer and is attached after
    // the blurred render target, keeping that layer unaffected by blur.
    return createBlurredTileBackgroundRuntimeWebGL(ctx, material, options);
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
    updateWebGLTileBackgroundMaterial(
      material,
      frame,
      ctx,
      true,
      options.textureOverlay,
      getBackgroundTimeSeconds(renderOptions),
    );
  }

  return {
    update,
    dispose: plane.dispose,
  };
}

function updateWebGLTileBackgroundMaterial(
  material,
  frame,
  ctx,
  includeOverlay,
  textureOverlay = null,
  timeSeconds = 0,
) {
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
  const layerState = getBackgroundLayerState(ctx);
  material.uniforms.uBaseEnabled.value = layerState.baseEnabled ? 1 : 0;
  material.uniforms.uTexture.value = textureOverlay;
  material.uniforms.uStaticTextureEnabled.value =
    includeOverlay && layerState.staticEnabled && !!textureOverlay ? 1 : 0;
  material.uniforms.uWaterEnabled.value =
    includeOverlay && layerState.waterEnabled ? 1 : 0;
  material.uniforms.uWaterScale.value = layerState.waterScale;
  material.uniforms.uWaterSpeed.value = layerState.waterSpeed;
  material.uniforms.uWaterStrength.value = layerState.waterStrength;
  material.uniforms.uTime.value = timeSeconds;
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

function createBlurredTileBackgroundRuntimeWebGL(
  ctx,
  sourceMaterial,
  options = {},
) {
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

  const displayMaterial = createWebGLBackgroundDisplayMaterial(
    options.textureOverlay,
  );
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
      updateWebGLBackgroundDisplayMaterial(
        displayMaterial,
        ctx,
        outputTexture,
        options.textureOverlay,
        getBackgroundTimeSeconds(renderOptions),
      );
      displayMaterial.needsUpdate = true;
      ctx.backgroundTexture.value = outputTexture;
    }

    updateWebGLBackgroundDisplayMaterial(
      displayMaterial,
      ctx,
      outputTarget.texture,
      options.textureOverlay,
      getBackgroundTimeSeconds(renderOptions),
    );
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
    max,
    pow,
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
    const waterTimeUniform = uniform(float(getBackgroundTimeSeconds()));
    const baseEnabledUniform = uniform(
      getBackgroundLayerState(ctx).baseEnabled ? 1 : 0,
    );
    const staticTextureEnabledUniform = uniform(
      getBackgroundLayerState(ctx).staticEnabled && options.textureOverlay
        ? 1
        : 0,
    );
    const waterEnabledUniform = uniform(
      getBackgroundLayerState(ctx).waterEnabled ? 1 : 0,
    );
    const waterScaleUniform = uniform(
      float(getBackgroundLayerState(ctx).waterScale),
    );
    const waterSpeedUniform = uniform(
      float(getBackgroundLayerState(ctx).waterSpeed),
    );
    const waterStrengthUniform = uniform(
      float(getBackgroundLayerState(ctx).waterStrength),
    );
    const opacityUniform = uniform(float(getBackgroundOpacity(options)));
    const overlayState = getBackgroundOverlayState(ctx);
    const layerState = getBackgroundLayerState(ctx);
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

    function proceduralWater(coord, time) {
      let p = coord.mul(waterScaleUniform);
      let waveSum = float(0);
      let ridgeSum = float(0);
      let weightSum = float(0);
      let weight = 1.0;
      const directions = [
        [0.943, 0.330],
        [0.951, -0.308],
        [0.856, -0.517],
        [0.796, -0.605],
      ];

      for (let i = 0; i < 4; i += 1) {
        const iteration = i;
        const frequency = 1.0 + iteration * 1.35;
        const directionX = directions[i][0];
        const directionY = directions[i][1];
        const direction = vec2(directionX, directionY);
        const phase = time
          .mul(0.35 + iteration * 0.11)
          .mul(waterSpeedUniform);
        const wave = p.x
          .mul(directionX * frequency)
          .add(p.y.mul(directionY * frequency))
          .add(phase)
          .sin();
        const ridge = pow(max(wave, float(0)), float(5));

        p = p.add(direction.mul(wave.mul(weight * 0.13)));
        waveSum = waveSum.add(wave.mul(weight));
        ridgeSum = ridgeSum.add(ridge.mul(weight));
        weightSum = weightSum.add(weight);
        weight *= 0.58;
      }

      const centered = waveSum.div(weightSum);
      const ridge = ridgeSum.div(weightSum);
      const trough = pow(max(centered.mul(-1.6), float(0)), float(1.35));
      const contrast = waterStrengthUniform.mul(1.8).add(0.55);
      const waterValue = centered
        .mul(contrast)
        .add(ridge.mul(waterStrengthUniform.mul(0.38).add(0.08)))
        .sub(trough.mul(0.06))
        .add(0.5)
        .max(0.02)
        .min(0.98);
      return vec3(waterValue);
    }

    function softLightBlend(base, blend) {
      const low = base.sub(
        float(1)
          .sub(blend.mul(2))
          .mul(base)
          .mul(float(1).sub(base)),
      );
      const high = base.add(
        blend.mul(2).sub(1).mul(base.sqrt().sub(base)),
      );
      return blend.lessThan(float(0.5)).select(low, high);
    }

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

    const baseColor = baseEnabledUniform
      .equal(1)
      .select(color.rgb, vec3(0.5));
    const outputColor = vec4(baseColor, color.a.mul(opacityUniform));
    const colorWithOverlay = includeOverlay
      ? mix(outputColor.rgb, overlayColor, overlayOpacityUniform)
      : outputColor.rgb;
    const staticTextureColor = options.textureOverlay
      ? textureNode(options.textureOverlay, baseUv).rgb
      : null;
    const withStaticTexture =
      includeOverlay && staticTextureColor
        ? staticTextureEnabledUniform
            .equal(1)
            .select(
              softLightBlend(colorWithOverlay, staticTextureColor),
              colorWithOverlay,
            )
        : colorWithOverlay;
    const waterColor = includeOverlay && layerState.waterEnabled
      ? proceduralWater(baseUv, waterTimeUniform)
      : vec3(0.5);
    const texturedColor = includeOverlay
      ? waterEnabledUniform
          .equal(1)
          .select(softLightBlend(withStaticTexture, waterColor), withStaticTexture)
      : withStaticTexture;
    material.colorNode = vec4(texturedColor, outputColor.a);
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
    material._waterTimeUniform = waterTimeUniform;
    material._baseEnabledUniform = baseEnabledUniform;
    material._staticTextureEnabledUniform = staticTextureEnabledUniform;
    material._waterEnabledUniform = waterEnabledUniform;
    material._waterScaleUniform = waterScaleUniform;
    material._waterSpeedUniform = waterSpeedUniform;
    material._waterStrengthUniform = waterStrengthUniform;
    material._hasStaticTexture = !!options.textureOverlay;
    material._overlayRedUniform = overlayRedUniform;
    material._overlayGreenUniform = overlayGreenUniform;
    material._overlayBlueUniform = overlayBlueUniform;
    material._overlayOpacityUniform = overlayOpacityUniform;
    material._includeOverlay = includeOverlay;

    return material;
  }

    function syncOverlayMaterial(
      material,
      includeOverlay = false,
      renderOptions = {},
  ) {
    if (
      !material?._overlayRedUniform ||
      !material?._overlayGreenUniform ||
      !material?._overlayBlueUniform ||
      !material?._overlayOpacityUniform
    ) {
      return;
    }

    const overlayState = getBackgroundOverlayState(ctx);
    const layerState = getBackgroundLayerState(ctx);
    material._overlayRedUniform.value = overlayState.color.r;
    material._overlayGreenUniform.value = overlayState.color.g;
    material._overlayBlueUniform.value = overlayState.color.b;
    material._overlayOpacityUniform.value =
      includeOverlay && overlayState.enabled ? overlayState.opacity : 0;
    if (material._baseEnabledUniform) {
      material._baseEnabledUniform.value = layerState.baseEnabled ? 1 : 0;
    }
    if (material._staticTextureEnabledUniform) {
      material._staticTextureEnabledUniform.value =
        includeOverlay && layerState.staticEnabled && options.textureOverlay
          ? 1
          : 0;
    }
    if (material._waterEnabledUniform) {
      material._waterEnabledUniform.value =
        includeOverlay && layerState.waterEnabled ? 1 : 0;
    }
    if (material._waterScaleUniform) {
      material._waterScaleUniform.value = layerState.waterScale;
    }
    if (material._waterSpeedUniform) {
      material._waterSpeedUniform.value = layerState.waterSpeed;
    }
    if (material._waterStrengthUniform) {
      material._waterStrengthUniform.value = layerState.waterStrength;
    }
    if (material._waterTimeUniform) {
      material._waterTimeUniform.value = getBackgroundTimeSeconds(renderOptions);
    }
  }

  if (ctx.app.backgroundBlurEnabled) {
    return await createBlurredTileBackgroundRuntimeWebGPU(
      ctx,
      frame,
      createMaterial,
      makeSignature,
      options,
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
    material._waterTimeUniform.value = getBackgroundTimeSeconds(renderOptions);
    syncOverlayMaterial(material, true, renderOptions);
  }

  return {
    update,
    dispose: () => {
      plane?.dispose?.();
      plane = null;
    },
  };
}

function syncWebGPUTileBackgroundMaterial(
  material,
  frame,
  ctx,
  includeOverlay,
  renderOptions = {},
) {
  material._layerUniform.value = frame.currentLayer;
  material._flowOffsetUniform.value = frame.flowOffset;
  material._flowActiveUniform.value = frame.flowActive ? 1 : 0;
  material._rotateUniform.value = frame.rotate90;
  material._flipUniform.value = frame.flipVertical;
  material._blurUniform.value = frame.blurRadius;
  const layerState = getBackgroundLayerState(ctx);
  material._baseEnabledUniform.value = layerState.baseEnabled ? 1 : 0;
  material._staticTextureEnabledUniform.value =
    includeOverlay && layerState.staticEnabled && material._hasStaticTexture
      ? 1
      : 0;
  material._waterEnabledUniform.value =
    includeOverlay && layerState.waterEnabled ? 1 : 0;
  material._waterScaleUniform.value = layerState.waterScale;
  material._waterSpeedUniform.value = layerState.waterSpeed;
  material._waterStrengthUniform.value = layerState.waterStrength;
  const overlayState = getBackgroundOverlayState(ctx);
  material._overlayRedUniform.value = overlayState.color.r;
  material._overlayGreenUniform.value = overlayState.color.g;
  material._overlayBlueUniform.value = overlayState.color.b;
  material._overlayOpacityUniform.value =
    includeOverlay && overlayState.enabled ? overlayState.opacity : 0;
  if (material._waterTimeUniform) {
    material._waterTimeUniform.value = getBackgroundTimeSeconds(renderOptions);
  }
}

async function createBlurredTileBackgroundRuntimeWebGPU(
  ctx,
  initialFrame,
  createMaterial,
  makeSignature,
  options = {},
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
    max,
    pow,
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
    // Keep procedural/static background layers out of the source material;
    // they are composited by the display material after Gaussian blur.
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
    const waterTimeUniform = uniform(float(getBackgroundTimeSeconds()));
    const layerState = getBackgroundLayerState(ctx);
    const staticTextureEnabledUniform = uniform(
      layerState.staticEnabled && options.textureOverlay ? 1 : 0,
    );
    const waterEnabledUniform = uniform(layerState.waterEnabled ? 1 : 0);
    const waterScaleUniform = uniform(float(layerState.waterScale));
    const waterSpeedUniform = uniform(float(layerState.waterSpeed));
    const waterStrengthUniform = uniform(float(layerState.waterStrength));
    const sampledColor = textureNode(inputTexture, uv());
    const colorWithOverlay = mix(
      sampledColor.rgb,
      vec3(overlayRedUniform, overlayGreenUniform, overlayBlueUniform),
      overlayOpacityUniform,
    );
    function proceduralWater(coord, time) {
      let p = coord.mul(waterScaleUniform);
      let waveSum = float(0);
      let ridgeSum = float(0);
      let weightSum = float(0);
      let weight = 1.0;
      const directions = [
        [0.943, 0.330],
        [0.951, -0.308],
        [0.856, -0.517],
        [0.796, -0.605],
      ];

      for (let i = 0; i < 4; i += 1) {
        const iteration = i;
        const frequency = 1.0 + iteration * 1.35;
        const directionX = directions[i][0];
        const directionY = directions[i][1];
        const direction = vec2(directionX, directionY);
        const phase = time
          .mul(0.35 + iteration * 0.11)
          .mul(waterSpeedUniform);
        const wave = p.x
          .mul(directionX * frequency)
          .add(p.y.mul(directionY * frequency))
          .add(phase)
          .sin();
        const ridge = pow(max(wave, float(0)), float(5));

        p = p.add(direction.mul(wave.mul(weight * 0.13)));
        waveSum = waveSum.add(wave.mul(weight));
        ridgeSum = ridgeSum.add(ridge.mul(weight));
        weightSum = weightSum.add(weight);
        weight *= 0.58;
      }

      const centered = waveSum.div(weightSum);
      const ridge = ridgeSum.div(weightSum);
      const trough = pow(max(centered.mul(-1.6), float(0)), float(1.35));
      const contrast = waterStrengthUniform.mul(1.8).add(0.55);
      const waterValue = centered
        .mul(contrast)
        .add(ridge.mul(waterStrengthUniform.mul(0.38).add(0.08)))
        .sub(trough.mul(0.06))
        .add(0.5)
        .max(0.02)
        .min(0.98);
      return vec3(waterValue);
    }

    function softLightBlend(base, blend) {
      const low = base.sub(
        float(1)
          .sub(blend.mul(2))
          .mul(base)
          .mul(float(1).sub(base)),
      );
      const high = base.add(
        blend.mul(2).sub(1).mul(base.sqrt().sub(base)),
      );
      return blend.lessThan(float(0.5)).select(low, high);
    }

    const staticTextureColor = options.textureOverlay
      ? textureNode(options.textureOverlay, uv()).rgb
      : null;
    const withStaticTexture = staticTextureColor
      ? staticTextureEnabledUniform
          .equal(1)
          .select(
            softLightBlend(colorWithOverlay, staticTextureColor),
            colorWithOverlay,
          )
      : colorWithOverlay;
    const waterColor = layerState.waterEnabled
      ? proceduralWater(uv(), waterTimeUniform)
      : vec3(0.5);
    const texturedColor = waterEnabledUniform
      .equal(1)
      .select(softLightBlend(withStaticTexture, waterColor), withStaticTexture);

    material.colorNode = vec4(texturedColor, sampledColor.a);
    material.transparent = false;
    material.depthTest = false;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material._overlayRedUniform = overlayRedUniform;
    material._overlayGreenUniform = overlayGreenUniform;
    material._overlayBlueUniform = overlayBlueUniform;
    material._overlayOpacityUniform = overlayOpacityUniform;
    material._waterTimeUniform = waterTimeUniform;
    material._staticTextureEnabledUniform = staticTextureEnabledUniform;
    material._waterEnabledUniform = waterEnabledUniform;
    material._waterScaleUniform = waterScaleUniform;
    material._waterSpeedUniform = waterSpeedUniform;
    material._waterStrengthUniform = waterStrengthUniform;
    material._hasStaticTexture = !!options.textureOverlay;
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

  function syncDisplayMaterial(renderOptions = {}) {
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
    const layerState = getBackgroundLayerState(ctx);
    displayMaterial._staticTextureEnabledUniform.value =
      layerState.staticEnabled && displayMaterial._hasStaticTexture ? 1 : 0;
    displayMaterial._waterEnabledUniform.value = layerState.waterEnabled ? 1 : 0;
    displayMaterial._waterScaleUniform.value = layerState.waterScale;
    displayMaterial._waterSpeedUniform.value = layerState.waterSpeed;
    displayMaterial._waterStrengthUniform.value = layerState.waterStrength;
    displayMaterial._waterTimeUniform.value = getBackgroundTimeSeconds(renderOptions);
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
      syncWebGPUTileBackgroundMaterial(
        sampleQuad.material,
        frame,
        ctx,
        false,
        renderOptions,
      );
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
    syncDisplayMaterial(renderOptions);
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
