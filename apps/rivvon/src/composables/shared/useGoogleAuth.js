// src/composables/shared/useGoogleAuth.js
// Unified Google Auth composable for both Viewer and Slyce

import { ref, computed } from 'vue'
import { useAuthStore } from '../../stores/authStore'

const API_URL = import.meta.env.VITE_API_URL || 'https://api.rivvon.ca'

// Shared state across all component instances
const user = ref(null)
const isAdmin = ref(false)
const isLoading = ref(false)
const error = ref(null)

// In-memory token cache (never localStorage!)
let accessToken = null
let tokenExpiresAt = null

export function useGoogleAuth() {
    const authStore = useAuthStore()
    const isAuthenticated = computed(() => !!user.value)

    /**
     * Initiate login - redirect through backend
     * Backend handles CSRF state generation and stores it in HTTP-only cookie
     */
    function login() {
        // Save current route to redirect back after login
        sessionStorage.setItem('auth_redirect', window.location.pathname)
        const redirectTo = encodeURIComponent(window.location.origin)
        window.location.href = `${API_URL}/api/auth/login?redirect_to=${redirectTo}`
    }

    /**
     * Logout - clear cookies and local state
     */
    async function logout() {
        try {
            await fetch(`${API_URL}/api/auth/logout`, {
                method: 'POST',
                credentials: 'include'
            })
        } catch (e) {
            console.error('[Auth] Logout error:', e)
        }

        user.value = null
        isAdmin.value = false
        accessToken = null
        tokenExpiresAt = null
        error.value = null
        authStore.clearUser()
    }

    /**
     * Check existing session on page load
     * Reads session from HTTP-only cookie
     */
    async function checkSession() {
        isLoading.value = true
        error.value = null
        authStore.setLoading(true)

        try {
            const response = await fetch(`${API_URL}/api/auth/me`, {
                credentials: 'include'
            })

            if (response.ok) {
                const data = await response.json()
                
                if (data.authenticated && data.user) {
                    user.value = data.user
                    isAdmin.value = data.isAdmin || false
                    authStore.setUser(data.user)
                    console.log('[Auth] Session found:', user.value.name)
                    console.log('[Auth] User email:', user.value.email)
                    console.log('[Auth] Admin status:', isAdmin.value ? '✓ ADMIN' : 'regular user')
                } else {
                    user.value = null
                    isAdmin.value = false
                    authStore.clearUser()
                    console.log('[Auth] No active session')
                }
            } else {
                // Not authenticated - that's ok
                user.value = null
                isAdmin.value = false
                authStore.clearUser()
            }
        } catch (e) {
            console.error('[Auth] Session check error:', e)
            user.value = null
            isAdmin.value = false
            authStore.clearUser()
        } finally {
            isLoading.value = false
            authStore.setLoading(false)
        }
    }

    /**
     * Get fresh access token for Drive operations
     * Tokens are exchanged via backend using HTTP-only refresh token cookie
     */
    async function getAccessToken() {
        // Return cached token if still valid (with 5 min buffer)
        if (accessToken && tokenExpiresAt > Date.now() + 5 * 60 * 1000) {
            return accessToken
        }

        // Request fresh token from backend
        // Backend reads refresh_token from HTTP-only cookie
        const response = await fetch(`${API_URL}/api/auth/drive-token`, {
            credentials: 'include'
        })

        if (!response.ok) {
            const data = await response.json()

            if (response.status === 401) {
                // Refresh token expired or revoked, need to re-login
                user.value = null
                isAdmin.value = false
                accessToken = null
                tokenExpiresAt = null
                authStore.clearUser()

                if (data.needsReauth) {
                    error.value = 'Session expired. Please log in again.'
                    authStore.setError('Session expired. Please log in again.')
                }
                return null
            }
            throw new Error(data.error || 'Failed to get access token')
        }

        const data = await response.json()
        accessToken = data.accessToken // Cache in memory only
        tokenExpiresAt = Date.now() + (data.expiresIn * 1000)

        return accessToken
    }

    /**
     * Get the user's cached Drive folder ID
     * Returns null if not yet created
     */
    async function getDriveFolderId() {
        const response = await fetch(`${API_URL}/api/auth/drive-token`, {
            credentials: 'include'
        })

        if (!response.ok) {
            return null
        }

        const data = await response.json()
        return data.slyceFolderId
    }

    /**
     * Clear any auth error
     */
    function clearError() {
        error.value = null
        authStore.setError(null)
    }

    return {
        // State
        user,
        isAdmin,
        isAuthenticated,
        isLoading,
        error,

        // Actions
        login,
        logout,
        checkSession,
        getAccessToken,
        getDriveFolderId,
        clearError
    }
}
