// vite.config.mjs
// Vue 3 version of rivvon
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
        }
    },
    // Dev server configuration
    server: {
        open: '/',
    },
});

