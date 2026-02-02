// src/modules/auth.js
// Google Auth module for Rivvon
// Provides authentication state and access token for Google Drive API

const API_BASE_URL = 'https://api.rivvon.ca';

// Auth state
let currentUser = null;
let accessToken = null;
let isInitialized = false;

// Callbacks for auth state changes
const authListeners = new Set();

/**
 * Add a listener for auth state changes
 * @param {Function} callback - Called with (user, isAuthenticated) when auth state changes
 */
export function onAuthStateChange(callback) {
    authListeners.add(callback);
    // Immediately call with current state if already initialized
    if (isInitialized) {
        callback(currentUser, !!currentUser);
    }
    return () => authListeners.delete(callback);
}

/**
 * Notify all listeners of auth state change
 */
function notifyListeners() {
    authListeners.forEach(callback => {
        try {
            callback(currentUser, !!currentUser);
        } catch (err) {
            console.error('[Auth] Listener error:', err);
        }
    });
}

/**
 * Initialize auth state by checking for existing session
 * Should be called early in app startup
 */
export async function initAuth() {
    if (isInitialized) return;

    console.log('[Auth] Initializing...');

    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
            credentials: 'include',
        });

        if (response.ok) {
            const data = await response.json();
            // API returns { authenticated: boolean, user?: {...} }
            if (data.authenticated && data.user) {
                currentUser = data.user;
                console.log('[Auth] Session found:', currentUser.name);
            } else {
                currentUser = null;
                console.log('[Auth] No active session');
            }
        } else {
            currentUser = null;
            console.log('[Auth] No active session');
        }
    } catch (err) {
        console.error('[Auth] Failed to check session:', err);
        currentUser = null;
    }

    isInitialized = true;
    notifyListeners();
}

/**
 * Check if user is authenticated
 * @returns {boolean}
 */
export function isAuthenticated() {
    return !!currentUser;
}

/**
 * Get current user info
 * @returns {Object|null}
 */
export function getUser() {
    return currentUser;
}

/**
 * Redirect to Google login
 * After login, user will be redirected back to this app
 */
export function login() {
    const redirectTo = encodeURIComponent(window.location.origin);
    window.location.href = `${API_BASE_URL}/api/auth/login?redirect_to=${redirectTo}`;
}

/**
 * Log out the current user
 */
export async function logout() {
    try {
        await fetch(`${API_BASE_URL}/api/auth/logout`, {
            method: 'POST',
            credentials: 'include',
        });
    } catch (err) {
        console.error('[Auth] Logout error:', err);
    }

    currentUser = null;
    accessToken = null;
    notifyListeners();
}

/**
 * Get a valid Google access token for Drive API
 * Fetches fresh token from backend (which handles refresh)
 * @returns {Promise<string|null>} Access token or null if not authenticated
 */
export async function getAccessToken() {
    if (!currentUser) {
        return null;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/drive-token`, {
            credentials: 'include',
        });

        if (!response.ok) {
            console.error('[Auth] Failed to get access token:', response.status);
            return null;
        }

        const data = await response.json();
        accessToken = data.accessToken;
        return accessToken;
    } catch (err) {
        console.error('[Auth] Failed to get access token:', err);
        return null;
    }
}

/**
 * Fetch a file from Google Drive using the Drive API
 * This bypasses CORS issues with direct Drive links
 * @param {string} driveFileId - The Google Drive file ID
 * @param {Function} onBytesReceived - Optional callback for streaming progress: (bytes) => {}
 * @returns {Promise<ArrayBuffer>} The file data
 */
export async function fetchDriveFile(driveFileId, onBytesReceived = null) {
    const token = await getAccessToken();
    if (!token) {
        throw new Error('Not authenticated - please log in to view this texture');
    }

    const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`,
        {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        }
    );

    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            throw new Error('Access denied - you may not have permission to view this file');
        }
        throw new Error(`Failed to fetch file: ${response.statusText}`);
    }

    // If we have streaming support and a progress callback, use streaming
    if (onBytesReceived && response.body) {
        const reader = response.body.getReader();
        const chunks = [];
        let receivedLength = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            receivedLength += value.length;

            // Report bytes received
            onBytesReceived(value.length);
        }

        // Combine chunks into single ArrayBuffer
        const buffer = new Uint8Array(receivedLength);
        let position = 0;
        for (const chunk of chunks) {
            buffer.set(chunk, position);
            position += chunk.length;
        }

        return buffer.buffer;
    }

    // Fallback: simple arrayBuffer() call
    return response.arrayBuffer();
}
