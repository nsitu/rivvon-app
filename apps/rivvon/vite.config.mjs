// vite.config.mjs
// Unified Vue 3 rivvon app (viewer + slyce)
import { defineConfig, normalizePath } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueDevTools from 'vite-plugin-vue-devtools';
import tailwindcss from '@tailwindcss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';

const TASKS_VISION_VERSION = '0.10.34';
const TASKS_VISION_WASM_SOURCE = normalizePath(resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm/*'));
const TASKS_VISION_WASM_DEST = `vendor/mediapipe/tasks-vision/${TASKS_VISION_VERSION}/wasm`;

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
        viteStaticCopy({
            targets: [
                {
                    src: TASKS_VISION_WASM_SOURCE,
                    dest: TASKS_VISION_WASM_DEST,
                },
            ],
        }),
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

