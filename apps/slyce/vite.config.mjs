// vite.config.mjs
import { defineConfig } from 'vite';
import vueDevTools from 'vite-plugin-vue-devtools'
import vue from '@vitejs/plugin-vue';

import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    base: '/',
    plugins: [

        tailwindcss(),
        vue(),
        vueDevTools(),
    ]
});

