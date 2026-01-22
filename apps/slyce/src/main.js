
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import { createAuth0 } from '@auth0/auth0-vue';
import PrimeVue from 'primevue/config';
import Aura from '@primevue/themes/aura';
import App from './App.vue';
import router from './router';


// Material Icons 
import { loadMaterialSymbols } from './modules/iconLoader';
// Pass an array icon names to be loaded via Google Fonts CDN
loadMaterialSymbols([
    'home', 'palette', 'settings', 'info', 'rotate_90_degrees_cw',
    'step_over', 'close_fullscreen', 'open_in_full', 'warning',
    'video_file', 'frame_source', 'barcode', 'timer', 'speed',
    'calculate', 'view_compact', 'rotate_right', 'equalizer',
    'arrow_range', 'double_arrow', 'filter_alt', 'play_arrow', 'volume_off', 'volume_up', 'pause',
    'login', 'logout', 'account_circle'
])
// Note: we could also import the entire set, but the bundle is too big.
// import 'material-symbols/outlined.css';


const app = createApp(App);

const pinia = createPinia();
app.use(pinia);

// Configure Vue Router
app.use(router);

// Configure Auth0
app.use(
    createAuth0({
        domain: import.meta.env.VITE_AUTH0_DOMAIN,
        clientId: import.meta.env.VITE_AUTH0_CLIENT_ID,
        authorizationParams: {
            redirect_uri: import.meta.env.VITE_AUTH0_REDIRECT_URI || window.location.origin + '/callback',
            audience: import.meta.env.VITE_AUTH0_AUDIENCE,
            scope: 'openid profile email upload:textures delete:textures',
        },
        cacheLocation: 'localstorage', // Persist auth across page reloads
    })
);

app.use(PrimeVue, {
    theme: {
        preset: Aura
    }
})


import Tooltip from 'primevue/tooltip';
app.directive('tooltip', Tooltip);

// Initialize BASIS Universal WASM for KTX2 encoding
// This preloads the encoder so it's ready when needed
import { loadBasisModule } from './modules/load_basis.js';
import { useAppStore } from './stores/appStore.js';
import { chooseRenderer } from './utils/renderer-utils.js';


// Initialize app
(async () => {
    try {
        // Choose renderer first
        const rendererType = await chooseRenderer();

        // Load BASIS module
        await loadBasisModule();
        console.log('[Main] BASIS module preloaded successfully');

        // Mount app
        app.mount('#app');

        // Set renderer type in store after app is mounted (so store is available)
        const store = useAppStore();
        store.rendererType = rendererType;
        console.log('[Main] Renderer type set in store:', rendererType);

    } catch (error) {
        console.error('[Main] Initialization error:', error);
        // Mount anyway - app can still work with WebM
        app.mount('#app');
    }
})();
