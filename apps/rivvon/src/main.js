// src/main.js
// Vue 3 entry point for rivvon

import { createPinia } from 'pinia';
import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primevue/themes/aura';
import App from './App.vue';
import router from './router';
import './style.css';

// Material Icons 
import { loadMaterialSymbols } from './modules/iconLoader';
loadMaterialSymbols([
    'sprint', 'upload', 'grid_view', 'text_fields', 
    'fullscreen', 'logout', 'login', 'draw', 'info','drive_file_move','cloud','person'
]);

// Import utilities
import { chooseRenderer } from './utils/renderer-utils';
import { useAppStore } from './stores/appStore';
import { useGoogleAuth } from './composables/useGoogleAuth';
import { initAuth } from './modules/auth';

const app = createApp(App);

// Pinia store
const pinia = createPinia();
app.use(pinia);

// Vue Router
app.use(router);

// PrimeVue configuration
app.use(PrimeVue, {
    theme: {
        preset: Aura
    }
});

// PrimeVue directives
import Tooltip from 'primevue/tooltip';
app.directive('tooltip', Tooltip);

// Initialize app
(async () => {
    try {
        // Choose renderer first
        const rendererType = await chooseRenderer();
        console.log('[Main] Renderer type determined:', rendererType);

        // Mount app - only once
        app.mount('#app');

        // Set renderer type in store after app is mounted
        const store = useAppStore();
        store.rendererType = rendererType;
        
        // Enable debug mode if #debug hash is present
        if (window.location.hash === '#debug') {
            store.debugMode = true;
        }

        // Check for existing Google Auth session (Vue composable)
        const { checkSession } = useGoogleAuth();
        await checkSession();
        
        // Also initialize vanilla auth module (used by TileManager for Drive API)
        await initAuth();
        
        console.log('[Main] Auth session checked');

    } catch (error) {
        console.error('[Main] Initialization error:', error);
        // Only mount if not already mounted
        if (!app._container) {
            app.mount('#app');
        }
    }
})();
