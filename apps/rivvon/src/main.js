// src/main.js
// Vue 3 entry point for unified rivvon app (viewer + slyce)

import { createPinia } from 'pinia';
import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';
import App from './App.vue';
import router from './router';
import './style.css';

// Material Icons - combined from both apps
import { loadMaterialSymbols } from './modules/shared/iconLoader';
loadMaterialSymbols([ 
    'sprint', 'upload', 'grid_view', 'text_fields', 
    'fullscreen', 'fullscreen_exit', 'logout', 'login', 'draw', 'info', 'drive_file_move', 'cloud', 'person',
    'home', 'palette', 'settings', 'rotate_90_degrees_cw',
    'step_over', 'close_fullscreen', 'open_in_full', 'warning',
    'video_file', 'frame_source', 'barcode', 'timer', 'speed',
    'calculate', 'view_compact', 'rotate_right', 'equalizer',
    'arrow_range', 'resize', 'double_arrow', 'filter_alt', 'play_arrow', 'volume_off', 'volume_up', 'pause',
    'account_circle', 'crop', 'save', 'folder','texture','arrow_back', 'arrow_forward', 'video_camera_back_add','arrow_back_ios','check','done_outline','visibility','hard_drive','cloud_upload','folder_zip','menu','block','animation',
    'polyline','file_export','image','airwave','videocam','content_copy','delete','edit','instant_mix','visibility_off',
    'cancel','restart_alt','center_focus_strong','theaters','stop','delete_sweep','close','mood','progress_activity',
    'genetics','rounded_corner','change_history','face','3d_rotation','open_with',
    'checklist','check_box','check_box_outline_blank','monitoring',
    'stop_circle','cameraswitch','construction','check_circle','memory','movie','camera_video','schedule','directions_walk',
    'play_circle','download_done','line_curve','crop_free','layers','content_cut','tag','aspect_ratio',
    'repeat','swap_horiz'
]);

// Import utilities
import { chooseRenderer } from './utils/renderer-utils';
import { useViewerStore } from './stores/viewerStore';
import { useSlyceStore } from './stores/slyceStore';
import { useGoogleAuth } from './composables/shared/useGoogleAuth';
import { initAuth } from './modules/viewer/auth';

const RivvonPreset = definePreset(Aura, {
    components: {
        stepper: {
            step: {
                padding: '0',
                gap: '0'
            },
            steppanels: {
                padding: '1.5rem 0'
            },
            steppanel: {
                background: 'transparent',
                padding: '0'
            }
        }
    }
});

const app = createApp(App);

// Pinia store
const pinia = createPinia();
app.use(pinia);

// Vue Router
app.use(router);

// PrimeVue configuration
app.use(PrimeVue, {
    theme: {
        preset: RivvonPreset,
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
