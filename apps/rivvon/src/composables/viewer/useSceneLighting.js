// Camera-key scene lighting and a transparent shadow catcher for the viewer.

import { watch } from "vue";
import * as THREE from "three";

const SHADOW_CATCHER_RENDER_ORDER = -9999;
const SHADOW_CATCHER_OVERSCAN = 1.02;
const SPOTLIGHT_BASE_INTENSITY = 100;

export function useSceneLighting(ctx) {
  let spotLight = null;
  let spotTarget = null;
  let fillLight = null;
  let shadowCatcher = null;
  let shadowCatcherGeometry = null;
  let shadowCatcherMaterial = null;
  const cameraPosition = new THREE.Vector3();
  const artworkCenter = new THREE.Vector3();
  const lightAxis = new THREE.Vector3();
  const cameraQuaternion = new THREE.Quaternion();

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
  }

  function syncSettings() {
    if (spotLight) {
      spotLight.intensity =
        SPOTLIGHT_BASE_INTENSITY * ctx.app.sceneLightingIntensity;
    }
    if (shadowCatcherMaterial) {
      shadowCatcherMaterial.opacity = ctx.app.sceneShadowOpacity;
    }
    syncMaterialLighting();
  }

  function syncShadowCatcherSize() {
    const camera = ctx.camera.value;
    if (!camera || !shadowCatcher) return;

    if (camera.isPerspectiveCamera) {
      const catcherDistance = cameraPosition.distanceTo(shadowCatcher.position);
      const effectiveFov = camera.getEffectiveFOV?.() ?? camera.fov;
      const height =
        2 *
        Math.tan(THREE.MathUtils.degToRad(effectiveFov) / 2) *
        catcherDistance *
        SHADOW_CATCHER_OVERSCAN;
      shadowCatcher.scale.set(height * camera.aspect, height, 1);
    } else if (camera.isOrthographicCamera) {
      shadowCatcher.scale.set(
        camera.right - camera.left,
        camera.top - camera.bottom,
        1,
      );
    }
  }

  function init() {
    dispose();

    const scene = ctx.scene.value;
    const camera = ctx.camera.value;
    const renderer = ctx.renderer.value;
    if (!scene || !camera || !renderer) return;

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

    shadowCatcherGeometry = new THREE.PlaneGeometry(1, 1);
    shadowCatcherMaterial = new THREE.ShadowMaterial({
      color: 0x000000,
      opacity: ctx.app.sceneShadowOpacity,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
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
    spotLight = null;
    spotTarget = null;
    fillLight = null;
    shadowCatcher = null;
    shadowCatcherGeometry = null;
    shadowCatcherMaterial = null;
  }

  watch(() => ctx.app.sceneLightingEnabled, syncEnabledState);
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
