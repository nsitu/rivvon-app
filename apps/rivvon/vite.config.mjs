// vite.config.mjs
// Unified Vue 3 rivvon app (viewer + slyce)
import { defineConfig, loadEnv, normalizePath } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueDevTools from 'vite-plugin-vue-devtools';
import tailwindcss from '@tailwindcss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';
import { getRuntimeAssetEntries } from './config/runtimeAssets.mjs';

const TASKS_VISION_VERSION = '0.10.34';
const TASKS_VISION_WASM_SOURCE = normalizePath(resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm/*'));
const TASKS_VISION_WASM_DEST = `vendor/mediapipe/tasks-vision/${TASKS_VISION_VERSION}/wasm`;
const BUILD_TIMESTAMP = new Date().toISOString();
const RUNTIME_ASSET_COPY_DEST = '.';

function resolveManualChunk(id) {
    const normalizedId = id.split('\\').join('/');

    if (!normalizedId.includes('/node_modules/')) {
        return undefined;
    }

    if (normalizedId.includes('/node_modules/@sentry/')) {
        return 'sentry';
    }

    if (normalizedId.includes('three.webgpu')) {
        return 'three-webgpu';
    }

    if (normalizedId.includes('three.tsl')) {
        return 'three-tsl';
    }

    if (normalizedId.includes('/node_modules/three/examples/jsm/') || normalizedId.includes('/node_modules/three/addons/')) {
        return 'three-addons';
    }

    if (normalizedId.includes('/node_modules/three/')) {
        return 'three-core';
    }

    return undefined;
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, __dirname, '');
    const shouldCopyRuntimeAssets = env.VITE_ASSET_MODE === 'local' || !env.VITE_ASSET_BASE_URL;
    const staticCopyTargets = [
        {
            src: TASKS_VISION_WASM_SOURCE,
            dest: TASKS_VISION_WASM_DEST,
        },
    ];

    if (shouldCopyRuntimeAssets) {
        staticCopyTargets.push(
            ...getRuntimeAssetEntries().map((entry) => ({
                src: normalizePath(resolve(__dirname, entry.sourcePath)),
                dest: RUNTIME_ASSET_COPY_DEST,
            }))
        );
    }

    return {
        base: '/',
        define: {
            'import.meta.env.VITE_BUILD_TIMESTAMP': JSON.stringify(BUILD_TIMESTAMP),
        },
        build: {
            target: 'esnext',
            outDir: 'dist',
            rollupOptions: {
                input: {
                    main: resolve(__dirname, 'index.html'),
                },
                output: {
                    manualChunks: resolveManualChunk,
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
                targets: staticCopyTargets,
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
    };
});

