// src/stores/viewerStore.js
// Pinia store for rivvon viewer state

import { defineStore } from 'pinia';
import { CAP_STYLE_ROUNDED, normalizeCapStyle } from '../modules/viewer/capStyle.js';
import { normalizeExportDimensionSettings } from '../modules/viewer/exportVideoDimensions.js';
import { createViewerPanelVisibilityState, VIEWER_PANEL_KEYS } from '../modules/viewer/viewerPanels.js';

const VIEWER_PREFERENCES_STORAGE_KEY = 'rivvon.viewer.preferences';
const PREFERRED_TEXTURE_RESOLUTION_VALUES = [256, 512, 1024];
const VIEWER_FILTER_MODES = ['none', 'blackAndWhite'];
const MIN_RIBBON_WIDTH_SCALE = 0.4;
const MAX_RIBBON_WIDTH_SCALE = 2.5;

function getDefaultPreferredTextureMaxResolution() {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        return window.matchMedia('(pointer: coarse)').matches ? 256 : 512;
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
    return VIEWER_FILTER_MODES.includes(value)
        ? value
        : 'none';
}

function normalizeRibbonWidthScale(value) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return 1;
    }

    return Math.min(MAX_RIBBON_WIDTH_SCALE, Math.max(MIN_RIBBON_WIDTH_SCALE, parsed));
}

function normalizeViewerBooleanPreference(value, fallback = false) {
    return typeof value === 'boolean' ? value : fallback;
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
    if (typeof window === 'undefined' || !window.localStorage) {
        return {};
    }

    try {
        const raw = window.localStorage.getItem(VIEWER_PREFERENCES_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (error) {
        console.warn('[ViewerStore] Failed to read viewer preferences:', error);
        return {};
    }
}

function writeViewerPreferences(patch) {
    if (typeof window === 'undefined' || !window.localStorage) {
        return;
    }

    try {
        const current = readViewerPreferences();
        window.localStorage.setItem(VIEWER_PREFERENCES_STORAGE_KEY, JSON.stringify({
            ...current,
            ...patch,
        }));
    } catch (error) {
        console.warn('[ViewerStore] Failed to persist viewer preferences:', error);
    }
}

function getStoredExportDimensionSettings() {
    return normalizeExportDimensionSettings(readViewerPreferences());
}

export const useViewerStore = defineStore('viewer', {
    state: () => {
        const exportDimensionSettings = getStoredExportDimensionSettings();
        const panelVisibilityState = createViewerPanelVisibilityState();

        return ({
        // Renderer state
        rendererType: 'webgl',    // 'webgl' | 'webgpu'
        
        // Drawing state
        isDrawingMode: false,
        strokeCount: 0,
        countdownSeconds: null,
        countdownProgress: 0,
        inFinalCountdown: false,

        // Walk capture state
        isWalkMode: false,
        walkPointCount: 0,

        // Viewer control mode
        viewerControlMode: 'orbit', // 'orbit' | 'headTracking' | 'mouseTilt' | 'scrollTilt'
        scrollDrivenTiltEnabled: normalizeViewerBooleanPreference(
            readViewerPreferences().scrollDrivenTiltEnabled,
            true
        ),
        scrollDrivenLayerCycleEnabled: normalizeViewerBooleanPreference(
            readViewerPreferences().scrollDrivenLayerCycleEnabled,
            true
        ),
        scrollDrivenFlowEnabled: normalizeViewerBooleanPreference(
            readViewerPreferences().scrollDrivenFlowEnabled,
            true
        ),
        headTrackingSupported: null,
        headTrackingActive: false,
        headTrackingCalibrating: false,
        headTrackingStatusMessage: '',
        headTrackingErrorMessage: '',
        headTrackingSuspendedReason: null,
        headTrackingRecenterToken: 0,
        screenWakeLockEnabled: normalizeViewerBooleanPreference(
            readViewerPreferences().screenWakeLockEnabled,
            true
        ),
        screenWakeLockSupported: null,
        screenWakeLockActive: false,
        screenWakeLockErrorMessage: '',
        
        // Ribbon/3D state
        flowState: 'forward', // 'off' | 'forward' | 'backward'
        flowSpeed: 0.25, // Base flow speed (positive value)
        flowCycleAlignmentEnabled: normalizeViewerBooleanPreference(
            readViewerPreferences().flowCycleAlignmentEnabled,
            true
        ),
        textureAnimationEnabled: normalizeViewerBooleanPreference(
            readViewerPreferences().textureAnimationEnabled,
            true
        ),
        textureAnimationReversed: normalizeViewerBooleanPreference(
            readViewerPreferences().textureAnimationReversed,
            false
        ),
        undulationEnabled: normalizeViewerBooleanPreference(
            readViewerPreferences().undulationEnabled,
            true
        ),
        
        // Helix mode
        helixMode: false,
        helixRadius: 0.20,   // Distance each strand sits from the spine
        helixPitch: 9.0,      // Number of full turns along the ribbon length
        helixStrandWidth: 0.50, // Width of each helical ribbon strip (fraction of original width)
        ribbonWidthScale: normalizeRibbonWidthScale(readViewerPreferences().ribbonWidthScale),

        // Geometry options
        capStyle: CAP_STYLE_ROUNDED,
        roundedCaps: true, // Legacy alias for capStyle === 'rounded'
        cornerNarrowingEnabled: false,
        
        // Texture state
        textureRepeatMode: 'mirrorTile', // 'wrap' | 'mirrorTile'
        textureOverviewFlipVertical: normalizeViewerBooleanPreference(
            readViewerPreferences().textureOverviewFlipVertical,
            false
        ),
        exportAspectRatioPreset: exportDimensionSettings.aspectRatioPreset,
        exportResolutionPreset: exportDimensionSettings.resolutionPreset,
        exportCustomWidth: exportDimensionSettings.customWidth,
        exportCustomHeight: exportDimensionSettings.customHeight,
        preferredTextureMaxResolution: normalizePreferredTextureMaxResolution(
            readViewerPreferences().preferredTextureMaxResolution
        ),
        renderFilterMode: normalizeViewerFilterMode(readViewerPreferences().renderFilterMode),
        currentTextureId: null,
        currentTextureName: '',
        currentTextureDescription: '',
        thumbnailUrl: null,
        activeTextureIds: [],      // Array of texture IDs when multi-texture is active
        multiTextureActive: false, // True when multiple textures are loaded simultaneously
        showTextureMetadataOverlay: normalizeViewerBooleanPreference(
            readViewerPreferences().showTextureMetadataOverlay,
            false
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
        });
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

        setViewerControlMode(mode) {
            if (mode === 'headTracking' || mode === 'mouseTilt' || mode === 'scrollTilt') {
                this.viewerControlMode = mode;
            } else {
                this.viewerControlMode = 'orbit';
            }
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
            if ('supported' in payload) {
                this.headTrackingSupported = payload.supported == null ? null : !!payload.supported;
            }
            if ('active' in payload) {
                this.headTrackingActive = !!payload.active;
            }
            if ('calibrating' in payload) {
                this.headTrackingCalibrating = !!payload.calibrating;
            }
            if ('statusMessage' in payload) {
                this.headTrackingStatusMessage = payload.statusMessage ?? '';
            }
            if ('errorMessage' in payload) {
                this.headTrackingErrorMessage = payload.errorMessage ?? '';
            }
            if ('suspendedReason' in payload) {
                this.headTrackingSuspendedReason = payload.suspendedReason ?? null;
            }
        },

        clearHeadTrackingFeedback() {
            this.headTrackingStatusMessage = '';
            this.headTrackingErrorMessage = '';
            this.headTrackingSuspendedReason = null;
        },

        requestHeadTrackingRecenter() {
            this.headTrackingRecenterToken += 1;
        },

        setScreenWakeLockEnabled(enabled) {
            const nextValue = !!enabled;
            this.screenWakeLockEnabled = nextValue;
            this.screenWakeLockErrorMessage = '';
            writeViewerPreferences({ screenWakeLockEnabled: nextValue });
        },

        setScreenWakeLockSupported(supported) {
            this.screenWakeLockSupported = supported == null ? null : !!supported;

            if (supported === false) {
                this.screenWakeLockActive = false;
            }
        },

        setScreenWakeLockRuntimeState(payload = {}) {
            if ('active' in payload) {
                this.screenWakeLockActive = !!payload.active;
            }

            if ('errorMessage' in payload) {
                this.screenWakeLockErrorMessage = payload.errorMessage ?? '';
            }
        },
        
        cycleFlowState() {
            // Cycle: off -> forward -> backward -> off
            if (this.flowState === 'off') {
                this.flowState = 'forward';
            } else if (this.flowState === 'forward') {
                this.flowState = 'backward';
            } else {
                this.flowState = 'off';
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

        setTextureAnimationReversed(reversed) {
            const nextValue = !!reversed;
            this.textureAnimationReversed = nextValue;
            writeViewerPreferences({ textureAnimationReversed: nextValue });
        },
        
        showBetaModal(reason = 'default') {
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
                textureAnimationReversed: this.textureAnimationReversed,
                textureRepeatMode: this.textureRepeatMode,
                exportAspectRatioPreset: this.exportAspectRatioPreset,
                exportResolutionPreset: this.exportResolutionPreset,
                exportCustomWidth: this.exportCustomWidth,
                exportCustomHeight: this.exportCustomHeight,
                preferredTextureMaxResolution: this.preferredTextureMaxResolution,
                renderFilterMode: this.renderFilterMode,
                ribbonWidthScale: this.ribbonWidthScale,
                helixMode: this.helixMode,
                helixRadius: this.helixRadius,
                helixPitch: this.helixPitch,
                helixStrandWidth: this.helixStrandWidth,
                capStyle: this.capStyle,
                cornerNarrowingEnabled: this.cornerNarrowingEnabled,
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
                this.scrollDrivenLayerCycleEnabled !== original.scrollDrivenLayerCycleEnabled ||
                this.scrollDrivenFlowEnabled !== original.scrollDrivenFlowEnabled ||
                this.flowState !== original.flowState ||
                this.flowSpeed !== original.flowSpeed ||
                this.undulationEnabled !== original.undulationEnabled ||
                this.flowCycleAlignmentEnabled !== original.flowCycleAlignmentEnabled ||
                this.textureAnimationEnabled !== original.textureAnimationEnabled ||
                this.textureAnimationReversed !== original.textureAnimationReversed ||
                this.textureRepeatMode !== original.textureRepeatMode ||
                this.exportAspectRatioPreset !== original.exportAspectRatioPreset ||
                this.exportResolutionPreset !== original.exportResolutionPreset ||
                this.exportCustomWidth !== original.exportCustomWidth ||
                this.exportCustomHeight !== original.exportCustomHeight ||
                this.preferredTextureMaxResolution !== original.preferredTextureMaxResolution ||
                this.renderFilterMode !== original.renderFilterMode ||
                this.ribbonWidthScale !== original.ribbonWidthScale ||
                this.helixMode !== original.helixMode ||
                this.helixRadius !== original.helixRadius ||
                this.helixPitch !== original.helixPitch ||
                this.helixStrandWidth !== original.helixStrandWidth ||
                this.capStyle !== original.capStyle ||
                this.cornerNarrowingEnabled !== original.cornerNarrowingEnabled ||
                this.showTextureMetadataOverlay !== original.showTextureMetadataOverlay ||
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

        setCurrentTextureMetadata({ id = null, name = '', description = '' } = {}) {
            this.currentTextureId = id;
            this.currentTextureName = typeof name === 'string' ? name : '';
            this.currentTextureDescription = typeof description === 'string' ? description : '';
        },

        clearCurrentTextureMetadata() {
            this.currentTextureId = null;
            this.currentTextureName = '';
            this.currentTextureDescription = '';
        },

        setTextureRepeatMode(mode) {
            this.textureRepeatMode = mode === 'mirrorTile' ? 'mirrorTile' : 'wrap';
        },

        setTextureOverviewFlipVertical(enabled) {
            const nextValue = !!enabled;
            this.textureOverviewFlipVertical = nextValue;
            writeViewerPreferences({ textureOverviewFlipVertical: nextValue });
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
                console.log('[ViewerStore] Viewer suspended with full GPU resource release');
            } else {
                if (this.threeContext?.pauseRenderLoop) {
                    this.threeContext.pauseRenderLoop();
                }
                console.log('[ViewerStore] Viewer suspended (render loop paused)');
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
                    console.log('[ViewerStore] Reinitializing viewer...');
                    try {
                        await this.reinitCallback();
                    } catch (e) {
                        console.error('[ViewerStore] Reinitialization failed:', e);
                    } finally {
                        this.isReinitializing = false;
                    }
                }
                console.log('[ViewerStore] Viewer resumed after full reinit');
            } else {
                if (this.threeContext?.resumeRenderLoop) {
                    this.threeContext.resumeRenderLoop();
                }
                console.log('[ViewerStore] Viewer resumed');
            }
        },
        
        setFullscreen(enabled) {
            this.isFullscreen = enabled;
        },
        
        setHelixMode(enabled) {
            this.helixMode = enabled;
        },
        
        setHelixOption(key, value) {
            if (key in this && ['helixRadius', 'helixPitch', 'helixStrandWidth'].includes(key)) {
                this[key] = value;
            }
        },

        setRibbonWidthScale(scale) {
            const nextScale = normalizeRibbonWidthScale(scale);
            this.ribbonWidthScale = nextScale;
            writeViewerPreferences({ ribbonWidthScale: nextScale });
        },

        setCapStyle(style) {
            const nextStyle = normalizeCapStyle(style, this.roundedCaps);
            this.capStyle = nextStyle;
            this.roundedCaps = nextStyle === CAP_STYLE_ROUNDED;
        },

        setRoundedCaps(enabled) {
            this.setCapStyle(enabled ? CAP_STYLE_ROUNDED : 'square');
        },

        setCornerNarrowingEnabled(enabled) {
            this.cornerNarrowingEnabled = !!enabled;
        },

    },
    
    getters: {
        hasActiveStrokes: (state) => state.strokeCount > 0,
        hasActiveWalkPath: (state) => state.walkPointCount > 1,
        flowEnabled: (state) => state.flowState !== 'off',
        helixEnabled: (state) => state.helixMode,
        headTrackingSelected: (state) => state.viewerControlMode === 'headTracking',
        headTrackingMessage: (state) => state.headTrackingErrorMessage || state.headTrackingStatusMessage,
        helixOptions: (state) => ({
            helixMode: state.helixMode,
            helixRadius: state.helixRadius,
            helixPitch: state.helixPitch,
            helixStrandWidth: state.helixStrandWidth,
            ribbonWidthScale: state.ribbonWidthScale,
            undulationEnabled: state.undulationEnabled,
            capStyle: normalizeCapStyle(state.capStyle, state.roundedCaps),
            roundedCaps: normalizeCapStyle(state.capStyle, state.roundedCaps) === CAP_STYLE_ROUNDED,
            cornerNarrowingEnabled: state.cornerNarrowingEnabled,
        }),
        toolsPanelHasChanges: (state) => state.hasToolsPanelChanges(),
    }
});
