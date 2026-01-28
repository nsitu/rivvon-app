// src-vue/router/index.js
// Vue Router configuration for rivvon

import { createRouter, createWebHistory } from 'vue-router';

const routes = [
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
        path: '/callback',
        name: 'callback',
        component: () => import('../views/CallbackView.vue')
    },
    {
        // Login route - redirects to home, handles error display
        path: '/login',
        name: 'login',
        redirect: (to) => {
            // If there's an error, pass it to home
            if (to.query.error) {
                return { path: '/', query: { auth_error: to.query.error } }
            }
            return '/'
        }
    }
];

const router = createRouter({
    history: createWebHistory(),
    routes
});

export default router;
