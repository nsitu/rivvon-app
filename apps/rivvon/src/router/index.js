// src/router/index.js
// Vue Router configuration for rivvon (unified app)

import { createRouter, createWebHistory } from 'vue-router';

const routes = [
    // ============ VIEWER ROUTES ============
    {
        path: '/',
        name: 'home',
        component: () => import('../views/RibbonView.vue')
    },
    {
        path: '/texture/:textureId',
        name: 'texture',
        component: () => import('../views/RibbonView.vue'),
        props: true
    },
    {
        path: '/videos',
        name: 'video-gallery',
        component: () => import('../views/RibbonView.vue')
    },
    {
        path: '/video/:videoId',
        name: 'video-player',
        component: () => import('../views/RibbonView.vue'),
        props: true
    },
    {
        path: '/audios',
        name: 'audio-library',
        component: () => import('../views/RibbonView.vue')
    },
    {
        path: '/audio/:audioId',
        name: 'audio-player',
        component: () => import('../views/RibbonView.vue'),
        props: true
    },
    
    // ============ TEXTURE CREATION ROUTES ============
    {
        // Canonical creator entry point.
        path: '/create',
        name: 'create-texture',
        redirect: { path: '/', query: { create: 'true' } }
    },
    {
        // Legacy Slyce URL. Keep it working while the product moves to Rivvon naming.
        path: '/slyce',
        name: 'slyce-legacy',
        redirect: { path: '/', query: { create: 'true' } }
    },
    {
        // Redirect to viewer with realtime webcam panel open
        path: '/realtime',
        name: 'realtime',
        redirect: { path: '/', query: { realtime: 'true' } }
    },
    {
        // Legacy route - redirect to viewer with texture browser open
        path: '/slyce/my-textures',
        name: 'my-textures-legacy',
        redirect: { path: '/', query: { textures: 'mine' } }
    },
    {
        // Canonical local texture library.
        path: '/local-textures',
        name: 'local-textures',
        component: () => import('../views/LocalTexturesView.vue'),
        meta: { layout: 'document' }
    },
    {
        // Legacy Slyce URL. Keep it as a redirect rather than exposing the old brand.
        path: '/slyce/local',
        name: 'local-textures-legacy',
        redirect: { name: 'local-textures' }
    },
    
    // ============ SHARED ROUTES ============
    {
        path: '/callback',
        name: 'callback',
        component: () => import('../views/CallbackView.vue')
    },
    {
        // Login route - redirects to appropriate page, handles error display
        path: '/login',
        name: 'login',
        redirect: (to) => {
            // Check where the user came from
            const redirect = sessionStorage.getItem('auth_redirect') || '/';
            sessionStorage.removeItem('auth_redirect');
            
            // If there's an error, pass it to the redirect page
            if (to.query.error) {
                return { path: redirect, query: { auth_error: to.query.error } }
            }
            return redirect;
        }
    }
];

const router = createRouter({
    history: createWebHistory(),
    routes
});

export default router;
