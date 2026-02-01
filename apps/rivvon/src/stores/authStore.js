// src/stores/authStore.js
// Pinia store for shared authentication state

import { defineStore } from 'pinia';

export const useAuthStore = defineStore('auth', {
    state: () => ({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
    }),
    
    actions: {
        setUser(user) {
            this.user = user;
            this.isAuthenticated = !!user;
        },
        
        clearUser() {
            this.user = null;
            this.isAuthenticated = false;
        },
        
        setLoading(loading) {
            this.isLoading = loading;
        },
        
        setError(error) {
            this.error = error;
        },
    },
    
    getters: {
        userName: (state) => state.user?.name || state.user?.email || 'User',
        userPicture: (state) => state.user?.picture || null,
    }
});
