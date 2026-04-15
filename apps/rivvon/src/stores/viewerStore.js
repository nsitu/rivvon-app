// src/stores/viewerStore.js
// Pinia store for rivvon viewer state

import { defineStore } from 'pinia';
import { CAP_STYLE_ROUNDED, normalizeCapStyle } from '../modules/viewer/capProfiles.js';

export const useViewerStore = defineStore('viewer', {
    state: () => ({
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
        viewerControlMode: 'orbit', // 'orbit' | 'headTracking' | 'mouseTilt'
        headTrackingSupported: null,
        headTrackingActive: false,
        headTrackingCalibrating: false,
        headTrackingStatusMessage: '',
        headTrackingErrorMessage: '',
        headTrackingSuspendedReason: null,
        headTrackingRecenterToken: 0,
        
        // Ribbon/3D state
        flowState: 'forward', // 'off' | 'forward' | 'backward'
        flowSpeed: 0.25, // Base flow speed (positive value)
        
        // Helix mode
        helixMode: false,
        helixRadius: 0.4,   // Distance each strand sits from the spine
        helixPitch: 4,      // Number of full turns along the ribbon length
        helixStrandWidth: 0.3, // Width of each helical ribbon strip (fraction of original width)

        // Geometry options
        capStyle: CAP_STYLE_ROUNDED,
        roundedCaps: true, // Legacy alias for capStyle === 'rounded'
        
        // Texture state
        textureRepeatMode: 'mirrorBounce', // 'wrap' | 'mirrorBounce'
        currentTextureId: null,
        thumbnailUrl: null,
        activeTextureIds: [],      // Array of texture IDs when multi-texture is active
        multiTextureActive: false, // True when multiple textures are loaded simultaneously

        // Text to SVG
        textPanelVisible: false,
        selectedFont: null,
        
        // Texture browser
        textureBrowserVisible: false,
        texturePreviewVisible: false,
        
        // Slyce panel
        textureCreatorVisible: false,

        // Realtime sampler screen
        realtimeSamplerVisible: false,
        
        // Tools panel
        toolsPanelVisible: false,

        // Emoji picker
        emojiPickerVisible: false,

        // About panel
        aboutPanelVisible: false,

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
    }),
    
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
            if (mode === 'headTracking' || mode === 'mouseTilt') {
                this.viewerControlMode = mode;
            } else {
                this.viewerControlMode = 'orbit';
            }
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
        
        showBetaModal(reason = 'default') {
            this.betaModalReason = reason;
            this.betaModalVisible = true;
        },
        
        hideBetaModal() {
            this.betaModalVisible = false;
            this.betaModalReason = null;
        },
        
        showTextPanel() {
            this.textPanelVisible = true;
        },
        
        hideTextPanel() {
            this.textPanelVisible = false;
        },
        
        showTextureBrowser() {
            this.textureBrowserVisible = true;
        },
        
        hideTextureBrowser() {
            this.textureBrowserVisible = false;
            this.texturePreviewVisible = false;
        },
        
        showTexturePreview() {
            this.texturePreviewVisible = true;
        },
        
        hideTexturePreview() {
            this.texturePreviewVisible = false;
        },
        
        showToolsPanel() {
            this.toolsPanelVisible = true;
        },

        hideToolsPanel() {
            this.toolsPanelVisible = false;
        },

        showEmojiPicker() {
            this.emojiPickerVisible = true;
        },

        hideEmojiPicker() {
            this.emojiPickerVisible = false;
        },

        showAboutPanel() {
            this.aboutPanelVisible = true;
        },

        hideAboutPanel() {
            this.aboutPanelVisible = false;
        },

        showSlyce() {
            this.textureCreatorVisible = true;
        },
        
        hideSlyce() {
            this.textureCreatorVisible = false;
        },
        
        toggleSlyce() {
            this.textureCreatorVisible = !this.textureCreatorVisible;
        },

        showRealtimeSampler() {
            this.realtimeSamplerVisible = true;
        },

        hideRealtimeSampler() {
            this.realtimeSamplerVisible = false;
        },
        
        setThumbnailUrl(url) {
            this.thumbnailUrl = url;
        },

        setTextureRepeatMode(mode) {
            this.textureRepeatMode = mode === 'mirrorBounce' ? 'mirrorBounce' : 'wrap';
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

        setCapStyle(style) {
            const nextStyle = normalizeCapStyle(style, this.roundedCaps);
            this.capStyle = nextStyle;
            this.roundedCaps = nextStyle === CAP_STYLE_ROUNDED;
        },

        setRoundedCaps(enabled) {
            this.setCapStyle(enabled ? CAP_STYLE_ROUNDED : 'square');
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
            capStyle: normalizeCapStyle(state.capStyle, state.roundedCaps),
            roundedCaps: normalizeCapStyle(state.capStyle, state.roundedCaps) === CAP_STYLE_ROUNDED,
        }),
    }
});
