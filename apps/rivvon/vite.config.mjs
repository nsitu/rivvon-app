// vite.config.mjs
// Unified Vue 3 rivvon app (viewer + slyce)
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueDevTools from 'vite-plugin-vue-devtools';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
    base: '/',
    build: {
        target: 'esnext',
        outDir: 'dist',
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
            },
        },
    },
    optimizeDeps: {
        esbuildOptions: {
            target: 'esnext',
        }
    },
    plugins: [
        tailwindcss(),
        vue(),
        vueDevTools(),
    ],
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
            '@viewer': resolve(__dirname, 'src/modules/viewer'),
            '@slyce': resolve(__dirname, 'src/modules/slyce'),
            '@shared': resolve(__dirname, 'src/modules/shared'),
        }
    },
    // Dev server configuration
    server: {
        open: '/',
        headers: {
            // Using 'credentialless' instead of 'require-corp' to allow cross-origin images
            // (thumbnails from cdn.rivvon.ca, Google profile pics) without CORP headers
            // SharedArrayBuffer is still available with credentialless COEP
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'credentialless',
        },
    },
    // Worker configuration for Slyce's web workers
    worker: {
        format: 'es',
    },
});

