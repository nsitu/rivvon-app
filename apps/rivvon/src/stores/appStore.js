// src/stores/appStore.js
// Pinia store for rivvon global state

import { defineStore } from 'pinia';

export const useAppStore = defineStore('appStore', {
    state: () => ({
        // Renderer state
        rendererType: 'webgl',    // 'webgl' | 'webgpu'
        
        // Drawing state
        isDrawingMode: false,
        strokeCount: 0,
        countdownSeconds: null,
        
        // Ribbon/3D state
        flowEnabled: false,
        
        // Texture state
        currentTextureId: null,
        thumbnailUrl: null,
        
        // Text to SVG
        textPanelVisible: false,
        selectedFont: null,
        
        // Texture browser
        textureBrowserVisible: false,
        
        // Auth state
        isAuthenticated: false,
        user: null,
        
        // UI state
        betaModalVisible: false,
        betaModalReason: null, // 'default' | 'texture-auth' | 'access-denied'
        debugMode: false,
        
        // Three.js references (set by composable)
        threeContext: null,
    }),
    
    actions: {
        setDrawingMode(enabled) {
            this.isDrawingMode = enabled;
        },
        
        setUser(user) {
            this.user = user;
            this.isAuthenticated = !!user;
        },
        
        clearUser() {
            this.user = null;
            this.isAuthenticated = false;
        },
        
        toggleFlow() {
            this.flowEnabled = !this.flowEnabled;
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
        
        setThumbnailUrl(url) {
            this.thumbnailUrl = url;
        },
        
        setStrokeCount(count) {
            this.strokeCount = count;
        },
        
        setCountdownSeconds(seconds) {
            this.countdownSeconds = seconds;
        },
        
        setThreeContext(context) {
            this.threeContext = context;
        },
    },
    
    getters: {
        userName: (state) => state.user?.name || state.user?.email || 'User',
        hasActiveStrokes: (state) => state.strokeCount > 0,
    }
});
