// src/main.js
// Vue 3 entry point for unified rivvon app (viewer + slyce)

import { createPinia } from 'pinia';
import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import App from './App.vue';
import router from './router';
import './style.css';

// Material Icons - combined from both apps
import { loadMaterialSymbols } from './modules/shared/iconLoader';
loadMaterialSymbols([ 
    'sprint', 'upload', 'grid_view', 'text_fields', 
    'fullscreen', 'logout', 'login', 'draw', 'info', 'drive_file_move', 'cloud', 'person',
    'home', 'palette', 'settings', 'rotate_90_degrees_cw',
    'step_over', 'close_fullscreen', 'open_in_full', 'warning',
    'video_file', 'frame_source', 'barcode', 'timer', 'speed',
    'calculate', 'view_compact', 'rotate_right', 'equalizer',
    'arrow_range', 'double_arrow', 'filter_alt', 'play_arrow', 'volume_off', 'volume_up', 'pause',
    'account_circle', 'crop', 'save', 'folder','texture','arrow_back', 'arrow_forward', 'video_camera_back_add','arrow_back_ios','check','done_outline','visibility','hard_drive','cloud_upload','folder_zip','menu','block','animation',
    'polyline','file_export','image','airwave','videocam','content_copy','delete'
]);

// Import utilities
import { chooseRenderer } from './utils/renderer-utils';
import { useViewerStore } from './stores/viewerStore';
import { useSlyceStore } from './stores/slyceStore';
import { useGoogleAuth } from './composables/shared/useGoogleAuth';
import { initAuth } from './modules/viewer/auth';

const app = createApp(App);

// Pinia store
const pinia = createPinia();
app.use(pinia);

// Vue Router
app.use(router);

// PrimeVue configuration
app.use(PrimeVue, {
    theme: {
        preset: Aura,
        options: {
            darkModeSelector: '.app-dark'
        }
    }
});

// PrimeVue directives
import Tooltip from 'primevue/tooltip';
app.directive('tooltip', Tooltip);

// Lazy load BASIS module only when visiting Slyce routes
async function loadBasisForSlyce() {
    try {
        const { loadBasisModule } = await import('./modules/slyce/load_basis.js');
        await loadBasisModule();
        console.log('[Main] BASIS module preloaded for Slyce');
    } catch (error) {
        console.warn('[Main] BASIS module load failed (non-critical for viewer):', error);
    }
}

// Initialize app
(async () => {
    try {
        // Choose renderer first
        const rendererType = await chooseRenderer();
        console.log('[Main] Renderer type determined:', rendererType);

        // Mount app - only once
        app.mount('#app');

        // Set renderer type in stores after app is mounted
        const viewerStore = useViewerStore();
        const slyceStore = useSlyceStore();
        viewerStore.rendererType = rendererType;
        slyceStore.rendererType = rendererType;
        
        // Enable debug mode if #debug hash is present
        if (window.location.hash === '#debug') {
            viewerStore.debugMode = true;
        }

        // Check for existing Google Auth session
        const { checkSession } = useGoogleAuth();
        await checkSession();
        console.log('[Main] Auth session checked');
        
        // Also initialize vanilla auth module (used by TileManager for Drive API)
        await initAuth();

        // Preload BASIS module if starting on Slyce route
        if (window.location.pathname.startsWith('/slyce')) {
            loadBasisForSlyce();
        }

        // Load BASIS module when navigating to Slyce routes
        router.beforeEach((to, from, next) => {
            if (to.path.startsWith('/slyce') && !from.path.startsWith('/slyce')) {
                loadBasisForSlyce();
            }
            next();
        });

    } catch (error) {
        console.error('[Main] Initialization error:', error);
        // Only mount if not already mounted
        if (!app._container) {
            app.mount('#app');
        }
    }
})();
