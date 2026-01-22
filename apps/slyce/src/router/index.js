import { createRouter, createWebHistory } from 'vue-router'

const routes = [
    {
        path: '/',
        name: 'home',
        component: () => import('../views/HomeView.vue')
    },
    {
        path: '/my-textures',
        name: 'my-textures',
        component: () => import('../views/MyTexturesView.vue')
    },
    {
        path: '/callback',
        name: 'callback',
        component: () => import('../views/CallbackView.vue')
    }
]

const router = createRouter({
    history: createWebHistory(),
    routes
})

export default router
