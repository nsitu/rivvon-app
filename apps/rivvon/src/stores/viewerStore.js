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
        
        setFullscreen(enabled) {
            this.isFullscreen = enabled;
        },
    },
    
    getters: {
        hasActiveStrokes: (state) => state.strokeCount > 0,
        flowEnabled: (state) => state.flowState !== 'off',
    }
});
