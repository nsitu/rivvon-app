// src/composables/useGoogleAuth.js
// Google Auth composable for rivvon - Vue 3 reactive wrapper around auth module

import { ref, computed } from 'vue';
import { useAppStore } from '../stores/appStore';

const API_BASE_URL = 'https://api.rivvon.ca';

// Shared state across all component instances
const user = ref(null);
const isLoading = ref(false);
const error = ref(null);

// In-memory token cache
let accessToken = null;
let tokenExpiresAt = null;

export function useGoogleAuth() {
    const app = useAppStore();
    const isAuthenticated = computed(() => !!user.value);

    /**
     * Initiate login - redirect through backend
     */
    function login() {
        const redirectTo = encodeURIComponent(window.location.origin);
        window.location.href = `${API_BASE_URL}/api/auth/login?redirect_to=${redirectTo}`;
    }

    /**
     * Logout - clear cookies and local state
     */
    async function logout() {
        try {
            await fetch(`${API_BASE_URL}/api/auth/logout`, {
                method: 'POST',
                credentials: 'include'
            });
        } catch (e) {
            console.error('[Auth] Logout error:', e);
        }

        user.value = null;
        accessToken = null;
        tokenExpiresAt = null;
        error.value = null;
        app.clearUser();
    }

    /**
     * Check existing session on page load
     * Endpoint always returns 200 - auth state is in the response body
     */
    async function checkSession() {
        isLoading.value = true;

        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();

                if (data.authenticated && data.user) {
                    user.value = data.user;
                    app.setUser(data.user);
                    console.log('[Auth] Session found:', user.value.name);
                } else {
                    user.value = null;
                    app.clearUser();
                    console.log('[Auth] No active session');
                }
            } else {
                // Unexpected error - endpoint should always return 200
                console.error('[Auth] Unexpected response:', response.status);
                user.value = null;
                app.clearUser();
            }
        } catch (e) {
            // Network error
            console.error('[Auth] Network error:', e.message);
            user.value = null;
            app.clearUser();
        } finally {
            isLoading.value = false;
        }
    }

    /**
     * Get fresh access token for Drive operations
     */
    async function getAccessToken() {
        // Return cached token if still valid (with 5 min buffer)
        if (accessToken && tokenExpiresAt > Date.now() + 5 * 60 * 1000) {
            return accessToken;
        }

        // Request fresh token from backend
        const response = await fetch(`${API_BASE_URL}/api/auth/drive-token`, {
            credentials: 'include'
        });

        if (!response.ok) {
            if (response.status === 401) {
                // Refresh token expired or revoked
                user.value = null;
                accessToken = null;
                tokenExpiresAt = null;
                app.clearUser();
                throw new Error('Authentication expired. Please log in again.');
            }
            throw new Error('Failed to get access token');
        }

        const data = await response.json();
        accessToken = data.accessToken;
        // Assume 1 hour expiry, cache for 55 minutes
        tokenExpiresAt = Date.now() + 55 * 60 * 1000;
        return accessToken;
    }

    /**
     * Fetch a file from Google Drive
     */
    async function fetchDriveFile(driveFileId) {
        const token = await getAccessToken();
        if (!token) {
            throw new Error('Not authenticated');
        }

        const response = await fetch(
            `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to fetch Drive file: ${response.status}`);
        }

        return response.arrayBuffer();
    }

    return {
        user,
        isAuthenticated,
        isLoading,
        error,
        login,
        logout,
        checkSession,
        getAccessToken,
        fetchDriveFile
    };
}
