# Google Drive Integration Plan

## Overview

Enable users to store their KTX2 textures in their own Google Drive instead of Cloudflare R2, reducing storage costs at scale. Textures would default to "anyone with the link" sharing for public access.

**Key Decisions Made:**
- ✅ Direct browser-to-Drive uploads (no backend proxy)
- ✅ Thumbnails remain on R2 (small, affordable)
- ✅ Metadata stored in DB (avoid excess Drive API calls)
- ✅ Hybrid storage during transition (user chooses R2 or Drive)
- ✅ Dedicated app folder in user's Drive root
- ✅ May replace Auth0 with direct Google OAuth or Better Auth

---

## Current Architecture

- **Auth0** handles authentication (standard Google social connection)
- **Cloudflare R2** stores KTX2 textures + thumbnails via `api.rivvon.ca`
- **Texture metadata** stored in database, files served from R2

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              User's Browser                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐    │
│   │  Auth        │     │  Thumbnails  │     │  KTX2 Textures       │    │
│   │  (Google)    │     │  (R2)        │     │  (User's Drive)      │    │
│   └──────┬───────┘     └──────┬───────┘     └──────────┬───────────┘    │
│          │                    │                        │                 │
│          ▼                    ▼                        ▼                 │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                        api.rivvon.ca                              │  │
│   │  • User accounts & sessions                                       │  │
│   │  • Texture metadata (name, dimensions, tile count, Drive IDs)    │  │
│   │  • Thumbnail storage (R2)                                         │  │
│   │  • Google token management (encrypted refresh tokens)            │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Data Flow:**
- **Thumbnails**: Browser → Backend → R2 (existing flow, unchanged)
- **KTX2 Textures**: Browser → Google Drive directly (new)
- **Metadata**: Browser → Backend → Database (existing flow, extended)

---

## Authentication Strategy

### Decision: Direct Google OAuth (Option C)

Replace Auth0 entirely with direct Google OAuth. This provides:
- **Single consent screen** for identity + Drive access
- **Simpler architecture** (one auth system, not two)
- **No vendor dependency** (Auth0 subscription not needed)
- **Full control** over tokens and scopes

### Why Not Keep Auth0?

| Issue | Impact |
|-------|--------|
| Standard social connection doesn't expose Google tokens | Can't get Drive access without reconfiguring |
| Reconfiguring to custom OAuth requires re-consent for all users | Disruptive, and still two token systems |
| Auth0 adds complexity | Extra vendor, extra cost, extra abstraction |
| Only Google login is used | No benefit from Auth0's multi-provider support |

### Migration Path

```
Current:  User → Auth0 → Google (identity only)
                ↓
          Auth0 token → Backend API

Target:   User → Google directly (identity + Drive)
                ↓
          Google tokens → Backend API
```

### Implementation Approach

**Google Identity Services (GIS)** for the frontend:
- Modern replacement for deprecated Google Sign-In
- Handles OAuth flow, token management
- Works well with `drive.file` scope

**Backend token validation:**
- Validate Google ID tokens directly
- No Auth0 SDK needed
- Store refresh tokens for Drive access

### Scopes Requested

```javascript
const SCOPES = [
  'openid',                                    // OpenID Connect
  'email',                                     // User's email
  'profile',                                   // Name, picture
  'https://www.googleapis.com/auth/drive.file' // App-created Drive files
]
```

All scopes requested in single consent screen:
```
"Slyce wants to:
 • See your email address
 • See your personal info
 • See, edit, create, and delete only the specific 
   Google Drive files you use with this app"
```

---

## Google OAuth Implementation

### Frontend: Google Identity Services

```javascript
// composables/useGoogleAuth.js

import { ref, computed } from 'vue'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const SCOPES = [
  'openid',
  'email', 
  'profile',
  'https://www.googleapis.com/auth/drive.file'
].join(' ')

export function useGoogleAuth() {
  const user = ref(null)
  const isAuthenticated = computed(() => !!user.value)
  const accessToken = ref(null)
  const tokenExpiresAt = ref(null)
  
  let tokenClient = null
  
  // Initialize Google Identity Services
  function initGoogleAuth() {
    return new Promise((resolve) => {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.onload = () => {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: SCOPES,
          callback: handleTokenResponse,
        })
        resolve()
      }
      document.head.appendChild(script)
    })
  }
  
  // Handle token response from Google
  async function handleTokenResponse(response) {
    if (response.error) {
      console.error('Google auth error:', response.error)
      return
    }
    
    accessToken.value = response.access_token
    tokenExpiresAt.value = Date.now() + (response.expires_in * 1000)
    
    // Get user info
    const userInfo = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${response.access_token}` }
    }).then(r => r.json())
    
    user.value = {
      sub: userInfo.sub,
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture
    }
    
    // Send tokens to backend for session creation
    await createSession(response.access_token)
  }
  
  // Initiate login flow
  function login() {
    tokenClient.requestAccessToken({ prompt: 'consent' })
  }
  
  // Request fresh token (for Drive uploads)
  async function getAccessToken() {
    // If token still valid (with 5 min buffer), return it
    if (accessToken.value && tokenExpiresAt.value > Date.now() + 300000) {
      return accessToken.value
    }
    
    // Request new token silently if possible
    return new Promise((resolve, reject) => {
      tokenClient.requestAccessToken({ prompt: '' })
      // Token will be available after handleTokenResponse
      const checkToken = setInterval(() => {
        if (accessToken.value && tokenExpiresAt.value > Date.now()) {
          clearInterval(checkToken)
          resolve(accessToken.value)
        }
      }, 100)
      
      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(checkToken)
        reject(new Error('Token refresh timeout'))
      }, 30000)
    })
  }
  
  // Send tokens to backend
  async function createSession(token) {
    await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: token }),
      credentials: 'include' // For session cookie
    })
  }
  
  // Logout
  function logout() {
    google.accounts.oauth2.revoke(accessToken.value)
    user.value = null
    accessToken.value = null
    tokenExpiresAt.value = null
    
    // Clear backend session
    fetch('/api/auth/logout', { 
      method: 'POST',
      credentials: 'include'
    })
  }
  
  // Check for existing session on page load
  async function checkSession() {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include'
      })
      if (response.ok) {
        const data = await response.json()
        user.value = data.user
      }
    } catch (e) {
      // No session
    }
  }
  
  return {
    user,
    isAuthenticated,
    accessToken,
    initGoogleAuth,
    login,
    logout,
    getAccessToken,
    checkSession
  }
}
```

### Backend: Session Management

**New Endpoints (replacing Auth0):**

```
POST /api/auth/session     - Create session from Google token
POST /api/auth/logout      - Clear session
GET  /api/auth/me          - Get current user
POST /api/auth/refresh     - Get fresh Google access token
```

**Session Creation Flow:**

```javascript
// POST /api/auth/session
async function createSession(req, res) {
  const { accessToken } = req.body
  
  // 1. Validate token with Google
  const tokenInfo = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`
  ).then(r => r.json())
  
  if (tokenInfo.error) {
    return res.status(401).json({ error: 'Invalid token' })
  }
  
  // 2. Verify token is for our app
  if (tokenInfo.aud !== GOOGLE_CLIENT_ID) {
    return res.status(401).json({ error: 'Token not for this app' })
  }
  
  // 3. Get or create user in database
  const user = await upsertUser({
    googleId: tokenInfo.sub,
    email: tokenInfo.email,
    // Get profile info from userinfo endpoint
  })
  
  // 4. Store refresh token (if provided) for Drive access
  // Note: refresh tokens only provided on first consent
  
  // 5. Create session (JWT or session cookie)
  const sessionToken = createSessionToken(user.id)
  
  res.cookie('session', sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  })
  
  res.json({ user })
}
```

### Refresh Token Strategy

Since we need Drive access for uploads, we need refresh tokens:

```javascript
// Frontend: Request offline access on first login
function loginWithOfflineAccess() {
  // Use authorization code flow for refresh token
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', `${window.location.origin}/callback`)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', SCOPES)
  authUrl.searchParams.set('access_type', 'offline')  // Get refresh token
  authUrl.searchParams.set('prompt', 'consent')
  
  window.location.href = authUrl.toString()
}

// Backend: Exchange code for tokens
async function handleCallback(req, res) {
  const { code } = req.query
  
  const tokens = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: `${ORIGIN}/callback`,
      grant_type: 'authorization_code'
    })
  }).then(r => r.json())
  
  // tokens.refresh_token - Store this encrypted in DB
  // tokens.access_token - Use for immediate requests
  // tokens.id_token - Contains user info
  
  // Store refresh token for future Drive access
  await storeRefreshToken(userId, encrypt(tokens.refresh_token))
  
  // Create session and redirect
  res.redirect('/')
}
```

---

## Migration from Auth0

### User Migration Strategy

Since there's currently only one user (you), migration is straightforward:

1. **Deploy new auth system** alongside Auth0
2. **Link accounts**: Match by email address
3. **Switch over**: Redirect login to new system
4. **Remove Auth0**: Delete Auth0 configuration

### Database Changes

```sql
-- Existing users table (if using Auth0 sub as ID)
-- Need to add Google-specific fields

ALTER TABLE users ADD COLUMN google_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN refresh_token_encrypted TEXT;

-- For existing user, set google_id = email or migrate manually
```

### Frontend Changes

| File | Change |
|------|--------|
| `main.js` | Remove `createAuth0()`, add Google init |
| `AuthButton.vue` | Replace Auth0 composable with `useGoogleAuth` |
| `api.js` | Replace `getAccessTokenSilently()` with new token method |
| `router/index.js` | Update callback route |
| `CallbackView.vue` | Handle Google OAuth callback |

### Environment Variables

**Remove:**
```
VITE_AUTH0_DOMAIN
VITE_AUTH0_CLIENT_ID
VITE_AUTH0_REDIRECT_URI
VITE_AUTH0_AUDIENCE
```

**Add:**
```
VITE_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET (backend only)
```

---

## Google OAuth Scopes

| Scope | Description | Use |
|-------|-------------|-----|
| `openid` | OpenID Connect | ✅ User identity |
| `email` | User's email | ✅ Account identification |
| `profile` | Name, picture | ✅ Display in UI |
| `drive.file` | App-created files only | ✅ **Texture storage** |

**`drive.file`** is the minimum scope needed:
- Create files/folders in user's Drive
- Read/update/delete files the app created
- Set sharing permissions on those files
- Does NOT access user's other files

---

## Storage Model

### Hybrid Architecture (During Transition)

```
┌─────────────────────────────────────────────────────────────┐
│  User Settings                                               │
├─────────────────────────────────────────────────────────────┤
│  Storage Provider:                                           │
│  ○ Slyce Cloud (default) - We handle storage                │
│  ● Google Drive - Use your own storage  [Connected ✓]       │
│                                                              │
│  [Disconnect Google Drive]                                   │
└─────────────────────────────────────────────────────────────┘
```

### What Goes Where

| Asset | R2 Users | Drive Users | Rationale |
|-------|----------|-------------|-----------|
| Thumbnails | R2 | R2 | Small (~50KB), affordable, fast CDN |
| KTX2 Textures | R2 | Google Drive | Large (MBs), user's storage |
| Metadata | Database | Database | Always in DB for fast queries |

### Benefits

- **My Textures view** loads fast (DB query + R2 thumbnails)
- **Minimal Drive API calls** (only during upload/delete)
- **Graceful fallback** if Drive is slow/unavailable

---

## Google Drive Folder Structure

### App Folder Strategy

Create a dedicated folder in the user's Drive root:

```
My Drive/
└── Slyce Textures/                    ← Created on first upload
    └── {texture-set-name}-{short-id}/ ← Per texture set
        ├── tile-0.ktx2
        ├── tile-1.ktx2
        └── ...
```

### Folder Naming:**
- Root folder: `Slyce Textures` (preferred, clean)
  - If already exists (rare edge case): `Slyce Textures 2`, `Slyce Textures 3`, etc.
- Texture set folders: `{user-provided-name}-{6-char-id}` 
  - Example: `sunset-beach-a1b2c3`
  - ID suffix prevents name collisions

**Why not `drive.appdata` (hidden folder)?**
- Files in appdata cannot be shared publicly
- Users can't see/manage their textures in Drive
- `drive.file` with visible folder is more transparent

### Folder Creation Flow

```javascript
// On first upload to Google Drive:
1. Check if "Slyce Textures" folder exists (created by this app)
   → GET /drive/v3/files?q=name='Slyce Textures' and mimeType='folder' and 'root' in parents
   
2. If not exists, create it
   → POST /drive/v3/files { name: 'Slyce Textures', mimeType: 'folder' }
   
   If name taken (409 conflict or found but not ours), try with suffix:
   → 'Slyce Textures 2', 'Slyce Textures 3', etc.
   
3. Create texture set subfolder
   → POST /drive/v3/files { name: '{name}-{id}', parents: [slyceFolder.id] }
   
4. Store folder IDs in database for future use
```

### User-Specified Location (Future Enhancement)

**Implications of letting users choose folder location:**

| Aspect | Fixed Location | User-Specified |
|--------|---------------|----------------|
| Implementation | Simple | Complex (folder picker UI) |
| UX | One-click setup | Multi-step setup |
| Reliability | Predictable | User may move/delete folder |
| Scope needed | `drive.file` | Still `drive.file` (we create it) |

**Recommendation:** Start with fixed location. User-specified adds complexity without significant benefit since users can always move the folder manually in Drive.

---

## Direct Browser-to-Drive Upload

### Why Direct Upload?

- **No bandwidth cost** on your backend
- **Faster uploads** (no double-hop through your server)
- **Simpler backend** (no file proxying)

### The Token Challenge

Direct uploads require the Google access token in the browser. This is secure if:
1. Token is short-lived (1 hour default)
2. Scope is limited (`drive.file` only)
3. Token is not stored in localStorage (memory only)
4. HTTPS everywhere

### Token Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │     │   Backend   │     │   Google    │     │   Drive     │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │                   │
       │ Request token     │                   │                   │
       │──────────────────>│                   │                   │
       │                   │                   │                   │
       │                   │ Refresh token     │                   │
       │                   │──────────────────>│                   │
       │                   │                   │                   │
       │                   │<──────────────────│                   │
       │                   │   Access token    │                   │
       │<──────────────────│                   │                   │
       │   Access token    │                   │                   │
       │                   │                   │                   │
       │   Upload file directly ──────────────────────────────────>│
       │                   │                   │                   │
       │<─────────────────────────────────────────────────────────│
       │   File ID + metadata                  │                   │
       │                   │                   │                   │
       │ Store metadata    │                   │                   │
       │──────────────────>│                   │                   │
       │                   │ Save to DB        │                   │
```

### Backend Endpoint: Get Upload Token

```
GET /api/google-drive/token

Response:
{
  "accessToken": "ya29.a0AfH6...",  // Short-lived (1 hour)
  "expiresAt": 1706054400,
  "slyceFolder": {
    "id": "1abc123...",
    "name": "Slyce Textures"
  }
}
```

Backend responsibilities:
1. Fetch stored refresh token for user
2. Exchange for fresh access token via Google API
3. Return access token + cached folder info

### Frontend Upload Implementation

```javascript
// composables/useGoogleDrive.js

export function useGoogleDrive() {
  const accessToken = ref(null)
  const tokenExpiresAt = ref(null)
  const slyceFolderId = ref(null)
  
  async function getAccessToken() {
    // Check if current token is still valid (with 5 min buffer)
    if (accessToken.value && tokenExpiresAt.value > Date.now() + 300000) {
      return accessToken.value
    }
    
    // Fetch fresh token from backend
    const response = await fetch('/api/google-drive/token', {
      headers: { Authorization: `Bearer ${auth0Token}` }
    })
    const data = await response.json()
    
    accessToken.value = data.accessToken
    tokenExpiresAt.value = data.expiresAt * 1000
    slyceFolderId.value = data.slyceFolder.id
    
    return accessToken.value
  }
  
  async function uploadFile(file, fileName, parentFolderId) {
    const token = await getAccessToken()
    
    // Google Drive resumable upload for large files
    const metadata = {
      name: fileName,
      parents: [parentFolderId],
      mimeType: 'image/ktx2'
    }
    
    // Step 1: Initiate resumable upload
    const initResponse = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(metadata)
      }
    )
    
    const uploadUrl = initResponse.headers.get('Location')
    
    // Step 2: Upload file content
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/ktx2',
        'Content-Length': file.size
      },
      body: file
    })
    
    const fileData = await uploadResponse.json()
    
    // Step 3: Set sharing permission (anyone with link)
    await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileData.id}/permissions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          role: 'reader',
          type: 'anyone'
        })
      }
    )
    
    return {
      fileId: fileData.id,
      webContentLink: `https://drive.google.com/uc?id=${fileData.id}&export=download`
    }
  }
  
  async function createFolder(name, parentId) {
    const token = await getAccessToken()
    
    const response = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId || 'root']
      })
    })
    
    return response.json()
  }
  
  return {
    getAccessToken,
    uploadFile,
    createFolder,
    isConnected: computed(() => !!accessToken.value)
  }
}
```

---

## Database Schema Extensions

### New Fields for Texture Sets

```sql
-- Add to existing texture_sets table
ALTER TABLE texture_sets ADD COLUMN storage_provider TEXT DEFAULT 'r2'; -- 'r2' | 'google-drive'
ALTER TABLE texture_sets ADD COLUMN drive_folder_id TEXT;               -- Google Drive folder ID
```

### New Fields for Tiles

```sql
-- Add to existing tiles table (or create if doesn't exist)
ALTER TABLE tiles ADD COLUMN drive_file_id TEXT;        -- Google Drive file ID
ALTER TABLE tiles ADD COLUMN drive_public_url TEXT;     -- Public download URL
```

### Google Drive Connections Table

```sql
CREATE TABLE google_drive_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  refresh_token_encrypted TEXT NOT NULL,
  slyce_folder_id TEXT,                    -- Cached root folder ID
  connected_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP,
  UNIQUE(user_id)
);
```

---

## Frontend Components

### Updated: `AuthButton.vue`

Replace Auth0 with Google auth:

```vue
<template>
  <div class="auth-button">
    <button
      v-if="!isAuthenticated"
      @click="login"
      class="btn-login"
    >
      <img src="/icons/google.svg" alt="" class="google-icon" />
      Sign in with Google
    </button>

    <div v-else class="user-menu">
      <img
        v-if="user?.picture"
        :src="user.picture"
        :alt="user.name"
        class="avatar"
      />
      <span class="username">{{ user?.name || user?.email }}</span>
      
      <div class="separator"></div>
      
      <router-link to="/" class="nav-link">Create</router-link>
      <router-link to="/my-textures" class="nav-link">Textures</router-link>
      
      <button @click="logout" class="btn-logout">
        <span class="material-symbols-outlined">logout</span>
        Logout
      </button>
    </div>
  </div>
</template>

<script setup>
import { useGoogleAuth } from '@/composables/useGoogleAuth'

const { user, isAuthenticated, login, logout } = useGoogleAuth()
</script>
```

### Updated: `main.js`

Remove Auth0, initialize Google:

```javascript
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { useGoogleAuth } from './composables/useGoogleAuth'

const app = createApp(App)
app.use(createPinia())
app.use(router)

// Initialize Google Auth (replaces Auth0)
const { initGoogleAuth, checkSession } = useGoogleAuth()

;(async () => {
  await initGoogleAuth()
  await checkSession()  // Restore session if exists
  app.mount('#app')
})()
```

### Storage Settings (Simplified)

Since all Google users automatically have Drive access, the settings become simpler:

```vue
<template>
  <div class="storage-settings">
    <h3>Texture Storage</h3>
    
    <div class="storage-options">
      <label class="storage-option">
        <input type="radio" v-model="storageProvider" value="r2" />
        <div class="option-content">
          <strong>Slyce Cloud</strong>
          <span>We handle storage (default)</span>
        </div>
      </label>
      
      <label class="storage-option">
        <input type="radio" v-model="storageProvider" value="google-drive" />
        <div class="option-content">
          <strong>Google Drive</strong>
          <span>Store in your own Drive</span>
        </div>
      </label>
    </div>
    
    <p class="storage-note" v-if="storageProvider === 'google-drive'">
      Textures will be saved to "Slyce Textures" folder in your Google Drive.
    </p>
  </div>
</template>
```

No "Connect" button needed—Drive access is granted during initial login!

---

## Backend Endpoints

### Auth Endpoints (New - Replacing Auth0)

```
POST /api/auth/session     - Create session from Google auth code
POST /api/auth/logout      - Clear session  
GET  /api/auth/me          - Get current user info
GET  /api/auth/token       - Get fresh Google access token for Drive
```

### `POST /api/auth/session`

Exchange Google auth code for tokens, create user session.

```javascript
// Request (from OAuth callback)
{ "code": "4/0AX4XfWj..." }

// Backend logic
1. Exchange code for access_token + refresh_token + id_token
2. Decode id_token to get user info (sub, email, name, picture)
3. Upsert user in database (create if new, update if exists)
4. Encrypt and store refresh_token
5. Create session cookie
6. Return user info

// Response
{
  "user": {
    "id": "user_123",
    "email": "user@example.com",
    "name": "User Name",
    "picture": "https://..."
  }
}
```

### `GET /api/auth/token`

Get fresh access token for Drive uploads.

```javascript
// Backend logic
1. Validate session cookie
2. Fetch user's encrypted refresh_token from DB
3. Exchange refresh_token for fresh access_token via Google
4. Return access_token (do NOT return refresh_token)

// Response
{
  "accessToken": "ya29.a0AfH6...",
  "expiresAt": 1706054400,
  "slyceFolder": {
    "id": "1abc123...",      // Cached folder ID
    "name": "Slyce Textures"
  }
}
```

### Texture Endpoints (Existing - Modified)

```
POST /texture-set                              - Create texture set (add storageProvider field)
PUT  /texture-set/:id/thumbnail                - Upload thumbnail (always R2)
POST /texture-set/:id/tile/:index/metadata     - Store tile metadata (Drive file ID, URL)
POST /texture-set/:id/complete                 - Mark upload complete
GET  /my-textures                              - List user's textures
DELETE /texture-set/:id                        - Delete texture set
```

---

## Complete Upload Flow (Google Drive)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Texture Set Upload Flow                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. User clicks "Upload to Cloud"                                           │
│     └─ Check: user.storageProvider === 'google-drive'?                      │
│                                                                              │
│  2. Create texture set in DB (backend)                                       │
│     POST /texture-set                                                        │
│     └─ Returns: { textureSetId, storageProvider: 'google-drive' }           │
│                                                                              │
│  3. Get fresh Drive token (backend → browser)                               │
│     GET /api/google-drive/token                                              │
│     └─ Returns: { accessToken, slyceFolder.id }                             │
│                                                                              │
│  4. Create texture set folder in Drive (browser → Drive)                    │
│     POST https://www.googleapis.com/drive/v3/files                          │
│     └─ Returns: { folderId }                                                │
│                                                                              │
│  5. Upload thumbnail to R2 (browser → backend → R2)                         │
│     PUT /texture-set/{id}/thumbnail                                          │
│     └─ Existing flow, unchanged                                             │
│                                                                              │
│  6. Upload each tile to Drive (browser → Drive)                             │
│     For each tile:                                                           │
│       a. POST resumable upload init                                          │
│       b. PUT file content                                                    │
│       c. POST sharing permission (anyone with link)                          │
│       d. POST /texture-set/{id}/tile/{index}/metadata                       │
│          └─ Store Drive file ID + public URL in DB                          │
│                                                                              │
│  7. Mark upload complete (browser → backend)                                 │
│     POST /texture-set/{id}/complete                                          │
│     └─ Update status, trigger any post-processing                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## My Textures View

No changes needed to core functionality:

```javascript
// Existing flow works for both storage providers:
1. GET /my-textures → Returns texture set metadata from DB
2. Each texture set includes:
   - Thumbnail URL (always R2)
   - Tile URLs (R2 or Drive public URLs)
   - Metadata (dimensions, tile count, etc.)

// The view doesn't need to know where tiles are stored
// It just uses the URLs from the database
```

---

## Security Considerations

1. **Refresh Token Encryption**
   - Encrypt with AES-256 before storing in DB
   - Key stored in environment variable, not in code

2. **Access Token Handling**
   - Short-lived (1 hour)
   - Held in memory only (not localStorage)
   - Scoped to `drive.file` (minimal permissions)

3. **Token Refresh**
   - Backend handles refresh automatically
   - Frontend requests new token if expired

4. **HTTPS Everywhere**
   - All API calls over HTTPS
   - Drive API requires HTTPS

5. **Token Revocation on Disconnect**
   - Properly revoke with Google
   - Delete from database

---

## Implementation Phases

### Phase 1: Auth Migration (Auth0 → Google OAuth)

**Goal:** Replace Auth0 with direct Google OAuth

- [ ] Create Google Cloud project
- [ ] Configure OAuth consent screen (include Drive scope)
- [ ] Create OAuth 2.0 credentials (web application)
- [ ] Add authorized redirect URI: `https://slyce.rivvon.ca/callback`
- [ ] Backend: Implement `/api/auth/session` endpoint
- [ ] Backend: Implement `/api/auth/logout` endpoint
- [ ] Backend: Implement `/api/auth/me` endpoint
- [ ] Backend: Add `google_id`, `refresh_token_encrypted` to users table
- [ ] Frontend: Create `useGoogleAuth.js` composable
- [ ] Frontend: Update `AuthButton.vue` to use new auth
- [ ] Frontend: Update `CallbackView.vue` for Google callback
- [ ] Frontend: Remove Auth0 from `main.js`
- [ ] Frontend: Update `api.js` to use session auth (not Auth0 tokens)
- [ ] Test: Login, logout, session persistence
- [ ] Remove Auth0 dependencies from `package.json`

### Phase 2: Drive Upload Integration

**Goal:** Textures upload directly to user's Drive

- [ ] Backend: Implement `/api/auth/token` endpoint (for Drive access)
- [ ] Backend: Extend texture_sets table with `storage_provider`, `drive_folder_id`
- [ ] Frontend: Create `useGoogleDrive.js` composable (upload operations)
- [ ] Frontend: Add storage provider selection to settings/upload UI
- [ ] Frontend: Implement Drive folder creation ("Slyce Textures")
- [ ] Frontend: Implement resumable upload to Drive
- [ ] Frontend: Implement permission setting (anyone with link)
- [ ] Backend: Endpoint to store tile metadata (Drive file IDs)
- [ ] Test: Full upload flow to Google Drive

### Phase 3: My Textures Integration

**Goal:** View works seamlessly with Drive-stored textures

- [ ] Backend: Ensure GET /my-textures returns correct URLs for Drive textures
- [ ] Frontend: Verify texture playback works with Drive URLs
- [ ] Frontend: Verify download works with Drive URLs
- [ ] Test: Create texture with Drive, view in My Textures, download

### Phase 4: Polish & Edge Cases

**Goal:** Production-ready experience

- [ ] Handle token expiry during upload (auto-refresh)
- [ ] Handle Drive quota exceeded error
- [ ] Handle Drive unavailable/slow gracefully
- [ ] Add upload progress indicators
- [ ] Error messaging for common failure modes
- [ ] Delete texture → delete from Drive

---

## Google Cloud Setup Checklist

1. **Create Project**
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create new project: "Slyce"

2. **Enable APIs**
   - Enable "Google Drive API"
   - Enable "Google Identity" (for OAuth)

3. **Configure OAuth Consent Screen**
   - User type: External
   - App name: "Slyce"
   - User support email: your email
   - Scopes: `email`, `profile`, `openid`, `drive.file`
   - Test users: add your email (while in testing mode)

4. **Create Credentials**
   - Type: OAuth 2.0 Client ID
   - Application type: Web application
   - Authorized JavaScript origins: 
     - `https://slyce.rivvon.ca`
     - `http://localhost:5173` (for development)
   - Authorized redirect URIs: 
     - `https://slyce.rivvon.ca/callback`
     - `http://localhost:5173/callback`
   - Save Client ID and Client Secret

5. **Move to Production**
   - Submit for verification (required for `drive.file` scope)
   - Provide privacy policy URL
   - Complete verification process
   - App name: "Slyce"
   - User support email: your email
   - Scopes: `drive.file`
   - Test users: add your email (while in testing mode)

4. **Create Credentials**
   - Type: OAuth 2.0 Client ID
   - Application type: Web application
   - Authorized JavaScript origins: `https://slyce.rivvon.ca`
   - Authorized redirect URIs: `https://slyce.rivvon.ca/callback/google-drive`
   - Save Client ID and Client Secret

5. **Move to Production**
   - Submit for verification (required for `drive.file` scope)
   - Provide privacy policy URL
   - Complete verification process

---

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1: Auth Migration | 8-10 hours |
| Phase 2: Drive Upload | 8-10 hours |
| Phase 3: My Textures | 2-3 hours |
| Phase 4: Polish | 4-6 hours |
| **Total** | **~22-29 hours** |

---

## Open Questions (Resolved)

| Question | Decision |
|----------|----------|
| Authentication | ✅ Direct Google OAuth (replace Auth0) |
| Upload path | ✅ Direct browser-to-Drive |
| Thumbnail storage | ✅ Always R2 |
| Folder location | ✅ Fixed "Slyce Textures" in root |
| Storage model | ✅ Hybrid (user choice) during transition |
| Existing textures | ✅ Stay on R2, migrate later |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Google verification takes weeks | Start early, use test mode for development |
| Drive API rate limits | Batch permission requests, cache folder IDs |
| Token expires during long upload | Implement token refresh mid-upload |
| User deletes folder in Drive | Handle 404 gracefully, offer re-create option |
| Google changes API | Use stable v3 API, monitor deprecation notices |

---

## Appendix: Google Drive API Reference

**Resumable Upload:**
https://developers.google.com/drive/api/guides/manage-uploads#resumable

**Permissions:**
https://developers.google.com/drive/api/reference/rest/v3/permissions

**Files:**
https://developers.google.com/drive/api/reference/rest/v3/files

**OAuth Scopes:**
https://developers.google.com/drive/api/guides/api-specific-auth
