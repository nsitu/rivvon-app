// src/stores/viewerStore.js
// Pinia store for rivvon viewer state

import { defineStore } from 'pinia';

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
        
        // Ribbon/3D state
        flowState: 'off', // 'off' | 'forward' | 'backward'
        flowSpeed: 0.25, // Base flow speed (positive value)
        
        // Texture state
        currentTextureId: null,
        thumbnailUrl: null,
        
        // Text to SVG
        textPanelVisible: false,
        selectedFont: null,
        
        // Texture browser
        textureBrowserVisible: false,
        
        // Slyce panel
        textureCreatorVisible: false,
        
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
        
        setThumbnailUrl(url) {
            this.thumbnailUrl = url;
        },
        
        setStrokeCount(count) {
            this.strokeCount = count;
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
    },
    
    getters: {
        hasActiveStrokes: (state) => state.strokeCount > 0,
        flowEnabled: (state) => state.flowState !== 'off',
    }
});
