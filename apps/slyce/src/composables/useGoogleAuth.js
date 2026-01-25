// src/composables/useGoogleAuth.js

import { ref, computed } from 'vue'

const API_URL = import.meta.env.VITE_API_URL || ''

// Shared state across all component instances
const user = ref(null)
const isLoading = ref(false)
const error = ref(null)

// In-memory token cache (never localStorage!)
let accessToken = null
let tokenExpiresAt = null

export function useGoogleAuth() {
  const isAuthenticated = computed(() => !!user.value)

  /**
   * Initiate login - redirect through backend
   * Backend handles CSRF state generation and stores it in HTTP-only cookie
   */
  function login() {
    // Save current route to redirect back after login
    sessionStorage.setItem('auth_redirect', window.location.pathname)
    window.location.href = `${API_URL}/api/auth/login`
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
      console.error('Logout error:', e)
    }
    
    user.value = null
    accessToken = null
    tokenExpiresAt = null
    error.value = null
  }

  /**
   * Check existing session on page load
   * Reads session from HTTP-only cookie
   */
  async function checkSession() {
    isLoading.value = true
    error.value = null
    
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        credentials: 'include'
      })
      
      if (response.ok) {
        const data = await response.json()
        user.value = data.user
      } else {
        // Not authenticated - that's ok
        user.value = null
      }
    } catch (e) {
      console.error('Session check error:', e)
      user.value = null
    } finally {
      isLoading.value = false
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
        accessToken = null
        tokenExpiresAt = null
        
        if (data.needsReauth) {
          error.value = 'Session expired. Please log in again.'
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
  }

  return {
    // State
    user,
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
