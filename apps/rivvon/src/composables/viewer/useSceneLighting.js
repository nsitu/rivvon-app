// Camera-key scene lighting and a transparent shadow catcher for the viewer.

import { watch } from "vue";
import * as THREE from "three";

const SHADOW_CATCHER_RENDER_ORDER = -9999;
const SHADOW_CATCHER_OVERSCAN = 1.02;
const SHADOW_CATCHER_CURVE_ANGLE = THREE.MathUtils.degToRad(25);
const SPOTLIGHT_BASE_INTENSITY = 100;
const TRANSMISSION_MAP_SIZE_DESKTOP = 512;
const TRANSMISSION_MAP_SIZE_MOBILE = 256;

export function useSceneLighting(ctx) {
  let spotLight = null;
  let spotTarget = null;
  let fillLight = null;
  let shadowCatcher = null;
  let shadowCatcherGeometry = null;
  let shadowCatcherMaterial = null;
  let coloredShadowMaterial = null;
  let transmissionRenderTarget = null;
  let transmissionCamera = null;
  let webGPUDeps = null;
  let catcherWidth = 0;
  let catcherHeight = 0;
  let catcherWasSpherical = null;
  const transmissionMaterials = new Map();
  const cameraPosition = new THREE.Vector3();
  const artworkCenter = new THREE.Vector3();
  const lightAxis = new THREE.Vector3();
  const cameraQuaternion = new THREE.Quaternion();
  const transmissionProjectorMatrix = new THREE.Matrix4();

  function isColoredProjectionActive() {
    return !!(
      ctx.app.sceneLightingEnabled && ctx.app.sceneColoredShadowsEnabled
    );
  }

  function configureMultiplicativeBlending(material) {
    material.transparent = true;
    material.depthTest = false;
    material.depthWrite = false;
    // Three's built-in mode maps to source × destination and is normalized
    // consistently by both the WebGL and WebGPU render backends.
    material.blending = THREE.MultiplyBlending;
    material.premultipliedAlpha = true;
    material.toneMapped = false;
    material.side = THREE.DoubleSide;
    return material;
  }

  function resolveArtworkCenter(target) {
    const series = ctx.ribbonSeries.value;
    if (series?.getWorldCenter) return series.getWorldCenter(target);
    if (ctx.controls.value?.target) return target.copy(ctx.controls.value.target);
    return target.set(0, 0, 0);
  }

  function getActiveTileManagers() {
    return ctx.tileManagers.value.length > 0
      ? ctx.tileManagers.value
      : ctx.tileManager.value
        ? [ctx.tileManager.value]
        : [];
  }

  function syncMaterialLighting() {
    for (const manager of getActiveTileManagers()) {
      manager.setSceneLighting?.(
        ctx.app.sceneLightingEnabled,
        ctx.app.sceneLightingIntensity,
      );
    }
  }

  function syncEnabledState() {
    const enabled = !!ctx.app.sceneLightingEnabled;
    if (spotLight) spotLight.visible = enabled;
    if (fillLight) fillLight.visible = enabled;
    if (shadowCatcher) shadowCatcher.visible = enabled;
    if (ctx.renderer.value?.shadowMap) {
      ctx.renderer.value.shadowMap.enabled = enabled;
    }
    syncMaterialLighting();
    syncShadowCatcherMode();
  }

  function syncSettings() {
    if (spotLight) {
      spotLight.intensity =
        SPOTLIGHT_BASE_INTENSITY * ctx.app.sceneLightingIntensity;
    }
    if (shadowCatcherMaterial) {
      shadowCatcherMaterial.opacity = ctx.app.sceneShadowOpacity;
    }
    if (coloredShadowMaterial?._opacityUniform) {
      coloredShadowMaterial._opacityUniform.value = ctx.app.sceneShadowOpacity;
    }
    syncMaterialLighting();
  }

  function syncShadowCatcherMode() {
    if (!shadowCatcher) return;
    const colored = isColoredProjectionActive() && coloredShadowMaterial;
    shadowCatcher.material = colored
      ? coloredShadowMaterial
      : shadowCatcherMaterial;
    shadowCatcher.receiveShadow = !colored;
  }

  function createTransmissionRenderTarget(renderer) {
    const coarsePointer =
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)").matches;
    const size = coarsePointer
      ? TRANSMISSION_MAP_SIZE_MOBILE
      : TRANSMISSION_MAP_SIZE_DESKTOP;
    const options = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      colorSpace: THREE.LinearSRGBColorSpace,
    };
    const target = renderer.isWebGPURenderer
      ? new THREE.RenderTarget(size, size, options)
      : new THREE.WebGLRenderTarget(size, size, options);
    target.texture.name = "RivvonColoredTransmissionMap";
    target.texture.generateMipmaps = false;
    return target;
  }

  function createColoredShadowMaterial(renderer) {
    if (renderer.isWebGPURenderer && webGPUDeps) {
      const { MeshBasicNodeMaterial } = webGPUDeps.threeWebGPU;
      const { texture, uniform, positionWorld, float, vec2, vec3, vec4, mix } =
        webGPUDeps.threeTSL;
      const opacityUniform = uniform(ctx.app.sceneShadowOpacity);
      const projectorMatrixUniform = uniform(transmissionProjectorMatrix);
      const lightClip = projectorMatrixUniform.mul(vec4(positionWorld, 1));
      const lightNdc = lightClip.xyz.div(lightClip.w);
      const receiverUv = lightNdc.xy.mul(0.5).add(0.5);
      // Render-target rows are inverted relative to the receiver plane. Leaving
      // this uncorrected mirrors the projection and reverses apparent rotation.
      const projectionUv = vec2(receiverUv.x, float(1).sub(receiverUv.y));
      const sampledTransmission = texture(
        transmissionRenderTarget.texture,
        projectionUv,
      );
      const inBounds = lightClip.w
        .greaterThan(float(0))
        .and(receiverUv.x.greaterThanEqual(float(0)))
        .and(receiverUv.x.lessThanEqual(float(1)))
        .and(receiverUv.y.greaterThanEqual(float(0)))
        .and(receiverUv.y.lessThanEqual(float(1)))
        .and(lightNdc.z.greaterThanEqual(float(-1)))
        .and(lightNdc.z.lessThanEqual(float(1)));
      const transmittedLight = inBounds.select(
        sampledTransmission.rgb,
        vec3(1, 1, 1),
      );
      const material = new MeshBasicNodeMaterial();
      material.colorNode = mix(
        vec3(1, 1, 1),
        transmittedLight,
        opacityUniform,
      );
      material.opacityNode = float(1);
      material._opacityUniform = opacityUniform;
      material._projectorMatrixUniform = projectorMatrixUniform;
      return configureMultiplicativeBlending(material);
    }

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTransmissionMap: { value: transmissionRenderTarget.texture },
        uOpacity: { value: ctx.app.sceneShadowOpacity },
        uTransmissionProjector: { value: transmissionProjectorMatrix },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uTransmissionMap;
        uniform float uOpacity;
        uniform mat4 uTransmissionProjector;
        varying vec3 vWorldPosition;
        void main() {
          vec4 lightClip = uTransmissionProjector * vec4(vWorldPosition, 1.0);
          vec3 lightNdc = lightClip.xyz / lightClip.w;
          vec2 receiverUv = lightNdc.xy * 0.5 + 0.5;
          vec2 projectionUv = vec2(receiverUv.x, 1.0 - receiverUv.y);
          bool inBounds = lightClip.w > 0.0
            && all(greaterThanEqual(receiverUv, vec2(0.0)))
            && all(lessThanEqual(receiverUv, vec2(1.0)))
            && lightNdc.z >= -1.0
            && lightNdc.z <= 1.0;
          vec3 transmission = inBounds
            ? texture2D(uTransmissionMap, projectionUv).rgb
            : vec3(1.0);
          gl_FragColor = vec4(mix(vec3(1.0), transmission, uOpacity), 1.0);
        }
      `,
    });
    material._opacityUniform = material.uniforms.uOpacity;
    return configureMultiplicativeBlending(material);
  }

  function createTransmissionMaterial(sourceMaterial) {
    if (ctx.renderer.value?.isWebGPURenderer && webGPUDeps) {
      let colorNode = sourceMaterial?._transmissionColorNode;
      let alphaNode = sourceMaterial?._transmissionAlphaNode;
      const { texture, float, vec3, mix } = webGPUDeps.threeTSL;
      if ((!colorNode || !alphaNode) && sourceMaterial?.map) {
        const sampledMap = texture(sourceMaterial.map);
        const tint = sourceMaterial.color || new THREE.Color(1, 1, 1);
        colorNode = sampledMap.rgb.mul(vec3(tint.r, tint.g, tint.b));
        alphaNode = sampledMap.a.mul(float(sourceMaterial.opacity ?? 1));
      }
      if (!colorNode || !alphaNode) return null;
      const { MeshBasicNodeMaterial } = webGPUDeps.threeWebGPU;
      const material = new MeshBasicNodeMaterial();
      material.colorNode = mix(vec3(1, 1, 1), colorNode, alphaNode);
      material.opacityNode = float(1);
      material.defaultAttributeValues = {
        ...(sourceMaterial.defaultAttributeValues || {}),
      };
      return configureMultiplicativeBlending(material);
    }

    if (sourceMaterial?.map) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: sourceMaterial.map },
          uColor: { value: sourceMaterial.color || new THREE.Color(1, 1, 1) },
          uOpacity: { value: sourceMaterial.opacity ?? 1 },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D uMap;
          uniform vec3 uColor;
          uniform float uOpacity;
          varying vec2 vUv;
          void main() {
            vec4 texel = texture2D(uMap, vUv);
            float alpha = texel.a * uOpacity;
            gl_FragColor = vec4(mix(vec3(1.0), texel.rgb * uColor, alpha), 1.0);
          }
        `,
      });
      return configureMultiplicativeBlending(material);
    }

    if (!sourceMaterial?.isShaderMaterial) return null;
    const material = sourceMaterial.clone();
    // Keep animated layer/flow uniforms synchronized with the visible material.
    material.uniforms = sourceMaterial.uniforms;
    const lightingOutputPattern =
      /outColor\s*=\s*vec4\(applyCameraKeyLighting\([\s\S]*?\),\s*texColor\.a\s*\);/;
    if (!lightingOutputPattern.test(material.fragmentShader)) {
      material.dispose();
      return null;
    }
    material.fragmentShader = material.fragmentShader.replace(
      lightingOutputPattern,
      "outColor = vec4(mix(vec3(1.0), adjustedColor, texColor.a), 1.0);",
    );
    return configureMultiplicativeBlending(material);
  }

  function getTransmissionMaterial(sourceMaterial) {
    if (!sourceMaterial) return null;
    const cached = transmissionMaterials.get(sourceMaterial.uuid);
    if (cached) return cached;
    const material = createTransmissionMaterial(sourceMaterial);
    if (material) transmissionMaterials.set(sourceMaterial.uuid, material);
    return material;
  }

  function renderTransmissionMap() {
    if (!isColoredProjectionActive() || !transmissionRenderTarget) return;
    const renderer = ctx.renderer.value;
    const scene = ctx.scene.value;
    const root = ctx.ribbonSeries.value?.getTransformRoot?.();
    if (!renderer || !scene || !root || !transmissionCamera) return;

    const materialOverrides = [];
    root.traverse((object) => {
      if (!object.isMesh || !object.visible) return;
      const originalMaterial = object.material;
      const sourceMaterials = Array.isArray(originalMaterial)
        ? originalMaterial
        : [originalMaterial];
      const replacements = sourceMaterials.map(getTransmissionMaterial);
      if (replacements.some((material) => !material)) return;
      materialOverrides.push({ object, originalMaterial });
      object.material = Array.isArray(originalMaterial)
        ? replacements
        : replacements[0];
    });

    const hiddenObjects = [];
    for (const child of scene.children) {
      if (child === root || !child.visible) continue;
      hiddenObjects.push(child);
      child.visible = false;
    }
    const savedTarget = renderer.getRenderTarget?.() ?? null;
    const savedClearColor = renderer.getClearColor(new THREE.Color());
    const savedClearAlpha = renderer.getClearAlpha();
    const savedBackground = scene.background;

    try {
      scene.background = null;
      renderer.setClearColor(0xffffff, 1);
      renderer.setRenderTarget(transmissionRenderTarget);
      renderer.clear(true, false, false);
      renderer.render(scene, transmissionCamera);
    } finally {
      renderer.setRenderTarget(savedTarget);
      renderer.setClearColor(savedClearColor, savedClearAlpha);
      scene.background = savedBackground;
      for (const child of hiddenObjects) child.visible = true;
      for (const { object, originalMaterial } of materialOverrides) {
        object.material = originalMaterial;
      }
    }
  }

  function syncShadowCatcherGeometry(width, height) {
    if (!shadowCatcherGeometry) return;
    const spherical = !!ctx.app.backgroundSphericalLayersEnabled;
    if (
      catcherWasSpherical === spherical &&
      Math.abs(catcherWidth - width) < 0.0001 &&
      Math.abs(catcherHeight - height) < 0.0001
    ) {
      return;
    }

    catcherWidth = width;
    catcherHeight = height;
    catcherWasSpherical = spherical;
    const position = shadowCatcherGeometry.attributes.position;
    const uvAttribute = shadowCatcherGeometry.attributes.uv;
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    const radialExtent = Math.hypot(halfWidth, halfHeight);
    const sphereRadius = spherical
      ? radialExtent / Math.sin(SHADOW_CATCHER_CURVE_ANGLE)
      : Infinity;

    for (let index = 0; index < position.count; index += 1) {
      const x = (uvAttribute.getX(index) - 0.5) * width;
      const y = (uvAttribute.getY(index) - 0.5) * height;
      const radialDistanceSquared = x * x + y * y;
      const z = spherical
        ? sphereRadius -
          Math.sqrt(Math.max(0, sphereRadius * sphereRadius - radialDistanceSquared))
        : 0;
      position.setXYZ(index, x, y, z);
    }

    position.needsUpdate = true;
    shadowCatcherGeometry.computeVertexNormals();
    shadowCatcherGeometry.computeBoundingSphere();
    shadowCatcherGeometry.computeBoundingBox();
  }

  function syncShadowCatcherSize() {
    const camera = ctx.camera.value;
    if (!camera || !shadowCatcher) return;

    let width;
    let height;
    if (camera.isPerspectiveCamera) {
      const catcherDistance = cameraPosition.distanceTo(shadowCatcher.position);
      const effectiveFov = camera.getEffectiveFOV?.() ?? camera.fov;
      height =
        2 *
        Math.tan(THREE.MathUtils.degToRad(effectiveFov) / 2) *
        catcherDistance *
        SHADOW_CATCHER_OVERSCAN;
      width = height * camera.aspect;
    } else if (camera.isOrthographicCamera) {
      width = (camera.right - camera.left) / camera.zoom;
      height = (camera.top - camera.bottom) / camera.zoom;
    }
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    shadowCatcher.scale.set(1, 1, 1);
    syncShadowCatcherGeometry(width, height);
  }

  function syncTransmissionProjector() {
    if (!transmissionCamera) return;
    transmissionCamera.updateMatrixWorld(true);
    transmissionProjectorMatrix.multiplyMatrices(
      transmissionCamera.projectionMatrix,
      transmissionCamera.matrixWorldInverse,
    );
    if (coloredShadowMaterial?._projectorMatrixUniform) {
      coloredShadowMaterial._projectorMatrixUniform.value =
        transmissionProjectorMatrix;
    }
  }

  function getTransmissionVerticalFov(lightToCenterDistance, aspect) {
    const positions = shadowCatcherGeometry?.attributes?.position;
    if (!positions) return 60;
    let maximumVerticalTangent = 0;
    for (let index = 0; index < positions.count; index += 1) {
      const distanceFromLight = lightToCenterDistance - positions.getZ(index);
      if (distanceFromLight <= 0.001) continue;
      maximumVerticalTangent = Math.max(
        maximumVerticalTangent,
        Math.abs(positions.getY(index)) / distanceFromLight,
        Math.abs(positions.getX(index)) / distanceFromLight / aspect,
      );
    }
    return THREE.MathUtils.radToDeg(
      2 * Math.atan(maximumVerticalTangent * SHADOW_CATCHER_OVERSCAN),
    );
  }

  async function init() {
    dispose();

    const scene = ctx.scene.value;
    const camera = ctx.camera.value;
    const renderer = ctx.renderer.value;
    if (!scene || !camera || !renderer) return;

    if (renderer.isWebGPURenderer) {
      const [threeWebGPU, threeTSL] = await Promise.all([
        import("three/webgpu"),
        import("three/tsl"),
      ]);
      webGPUDeps = { threeWebGPU, threeTSL };
    }

    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = !!ctx.app.sceneLightingEnabled;
      if (!renderer.isWebGPURenderer) {
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      }
    }

    spotLight = new THREE.SpotLight(
      0xffffff,
      SPOTLIGHT_BASE_INTENSITY * ctx.app.sceneLightingIntensity,
      250,
      THREE.MathUtils.degToRad(35),
      0.65,
      2,
    );
    spotLight.name = "RivvonCameraSpotlight";
    spotLight.castShadow = true;
    spotLight.shadow.mapSize.set(
      typeof window !== "undefined" &&
        window.matchMedia?.("(pointer: coarse)").matches
        ? 512
        : 1024,
      typeof window !== "undefined" &&
        window.matchMedia?.("(pointer: coarse)").matches
        ? 512
        : 1024,
    );
    spotLight.shadow.camera.near = 0.25;
    spotLight.shadow.camera.far = 250;
    spotLight.shadow.bias = -0.0002;
    spotLight.shadow.normalBias = 0.02;
    spotLight.shadow.radius = 2;

    spotTarget = new THREE.Object3D();
    spotTarget.name = "RivvonCameraSpotlightTarget";
    spotLight.target = spotTarget;

    fillLight = new THREE.HemisphereLight(0xffffff, 0x182030, 0.28);
    fillLight.name = "RivvonLightingFill";

    const coarsePointer =
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)").matches;
    shadowCatcherGeometry = new THREE.PlaneGeometry(
      1,
      1,
      coarsePointer ? 20 : 32,
      coarsePointer ? 14 : 24,
    );
    shadowCatcherMaterial = new THREE.ShadowMaterial({
      color: 0x000000,
      opacity: ctx.app.sceneShadowOpacity,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    transmissionRenderTarget = createTransmissionRenderTarget(renderer);
    transmissionCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 250);
    transmissionCamera.name = "RivvonTransmissionCamera";
    coloredShadowMaterial = createColoredShadowMaterial(renderer);
    shadowCatcher = new THREE.Mesh(
      shadowCatcherGeometry,
      shadowCatcherMaterial,
    );
    shadowCatcher.name = "RivvonBackgroundShadowCatcher";
    shadowCatcher.receiveShadow = true;
    shadowCatcher.frustumCulled = false;
    shadowCatcher.renderOrder = SHADOW_CATCHER_RENDER_ORDER;

    if (!camera.parent) scene.add(camera);
    scene.add(spotLight, spotTarget, fillLight, shadowCatcher);
    syncEnabledState();
    tick();
  }

  function tick() {
    const camera = ctx.camera.value;
    if (!camera || !spotLight || !spotTarget) return;

    camera.getWorldPosition(cameraPosition);
    resolveArtworkCenter(artworkCenter);
    lightAxis.subVectors(cameraPosition, artworkCenter);
    if (lightAxis.lengthSq() < 0.000001) {
      camera.getWorldDirection(lightAxis).multiplyScalar(-1);
    } else {
      lightAxis.normalize();
    }

    spotLight.position
      .copy(artworkCenter)
      .addScaledVector(lightAxis, ctx.app.sceneLightDistance);
    spotTarget.position.copy(artworkCenter);
    spotTarget.updateMatrixWorld();

    shadowCatcher.position
      .copy(artworkCenter)
      .addScaledVector(lightAxis, -ctx.app.sceneShadowPlaneDistance);
    camera.getWorldQuaternion(cameraQuaternion);
    shadowCatcher.quaternion.copy(cameraQuaternion);
    syncShadowCatcherSize();

    const lightToPlaneDistance = spotLight.position.distanceTo(
      shadowCatcher.position,
    );
    transmissionCamera.position.copy(spotLight.position);
    transmissionCamera.quaternion.copy(cameraQuaternion);
    transmissionCamera.aspect = camera.aspect;
    transmissionCamera.fov = getTransmissionVerticalFov(
      lightToPlaneDistance,
      camera.aspect,
    );
    transmissionCamera.near = 0.1;
    transmissionCamera.far = lightToPlaneDistance + 1;
    transmissionCamera.updateProjectionMatrix();
    syncTransmissionProjector();
    renderTransmissionMap();
  }

  function dispose() {
    const scene = ctx.scene.value;
    if (shadowCatcher && scene) scene.remove(shadowCatcher);
    if (spotLight && scene) scene.remove(spotLight);
    if (spotTarget && scene) scene.remove(spotTarget);
    if (fillLight && scene) scene.remove(fillLight);
    spotLight?.shadow?.map?.dispose?.();
    shadowCatcherGeometry?.dispose?.();
    shadowCatcherMaterial?.dispose?.();
    coloredShadowMaterial?.dispose?.();
    transmissionRenderTarget?.dispose?.();
    for (const material of transmissionMaterials.values()) material.dispose?.();
    transmissionMaterials.clear();
    spotLight = null;
    spotTarget = null;
    fillLight = null;
    shadowCatcher = null;
    shadowCatcherGeometry = null;
    shadowCatcherMaterial = null;
    coloredShadowMaterial = null;
    transmissionRenderTarget = null;
    transmissionCamera = null;
    webGPUDeps = null;
    catcherWidth = 0;
    catcherHeight = 0;
    catcherWasSpherical = null;
  }

  watch(() => ctx.app.sceneLightingEnabled, syncEnabledState);
  watch(() => ctx.app.sceneColoredShadowsEnabled, syncShadowCatcherMode);
  watch(() => ctx.app.backgroundSphericalLayersEnabled, () => {
    catcherWasSpherical = null;
    syncShadowCatcherSize();
  });
  watch(
    () => [ctx.app.sceneLightingIntensity, ctx.app.sceneShadowOpacity],
    syncSettings,
  );

  return {
    init,
    tick,
    dispose,
    syncMaterialLighting,
  };
}
