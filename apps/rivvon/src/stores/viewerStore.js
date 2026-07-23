// src/stores/viewerStore.js
// Pinia store for rivvon viewer state

import { defineStore } from "pinia";
import {
  CAP_STYLE_ROUNDED,
  normalizeCapStyle,
} from "../modules/viewer/capStyle.js";
import { normalizeExportDimensionSettings } from "../modules/viewer/exportVideoDimensions.js";
import {
  EXPORT_LOGO_DEFAULT_CORNER,
  normalizeExportLogoCorner,
} from "../modules/viewer/exportLogoOverlay.js";
import {
  DEFAULT_CLOCK_SETTINGS,
  DEFAULT_SINE_WAVE_SETTINGS,
  normalizeClockSettings,
  normalizeProceduralSourceType,
  normalizeSineWaveSettings,
} from "../modules/viewer/proceduralPaths.js";
import { normalizeTextureOverviewLayoutStrategy } from "../modules/viewer/textureOverviewLayout.js";
import {
  DEFAULT_SPHERICAL_WRAP_DEGREES,
  normalizeSphericalProjectionWrapDegrees,
} from "../modules/viewer/sphericalProjection.js";
import {
  createViewerPanelVisibilityState,
  VIEWER_PANEL_KEYS,
} from "../modules/viewer/viewerPanels.js";

const VIEWER_PREFERENCES_STORAGE_KEY = "rivvon.viewer.preferences";
const PREFERRED_TEXTURE_RESOLUTION_VALUES = [256, 512, 1024];
const VIEWER_FILTER_MODES = ["none", "duotone"];
const DEFAULT_DUOTONE_COLOR = "#ff7a00";
const TRANSPARENCY_MODES = ["shadows", "highlights"];
const DEFAULT_TRANSPARENCY_MODE = "shadows";
const DEFAULT_TRANSPARENT_SHADOWS_THRESHOLD_MIN = 0.2;
const DEFAULT_TRANSPARENT_SHADOWS_THRESHOLD_MAX = 0.5;
const MIN_TRANSPARENT_SHADOWS_THRESHOLD_GAP = 0.01;
const DEFAULT_PEAK_TROUGH_GRADIENT_START = 0.65;
const DEFAULT_PEAK_TROUGH_GRADIENT_END = 1.0;
const MIN_PEAK_TROUGH_GRADIENT_GAP = 0.01;
const DEFAULT_PEAK_TROUGH_BLUR_AMOUNT = 4.0;
const MIN_PEAK_TROUGH_BLUR_AMOUNT = 1.0;
const MAX_PEAK_TROUGH_BLUR_AMOUNT = 16.0;
const MIN_RIBBON_WIDTH_SCALE = 0.1;
const MAX_RIBBON_WIDTH_SCALE = 2.5;
const DEFAULT_EDGE_NOISE_TRANSPARENCY_MAX = 0.5;
const MAX_EDGE_NOISE_TRANSPARENCY = 0.5;
const DEFAULT_EDGE_DRIFT_ENABLED = false;
const DEFAULT_EDGE_NOISE_PATTERN_LENGTH = 0.5;
const MIN_EDGE_NOISE_PATTERN_LENGTH = 0.1;
const MAX_EDGE_NOISE_PATTERN_LENGTH = 2;
const DEFAULT_FILMSTRIP_STYLE_ENABLED = false;
const DEFAULT_FILMSTRIP_GAP_LENGTH = 0.4;
const MIN_FILMSTRIP_GAP_LENGTH = 0.05;
const MAX_FILMSTRIP_GAP_LENGTH = 2;
const DEFAULT_FILMSTRIP_HOLE_LENGTH = 0.4;
const MIN_FILMSTRIP_HOLE_LENGTH = 0.05;
const MAX_FILMSTRIP_HOLE_LENGTH = 1;
const DEFAULT_FILMSTRIP_APERTURE = 0.45;
const MIN_FILMSTRIP_APERTURE = 0.1;
const MAX_FILMSTRIP_APERTURE = 0.95;
const DEFAULT_FILMSTRIP_HOLE_ROUNDEDNESS = 0.7;
const MIN_FILMSTRIP_HOLE_ROUNDEDNESS = 0;
const MAX_FILMSTRIP_HOLE_ROUNDEDNESS = 1;
const DEFAULT_CONTRAST = 1.0;
const MIN_CONTRAST = 0.0;
const MAX_CONTRAST = 2.0;
const DEFAULT_SATURATION = 1.0;
const MIN_SATURATION = 0.0;
const MAX_SATURATION = 2.0;
const DEFAULT_BACKGROUND_BLUR_AMOUNT = 8.0;
const MIN_BACKGROUND_BLUR_AMOUNT = 1.0;
const MAX_BACKGROUND_BLUR_AMOUNT = 50.0;
const DEFAULT_BACKGROUND_FLOW_SPEED = 0.25;
const MIN_BACKGROUND_FLOW_SPEED = 0.05;
const MAX_BACKGROUND_FLOW_SPEED = 2.0;
const DEFAULT_BACKGROUND_OVERLAY_COLOR = "#ffffff";
const DEFAULT_BACKGROUND_OVERLAY_OPACITY = 0.35;
const RIBBON_PATH_ALIGNMENT_MODES = ["inside", "center", "outside"];
const SURFACE_MODES = ["ribbon", "tube"];
const DEFAULT_TUBE_RADIUS_SCALE = 0.5;
const DEFAULT_TUBE_RADIAL_SEGMENTS = 8;
const DEFAULT_TUBE_TEXTURE_JOIN_OFFSET_DEGREES = 0;
function getDefaultPreferredTextureMaxResolution() {
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
  ) {
    return window.matchMedia("(pointer: coarse)").matches ? 256 : 512;
  }

  return 512;
}

function normalizePreferredTextureMaxResolution(value) {
  const parsed = Number(value);
  return PREFERRED_TEXTURE_RESOLUTION_VALUES.includes(parsed)
    ? parsed
    : getDefaultPreferredTextureMaxResolution();
}

function normalizeViewerFilterMode(value) {
  return VIEWER_FILTER_MODES.includes(value) ? value : "none";
}

function normalizeDuotoneColor(value) {
  if (typeof value !== "string") {
    return DEFAULT_DUOTONE_COLOR;
  }

  const normalized = value.trim().replace(/^#/, "").toLowerCase();

  if (/^[0-9a-f]{3}$/.test(normalized)) {
    return `#${normalized
      .split("")
      .map((char) => `${char}${char}`)
      .join("")}`;
  }

  return /^[0-9a-f]{6}$/.test(normalized)
    ? `#${normalized}`
    : DEFAULT_DUOTONE_COLOR;
}

function normalizeTransparencyMode(value) {
  return TRANSPARENCY_MODES.includes(value) ? value : DEFAULT_TRANSPARENCY_MODE;
}

function normalizeContrast(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_CONTRAST;
  return Math.min(MAX_CONTRAST, Math.max(MIN_CONTRAST, parsed));
}

function normalizeSaturation(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SATURATION;
  return Math.min(MAX_SATURATION, Math.max(MIN_SATURATION, parsed));
}

function normalizeBackgroundBlurAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_BACKGROUND_BLUR_AMOUNT;
  return Math.min(
    MAX_BACKGROUND_BLUR_AMOUNT,
    Math.max(MIN_BACKGROUND_BLUR_AMOUNT, parsed),
  );
}

function normalizeBackgroundFlowSpeed(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_BACKGROUND_FLOW_SPEED;
  return Math.min(
    MAX_BACKGROUND_FLOW_SPEED,
    Math.max(MIN_BACKGROUND_FLOW_SPEED, parsed),
  );
}

function normalizeBackgroundOverlayOpacity(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_BACKGROUND_OVERLAY_OPACITY;
  return Math.min(1, Math.max(0, parsed));
}

function normalizeBackgroundOverlayColor(value) {
  if (typeof value !== "string") {
    return DEFAULT_BACKGROUND_OVERLAY_COLOR;
  }

  const normalized = value.trim().replace(/^#/, "").toLowerCase();

  if (/^[0-9a-f]{3}$/.test(normalized)) {
    return `#${normalized
      .split("")
      .map((char) => `${char}${char}`)
      .join("")}`;
  }

  return /^[0-9a-f]{6}$/.test(normalized)
    ? `#${normalized}`
    : DEFAULT_BACKGROUND_OVERLAY_COLOR;
}

function normalizeTransparentShadowsThresholdValue(value, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, parsed));
}

function normalizeTransparentShadowsThresholdRange(minValue, maxValue) {
  let minThreshold = normalizeTransparentShadowsThresholdValue(
    minValue,
    DEFAULT_TRANSPARENT_SHADOWS_THRESHOLD_MIN,
  );
  let maxThreshold = normalizeTransparentShadowsThresholdValue(
    maxValue,
    DEFAULT_TRANSPARENT_SHADOWS_THRESHOLD_MAX,
  );

  if (maxThreshold < minThreshold) {
    [minThreshold, maxThreshold] = [maxThreshold, minThreshold];
  }

  if (maxThreshold - minThreshold < MIN_TRANSPARENT_SHADOWS_THRESHOLD_GAP) {
    if (minThreshold + MIN_TRANSPARENT_SHADOWS_THRESHOLD_GAP <= 1) {
      maxThreshold = minThreshold + MIN_TRANSPARENT_SHADOWS_THRESHOLD_GAP;
    } else {
      minThreshold = Math.max(
        0,
        maxThreshold - MIN_TRANSPARENT_SHADOWS_THRESHOLD_GAP,
      );
    }
  }

  return {
    min: minThreshold,
    max: maxThreshold,
  };
}

function normalizePeakTroughGradientRange(startValue, endValue) {
  let start = normalizeTransparentShadowsThresholdValue(
    startValue,
    DEFAULT_PEAK_TROUGH_GRADIENT_START,
  );
  let end = normalizeTransparentShadowsThresholdValue(
    endValue,
    DEFAULT_PEAK_TROUGH_GRADIENT_END,
  );

  if (end < start) {
    [start, end] = [end, start];
  }

  if (end - start < MIN_PEAK_TROUGH_GRADIENT_GAP) {
    if (start + MIN_PEAK_TROUGH_GRADIENT_GAP <= 1) {
      end = start + MIN_PEAK_TROUGH_GRADIENT_GAP;
    } else {
      start = Math.max(0, end - MIN_PEAK_TROUGH_GRADIENT_GAP);
    }
  }

  return { start, end };
}

function normalizePeakTroughBlurAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_PEAK_TROUGH_BLUR_AMOUNT;
  }

  return Math.min(
    MAX_PEAK_TROUGH_BLUR_AMOUNT,
    Math.max(MIN_PEAK_TROUGH_BLUR_AMOUNT, parsed),
  );
}

function normalizeRibbonWidthScale(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.min(
    MAX_RIBBON_WIDTH_SCALE,
    Math.max(MIN_RIBBON_WIDTH_SCALE, parsed),
  );
}

function normalizeEdgeNoiseTransparencyMax(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_EDGE_NOISE_TRANSPARENCY_MAX;
  }

  return Math.min(MAX_EDGE_NOISE_TRANSPARENCY, Math.max(0, parsed));
}

function normalizeEdgeNoisePatternLength(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_EDGE_NOISE_PATTERN_LENGTH;
  }

  return Math.min(
    MAX_EDGE_NOISE_PATTERN_LENGTH,
    Math.max(MIN_EDGE_NOISE_PATTERN_LENGTH, parsed),
  );
}

function normalizeFilmstripGapLength(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_FILMSTRIP_GAP_LENGTH;
  }

  return Math.min(
    MAX_FILMSTRIP_GAP_LENGTH,
    Math.max(MIN_FILMSTRIP_GAP_LENGTH, parsed),
  );
}

function normalizeFilmstripHoleLength(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_FILMSTRIP_HOLE_LENGTH;
  }

  return Math.min(
    MAX_FILMSTRIP_HOLE_LENGTH,
    Math.max(MIN_FILMSTRIP_HOLE_LENGTH, parsed),
  );
}

function normalizeFilmstripAperture(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_FILMSTRIP_APERTURE;
  }

  return Math.min(
    MAX_FILMSTRIP_APERTURE,
    Math.max(MIN_FILMSTRIP_APERTURE, parsed),
  );
}

function normalizeFilmstripHoleRoundedness(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_FILMSTRIP_HOLE_ROUNDEDNESS;
  }

  return Math.min(
    MAX_FILMSTRIP_HOLE_ROUNDEDNESS,
    Math.max(MIN_FILMSTRIP_HOLE_ROUNDEDNESS, parsed),
  );
}

function normalizeRibbonPathAlignmentMode(value) {
  return RIBBON_PATH_ALIGNMENT_MODES.includes(value) ? value : "center";
}

function normalizeSurfaceMode(value) {
  return SURFACE_MODES.includes(value) ? value : "ribbon";
}

function normalizeTubeRadiusScale(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0.1, Math.min(1, parsed))
    : DEFAULT_TUBE_RADIUS_SCALE;
}

function normalizeTubeRadialSegments(value) {
  const parsed = Math.round(Number(value));
  const clamped = Number.isFinite(parsed)
    ? Math.max(4, Math.min(24, parsed))
    : DEFAULT_TUBE_RADIAL_SEGMENTS;
  return clamped % 2 === 0 ? clamped : Math.min(24, clamped + 1);
}

function normalizeTubeTextureJoinOffsetDegrees(value) {
  const parsed = Math.round(Number(value));

  if (!Number.isFinite(parsed)) {
    return DEFAULT_TUBE_TEXTURE_JOIN_OFFSET_DEGREES;
  }

  return Math.max(0, Math.min(359, parsed));
}

function normalizeViewerBooleanPreference(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function setViewerFlag(store, key, value) {
  store[key] = value;
}

function showViewerFlag(store, key) {
  setViewerFlag(store, key, true);
}

function hideViewerFlag(store, key) {
  setViewerFlag(store, key, false);
}

function toggleViewerFlag(store, key) {
  setViewerFlag(store, key, !store[key]);
}

function readViewerPreferences() {
  if (typeof window === "undefined" || !window.localStorage) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(VIEWER_PREFERENCES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.warn("[ViewerStore] Failed to read viewer preferences:", error);
    return {};
  }
}

function writeViewerPreferences(patch) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    const current = readViewerPreferences();
    window.localStorage.setItem(
      VIEWER_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        ...current,
        ...patch,
      }),
    );
  } catch (error) {
    console.warn("[ViewerStore] Failed to persist viewer preferences:", error);
  }
}

function getStoredExportDimensionSettings() {
  return normalizeExportDimensionSettings(readViewerPreferences());
}

function getStoredExportLogoSettings() {
  const preferences = readViewerPreferences();

  return {
    exportLogoOverlayEnabled: normalizeViewerBooleanPreference(
      preferences.exportLogoOverlayEnabled,
      true,
    ),
    exportLogoOverlayCorner: normalizeExportLogoCorner(
      preferences.exportLogoOverlayCorner,
      EXPORT_LOGO_DEFAULT_CORNER,
    ),
  };
}

function getStoredFilterSettings() {
  const preferences = readViewerPreferences();
  const transparentShadowsThresholds =
    normalizeTransparentShadowsThresholdRange(
      preferences.transparentShadowsThresholdMin,
      preferences.transparentShadowsThresholdMax,
    );

  return {
    renderFilterMode: normalizeViewerFilterMode(preferences.renderFilterMode),
    transparentShadowsEnabled: normalizeViewerBooleanPreference(
      preferences.transparentShadowsEnabled,
      preferences.renderFilterMode === "transparentShadows",
    ),
    transparencyMode: normalizeTransparencyMode(preferences.transparencyMode),
    transparentShadowsThresholdMin: transparentShadowsThresholds.min,
    transparentShadowsThresholdMax: transparentShadowsThresholds.max,
    duotoneColor: normalizeDuotoneColor(preferences.duotoneColor),
    contrast: normalizeContrast(preferences.contrast),
    saturation: normalizeSaturation(preferences.saturation),
  };
}

export const useViewerStore = defineStore("viewer", {
  state: () => {
    const exportDimensionSettings = getStoredExportDimensionSettings();
    const storedExportLogoSettings = getStoredExportLogoSettings();
    const storedFilterSettings = getStoredFilterSettings();
    const storedPeakTroughPreferences = readViewerPreferences();
    const storedPeakTroughGradient = normalizePeakTroughGradientRange(
      storedPeakTroughPreferences.peakTroughGradientStart,
      storedPeakTroughPreferences.peakTroughGradientEnd,
    );
    const storedPeakTroughTransparencyEnabled =
      normalizeViewerBooleanPreference(
        storedPeakTroughPreferences.peakTroughTransparencyEnabled,
        false,
      );
    const storedPeakTroughBlurEnabled =
      !storedPeakTroughTransparencyEnabled &&
      normalizeViewerBooleanPreference(
        storedPeakTroughPreferences.peakTroughBlurEnabled,
        false,
      );
    const panelVisibilityState = createViewerPanelVisibilityState();

    return {
      // Renderer state
      rendererType: "webgl", // 'webgl' | 'webgpu'

      // Drawing state
      isDrawingMode: false,
      strokeCount: 0,
      countdownSeconds: null,
      countdownProgress: 0,
      inFinalCountdown: false,
      proceduralPathMode: null,
      proceduralSourceType: "sineWave",
      sineWaveSettings: { ...DEFAULT_SINE_WAVE_SETTINGS },
      clockSettings: { ...DEFAULT_CLOCK_SETTINGS },

      // Walk capture state
      isWalkMode: false,
      walkPointCount: 0,

      // Viewer control mode
      viewerControlMode: "orbit", // 'orbit' | 'headTracking' | 'mouseTilt' | 'scrollTilt'
      scrollDrivenTiltEnabled: normalizeViewerBooleanPreference(
        readViewerPreferences().scrollDrivenTiltEnabled,
        true,
      ),
      scrollDrivenLayerCycleEnabled: normalizeViewerBooleanPreference(
        readViewerPreferences().scrollDrivenLayerCycleEnabled,
        true,
      ),
      scrollDrivenFlowEnabled: normalizeViewerBooleanPreference(
        readViewerPreferences().scrollDrivenFlowEnabled,
        false,
      ),
      headTrackingSupported: null,
      headTrackingActive: false,
      headTrackingCalibrating: false,
      headTrackingStatusMessage: "",
      headTrackingErrorMessage: "",
      headTrackingSuspendedReason: null,
      headTrackingRecenterToken: 0,
      screenWakeLockEnabled: normalizeViewerBooleanPreference(
        readViewerPreferences().screenWakeLockEnabled,
        true,
      ),
      screenWakeLockSupported: null,
      screenWakeLockActive: false,
      screenWakeLockErrorMessage: "",

      // Ribbon/3D state
      flowState: "off", // 'off' | 'forward' | 'backward'
      flowSpeed: 0.25, // Base flow speed (positive value)
      flowCycleAlignmentEnabled: normalizeViewerBooleanPreference(
        readViewerPreferences().flowCycleAlignmentEnabled,
        true,
      ),
      textureAnimationEnabled: normalizeViewerBooleanPreference(
        readViewerPreferences().textureAnimationEnabled,
        true,
      ),
      animatedBackgroundEnabled: normalizeViewerBooleanPreference(
        readViewerPreferences().animatedBackgroundEnabled,
        false,
      ),
      backgroundFlipVertical: normalizeViewerBooleanPreference(
        readViewerPreferences().backgroundFlipVertical,
        false,
      ),
      backgroundFlowEnabled: normalizeViewerBooleanPreference(
        readViewerPreferences().backgroundFlowEnabled,
        false,
      ),
      backgroundFlowSpeed: normalizeBackgroundFlowSpeed(
        readViewerPreferences().backgroundFlowSpeed,
      ),
      backgroundBlurEnabled: normalizeViewerBooleanPreference(
        readViewerPreferences().backgroundBlurEnabled,
        true,
      ),
      backgroundBlurAmount: normalizeBackgroundBlurAmount(
        readViewerPreferences().backgroundBlurAmount,
      ),
      backgroundOverlayEnabled: normalizeViewerBooleanPreference(
        readViewerPreferences().backgroundOverlayEnabled,
        false,
      ),
      backgroundOverlayColor: normalizeBackgroundOverlayColor(
        readViewerPreferences().backgroundOverlayColor,
      ),
      backgroundOverlayOpacity: normalizeBackgroundOverlayOpacity(
        readViewerPreferences().backgroundOverlayOpacity,
      ),
      textureAnimationReversed: normalizeViewerBooleanPreference(
        readViewerPreferences().textureAnimationReversed,
        false,
      ),
      peakTroughTransparencyEnabled: storedPeakTroughTransparencyEnabled,
      peakTroughBlurEnabled: storedPeakTroughBlurEnabled,
      peakTroughBlurAmount: normalizePeakTroughBlurAmount(
        storedPeakTroughPreferences.peakTroughBlurAmount,
      ),
      peakTroughGradientStart: storedPeakTroughGradient.start,
      peakTroughGradientEnd: storedPeakTroughGradient.end,
      undulationEnabled: normalizeViewerBooleanPreference(
        readViewerPreferences().undulationEnabled,
        true,
      ),

      // Helix mode
      helixMode: false,
      helixRadius: 0.2, // Distance each strand sits from the spine
      helixPitch: 9.0, // Number of full turns along the ribbon length
      helixStrandWidth: 0.5, // Width of each helical ribbon strip (fraction of original width)
      ribbonWidthScale: normalizeRibbonWidthScale(
        readViewerPreferences().ribbonWidthScale,
      ),
      ribbonPathAlignmentMode: normalizeRibbonPathAlignmentMode(
        readViewerPreferences().ribbonPathAlignmentMode,
      ),
      surfaceMode: normalizeSurfaceMode(readViewerPreferences().surfaceMode),
      tubeRadiusScale: normalizeTubeRadiusScale(
        readViewerPreferences().tubeRadiusScale,
      ),
      tubeRadialSegments: normalizeTubeRadialSegments(
        readViewerPreferences().tubeRadialSegments,
      ),
      tubeTextureJoinOffsetDegrees: normalizeTubeTextureJoinOffsetDegrees(
        readViewerPreferences().tubeTextureJoinOffsetDegrees,
      ),

      // Geometry options
      capStyle: CAP_STYLE_ROUNDED,
      roundedCaps: true, // Legacy alias for capStyle === 'rounded'
      cornerNarrowingEnabled: false,
      sphericalProjectionEnabled: normalizeViewerBooleanPreference(
        readViewerPreferences().sphericalProjectionEnabled,
        false,
      ),
      sphericalProjectionWrapDegrees: normalizeSphericalProjectionWrapDegrees(
        readViewerPreferences().sphericalProjectionWrapDegrees,
      ),

      // Texture state
      textureRepeatMode: "mirrorTile", // 'wrap' | 'mirrorTile'
      normalizeTextureOrientation: normalizeViewerBooleanPreference(
        readViewerPreferences().normalizeTextureOrientation,
        true,
      ),
      textureFlipVertical: normalizeViewerBooleanPreference(
        readViewerPreferences().textureFlipVertical,
        normalizeViewerBooleanPreference(
          readViewerPreferences().textureOverviewFlipVertical,
          false,
        ),
      ),
      textureOverviewLayoutStrategy: normalizeTextureOverviewLayoutStrategy(
        readViewerPreferences().textureOverviewLayoutStrategy,
      ),
      exportAspectRatioPreset: exportDimensionSettings.aspectRatioPreset,
      exportResolutionPreset: exportDimensionSettings.resolutionPreset,
      exportCustomWidth: exportDimensionSettings.customWidth,
      exportCustomHeight: exportDimensionSettings.customHeight,
      exportLogoOverlayEnabled:
        storedExportLogoSettings.exportLogoOverlayEnabled,
      exportLogoOverlayCorner: storedExportLogoSettings.exportLogoOverlayCorner,
      preferredTextureMaxResolution: normalizePreferredTextureMaxResolution(
        readViewerPreferences().preferredTextureMaxResolution,
      ),
      renderFilterMode: storedFilterSettings.renderFilterMode,
      transparentShadowsEnabled: storedFilterSettings.transparentShadowsEnabled,
      transparencyMode: storedFilterSettings.transparencyMode,
      transparentShadowsThresholdMin:
        storedFilterSettings.transparentShadowsThresholdMin,
      transparentShadowsThresholdMax:
        storedFilterSettings.transparentShadowsThresholdMax,
      edgeDriftEnabled: normalizeViewerBooleanPreference(
        readViewerPreferences().edgeDriftEnabled,
        DEFAULT_EDGE_DRIFT_ENABLED,
      ),
      edgeNoiseTransparencyMax: normalizeEdgeNoiseTransparencyMax(
        readViewerPreferences().edgeNoiseTransparencyMax,
      ),
      edgeNoisePatternLength: normalizeEdgeNoisePatternLength(
        readViewerPreferences().edgeNoisePatternLength,
      ),
      edgeNoiseMirrored: normalizeViewerBooleanPreference(
        readViewerPreferences().edgeNoiseMirrored,
        false,
      ),
      filmstripStyleEnabled: normalizeViewerBooleanPreference(
        readViewerPreferences().filmstripStyleEnabled,
        DEFAULT_FILMSTRIP_STYLE_ENABLED,
      ),
      filmstripGapLength: normalizeFilmstripGapLength(
        readViewerPreferences().filmstripGapLength ??
          readViewerPreferences().filmstripHoleSpacing,
      ),
      filmstripHoleLength: normalizeFilmstripHoleLength(
        readViewerPreferences().filmstripHoleLength ??
          readViewerPreferences().filmstripHoleSpacing,
      ),
      filmstripAperture: normalizeFilmstripAperture(
        readViewerPreferences().filmstripAperture ??
          readViewerPreferences().filmstripHoleSize,
      ),
      filmstripHoleRoundedness: normalizeFilmstripHoleRoundedness(
        readViewerPreferences().filmstripHoleRoundedness,
      ),
      duotoneColor: storedFilterSettings.duotoneColor,
      contrast: storedFilterSettings.contrast,
      saturation: storedFilterSettings.saturation,
      currentTextureId: null,
      currentTextureName: "",
      currentTextureDescription: "",
      activeTextureCrossSectionType: null,
      thumbnailUrl: null,
      activeTextureIds: [], // Array of texture IDs when multi-texture is active
      multiTextureActive: false, // True when multiple textures are loaded simultaneously
      showTextureMetadataOverlay: normalizeViewerBooleanPreference(
        readViewerPreferences().showTextureMetadataOverlay,
        false,
      ),

      // Viewer panel visibility state
      ...panelVisibilityState,

      // Text to SVG
      selectedFont: null,

      // Tools panel
      toolsPanelOriginalState: null, // Captured state snapshot when tools panel opens

      // UI state
      betaModalVisible: false,
      betaModalReason: null, // 'default' | 'texture-auth' | 'access-denied'
      debugMode: false,
      isFullscreen: false,

      // Three.js references (set by composable)
      threeContext: null,

      // Suspension state — true when viewer is paused to free resources for Slyce
      isSuspended: false,

      // Full resource release state (interventions 5+6)
      resourcesReleased: false,
      isReinitializing: false,
      reinitCallback: null,
    };
  },

  actions: {
    setDrawingMode(enabled) {
      this.isDrawingMode = enabled;

      if (enabled) {
        this.isWalkMode = false;
        this.walkPointCount = 0;
      } else {
        this.strokeCount = 0;
        this.countdownSeconds = null;
        this.countdownProgress = 0;
        this.inFinalCountdown = false;
      }
    },

    setWalkMode(enabled) {
      this.isWalkMode = enabled;

      if (enabled) {
        this.isDrawingMode = false;
        this.strokeCount = 0;
        this.countdownSeconds = null;
        this.countdownProgress = 0;
        this.inFinalCountdown = false;
      } else {
        this.walkPointCount = 0;
      }
    },

    setProceduralPathMode(mode) {
      if (mode == null) {
        this.proceduralPathMode = null;
        return;
      }

      const nextType = normalizeProceduralSourceType(mode);
      this.proceduralPathMode = nextType;
      this.proceduralSourceType = nextType;
    },

    setProceduralSourceType(type) {
      this.proceduralSourceType = normalizeProceduralSourceType(type);
    },

    setSineWaveSettings(settings = {}) {
      this.sineWaveSettings = normalizeSineWaveSettings({
        ...this.sineWaveSettings,
        ...settings,
      });
    },

    setClockSettings(settings = {}) {
      this.clockSettings = normalizeClockSettings({
        ...this.clockSettings,
        ...settings,
      });
    },

    resetSineWaveSettings() {
      this.sineWaveSettings = { ...DEFAULT_SINE_WAVE_SETTINGS };
    },

    resetClockSettings() {
      this.clockSettings = { ...DEFAULT_CLOCK_SETTINGS };
    },

    setViewerControlMode(mode) {
      if (
        mode === "headTracking" ||
        mode === "mouseTilt" ||
        mode === "scrollTilt"
      ) {
        this.viewerControlMode = mode;
      } else {
        this.viewerControlMode = "orbit";
      }
    },

    resetToolbarSettingsToDefaults() {
      const defaultExportDimensions = normalizeExportDimensionSettings({});

      this.viewerControlMode = "orbit";
      this.scrollDrivenTiltEnabled = true;
      this.scrollDrivenLayerCycleEnabled = true;
      this.scrollDrivenFlowEnabled = false;
      this.flowState = "off";
      this.flowSpeed = 0.25;
      this.undulationEnabled = true;
      this.flowCycleAlignmentEnabled = true;
      this.textureAnimationEnabled = true;
      this.animatedBackgroundEnabled = false;
      this.backgroundFlipVertical = false;
      this.backgroundFlowEnabled = false;
      this.backgroundFlowSpeed = DEFAULT_BACKGROUND_FLOW_SPEED;
      this.backgroundBlurEnabled = true;
      this.backgroundBlurAmount = DEFAULT_BACKGROUND_BLUR_AMOUNT;
      this.backgroundOverlayEnabled = false;
      this.backgroundOverlayColor = DEFAULT_BACKGROUND_OVERLAY_COLOR;
      this.backgroundOverlayOpacity = DEFAULT_BACKGROUND_OVERLAY_OPACITY;
      this.textureAnimationReversed = false;
      this.peakTroughTransparencyEnabled = false;
      this.peakTroughBlurEnabled = false;
      this.peakTroughBlurAmount = DEFAULT_PEAK_TROUGH_BLUR_AMOUNT;
      this.peakTroughGradientStart = DEFAULT_PEAK_TROUGH_GRADIENT_START;
      this.peakTroughGradientEnd = DEFAULT_PEAK_TROUGH_GRADIENT_END;
      this.textureRepeatMode = "mirrorTile";
      this.normalizeTextureOrientation = true;
      this.textureFlipVertical = false;
      this.textureOverviewLayoutStrategy =
        normalizeTextureOverviewLayoutStrategy(undefined);
      this.exportAspectRatioPreset = defaultExportDimensions.aspectRatioPreset;
      this.exportResolutionPreset = defaultExportDimensions.resolutionPreset;
      this.exportCustomWidth = defaultExportDimensions.customWidth;
      this.exportCustomHeight = defaultExportDimensions.customHeight;
      this.exportLogoOverlayEnabled = true;
      this.exportLogoOverlayCorner = EXPORT_LOGO_DEFAULT_CORNER;
      this.preferredTextureMaxResolution =
        getDefaultPreferredTextureMaxResolution();
      this.renderFilterMode = "none";
      this.transparentShadowsEnabled = false;
      this.transparencyMode = DEFAULT_TRANSPARENCY_MODE;
      this.transparentShadowsThresholdMin =
        DEFAULT_TRANSPARENT_SHADOWS_THRESHOLD_MIN;
      this.transparentShadowsThresholdMax =
        DEFAULT_TRANSPARENT_SHADOWS_THRESHOLD_MAX;
      this.edgeDriftEnabled = DEFAULT_EDGE_DRIFT_ENABLED;
      this.edgeNoiseTransparencyMax = DEFAULT_EDGE_NOISE_TRANSPARENCY_MAX;
      this.edgeNoisePatternLength = DEFAULT_EDGE_NOISE_PATTERN_LENGTH;
      this.edgeNoiseMirrored = false;
      this.filmstripStyleEnabled = DEFAULT_FILMSTRIP_STYLE_ENABLED;
      this.filmstripGapLength = DEFAULT_FILMSTRIP_GAP_LENGTH;
      this.filmstripHoleLength = DEFAULT_FILMSTRIP_HOLE_LENGTH;
      this.filmstripAperture = DEFAULT_FILMSTRIP_APERTURE;
      this.filmstripHoleRoundedness = DEFAULT_FILMSTRIP_HOLE_ROUNDEDNESS;
      this.duotoneColor = DEFAULT_DUOTONE_COLOR;
      this.contrast = DEFAULT_CONTRAST;
      this.saturation = DEFAULT_SATURATION;
      this.ribbonWidthScale = 1;
      this.ribbonPathAlignmentMode = "center";
      this.surfaceMode = "ribbon";
      this.tubeRadiusScale = DEFAULT_TUBE_RADIUS_SCALE;
      this.tubeRadialSegments = DEFAULT_TUBE_RADIAL_SEGMENTS;
      this.tubeTextureJoinOffsetDegrees =
        DEFAULT_TUBE_TEXTURE_JOIN_OFFSET_DEGREES;
      this.helixMode = false;
      this.helixRadius = 0.2;
      this.helixPitch = 9.0;
      this.helixStrandWidth = 0.5;
      this.capStyle = CAP_STYLE_ROUNDED;
      this.roundedCaps = true;
      this.cornerNarrowingEnabled = false;
      this.sphericalProjectionEnabled = false;
      this.sphericalProjectionWrapDegrees = DEFAULT_SPHERICAL_WRAP_DEGREES;
      this.showTextureMetadataOverlay = false;
      this.screenWakeLockEnabled = true;
      this.clearHeadTrackingFeedback();

      writeViewerPreferences({
        scrollDrivenTiltEnabled: true,
        scrollDrivenLayerCycleEnabled: true,
        scrollDrivenFlowEnabled: false,
        flowCycleAlignmentEnabled: true,
        textureAnimationEnabled: true,
        animatedBackgroundEnabled: false,
        backgroundFlipVertical: false,
        backgroundFlowEnabled: false,
        backgroundFlowSpeed: DEFAULT_BACKGROUND_FLOW_SPEED,
        backgroundBlurEnabled: true,
        backgroundBlurAmount: DEFAULT_BACKGROUND_BLUR_AMOUNT,
        backgroundOverlayEnabled: false,
        backgroundOverlayColor: DEFAULT_BACKGROUND_OVERLAY_COLOR,
        backgroundOverlayOpacity: DEFAULT_BACKGROUND_OVERLAY_OPACITY,
        textureAnimationReversed: false,
        peakTroughTransparencyEnabled: false,
        peakTroughBlurEnabled: false,
        peakTroughBlurAmount: DEFAULT_PEAK_TROUGH_BLUR_AMOUNT,
        peakTroughGradientStart: DEFAULT_PEAK_TROUGH_GRADIENT_START,
        peakTroughGradientEnd: DEFAULT_PEAK_TROUGH_GRADIENT_END,
        normalizeTextureOrientation: true,
        textureFlipVertical: false,
        textureOverviewFlipVertical: false,
        textureOverviewLayoutStrategy: this.textureOverviewLayoutStrategy,
        exportAspectRatioPreset: this.exportAspectRatioPreset,
        exportResolutionPreset: this.exportResolutionPreset,
        exportCustomWidth: this.exportCustomWidth,
        exportCustomHeight: this.exportCustomHeight,
        exportLogoOverlayEnabled: true,
        exportLogoOverlayCorner: EXPORT_LOGO_DEFAULT_CORNER,
        preferredTextureMaxResolution: this.preferredTextureMaxResolution,
        renderFilterMode: "none",
        transparentShadowsEnabled: false,
        transparencyMode: DEFAULT_TRANSPARENCY_MODE,
        transparentShadowsThresholdMin:
          DEFAULT_TRANSPARENT_SHADOWS_THRESHOLD_MIN,
        transparentShadowsThresholdMax:
          DEFAULT_TRANSPARENT_SHADOWS_THRESHOLD_MAX,
        edgeDriftEnabled: DEFAULT_EDGE_DRIFT_ENABLED,
        edgeNoiseTransparencyMax: DEFAULT_EDGE_NOISE_TRANSPARENCY_MAX,
        edgeNoisePatternLength: DEFAULT_EDGE_NOISE_PATTERN_LENGTH,
        edgeNoiseMirrored: false,
        filmstripStyleEnabled: DEFAULT_FILMSTRIP_STYLE_ENABLED,
        filmstripGapLength: DEFAULT_FILMSTRIP_GAP_LENGTH,
        filmstripHoleLength: DEFAULT_FILMSTRIP_HOLE_LENGTH,
        filmstripAperture: DEFAULT_FILMSTRIP_APERTURE,
        filmstripHoleRoundedness: DEFAULT_FILMSTRIP_HOLE_ROUNDEDNESS,
        filmstripHoleSpacing: DEFAULT_FILMSTRIP_GAP_LENGTH,
        filmstripHoleSize: DEFAULT_FILMSTRIP_APERTURE,
        duotoneColor: DEFAULT_DUOTONE_COLOR,
        contrast: DEFAULT_CONTRAST,
        saturation: DEFAULT_SATURATION,
        undulationEnabled: true,
        surfaceMode: "ribbon",
        tubeRadiusScale: DEFAULT_TUBE_RADIUS_SCALE,
        tubeRadialSegments: DEFAULT_TUBE_RADIAL_SEGMENTS,
        tubeTextureJoinOffsetDegrees: DEFAULT_TUBE_TEXTURE_JOIN_OFFSET_DEGREES,
        sphericalProjectionEnabled: false,
        sphericalProjectionWrapDegrees: DEFAULT_SPHERICAL_WRAP_DEGREES,
        showTextureMetadataOverlay: false,
        screenWakeLockEnabled: true,
      });
    },

    setScrollDrivenTiltEnabled(enabled) {
      const nextValue = !!enabled;
      this.scrollDrivenTiltEnabled = nextValue;
      writeViewerPreferences({ scrollDrivenTiltEnabled: nextValue });
    },

    setScrollDrivenLayerCycleEnabled(enabled) {
      const nextValue = !!enabled;
      this.scrollDrivenLayerCycleEnabled = nextValue;
      writeViewerPreferences({ scrollDrivenLayerCycleEnabled: nextValue });
    },

    setScrollDrivenFlowEnabled(enabled) {
      const nextValue = !!enabled;
      this.scrollDrivenFlowEnabled = nextValue;
      writeViewerPreferences({ scrollDrivenFlowEnabled: nextValue });
    },

    setHeadTrackingSupported(supported) {
      this.headTrackingSupported = supported == null ? null : !!supported;
    },

    setHeadTrackingRuntimeState(payload = {}) {
      if ("supported" in payload) {
        this.headTrackingSupported =
          payload.supported == null ? null : !!payload.supported;
      }
      if ("active" in payload) {
        this.headTrackingActive = !!payload.active;
      }
      if ("calibrating" in payload) {
        this.headTrackingCalibrating = !!payload.calibrating;
      }
      if ("statusMessage" in payload) {
        this.headTrackingStatusMessage = payload.statusMessage ?? "";
      }
      if ("errorMessage" in payload) {
        this.headTrackingErrorMessage = payload.errorMessage ?? "";
      }
      if ("suspendedReason" in payload) {
        this.headTrackingSuspendedReason = payload.suspendedReason ?? null;
      }
    },

    clearHeadTrackingFeedback() {
      this.headTrackingStatusMessage = "";
      this.headTrackingErrorMessage = "";
      this.headTrackingSuspendedReason = null;
    },

    requestHeadTrackingRecenter() {
      this.headTrackingRecenterToken += 1;
    },

    setScreenWakeLockEnabled(enabled) {
      const nextValue = !!enabled;
      this.screenWakeLockEnabled = nextValue;
      this.screenWakeLockErrorMessage = "";
      writeViewerPreferences({ screenWakeLockEnabled: nextValue });
    },

    setScreenWakeLockSupported(supported) {
      this.screenWakeLockSupported = supported == null ? null : !!supported;

      if (supported === false) {
        this.screenWakeLockActive = false;
      }
    },

    setScreenWakeLockRuntimeState(payload = {}) {
      if ("active" in payload) {
        this.screenWakeLockActive = !!payload.active;
      }

      if ("errorMessage" in payload) {
        this.screenWakeLockErrorMessage = payload.errorMessage ?? "";
      }
    },

    cycleFlowState() {
      // Cycle: off -> forward -> backward -> off
      if (this.flowState === "off") {
        this.flowState = "forward";
      } else if (this.flowState === "forward") {
        this.flowState = "backward";
      } else {
        this.flowState = "off";
      }
    },

    setFlowState(state) {
      this.flowState = state;
    },

    setFlowSpeed(speed) {
      const parsed = Number(speed);
      if (!Number.isFinite(parsed)) {
        return;
      }

      this.flowSpeed = Math.max(0.05, Math.min(2, parsed));
    },

    setFlowCycleAlignmentEnabled(enabled) {
      const nextValue = !!enabled;
      this.flowCycleAlignmentEnabled = nextValue;
      writeViewerPreferences({ flowCycleAlignmentEnabled: nextValue });
    },

    setTextureAnimationEnabled(enabled) {
      const nextValue = !!enabled;
      this.textureAnimationEnabled = nextValue;
      writeViewerPreferences({ textureAnimationEnabled: nextValue });
    },

    setAnimatedBackgroundEnabled(enabled) {
      const nextValue = !!enabled;
      this.animatedBackgroundEnabled = nextValue;
      writeViewerPreferences({ animatedBackgroundEnabled: nextValue });
    },

    setBackgroundFlipVertical(enabled) {
      const nextValue = !!enabled;
      this.backgroundFlipVertical = nextValue;
      writeViewerPreferences({ backgroundFlipVertical: nextValue });
    },

    setBackgroundFlowEnabled(enabled) {
      const nextValue = !!enabled;
      this.backgroundFlowEnabled = nextValue;
      writeViewerPreferences({ backgroundFlowEnabled: nextValue });
    },

    setBackgroundFlowSpeed(speed) {
      const nextValue = normalizeBackgroundFlowSpeed(speed);
      this.backgroundFlowSpeed = nextValue;
      writeViewerPreferences({ backgroundFlowSpeed: nextValue });
    },

    setBackgroundBlurEnabled(enabled) {
      const nextValue = !!enabled;
      this.backgroundBlurEnabled = nextValue;
      writeViewerPreferences({ backgroundBlurEnabled: nextValue });
    },

    setBackgroundBlurAmount(amount) {
      const nextValue = normalizeBackgroundBlurAmount(amount);
      this.backgroundBlurAmount = nextValue;
      writeViewerPreferences({ backgroundBlurAmount: nextValue });
    },

    setBackgroundOverlayEnabled(enabled) {
      const nextValue = !!enabled;
      this.backgroundOverlayEnabled = nextValue;
      writeViewerPreferences({ backgroundOverlayEnabled: nextValue });
    },

    setBackgroundOverlayColor(color) {
      const nextValue = normalizeBackgroundOverlayColor(color);
      this.backgroundOverlayColor = nextValue;
      writeViewerPreferences({ backgroundOverlayColor: nextValue });
    },

    setBackgroundOverlayOpacity(opacity) {
      const nextValue = normalizeBackgroundOverlayOpacity(opacity);
      this.backgroundOverlayOpacity = nextValue;
      writeViewerPreferences({ backgroundOverlayOpacity: nextValue });
    },

    setTextureAnimationReversed(reversed) {
      const nextValue = !!reversed;
      this.textureAnimationReversed = nextValue;
      writeViewerPreferences({ textureAnimationReversed: nextValue });
    },

    setPeakTroughTransparencyEnabled(enabled) {
      const nextValue =
        !!enabled && this.activeTextureCrossSectionType === "waves";
      this.peakTroughTransparencyEnabled = nextValue;
      if (nextValue) {
        this.peakTroughBlurEnabled = false;
      }
      writeViewerPreferences({
        peakTroughTransparencyEnabled: nextValue,
        peakTroughBlurEnabled: this.peakTroughBlurEnabled,
      });
    },

    setPeakTroughBlurEnabled(enabled) {
      const nextValue =
        !!enabled && this.activeTextureCrossSectionType === "waves";
      this.peakTroughBlurEnabled = nextValue;
      if (nextValue) {
        this.peakTroughTransparencyEnabled = false;
      }
      writeViewerPreferences({
        peakTroughBlurEnabled: nextValue,
        peakTroughTransparencyEnabled: this.peakTroughTransparencyEnabled,
      });
    },

    setPeakTroughBlurAmount(amount) {
      const nextValue = normalizePeakTroughBlurAmount(amount);
      this.peakTroughBlurAmount = nextValue;
      writeViewerPreferences({ peakTroughBlurAmount: nextValue });
    },

    setPeakTroughGradientRange(range) {
      const [startValue, endValue] = Array.isArray(range) ? range : [];
      const normalized = normalizePeakTroughGradientRange(startValue, endValue);
      this.peakTroughGradientStart = normalized.start;
      this.peakTroughGradientEnd = normalized.end;
      writeViewerPreferences({
        peakTroughGradientStart: normalized.start,
        peakTroughGradientEnd: normalized.end,
      });
      return normalized;
    },

    setActiveTextureCrossSectionType(type) {
      const nextType = type === "waves" || type === "planes" ? type : null;
      this.activeTextureCrossSectionType = nextType;
      if (nextType !== "waves" && this.peakTroughTransparencyEnabled) {
        this.setPeakTroughTransparencyEnabled(false);
      }
      if (nextType !== "waves" && this.peakTroughBlurEnabled) {
        this.setPeakTroughBlurEnabled(false);
      }
    },

    showBetaModal(reason = "default") {
      this.betaModalReason = reason;
      this.betaModalVisible = true;
    },

    hideBetaModal() {
      this.betaModalVisible = false;
      this.betaModalReason = null;
    },

    showTextPanel() {
      showViewerFlag(this, VIEWER_PANEL_KEYS.text);
    },

    hideTextPanel() {
      hideViewerFlag(this, VIEWER_PANEL_KEYS.text);
    },

    showTextureBrowser() {
      showViewerFlag(this, VIEWER_PANEL_KEYS.textureBrowser);
    },

    hideTextureBrowser() {
      hideViewerFlag(this, VIEWER_PANEL_KEYS.textureBrowser);
      hideViewerFlag(this, VIEWER_PANEL_KEYS.texturePreview);
    },

    showDrawingBrowser() {
      showViewerFlag(this, VIEWER_PANEL_KEYS.drawings);
    },

    hideDrawingBrowser() {
      hideViewerFlag(this, VIEWER_PANEL_KEYS.drawings);
    },

    showTexturePreview() {
      showViewerFlag(this, VIEWER_PANEL_KEYS.texturePreview);
    },

    hideTexturePreview() {
      hideViewerFlag(this, VIEWER_PANEL_KEYS.texturePreview);
    },

    showToolsPanel() {
      showViewerFlag(this, VIEWER_PANEL_KEYS.tools);
      this.captureToolsPanelOriginalState();
    },

    hideToolsPanel() {
      hideViewerFlag(this, VIEWER_PANEL_KEYS.tools);
      this.toolsPanelOriginalState = null;
    },

    /**
     * Capture the current settings state as the "original" for tools panel change tracking.
     * Called when the tools panel opens.
     */
    captureToolsPanelOriginalState() {
      this.toolsPanelOriginalState = {
        viewerControlMode: this.viewerControlMode,
        scrollDrivenTiltEnabled: this.scrollDrivenTiltEnabled,
        scrollDrivenLayerCycleEnabled: this.scrollDrivenLayerCycleEnabled,
        scrollDrivenFlowEnabled: this.scrollDrivenFlowEnabled,
        flowState: this.flowState,
        flowSpeed: this.flowSpeed,
        undulationEnabled: this.undulationEnabled,
        flowCycleAlignmentEnabled: this.flowCycleAlignmentEnabled,
        textureAnimationEnabled: this.textureAnimationEnabled,
        animatedBackgroundEnabled: this.animatedBackgroundEnabled,
        backgroundFlipVertical: this.backgroundFlipVertical,
        backgroundFlowEnabled: this.backgroundFlowEnabled,
        backgroundFlowSpeed: this.backgroundFlowSpeed,
        backgroundBlurEnabled: this.backgroundBlurEnabled,
        backgroundBlurAmount: this.backgroundBlurAmount,
        backgroundOverlayEnabled: this.backgroundOverlayEnabled,
        backgroundOverlayColor: this.backgroundOverlayColor,
        backgroundOverlayOpacity: this.backgroundOverlayOpacity,
        textureAnimationReversed: this.textureAnimationReversed,
        peakTroughTransparencyEnabled: this.peakTroughTransparencyEnabled,
        peakTroughBlurEnabled: this.peakTroughBlurEnabled,
        peakTroughBlurAmount: this.peakTroughBlurAmount,
        peakTroughGradientStart: this.peakTroughGradientStart,
        peakTroughGradientEnd: this.peakTroughGradientEnd,
        textureRepeatMode: this.textureRepeatMode,
        normalizeTextureOrientation: this.normalizeTextureOrientation,
        textureFlipVertical: this.textureFlipVertical,
        textureOverviewLayoutStrategy: this.textureOverviewLayoutStrategy,
        exportAspectRatioPreset: this.exportAspectRatioPreset,
        exportResolutionPreset: this.exportResolutionPreset,
        exportCustomWidth: this.exportCustomWidth,
        exportCustomHeight: this.exportCustomHeight,
        exportLogoOverlayEnabled: this.exportLogoOverlayEnabled,
        exportLogoOverlayCorner: this.exportLogoOverlayCorner,
        preferredTextureMaxResolution: this.preferredTextureMaxResolution,
        renderFilterMode: this.renderFilterMode,
        transparentShadowsEnabled: this.transparentShadowsEnabled,
        transparencyMode: this.transparencyMode,
        transparentShadowsThresholdMin: this.transparentShadowsThresholdMin,
        transparentShadowsThresholdMax: this.transparentShadowsThresholdMax,
        edgeDriftEnabled: this.edgeDriftEnabled,
        edgeNoiseTransparencyMax: this.edgeNoiseTransparencyMax,
        edgeNoisePatternLength: this.edgeNoisePatternLength,
        edgeNoiseMirrored: this.edgeNoiseMirrored,
        filmstripStyleEnabled: this.filmstripStyleEnabled,
        filmstripGapLength: this.filmstripGapLength,
        filmstripHoleLength: this.filmstripHoleLength,
        filmstripAperture: this.filmstripAperture,
        filmstripHoleRoundedness: this.filmstripHoleRoundedness,
        duotoneColor: this.duotoneColor,
        contrast: this.contrast,
        saturation: this.saturation,
        ribbonWidthScale: this.ribbonWidthScale,
        ribbonPathAlignmentMode: this.ribbonPathAlignmentMode,
        surfaceMode: this.surfaceMode,
        tubeRadiusScale: this.tubeRadiusScale,
        tubeRadialSegments: this.tubeRadialSegments,
        helixMode: this.helixMode,
        helixRadius: this.helixRadius,
        helixPitch: this.helixPitch,
        helixStrandWidth: this.helixStrandWidth,
        capStyle: this.capStyle,
        cornerNarrowingEnabled: this.cornerNarrowingEnabled,
        sphericalProjectionEnabled: this.sphericalProjectionEnabled,
        sphericalProjectionWrapDegrees: this.sphericalProjectionWrapDegrees,
        showTextureMetadataOverlay: this.showTextureMetadataOverlay,
        screenWakeLockEnabled: this.screenWakeLockEnabled,
      };
    },

    /**
     * Check if any settings in the tools panel have changed since it was opened.
     * @returns {boolean} true if any settings have changed from their original values
     */
    hasToolsPanelChanges() {
      if (!this.toolsPanelOriginalState) {
        return false;
      }

      const original = this.toolsPanelOriginalState;
      return (
        this.viewerControlMode !== original.viewerControlMode ||
        this.scrollDrivenTiltEnabled !== original.scrollDrivenTiltEnabled ||
        this.scrollDrivenLayerCycleEnabled !==
          original.scrollDrivenLayerCycleEnabled ||
        this.scrollDrivenFlowEnabled !== original.scrollDrivenFlowEnabled ||
        this.flowState !== original.flowState ||
        this.flowSpeed !== original.flowSpeed ||
        this.undulationEnabled !== original.undulationEnabled ||
        this.flowCycleAlignmentEnabled !== original.flowCycleAlignmentEnabled ||
        this.textureAnimationEnabled !== original.textureAnimationEnabled ||
        this.animatedBackgroundEnabled !== original.animatedBackgroundEnabled ||
        this.backgroundFlipVertical !== original.backgroundFlipVertical ||
        this.backgroundFlowEnabled !== original.backgroundFlowEnabled ||
        this.backgroundFlowSpeed !== original.backgroundFlowSpeed ||
        this.backgroundBlurEnabled !== original.backgroundBlurEnabled ||
        this.backgroundBlurAmount !== original.backgroundBlurAmount ||
        this.backgroundOverlayEnabled !== original.backgroundOverlayEnabled ||
        this.backgroundOverlayColor !== original.backgroundOverlayColor ||
        this.backgroundOverlayOpacity !== original.backgroundOverlayOpacity ||
        this.textureAnimationReversed !== original.textureAnimationReversed ||
        this.peakTroughTransparencyEnabled !==
          original.peakTroughTransparencyEnabled ||
        this.peakTroughBlurEnabled !== original.peakTroughBlurEnabled ||
        this.peakTroughBlurAmount !== original.peakTroughBlurAmount ||
        this.peakTroughGradientStart !== original.peakTroughGradientStart ||
        this.peakTroughGradientEnd !== original.peakTroughGradientEnd ||
        this.textureRepeatMode !== original.textureRepeatMode ||
        this.normalizeTextureOrientation !==
          original.normalizeTextureOrientation ||
        this.textureFlipVertical !== original.textureFlipVertical ||
        this.textureOverviewLayoutStrategy !==
          original.textureOverviewLayoutStrategy ||
        this.exportAspectRatioPreset !== original.exportAspectRatioPreset ||
        this.exportResolutionPreset !== original.exportResolutionPreset ||
        this.exportCustomWidth !== original.exportCustomWidth ||
        this.exportCustomHeight !== original.exportCustomHeight ||
        this.exportLogoOverlayEnabled !== original.exportLogoOverlayEnabled ||
        this.exportLogoOverlayCorner !== original.exportLogoOverlayCorner ||
        this.preferredTextureMaxResolution !==
          original.preferredTextureMaxResolution ||
        this.renderFilterMode !== original.renderFilterMode ||
        this.transparentShadowsEnabled !== original.transparentShadowsEnabled ||
        this.transparencyMode !== original.transparencyMode ||
        this.transparentShadowsThresholdMin !==
          original.transparentShadowsThresholdMin ||
        this.transparentShadowsThresholdMax !==
          original.transparentShadowsThresholdMax ||
        this.edgeDriftEnabled !== original.edgeDriftEnabled ||
        this.edgeNoiseTransparencyMax !== original.edgeNoiseTransparencyMax ||
        this.edgeNoisePatternLength !== original.edgeNoisePatternLength ||
        this.edgeNoiseMirrored !== original.edgeNoiseMirrored ||
        this.filmstripStyleEnabled !== original.filmstripStyleEnabled ||
        this.filmstripGapLength !== original.filmstripGapLength ||
        this.filmstripHoleLength !== original.filmstripHoleLength ||
        this.filmstripAperture !== original.filmstripAperture ||
        this.filmstripHoleRoundedness !== original.filmstripHoleRoundedness ||
        this.duotoneColor !== original.duotoneColor ||
        this.contrast !== original.contrast ||
        this.saturation !== original.saturation ||
        this.ribbonWidthScale !== original.ribbonWidthScale ||
        this.ribbonPathAlignmentMode !== original.ribbonPathAlignmentMode ||
        this.surfaceMode !== original.surfaceMode ||
        this.tubeRadiusScale !== original.tubeRadiusScale ||
        this.tubeRadialSegments !== original.tubeRadialSegments ||
        this.tubeTextureJoinOffsetDegrees !==
          original.tubeTextureJoinOffsetDegrees ||
        this.helixMode !== original.helixMode ||
        this.helixRadius !== original.helixRadius ||
        this.helixPitch !== original.helixPitch ||
        this.helixStrandWidth !== original.helixStrandWidth ||
        this.capStyle !== original.capStyle ||
        this.cornerNarrowingEnabled !== original.cornerNarrowingEnabled ||
        this.sphericalProjectionEnabled !==
          original.sphericalProjectionEnabled ||
        this.sphericalProjectionWrapDegrees !==
          original.sphericalProjectionWrapDegrees ||
        this.showTextureMetadataOverlay !==
          original.showTextureMetadataOverlay ||
        this.screenWakeLockEnabled !== original.screenWakeLockEnabled
      );
    },

    showEmojiPicker() {
      showViewerFlag(this, VIEWER_PANEL_KEYS.emoji);
    },

    hideEmojiPicker() {
      hideViewerFlag(this, VIEWER_PANEL_KEYS.emoji);
    },

    showContourPanel() {
      showViewerFlag(this, VIEWER_PANEL_KEYS.contour);
    },

    hideContourPanel() {
      hideViewerFlag(this, VIEWER_PANEL_KEYS.contour);
    },

    showSineWavePanel() {
      hideViewerFlag(this, VIEWER_PANEL_KEYS.clock);
      showViewerFlag(this, VIEWER_PANEL_KEYS.sineWave);
    },

    hideSineWavePanel() {
      hideViewerFlag(this, VIEWER_PANEL_KEYS.sineWave);
    },

    showClockPanel() {
      hideViewerFlag(this, VIEWER_PANEL_KEYS.sineWave);
      showViewerFlag(this, VIEWER_PANEL_KEYS.clock);
    },

    hideClockPanel() {
      hideViewerFlag(this, VIEWER_PANEL_KEYS.clock);
    },

    showAboutPanel() {
      showViewerFlag(this, VIEWER_PANEL_KEYS.about);
    },

    hideAboutPanel() {
      hideViewerFlag(this, VIEWER_PANEL_KEYS.about);
    },

    showSlyce() {
      showViewerFlag(this, VIEWER_PANEL_KEYS.textureCreator);
    },

    hideSlyce() {
      hideViewerFlag(this, VIEWER_PANEL_KEYS.textureCreator);
    },

    toggleSlyce() {
      toggleViewerFlag(this, VIEWER_PANEL_KEYS.textureCreator);
    },

    showRealtimeSampler() {
      showViewerFlag(this, VIEWER_PANEL_KEYS.realtimeSampler);
    },

    hideRealtimeSampler() {
      hideViewerFlag(this, VIEWER_PANEL_KEYS.realtimeSampler);
    },

    setThumbnailUrl(url) {
      this.thumbnailUrl = url;
    },

    setCurrentTextureMetadata({ id = null, name = "", description = "" } = {}) {
      this.currentTextureId = id;
      this.currentTextureName = typeof name === "string" ? name : "";
      this.currentTextureDescription =
        typeof description === "string" ? description : "";
    },

    clearCurrentTextureMetadata() {
      this.currentTextureId = null;
      this.currentTextureName = "";
      this.currentTextureDescription = "";
    },

    setTextureRepeatMode(mode) {
      this.textureRepeatMode = mode === "mirrorTile" ? "mirrorTile" : "wrap";
    },

    setNormalizeTextureOrientation(enabled) {
      const nextValue = !!enabled;
      this.normalizeTextureOrientation = nextValue;
      writeViewerPreferences({ normalizeTextureOrientation: nextValue });
    },

    setTextureFlipVertical(enabled) {
      const nextValue = !!enabled;
      this.textureFlipVertical = nextValue;
      writeViewerPreferences({
        textureFlipVertical: nextValue,
        textureOverviewFlipVertical: nextValue,
      });
    },

    setTextureOverviewLayoutStrategy(strategy) {
      const nextStrategy = normalizeTextureOverviewLayoutStrategy(strategy);
      this.textureOverviewLayoutStrategy = nextStrategy;
      writeViewerPreferences({ textureOverviewLayoutStrategy: nextStrategy });
      return nextStrategy;
    },

    setExportDimensionSettings(settings = {}) {
      const normalized = normalizeExportDimensionSettings({
        aspectRatioPreset: this.exportAspectRatioPreset,
        resolutionPreset: this.exportResolutionPreset,
        customWidth: this.exportCustomWidth,
        customHeight: this.exportCustomHeight,
        ...settings,
      });

      this.exportAspectRatioPreset = normalized.aspectRatioPreset;
      this.exportResolutionPreset = normalized.resolutionPreset;
      this.exportCustomWidth = normalized.customWidth;
      this.exportCustomHeight = normalized.customHeight;

      writeViewerPreferences({
        exportAspectRatioPreset: normalized.aspectRatioPreset,
        exportResolutionPreset: normalized.resolutionPreset,
        exportCustomWidth: normalized.customWidth,
        exportCustomHeight: normalized.customHeight,
      });

      return normalized;
    },

    setExportAspectRatioPreset(aspectRatioPreset) {
      return this.setExportDimensionSettings({ aspectRatioPreset });
    },

    setExportResolutionPreset(resolutionPreset) {
      return this.setExportDimensionSettings({ resolutionPreset });
    },

    setExportCustomWidth(customWidth) {
      return this.setExportDimensionSettings({ customWidth });
    },

    setExportCustomHeight(customHeight) {
      return this.setExportDimensionSettings({ customHeight });
    },

    setExportLogoOverlayEnabled(enabled) {
      const nextValue = !!enabled;
      this.exportLogoOverlayEnabled = nextValue;
      writeViewerPreferences({ exportLogoOverlayEnabled: nextValue });
    },

    setExportLogoOverlayCorner(corner) {
      const nextCorner = normalizeExportLogoCorner(
        corner,
        EXPORT_LOGO_DEFAULT_CORNER,
      );
      this.exportLogoOverlayCorner = nextCorner;
      writeViewerPreferences({ exportLogoOverlayCorner: nextCorner });
      return nextCorner;
    },

    setUndulationEnabled(enabled) {
      const nextValue = !!enabled;
      this.undulationEnabled = nextValue;
      writeViewerPreferences({ undulationEnabled: nextValue });
    },

    setPreferredTextureMaxResolution(resolution) {
      const nextResolution = normalizePreferredTextureMaxResolution(resolution);
      this.preferredTextureMaxResolution = nextResolution;
      writeViewerPreferences({ preferredTextureMaxResolution: nextResolution });
    },

    setRenderFilterMode(mode) {
      const nextMode = normalizeViewerFilterMode(mode);
      this.renderFilterMode = nextMode;
      writeViewerPreferences({ renderFilterMode: nextMode });
    },

    setTransparentShadowsEnabled(enabled) {
      const nextValue = !!enabled;
      this.transparentShadowsEnabled = nextValue;
      writeViewerPreferences({ transparentShadowsEnabled: nextValue });
    },

    setTransparencyMode(mode) {
      const nextMode = normalizeTransparencyMode(mode);
      this.transparencyMode = nextMode;
      writeViewerPreferences({ transparencyMode: nextMode });
    },

    setTransparentShadowsThresholdRange(range) {
      const [minValue, maxValue] = Array.isArray(range) ? range : [];
      const normalized = normalizeTransparentShadowsThresholdRange(
        minValue,
        maxValue,
      );

      this.transparentShadowsThresholdMin = normalized.min;
      this.transparentShadowsThresholdMax = normalized.max;
      writeViewerPreferences({
        transparentShadowsThresholdMin: normalized.min,
        transparentShadowsThresholdMax: normalized.max,
      });

      return normalized;
    },

    setEdgeNoiseTransparencyMax(value) {
      const nextValue = normalizeEdgeNoiseTransparencyMax(value);
      this.edgeNoiseTransparencyMax = nextValue;
      writeViewerPreferences({ edgeNoiseTransparencyMax: nextValue });
      return nextValue;
    },

    setEdgeDriftEnabled(enabled) {
      const nextValue = !!enabled;
      this.edgeDriftEnabled = nextValue;
      writeViewerPreferences({ edgeDriftEnabled: nextValue });
      return nextValue;
    },

    setEdgeNoisePatternLength(value) {
      const nextValue = normalizeEdgeNoisePatternLength(value);
      this.edgeNoisePatternLength = nextValue;
      writeViewerPreferences({ edgeNoisePatternLength: nextValue });
      return nextValue;
    },

    setEdgeNoiseMirrored(enabled) {
      const nextValue = !!enabled;
      this.edgeNoiseMirrored = nextValue;
      writeViewerPreferences({ edgeNoiseMirrored: nextValue });
      return nextValue;
    },

    setFilmstripStyleEnabled(enabled) {
      const nextValue = !!enabled;
      this.filmstripStyleEnabled = nextValue;
      writeViewerPreferences({ filmstripStyleEnabled: nextValue });
      return nextValue;
    },

    setFilmstripGapLength(value) {
      const nextValue = normalizeFilmstripGapLength(value);
      this.filmstripGapLength = nextValue;
      writeViewerPreferences({ filmstripGapLength: nextValue });
      return nextValue;
    },

    setFilmstripHoleLength(value) {
      const nextValue = normalizeFilmstripHoleLength(value);
      this.filmstripHoleLength = nextValue;
      writeViewerPreferences({ filmstripHoleLength: nextValue });
      return nextValue;
    },

    setFilmstripAperture(value) {
      const nextValue = normalizeFilmstripAperture(value);
      this.filmstripAperture = nextValue;
      writeViewerPreferences({ filmstripAperture: nextValue });
      return nextValue;
    },

    setFilmstripHoleRoundedness(value) {
      const nextValue = normalizeFilmstripHoleRoundedness(value);
      this.filmstripHoleRoundedness = nextValue;
      writeViewerPreferences({ filmstripHoleRoundedness: nextValue });
      return nextValue;
    },

    // Backward-compatible aliases for older callsites/preferences migration.
    setFilmstripHoleSpacing(value) {
      return this.setFilmstripGapLength(value);
    },

    setFilmstripHoleSize(value) {
      return this.setFilmstripAperture(value);
    },

    setDuotoneColor(color) {
      const nextColor = normalizeDuotoneColor(color);
      this.duotoneColor = nextColor;
      writeViewerPreferences({ duotoneColor: nextColor });
    },

    setContrast(value) {
      const nextValue = normalizeContrast(value);
      this.contrast = nextValue;
      writeViewerPreferences({ contrast: nextValue });
    },

    setSaturation(value) {
      const nextValue = normalizeSaturation(value);
      this.saturation = nextValue;
      writeViewerPreferences({ saturation: nextValue });
    },

    setShowTextureMetadataOverlay(enabled) {
      const nextValue = !!enabled;
      this.showTextureMetadataOverlay = nextValue;
      writeViewerPreferences({ showTextureMetadataOverlay: nextValue });
    },

    setActiveTextures(ids) {
      this.activeTextureIds = ids;
      this.multiTextureActive = ids.length > 1;
    },

    clearActiveTextures() {
      this.activeTextureIds = [];
      this.multiTextureActive = false;
    },

    setStrokeCount(count) {
      this.strokeCount = count;
    },

    setWalkPointCount(count) {
      this.walkPointCount = count;
    },

    setCountdownSeconds(seconds) {
      this.countdownSeconds = seconds;
    },

    setCountdownProgress(progress, inFinal = false) {
      this.countdownProgress = progress;
      this.inFinalCountdown = inFinal;
    },

    setThreeContext(context) {
      this.threeContext = context;
    },

    /**
     * Register the ThreeCanvas reinitialize callback.
     * This persists across teardown since it's stored on the store, not threeContext.
     */
    setReinitCallback(callback) {
      this.reinitCallback = callback;
    },

    /**
     * Suspend the viewer to free GPU/CPU resources for Slyce processing.
     * @param {boolean} releaseResources — if true, fully dispose renderer + textures (interventions 5+6)
     */
    suspendViewer(releaseResources = false) {
      if (this.isSuspended) return;
      this.isSuspended = true;

      if (releaseResources && this.threeContext?.teardownViewer) {
        this.threeContext.teardownViewer();
        this.resourcesReleased = true;
        console.log(
          "[ViewerStore] Viewer suspended with full GPU resource release",
        );
      } else {
        if (this.threeContext?.pauseRenderLoop) {
          this.threeContext.pauseRenderLoop();
        }
        console.log("[ViewerStore] Viewer suspended (render loop paused)");
      }
    },

    /**
     * Resume the viewer after Slyce processing completes.
     * If resources were released, performs full reinitialization.
     */
    async resumeViewer() {
      if (!this.isSuspended) return;
      this.isSuspended = false;

      if (this.resourcesReleased) {
        this.resourcesReleased = false;
        if (this.reinitCallback) {
          this.isReinitializing = true;
          console.log("[ViewerStore] Reinitializing viewer...");
          try {
            await this.reinitCallback();
          } catch (e) {
            console.error("[ViewerStore] Reinitialization failed:", e);
          } finally {
            this.isReinitializing = false;
          }
        }
        console.log("[ViewerStore] Viewer resumed after full reinit");
      } else {
        if (this.threeContext?.resumeRenderLoop) {
          this.threeContext.resumeRenderLoop();
        }
        console.log("[ViewerStore] Viewer resumed");
      }
    },

    setFullscreen(enabled) {
      this.isFullscreen = enabled;
    },

    setHelixMode(enabled) {
      this.helixMode = enabled;
    },

    setHelixOption(key, value) {
      if (
        key in this &&
        ["helixRadius", "helixPitch", "helixStrandWidth"].includes(key)
      ) {
        this[key] = value;
      }
    },

    setRibbonWidthScale(scale) {
      const nextScale = normalizeRibbonWidthScale(scale);
      this.ribbonWidthScale = nextScale;
      writeViewerPreferences({ ribbonWidthScale: nextScale });
    },

    setRibbonPathAlignmentMode(mode) {
      const nextMode = normalizeRibbonPathAlignmentMode(mode);
      this.ribbonPathAlignmentMode = nextMode;
      writeViewerPreferences({ ribbonPathAlignmentMode: nextMode });
    },

    setSurfaceMode(mode) {
      const nextMode = normalizeSurfaceMode(mode);
      this.surfaceMode = nextMode;
      writeViewerPreferences({ surfaceMode: nextMode });
    },

    setTubeRadiusScale(value) {
      const nextValue = normalizeTubeRadiusScale(value);
      this.tubeRadiusScale = nextValue;
      writeViewerPreferences({ tubeRadiusScale: nextValue });
    },

    setTubeRadialSegments(value) {
      const nextValue = normalizeTubeRadialSegments(value);
      this.tubeRadialSegments = nextValue;
      writeViewerPreferences({ tubeRadialSegments: nextValue });
    },

    setTubeTextureJoinOffsetDegrees(value) {
      const nextValue = normalizeTubeTextureJoinOffsetDegrees(value);
      this.tubeTextureJoinOffsetDegrees = nextValue;
      writeViewerPreferences({ tubeTextureJoinOffsetDegrees: nextValue });
    },

    setCapStyle(style) {
      const nextStyle = normalizeCapStyle(style, this.roundedCaps);
      this.capStyle = nextStyle;
      this.roundedCaps = nextStyle === CAP_STYLE_ROUNDED;
    },

    setRoundedCaps(enabled) {
      this.setCapStyle(enabled ? CAP_STYLE_ROUNDED : "square");
    },

    setCornerNarrowingEnabled(enabled) {
      this.cornerNarrowingEnabled = !!enabled;
    },

    setSphericalProjectionEnabled(enabled) {
      const nextValue = !!enabled;
      this.sphericalProjectionEnabled = nextValue;
      writeViewerPreferences({ sphericalProjectionEnabled: nextValue });
    },

    setSphericalProjectionWrapDegrees(value) {
      const nextValue = normalizeSphericalProjectionWrapDegrees(value);
      this.sphericalProjectionWrapDegrees = nextValue;
      writeViewerPreferences({ sphericalProjectionWrapDegrees: nextValue });
    },
  },

  getters: {
    hasActiveStrokes: (state) => state.strokeCount > 0,
    hasActiveWalkPath: (state) => state.walkPointCount > 1,
    flowEnabled: (state) => state.flowState !== "off",
    helixEnabled: (state) => state.helixMode,
    headTrackingSelected: (state) => state.viewerControlMode === "headTracking",
    headTrackingMessage: (state) =>
      state.headTrackingErrorMessage || state.headTrackingStatusMessage,
    helixOptions: (state) => ({
      helixMode: state.helixMode,
      helixRadius: state.helixRadius,
      helixPitch: state.helixPitch,
      helixStrandWidth: state.helixStrandWidth,
      ribbonWidthScale: state.ribbonWidthScale,
      ribbonPathAlignmentMode: normalizeRibbonPathAlignmentMode(
        state.ribbonPathAlignmentMode,
      ),
      surfaceMode: normalizeSurfaceMode(state.surfaceMode),
      tubeRadiusScale: normalizeTubeRadiusScale(state.tubeRadiusScale),
      tubeRadialSegments: normalizeTubeRadialSegments(state.tubeRadialSegments),
      tubeTextureJoinOffsetDegrees: normalizeTubeTextureJoinOffsetDegrees(
        state.tubeTextureJoinOffsetDegrees,
      ),
      undulationEnabled: state.undulationEnabled,
      capStyle: normalizeCapStyle(state.capStyle, state.roundedCaps),
      roundedCaps:
        normalizeCapStyle(state.capStyle, state.roundedCaps) ===
        CAP_STYLE_ROUNDED,
      cornerNarrowingEnabled: state.cornerNarrowingEnabled,
      sphericalProjectionEnabled: state.sphericalProjectionEnabled,
      sphericalProjectionWrapDegrees:
        state.sphericalProjectionWrapDegrees || DEFAULT_SPHERICAL_WRAP_DEGREES,
    }),
    toolsPanelHasChanges: (state) => state.hasToolsPanelChanges(),
  },
});
