// src/router/index.js
// Vue Router configuration for rivvon (unified app)

import { createRouter, createWebHistory } from 'vue-router';

const routes = [
    // ============ VIEWER ROUTES ============
    {
        path: '/',
        name: 'home',
        component: () => import('../views/viewer/RibbonView.vue')
    },
    {
        path: '/texture/:textureId',
        name: 'texture',
        component: () => import('../views/viewer/RibbonView.vue'),
        props: true
    },
    
    // ============ SLYCE ROUTES ============
    {
        // Redirect to viewer with slyce panel open
        path: '/slyce',
        name: 'slyce',
        redirect: { path: '/', query: { slyce: 'true' } }
    },
    {
        // Legacy route - redirect to viewer with texture browser open
        path: '/slyce/my-textures',
        name: 'my-textures',
        redirect: { path: '/', query: { textures: 'mine' } }
    },
    {
        path: '/slyce/local',
        name: 'local-textures',
        component: () => import('../views/slyce/LocalTexturesView.vue')
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
