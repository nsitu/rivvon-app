# Google Auth and Google Drive Integration Plan

## Overview

Enable users to store their KTX2 textures in their own Google Drive instead of Cloudflare R2, reducing storage costs at scale. Textures would default to "anyone with the link" sharing for public access.

**Key Decisions Made:**
- ✅ Direct browser-to-Drive uploads (no backend proxy for file data)
- ✅ Thumbnails remain on R2 (small, affordable)
- ✅ Metadata stored in DB (avoid excess Drive API calls)
- ✅ **Google Drive as default** for all new textures
- ✅ **Hybrid storage**: Support both R2 (legacy) and Google Drive
- ✅ Dedicated "Slyce Textures" folder in user's Drive root
- ✅ **Complete migration from Auth0 to Google OAuth** (clean cutover)
- ✅ Existing R2 textures to be migrated to Google Drive (see Migration section)

---

## Monorepo Context

### Current Architecture

The Rivvon ecosystem consists of three main applications:

```
rivvon-app/
├── apps/
│   ├── api/          ← Cloudflare Worker backend (Hono + D1 + R2)
│   ├── slyce/        ← Vue 3 texture creator (uploads to API)
│   └── rivvon/       ← Vanilla JS texture renderer (consumes from API)
└── packages/
    └── shared-types/ ← Shared TypeScript types (future use)
```

**Current Flow:**
1. **Slyce** (texture creator) → Authenticates via Auth0 → Uploads KTX2 tiles to R2 via API
2. **API** (backend) → Validates Auth0 JWT → Stores metadata in D1 → Manages R2 storage
3. **Rivvon** (renderer) → Fetches public texture list from API → Loads KTX2 tiles from `cdn.rivvon.ca` (R2)

**Current Auth:**
- **Slyce**: Auth0 Vue SDK (`@auth0/auth0-vue`)
- **API**: Auth0 JWT verification via `jose` library
- **Rivvon**: No auth (consumes public textures only)

---

## Target Architecture

### Three-App Ecosystem

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                          SLYCE (Texture Creator)                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │  1. Google OAuth Login (identity + drive.file scope)                       │  │
│  │  2. Create texture set → api.rivvon.ca/texture-set                        │  │
│  │  3. Upload thumbnail → api.rivvon.ca → R2                                 │  │
│  │  4. Upload KTX2 tiles → Google Drive (user's folder)                      │  │
│  │  5. Store tile metadata → api.rivvon.ca (Drive file IDs & URLs)          │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                    API (Cloudflare Worker - api.rivvon.ca)                        │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │  • Google ID Token validation (replaces Auth0 JWT)                        │  │
│  │  • Session management (HTTP-only cookies)                                 │  │
│  │  • D1 Database: users, texture_sets, texture_tiles                       │  │
│  │  • R2 Storage: thumbnails only                                            │  │
│  │  • Google refresh token (HTTP-only cookie, not in DB)                     │  │
│  │  • Token refresh endpoint (for Drive uploads)                             │  │
│  │  • Texture metadata API (returns R2 or Drive URLs based on provider)     │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                      RIVVON (Texture Renderer)                                    │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │  1. Fetch texture list → api.rivvon.ca/textures (public)                 │  │
│  │  2. Get texture details → api.rivvon.ca/textures/:id                     │  │
│  │  3. Load thumbnails → cdn.rivvon.ca (R2)                                 │  │
│  │  4. Load KTX2 tiles from:                                                 │  │
│  │     • R2: https://cdn.rivvon.ca/textures/{setId}/{index}.ktx2           │  │
│  │     • Drive: https://drive.google.com/uc?id={fileId}&export=download    │  │
│  │  5. Render textures with Three.js (WebGL/WebGPU)                        │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Key Changes:**
- **Auth**: Google OAuth replaces Auth0 entirely
- **Storage**: Hybrid model (Google Drive default, R2 for legacy textures)
- **Tile URLs**: Database stores either R2 keys or Google Drive file IDs
- **Public Access**: Both R2 and Google Drive support direct public URLs

---

## Google Drive Public Access Investigation

### How Public Sharing Works

Google Drive files can be made publicly accessible via "Anyone with the link" sharing. This creates a direct download URL that works **without authentication**:

```
https://drive.google.com/uc?id={FILE_ID}&export=download
```

### CORS Considerations

**Good News:** Google Drive supports CORS for publicly shared files!

When a file is set to "Anyone with the link can view":
- ✅ Direct download URLs work from any origin
- ✅ CORS headers are automatically included
- ✅ No authentication required
- ✅ Works with Three.js texture loading
- ✅ No proxy needed (saves bandwidth costs!)

**Headers returned by Drive:**
```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET
Content-Type: image/ktx2
```

### Setting Public Permissions

After uploading a file, we need to add a permission:

```javascript
// POST https://www.googleapis.com/drive/v3/files/{fileId}/permissions
{
  "role": "reader",
  "type": "anyone"
}
```

This makes the file publicly accessible without authentication.

### URL Format

Public files use the direct download URL:

```
https://drive.google.com/uc?id={FILE_ID}&export=download
```

- Direct file content (no redirect)
- Works with Three.js loaders
- No authentication required

### Rate Limits & Quotas

Google Drive API has generous quotas:
- 20,000 queries per 100 seconds per user
- File downloads don't count against API quota
- Public file access is effectively unlimited

However, **very high traffic** (viral content) may trigger throttling. For production apps with thousands of concurrent users, Google recommends:
- Caching files on CDN (CloudFront, Cloudflare)
- Using Cloud Storage instead of Drive for high-traffic apps

**For our use case:**
- Rivvon apps are individual/small-scale
- Direct Drive URLs are perfect
- If we hit limits later, we can proxy through Cloudflare R2 as cache

---

## Authentication Strategy

### Decision: Direct Google OAuth (Clean Cutover from Auth0)

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
          Auth0 JWT → Backend API → Verifies with Auth0 JWKS

Target:   User → Google directly (identity + Drive)
                ↓
          Google ID Token → Backend API → Verifies with Google JWKS
          + Refresh Token (HTTP-only cookie, never stored in DB)
```

**Since you're the only user, we can do a clean cutover:**
1. Deploy new Google OAuth system
2. Test with your account
3. Remove Auth0 configuration
4. Delete Auth0 integration

No need for dual auth systems or graceful migration.

---

## HTTP-Only Cookie Token Strategy

### Why HTTP-Only Cookies?

Instead of storing encrypted refresh tokens in the database, we use HTTP-only cookies. This significantly simplifies the backend:

| Aspect | ~~Database Storage~~ (rejected) | ✅ HTTP-Only Cookie (chosen) |
|--------|--------------------------------|------------------------------|
| **Security** | Would need encryption in D1 | Never exposed to JS, browser-managed |
| **Backend complexity** | Encryption/decryption logic | Cookie automatically sent with requests |
| **Key management** | Need encryption key secret | None required |
| **Token rotation** | Manual re-encryption | Cookie expiry handles this |
| **Code required** | ~50 lines crypto utils | ~5 lines cookie config |

### How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │     │   Backend   │     │   Google    │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │ OAuth callback    │                   │
       │ (with auth code)  │                   │
       │──────────────────>│                   │
       │                   │ Exchange code     │
       │                   │──────────────────>│
       │                   │<──────────────────│
       │                   │ access_token +    │
       │                   │ refresh_token     │
       │<──────────────────│                   │
       │ Set-Cookie:       │                   │
       │   session (user)  │                   │
       │   refresh_token   │                   │
       │   (HTTP-only)     │                   │
       │                   │                   │
       │ Later: API call   │                   │
       │ (cookies auto-    │                   │
       │  sent by browser) │                   │
       │──────────────────>│                   │
       │                   │ Read refresh_token│
       │                   │ from cookie       │
       │                   │──────────────────>│
       │                   │<──────────────────│
       │                   │ Fresh access_token│
       │<──────────────────│                   │
       │ Access token      │                   │
       │ (for Drive API)   │                   │
```

### Cookie Configuration

```javascript
// Backend: Set cookies after OAuth callback
function setAuthCookies(c, tokens, user) {
  // Session cookie (contains user info, can be JWT or simple session ID)
  c.header('Set-Cookie', 
    `session=${createSessionToken(user)}; ` +
    `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`
  )
  
  // Refresh token cookie (HTTP-only, never accessible to JS)
  c.header('Set-Cookie',
    `google_refresh_token=${tokens.refresh_token}; ` +
    `HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=${30 * 24 * 60 * 60}`
  )
}

// Backend: Get fresh access token for Drive
app.get('/api/auth/drive-token', async (c) => {
  // Cookie automatically sent by browser
  const refreshToken = getCookie(c, 'google_refresh_token')
  
  if (!refreshToken) {
    return c.json({ error: 'Not authenticated' }, 401)
  }
  
  // Exchange refresh token for fresh access token
  const tokens = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  }).then(r => r.json())
  
  if (tokens.error) {
    // Refresh token revoked or expired - user needs to re-auth
    return c.json({ error: 'Token expired', needsReauth: true }, 401)
  }
  
  // Return access token to frontend (for direct Drive uploads)
  return c.json({
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in
  })
})
```

### Cookie Configuration Summary

All auth cookies use consistent security attributes:

| Cookie | Path | Max-Age | Purpose |
|--------|------|---------|---------|
| `session` | `/` | 7 days | User session for all API calls |
| `google_refresh_token` | `/api/auth` | 30 days | Refresh token (restricted path) |
| `oauth_state` | `/api/auth` | 10 min | CSRF protection during OAuth flow |

**All cookies use:** `HttpOnly; Secure; SameSite=Lax`

### Security Considerations

1. **HttpOnly**: JavaScript cannot access cookies (XSS protection)
2. **Secure**: Cookies only sent over HTTPS
3. **SameSite=Lax**: Allows top-level navigation (OAuth redirect) while blocking cross-site requests
4. **Path=/api/auth**: Refresh token cookie only sent to auth endpoints (principle of least privilege)
5. **CSRF State Validation**: OAuth flow uses backend-generated state stored in HTTP-only cookie

### Why SameSite=Lax (not Strict)?

- `Strict` would block cookies on the OAuth callback redirect (breaks the flow)
- `Lax` allows cookies on top-level navigations (like OAuth redirect from Google)
- `None` would allow cross-site requests (not needed, less secure)

### Why This Is Secure

- **Refresh token never in JavaScript**: XSS cannot steal it
- **CSRF state validation**: Prevents malicious OAuth redirects
- **Backend-managed state**: State token stored in HTTP-only cookie, not sessionStorage
- **No database storage**: No encryption keys to manage, no breach risk
- **Browser-managed expiry**: Cookies expire automatically
- **Revocation still works**: User can revoke at Google account settings

### Frontend Token Handling

The frontend only handles short-lived access tokens (in memory, never localStorage):

```javascript
// composables/useGoogleAuth.js
let accessToken = null  // In-memory only
let tokenExpiresAt = null

async function getAccessToken() {
  // If token still valid (with 5 min buffer), return it
  if (accessToken && tokenExpiresAt > Date.now() + 5 * 60 * 1000) {
    return accessToken
  }
  
  // Request fresh token from backend
  // Cookie is automatically sent
  const response = await fetch('/api/auth/drive-token', {
    credentials: 'include'  // Include cookies
  })
  
  if (!response.ok) {
    const data = await response.json()
    if (data.needsReauth) {
      // Redirect to login
      login()
      return null
    }
    throw new Error('Failed to get access token')
  }
  
  const data = await response.json()
  accessToken = data.accessToken
  tokenExpiresAt = Date.now() + (data.expiresIn * 1000)
  
  return accessToken
}
```

### CORS Configuration

For cookies to work cross-origin (slyce.rivvon.ca → api.rivvon.ca):

```javascript
// Backend CORS middleware
app.use('*', cors({
  origin: ['https://slyce.rivvon.ca', 'http://localhost:5173'],
  credentials: true,  // Allow cookies
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}))
```

### Logout

```javascript
// Backend: Clear cookies on logout
app.post('/api/auth/logout', (c) => {
  // Clear session cookie
  c.header('Set-Cookie', 
    'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
  )
  // Clear refresh token cookie
  c.header('Set-Cookie',
    'google_refresh_token=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=0'
  )
  return c.json({ success: true })
})

// Frontend: Also revoke token at Google (optional but recommended)
async function logout() {
  const token = await getAccessToken()
  if (token) {
    // Revoke at Google
    await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, {
      method: 'POST'
    })
  }
  
  // Clear backend session
  await fetch('/api/auth/logout', { 
    method: 'POST',
    credentials: 'include'
  })
  
  // Clear in-memory token
  accessToken = null
  tokenExpiresAt = null
}
```

---

## Database Schema Extensions

### Updates to Existing Tables

```sql
-- Users table (replace auth0_sub with google_id)
ALTER TABLE users ADD COLUMN google_id TEXT UNIQUE;
-- Note: refresh_token stored in HTTP-only cookie, NOT in database
ALTER TABLE users ADD COLUMN drive_folder_id TEXT; -- Cached "Slyce Textures" folder ID

-- For migration: existing auth0 users can be matched by email
-- UPDATE users SET google_id = ? WHERE email = ?

-- Texture sets table (add storage provider tracking)
ALTER TABLE texture_sets ADD COLUMN storage_provider TEXT DEFAULT 'google-drive'; 
-- 'r2' for legacy, 'google-drive' for new (default)

ALTER TABLE texture_sets ADD COLUMN drive_folder_id TEXT; 
-- Google Drive folder ID for this texture set

-- Texture tiles table (add Drive-specific fields)
ALTER TABLE texture_tiles ADD COLUMN drive_file_id TEXT;
-- Google Drive file ID (alternative to r2_key)

ALTER TABLE texture_tiles ADD COLUMN public_url TEXT;
-- Pre-computed public URL for fast retrieval
-- R2: https://cdn.rivvon.ca/{r2_key}
-- Drive: https://drive.google.com/uc?id={drive_file_id}&export=download
```

### Migration Script

```sql
-- Set existing textures to use R2
UPDATE texture_sets 
SET storage_provider = 'r2' 
WHERE storage_provider IS NULL;

-- Populate public_url for existing R2 textures
UPDATE texture_tiles
SET public_url = 'https://cdn.rivvon.ca/' || r2_key
WHERE r2_key IS NOT NULL AND public_url IS NULL;
```

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

### OAuth Flow: Authorization Code (Backend-Managed)

**Why Authorization Code Flow (not GIS Token Client)?**

| GIS Token Client | Authorization Code Flow |
|------------------|-------------------------|
| Returns access token directly to browser | Returns auth code, backend exchanges for tokens |
| No refresh token available to frontend | Refresh token goes directly to backend |
| Requires implicit grant or popup flow | Standard redirect flow |
| Can't securely store refresh token in HTTP-only cookie | ✅ Perfect for HTTP-only cookie storage |

**Flow Diagram:**

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │     │   Backend   │     │   Google    │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │ 1. Click Login    │                   │
       │──────────────────>│                   │
       │                   │                   │
       │                   │ 2. Generate CSRF  │
       │                   │    state, store   │
       │                   │    in cookie      │
       │                   │                   │
       │<──────────────────│                   │
       │ 3. Redirect to    │                   │
       │    Google (302)   │                   │
       │                   │                   │
       │ 4. User consents ─────────────────────>
       │                   │                   │
       │<─────────────────────────────────────│
       │ 5. Redirect to /api/auth/callback    │
       │    with code + state                 │
       │                   │                   │
       │──────────────────>│                   │
       │                   │ 6. Validate state │
       │                   │    from cookie    │
       │                   │                   │
       │                   │ 7. Exchange code  │
       │                   │──────────────────>│
       │                   │<──────────────────│
       │                   │ tokens (access,   │
       │                   │ refresh, id)      │
       │                   │                   │
       │<──────────────────│                   │
       │ 8. Set cookies:   │                   │
       │    - session      │                   │
       │    - refresh_token│                   │
       │    (HTTP-only)    │                   │
       │                   │                   │
       │ 9. Redirect to app│                   │
└──────┴──────┘     └──────┴──────┘     └──────┴──────┘
```

### Frontend: useGoogleAuth Composable

**Note:** No GIS library needed! The frontend simply redirects to the backend `/api/auth/login` endpoint.

```javascript
// composables/useGoogleAuth.js

import { ref, computed } from 'vue'

const API_URL = import.meta.env.VITE_API_URL

export function useGoogleAuth() {
  const user = ref(null)
  const isAuthenticated = computed(() => !!user.value)
  
  // In-memory token cache (never localStorage!)
  let accessToken = null
  let tokenExpiresAt = null
  
  // Initiate login - redirect through backend
  // Backend handles CSRF state generation and stores it in HTTP-only cookie
  function login() {
    window.location.href = `${API_URL}/api/auth/login`
  }
  
  // Logout - clear cookies and optionally revoke at Google
  async function logout() {
    await fetch(`${API_URL}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include'
    })
    user.value = null
    accessToken = null
    tokenExpiresAt = null
  }
  
  // Check existing session on page load
  async function checkSession() {
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
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
  
  // Get fresh access token for Drive operations
  // Tokens are exchanged via backend using HTTP-only refresh token cookie
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
      if (response.status === 401) {
        // Refresh token expired or revoked, need to re-login
        user.value = null
        accessToken = null
        tokenExpiresAt = null
        return null
      }
      throw new Error('Failed to get access token')
    }
    
    const data = await response.json()
    accessToken = data.accessToken  // Cache in memory only
    tokenExpiresAt = Date.now() + (data.expiresIn * 1000)
    
    return accessToken
  }
  
  return {
    user,
    isAuthenticated,
    login,
    logout,
    checkSession,
    getAccessToken
  }
}
```

### Backend: Auth Routes

**New Endpoints (replacing Auth0):**

```
GET  /api/auth/login       - Initiate OAuth flow, generate CSRF state, redirect to Google
GET  /api/auth/callback    - Validate state, exchange code for tokens, set cookies, redirect to app
GET  /api/auth/me          - Get current user (from session cookie)
GET  /api/auth/drive-token - Get fresh Google access token (reads refresh token from cookie)
POST /api/auth/logout      - Clear cookies & optionally revoke at Google
```

**Login Endpoint (Initiates OAuth with CSRF protection):**

```javascript
// GET /api/auth/login - Initiate OAuth flow
auth.get('/login', async (c) => {
  // Generate CSRF state token
  const state = crypto.randomUUID()
  
  // Store state in HTTP-only cookie for validation on callback
  // This prevents CSRF attacks on the OAuth callback
  c.header('Set-Cookie', 
    `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=600`
  )
  
  const SCOPES = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/drive.file'
  ].join(' ')
  
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', c.env.GOOGLE_CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', `${c.env.API_URL}/api/auth/callback`)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', SCOPES)
  authUrl.searchParams.set('access_type', 'offline')  // Request refresh token
  authUrl.searchParams.set('prompt', 'consent')        // Always show consent to get refresh token
  authUrl.searchParams.set('state', state)             // CSRF protection
  
  return c.redirect(authUrl.toString())
})
```

**OAuth Callback Flow (with CSRF validation):**

```javascript
// GET /api/auth/callback?code=xxx&state=xxx
auth.get('/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')
  
  // Handle OAuth errors from Google
  if (error) {
    return c.redirect(`${c.env.APP_URL}/login?error=${error}`)
  }
  
  // 1. Validate CSRF state (CRITICAL for security)
  const storedState = getCookie(c, 'oauth_state')
  if (!state || state !== storedState) {
    return c.redirect(`${c.env.APP_URL}/login?error=invalid_state`)
  }
  
  // Clear the state cookie (one-time use)
  c.header('Set-Cookie', 'oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=0')
  
  // 2. Exchange authorization code for tokens
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${c.env.API_URL}/api/auth/callback`,
      grant_type: 'authorization_code'
    })
  })
  
  const tokens = await tokenResponse.json()
  
  if (tokens.error) {
    return c.redirect(`${c.env.APP_URL}/login?error=token_exchange_failed`)
  }
  
  // 3. Decode ID token to get user info (no verification needed, came directly from Google)
  const payload = JSON.parse(atob(tokens.id_token.split('.')[1]))
  
  // 4. Upsert user in database
  const user = await upsertUser(c.env.DB, {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture
  })
  
  // 5. Create session token
  const sessionToken = await createSessionToken(user, c.env.SESSION_SECRET)
  
  // 6. Set HTTP-only cookies with consistent security attributes
  const headers = new Headers()
  
  // Session cookie - broader path for all API calls
  headers.append('Set-Cookie', 
    `session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`
  )
  
  // Refresh token cookie - restricted to /api/auth only (principle of least privilege)
  if (tokens.refresh_token) {
    headers.append('Set-Cookie',
      `google_refresh_token=${tokens.refresh_token}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=${30 * 24 * 60 * 60}`
    )
  }
  
  // 7. Redirect back to app
  headers.set('Location', c.env.APP_URL)
  
  return new Response(null, { status: 302, headers })
})
```

### Refresh Token Strategy (HTTP-Only Cookies)

The refresh token is stored in an HTTP-only cookie, eliminating the need for database storage or encryption.

**Drive Token Endpoint (Backend):**

```javascript
// GET /api/auth/drive-token - Exchange refresh token for fresh access token
auth.get('/drive-token', async (c) => {
  // Verify session first
  const sessionToken = getCookie(c, 'session')
  if (!sessionToken) {
    return c.json({ error: 'Not authenticated' }, 401)
  }
  
  const user = await verifySessionToken(sessionToken, c.env.SESSION_SECRET)
  if (!user) {
    return c.json({ error: 'Invalid session' }, 401)
  }
  
  // Read refresh token from HTTP-only cookie (automatically sent by browser)
  const refreshToken = getCookie(c, 'google_refresh_token')
  if (!refreshToken) {
    return c.json({ error: 'No refresh token', needsReauth: true }, 401)
  }
  
  // Exchange refresh token for fresh access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  })
  
  const tokens = await tokenResponse.json()
  
  if (tokens.error) {
    // Refresh token was revoked or expired
    return c.json({ error: 'Token expired', needsReauth: true }, 401)
  }
  
  // Get user's cached Drive folder ID
  const userRecord = await c.env.DB.prepare(
    'SELECT drive_folder_id FROM users WHERE google_id = ?'
  ).bind(user.googleId).first()
  
  return c.json({
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in,
    slyceFolderId: userRecord?.drive_folder_id || null
  })
})
```

**Logout Endpoint (Backend):**

```javascript
// POST /api/auth/logout - Clear all auth cookies
auth.post('/logout', (c) => {
  const headers = new Headers()
  
  // Clear session cookie
  headers.append('Set-Cookie', 
    'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
  )
  
  // Clear refresh token cookie
  headers.append('Set-Cookie', 
    'google_refresh_token=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=0'
  )
  
  return c.json({ success: true }, { headers })
})
```

**Key Benefits of This Approach:**
- ❌ No database storage of refresh tokens
- ❌ No encryption/decryption code
- ❌ No encryption key management
- ✅ Refresh token never exposed to JavaScript
- ✅ Automatic cookie handling by browser
- ✅ Simpler backend code

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
-- Note: refresh_token stored in HTTP-only cookie, NOT in database!

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

---

## Migrating Existing R2 Textures to Google Drive

### Why Migrate?

- **Cost savings**: Google Drive free tier (15GB) vs R2 paid storage
- **Consistency**: All textures in one place
- **User ownership**: Users control their texture files

### Migration Strategy

Since you're the only user, we can perform a manual migration with API assistance.

### Step 1: Export Texture Metadata

Create a backend endpoint to list all your R2 textures with download URLs:

```typescript
// GET /admin/export-textures (authenticated, owner-only)
app.get('/admin/export-textures', verifyAuth, async (c) => {
  const auth = c.get('auth')
  
  // Get all texture sets owned by current user
  const textureSets = await c.env.DB.prepare(`
    SELECT * FROM texture_sets WHERE owner_id = ?
  `).bind(auth.userId).all()
  
  const exports = []
  
  for (const textureSet of textureSets.results) {
    const tiles = await c.env.DB.prepare(`
      SELECT * FROM texture_tiles WHERE texture_set_id = ?
    `).bind(textureSet.id).all()
    
    exports.push({
      textureSet,
      tiles: tiles.results,
    })
  }
  
  return c.json({ exports })
})
```

### Step 2: Migration Script (Browser-Based)

Create a new page in Slyce: `MigrationView.vue`

```vue
<template>
  <div class="migration-view">
    <h1>Migrate Textures to Google Drive</h1>
    
    <div v-if="!migrationStarted">
      <p>Found {{ texturesToMigrate.length }} texture sets to migrate</p>
      <ul>
        <li v-for="texture in texturesToMigrate" :key="texture.id">
          {{ texture.name }} ({{ texture.tile_count }} tiles)
        </li>
      </ul>
      <button @click="startMigration">Start Migration</button>
    </div>
    
    <div v-else>
      <h2>Migration Progress</h2>
      <div v-for="texture in texturesToMigrate" :key="texture.id">
        <h3>{{ texture.name }}</h3>
        <progress 
          :value="progress[texture.id] || 0" 
          :max="texture.tile_count"
        />
        <span>{{ progress[texture.id] || 0 }} / {{ texture.tile_count }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRivvonAPI } from '@/services/api'
import { useGoogleDrive } from '@/composables/useGoogleDrive'

const texturesToMigrate = ref([])
const progress = ref({})
const migrationStarted = ref(false)

const api = useRivvonAPI()
const drive = useGoogleDrive()

onMounted(async () => {
  // Fetch textures to migrate
  const response = await api.exportTextures()
  texturesToMigrate.value = response.exports
})

async function startMigration() {
  migrationStarted.value = true
  
  for (const { textureSet, tiles } of texturesToMigrate.value) {
    progress.value[textureSet.id] = 0
    
    // 1. Create folder in Drive
    const folderName = `${textureSet.name}-${textureSet.id.slice(0, 6)}`
    const folder = await drive.createFolder(folderName, drive.slyceFolderId.value)
    
    // 2. Download each tile from R2 and re-upload to Drive
    for (const tile of tiles) {
      // Download from R2
      const response = await fetch(`https://cdn.rivvon.ca/${tile.r2_key}`)
      const blob = await response.blob()
      
      // Upload to Drive
      const fileName = `${tile.tile_index}.ktx2`
      const driveFile = await drive.uploadFile(blob, fileName, folder.id)
      
      // Update database with Drive info
      await api.updateTileStorage({
        tileId: tile.id,
        driveFileId: driveFile.fileId,
        publicUrl: driveFile.webContentLink,
      })
      
      progress.value[textureSet.id]++
    }
    
    // 3. Update texture set to use Drive
    await api.updateTextureSetStorage({
      textureSetId: textureSet.id,
      storageProvider: 'google-drive',
      driveFolderId: folder.id,
    })
  }
  
  alert('Migration complete!')
}
</script>
```

### Step 3: Backend Migration Endpoints

```typescript
// PUT /admin/texture-tile/:id/storage (update storage info)
app.put('/admin/texture-tile/:id/storage', verifyAuth, async (c) => {
  const tileId = c.req.param('id')
  const { driveFileId, publicUrl } = await c.req.json()
  
  await c.env.DB.prepare(`
    UPDATE texture_tiles 
    SET drive_file_id = ?, public_url = ?
    WHERE id = ?
  `).bind(driveFileId, publicUrl, tileId).run()
  
  return c.json({ success: true })
})

// PUT /admin/texture-set/:id/storage (update storage provider)
app.put('/admin/texture-set/:id/storage', verifyAuth, async (c) => {
  const textureSetId = c.req.param('id')
  const { storageProvider, driveFolderId } = await c.req.json()
  
  await c.env.DB.prepare(`
    UPDATE texture_sets 
    SET storage_provider = ?, drive_folder_id = ?
    WHERE id = ?
  `).bind(storageProvider, driveFolderId, textureSetId).run()
  
  return c.json({ success: true })
})
```

### Step 4: Cleanup R2 Files (Optional)

After confirming Drive migration works:

```typescript
// DELETE /admin/cleanup-r2 (delete migrated R2 files)
app.delete('/admin/cleanup-r2', verifyAuth, async (c) => {
  // Get all texture tiles that have been migrated (have drive_file_id)
  const tiles = await c.env.DB.prepare(`
    SELECT r2_key FROM texture_tiles WHERE drive_file_id IS NOT NULL
  `).all()
  
  for (const tile of tiles.results) {
    await c.env.BUCKET.delete(tile.r2_key)
  }
  
  return c.json({ deleted: tiles.results.length })
})
```

### Migration Checklist

- [ ] Create `/admin/export-textures` endpoint
- [ ] Create `MigrationView.vue` in Slyce
- [ ] Create migration update endpoints in API
- [ ] Run migration for all texture sets
- [ ] Verify all textures load in Rivvon from Drive URLs
- [ ] Verify textures display in "My Textures" view
- [ ] Test texture download from Drive
- [ ] **(Optional)** Delete R2 files after confirmation

**Estimated Time:** 1-2 hours for implementation + testing

---

## Rivvon Integration: Consuming Hybrid Storage

### Current Rivvon Texture Loading

```javascript
// src/modules/textureService.js
export async function fetchTextureSet(textureSetId) {
  const url = `${API_BASE}/textures/${textureSetId}`
  const response = await fetch(url)
  return await response.json()
}

// Returns:
// {
//   id, name, description, ...
//   tiles: [
//     { tileIndex: 0, url: 'https://cdn.rivvon.ca/textures/abc123/0.ktx2', fileSize: 123456 },
//     { tileIndex: 1, url: 'https://cdn.rivvon.ca/textures/abc123/1.ktx2', fileSize: 123456 },
//     ...
//   ]
// }
```

### Updated API Response (Hybrid URLs)

No changes needed! The API already returns URLs in the `tiles` array. We just need to ensure the API generates the correct URLs based on `storage_provider`:

```typescript
// src/routes/textures.ts - GET /:id endpoint
textureRoutes.get('/:id', async (c) => {
  const textureSetId = c.req.param('id')
  
  const textureSet = await c.env.DB.prepare(`
    SELECT * FROM texture_sets WHERE id = ? AND status = 'complete'
  `).bind(textureSetId).first()
  
  if (!textureSet) {
    return c.json({ error: 'Texture set not found' }, 404)
  }
  
  const tiles = await c.env.DB.prepare(`
    SELECT tile_index, r2_key, drive_file_id, public_url, file_size
    FROM texture_tiles 
    WHERE texture_set_id = ?
    ORDER BY tile_index
  `).bind(textureSetId).all()
  
  // Generate URLs based on storage provider
  const tileUrls = tiles.results.map((tile: any) => {
    let url
    
    if (tile.public_url) {
      // Pre-computed URL (preferred)
      url = tile.public_url
    } else if (tile.drive_file_id) {
      // Google Drive
      url = `https://drive.google.com/uc?id=${tile.drive_file_id}&export=download`
    } else if (tile.r2_key) {
      // R2 fallback
      url = `https://cdn.rivvon.ca/${tile.r2_key}`
    }
    
    return {
      tileIndex: tile.tile_index,
      url,
      fileSize: tile.file_size,
    }
  })
  
  return c.json({
    ...textureSet,
    tiles: tileUrls,
  })
})
```

### Rivvon Three.js Loader (No Changes Needed!)

```javascript
// src/modules/tileManager.js
async loadTile(url) {
  // Works with both R2 and Google Drive URLs!
  // Three.js KTX2Loader handles fetch() internally
  const texture = await this.ktx2Loader.loadAsync(url)
  return texture
}
```

**Key Insight:** Since Google Drive supports CORS and provides direct download URLs, Rivvon's existing texture loading code works without modifications! The API just returns different URLs based on storage provider.

---

## Complete Upload Flow (Google Drive - Updated)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Texture Set Upload Flow (Google Drive)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. User processes video in Slyce → generates KTX2 tiles                    │
│                                                                              │
│  2. User clicks "Upload to Cloud"                                           │
│     └─ storageProvider = 'google-drive' (default)                           │
│                                                                              │
│  3. Create texture set in DB (Slyce → API)                                  │
│     POST /texture-set                                                        │
│     Body: { name, description, tileCount, storageProvider: 'google-drive' } │
│     └─ Returns: { textureSetId }                                            │
│                                                                              │
│  4. Get fresh Drive token (Slyce → API)                                     │
│     GET /api/auth/drive-token                                                │
│     └─ Returns: { accessToken, slyceFolderId }                              │
│                                                                              │
│  5. Create texture set folder in Drive (Slyce → Google Drive API)           │
│     POST https://www.googleapis.com/drive/v3/files                          │
│     Body: { name: '{textureName}-{shortId}', parents: [slyceFolderId] }     │
│     └─ Returns: { id: driveFolderId }                                       │
│                                                                              │
│  6. Upload thumbnail to R2 (Slyce → API → R2)                               │
│     PUT /texture-set/{id}/thumbnail                                          │
│     └─ Existing flow, unchanged                                             │
│                                                                              │
│  7. Upload each tile to Drive (Slyce → Google Drive API)                    │
│     For each tile:                                                           │
│       a. POST resumable upload init                                          │
│          https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable│
│                                                                              │
│       b. PUT file content to resumable upload URL                            │
│                                                                              │
│       c. POST sharing permission (Slyce → Google Drive API)                  │
│          POST /files/{fileId}/permissions                                    │
│          Body: { role: 'reader', type: 'anyone' }                           │
│                                                                              │
│       d. Store tile metadata (Slyce → API)                                   │
│          POST /texture-set/{id}/tile/{index}/metadata                        │
│          Body: { driveFileId, fileSize }                                     │
│                                                                              │
│  8. Mark upload complete (Slyce → API)                                       │
│     POST /texture-set/{id}/complete                                          │
│     └─ Set status='complete', is_public=1                                   │
│                                                                              │
│  9. Texture now accessible via Rivvon                                        │
│     GET /textures → Lists texture set                                        │
│     GET /textures/{id} → Returns Drive URLs for tiles                        │
│     Rivvon loads tiles directly from Drive (no proxy!)                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Backend API Endpoints (Complete Reference)

### New Auth Endpoints (Replacing Auth0)

Located in `apps/api/routes/auth.ts` (new file)

```
GET  /api/auth/login         - Initiate OAuth, generate CSRF state, redirect to Google
GET  /api/auth/callback      - Validate state, exchange code for tokens, set cookies, redirect
GET  /api/auth/me            - Get current user info (from session cookie)
GET  /api/auth/drive-token   - Get fresh Google access token for Drive operations
POST /api/auth/logout        - Clear session cookies & optionally revoke at Google
```

#### `GET /api/auth/login`

Initiates OAuth flow. Generates CSRF state, stores in HTTP-only cookie, redirects to Google.

```typescript
// No request body - just redirects
// Sets oauth_state cookie for CSRF protection
// Redirects to Google OAuth consent screen
```

#### `GET /api/auth/callback`

Handles OAuth redirect from Google. Validates CSRF state, exchanges code for tokens, creates session.

```typescript
// Query params from Google: ?code=xxx&state=xxx
// Validates state against oauth_state cookie
// Exchanges code for tokens
// Sets session + refresh_token cookies
// Redirects to app home
```

#### `GET /api/auth/drive-token`

Requires session cookie. Returns fresh Google Drive access token.

```typescript
interface DriveTokenResponse {
  accessToken: string   // Fresh Google access token (valid ~1 hour)
  expiresIn: number    // Seconds until expiry (typically 3600)
  slyceFolderId: string | null  // Cached "Slyce Textures" folder ID
}
```

### Modified Texture Endpoints

#### `POST /texture-set`

**Changes:** Add `storageProvider` field (defaults to `'google-drive'`)

```typescript
interface CreateTextureSetRequest {
  name: string
  description?: string
  tileCount: number
  layerCount: number
  tileResolution: number
  crossSectionType?: string
  storageProvider?: 'r2' | 'google-drive'  // ← NEW (default: 'google-drive')
  sourceMetadata?: {
    filename: string
    width: number
    height: number
    duration: number
    sourceFrameCount: number
    sampledFrameCount: number
  }
  userProfile?: {
    name: string
    email: string
    picture: string
  }
}
```

#### `POST /texture-set/:id/tile/:index/metadata` (New)

#### `POST /texture-set/:id/tile/:index/metadata` (New)

Store Google Drive file metadata after browser uploads tile.

```typescript
interface StoreTileMetadataRequest {
  driveFileId: string  // Google Drive file ID
  fileSize: number     // File size in bytes
}

// Updates texture_tiles table with:
// - drive_file_id
// - file_size  
// - public_url (pre-computed Drive download URL)
```

#### `GET /textures/:id` (Modified)

**Changes:** Return URLs based on storage provider (R2 or Google Drive)

```typescript
interface TextureSetResponse {
  id: string
  name: string
  description: string
  storage_provider: 'r2' | 'google-drive'  // ← NEW
  // ... other metadata fields
  tiles: Array<{
    tileIndex: number
    url: string  // Either R2 or Drive URL
    fileSize: number
  }>
}
```

---

## Frontend Components (Updated)

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

// Check for existing session on app load (replaces Auth0)
const { checkSession } = useGoogleAuth()

;(async () => {
  await checkSession()  // Restore session from cookie if exists
  app.mount('#app')
})()
```

**Note:** No GIS library initialization needed! The frontend simply redirects to `/api/auth/login` which handles everything.

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
GET  /api/auth/login       - Initiate OAuth, generate CSRF state, redirect to Google
GET  /api/auth/callback    - Validate state, exchange code, set cookies, redirect to app
GET  /api/auth/me          - Get current user info (from session cookie)
GET  /api/auth/drive-token - Get fresh access token (reads refresh token from cookie)
POST /api/auth/logout      - Clear cookies & optionally revoke at Google
```

### `GET /api/auth/login`

Initiates OAuth flow with CSRF protection.

```javascript
// Backend logic:
1. Generate random CSRF state token (crypto.randomUUID())
2. Store state in HTTP-only cookie (oauth_state, expires in 10 min)
3. Build Google OAuth URL with:
   - client_id, redirect_uri, response_type=code
   - scope (openid, email, profile, drive.file)
   - access_type=offline, prompt=consent
   - state parameter (CSRF protection)
4. Redirect user to Google consent screen
```

### `GET /api/auth/callback`

Handles OAuth redirect from Google, validates state, exchanges code for tokens, sets cookies.

```javascript
// Called by Google OAuth redirect: /api/auth/callback?code=xxx&state=xxx

// Backend logic:
1. Validate CSRF state parameter against oauth_state cookie
2. Clear oauth_state cookie (one-time use)
3. Exchange code for access_token + refresh_token + id_token
4. Decode id_token to get user info (sub, email, name, picture)
5. Upsert user in database (create if new, update if exists)
6. Set HTTP-only cookies:
   - session (Path=/, 7 day expiry)
   - google_refresh_token (Path=/api/auth, 30 day expiry)
7. Redirect to frontend app
```

### `GET /api/auth/drive-token`

Get fresh access token for Drive uploads (reads refresh token from HTTP-only cookie).

```javascript
// Cookies automatically sent by browser

// Backend logic:
1. Verify session cookie
2. Read google_refresh_token from HTTP-only cookie
3. If missing, return 401 (user needs to re-login)
4. Exchange refresh_token for fresh access_token via Google
5. Return access_token (short-lived, safe for frontend)

// Response
{
  "accessToken": "ya29.a0AfH6...",
  "expiresIn": 3600,
  "slyceFolderId": "1abc123..."  // Cached folder ID from user record
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

1. **Refresh Token Storage (HTTP-Only Cookie)**
   - Stored in HTTP-only cookie, never accessible to JavaScript
   - Not stored in database (no encryption needed)
   - Automatic CSRF protection via SameSite=Lax

2. **Access Token Handling**
   - Short-lived (1 hour)
   - Held in memory only (not localStorage)
   - Scoped to `drive.file` (minimal permissions)

3. **Token Refresh**
   - Backend reads refresh token from HTTP-only cookie
   - Frontend requests new access token when needed
   - Cookie automatically sent with credentials: 'include'

4. **HTTPS Everywhere**
   - All API calls over HTTPS
   - Cookies have Secure flag (only sent over HTTPS)
   - Drive API requires HTTPS

5. **Token Revocation on Logout**
   - Clear both cookies (session + refresh_token)
   - Optionally revoke at Google

6. **CORS with Credentials**
   - API configured with `credentials: true`
   - Specific origins listed (not wildcard)

---

---

## Implementation Phases (Monorepo Context)

### Phase 0: Database Schema Updates

**Goal:** Prepare database for Google auth and hybrid storage

**Location:** `apps/api/db/schema.sql` and migration script

- [ ] Add Google auth fields to users table:
  ```sql
  ALTER TABLE users ADD COLUMN google_id TEXT UNIQUE;
  -- Note: refresh_token stored in HTTP-only cookie, NOT in database
  ALTER TABLE users ADD COLUMN drive_folder_id TEXT;
  ```
- [ ] Add storage provider fields to texture_sets:
  ```sql
  ALTER TABLE texture_sets ADD COLUMN storage_provider TEXT DEFAULT 'google-drive';
  ALTER TABLE texture_sets ADD COLUMN drive_folder_id TEXT;
  ```
- [ ] Add Drive fields to texture_tiles:
  ```sql
  ALTER TABLE texture_tiles ADD COLUMN drive_file_id TEXT;
  ALTER TABLE texture_tiles ADD COLUMN public_url TEXT;
  ```
- [ ] Run migration on D1 database via `wrangler d1 execute`
- [ ] Set existing textures to R2:
  ```sql
  UPDATE texture_sets SET storage_provider = 'r2' WHERE storage_provider IS NULL;
  ```

**Estimated Time:** 30 minutes

---

### Phase 1: Backend - Google OAuth & Session Management

**Goal:** Replace Auth0 authentication with Google OAuth in API

**Location:** `apps/api/`

- [ ] **Add secrets to Cloudflare:**
  ```bash
  wrangler secret put GOOGLE_CLIENT_ID
  wrangler secret put GOOGLE_CLIENT_SECRET
  wrangler secret put SESSION_SECRET  # For signing session tokens
  # Note: No encryption key needed - refresh tokens stored in HTTP-only cookies
  ```
- [ ] **Create auth routes** (`routes/auth.ts`):
  - [ ] `GET /api/auth/login` - Generate CSRF state, store in cookie, redirect to Google
  - [ ] `GET /api/auth/callback` - Validate state, exchange code for tokens, set cookies
  - [ ] `GET /api/auth/me` - Get current user from session cookie
  - [ ] `POST /api/auth/logout` - Clear cookies, optionally revoke at Google
  - [ ] `GET /api/auth/drive-token` - Get fresh access token (reads refresh token from cookie)
- [ ] **Create session middleware** (`middleware/session.ts`):
  - [ ] Parse session cookie
  - [ ] Validate session token
  - [ ] Attach user info to context
- [ ] **Create cookie utils** (`utils/cookies.ts`):
  - [ ] `setAuthCookies()` - Set session + refresh token cookies (consistent attributes)
  - [ ] `clearAuthCookies()` - Clear cookies on logout
  - [ ] `getCookie()` - Parse cookie from request
  - [ ] Cookie attributes: `HttpOnly; Secure; SameSite=Lax`
- [ ] **Update auth middleware** (`middleware/auth.ts`):
  - [ ] Replace Auth0 JWT verification with session validation
  - [ ] Remove `jose` Auth0 JWKS logic
- [ ] **Update index.ts**:
  - [ ] Mount `/api/auth` routes
  - [ ] Update CORS configuration if needed
- [ ] **Test endpoints** with curl/Postman

**Estimated Time:** 4-6 hours

---

### Phase 2: Frontend - Google OAuth Integration

**Goal:** Replace Auth0 in Slyce with Google OAuth (Authorization Code Flow)

**Location:** `apps/slyce/src/`

- [ ] **Create Google Auth composable** (`composables/useGoogleAuth.js`):
  - [ ] `login()` - Redirect to `/api/auth/login` (backend handles OAuth)
  - [ ] `logout()` - POST to `/api/auth/logout`
  - [ ] `checkSession()` - GET `/api/auth/me` on app load
  - [ ] `getAccessToken()` - GET `/api/auth/drive-token` for Drive operations
  - [ ] No GIS library needed - pure redirect flow
- [ ] **Update main.js**:
  - [ ] Remove Auth0 initialization
  - [ ] Call `checkSession()` on app load (no GIS init required)
- [ ] **Update AuthButton.vue**:
  - [ ] Replace Auth0 composable with `useGoogleAuth`
  - [ ] Update login button UI (Google branding)
- [ ] **Update api.js service**:
  - [ ] Remove `getAccessTokenSilently()`
  - [ ] Use session cookies with `credentials: 'include'`
- [ ] **Environment variables** (`.env`):
  ```
  VITE_API_URL=https://api.rivvon.ca
  ```
  Note: No `VITE_GOOGLE_CLIENT_ID` needed - backend handles OAuth redirect
- [ ] **Remove Auth0**:
  - [ ] Uninstall `@auth0/auth0-vue`
  - [ ] Remove Auth0 env variables
  - [ ] Remove GIS script loading (not needed)
- [ ] **Test**:
  - [ ] Login flow end-to-end
  - [ ] Session persistence (refresh page)
  - [ ] Logout
  - [ ] Token refresh for Drive operations

**Estimated Time:** 3-4 hours (simpler than GIS approach)

---

### Phase 3: Backend - Google Drive Support

**Goal:** Add endpoints for Drive file metadata storage

**Location:** `apps/api/routes/upload.ts`

- [ ] **Modify `POST /texture-set`**:
  - [ ] Accept `storageProvider` in request body
  - [ ] Store in database (defaults to 'google-drive')
- [ ] **Create `POST /texture-set/:id/tile/:index/metadata`**:
  - [ ] Accept `driveFileId`, `fileSize`
  - [ ] Generate public URL: `https://drive.google.com/uc?id={fileId}&export=download`
  - [ ] Store in `texture_tiles` table
- [ ] **Modify `POST /texture-set/:id/complete`**:
  - [ ] Verify tiles based on storage provider
  - [ ] For Drive: check `drive_file_id` exists
  - [ ] For R2: check R2 object exists (existing logic)
- [ ] **Modify `GET /textures/:id`** (`routes/textures.ts`):
  - [ ] Return URLs from `public_url` column
  - [ ] Fallback to generating URL from `drive_file_id` or `r2_key`
- [ ] **Test** with mock Drive file IDs

**Estimated Time:** 2-3 hours

---

### Phase 4: Frontend - Google Drive Upload

**Goal:** Upload KTX2 tiles directly to Google Drive from browser

**Location:** `apps/slyce/src/`

- [ ] **Create Google Drive composable** (`composables/useGoogleDrive.js`):
  - [ ] `getAccessToken()` - Fetch from `/api/auth/drive-token`
  - [ ] `createFolder(name, parentId)` - Create folder in Drive
  - [ ] `uploadFile(file, fileName, folderId)` - Resumable upload
  - [ ] `setPublicPermission(fileId)` - Make file public
- [ ] **Update upload flow** (in appStore or upload component):
  - [ ] Check storage provider (default: 'google-drive')
  - [ ] If Drive:
    - [ ] Get Drive access token
    - [ ] Create/get "Slyce Textures" folder
    - [ ] Create texture set subfolder
    - [ ] Upload each tile to Drive
    - [ ] Set public permissions
    - [ ] POST metadata to API
  - [ ] If R2: Use existing upload flow
- [ ] **Update SettingsArea.vue** (if needed):
  - [ ] Option to choose storage provider (default Google Drive)
  - [ ] Show "Textures will be stored in your Google Drive"
- [ ] **Test**:
  - [ ] Full texture creation → Drive upload flow
  - [ ] Verify files appear in Google Drive
  - [ ] Verify files are publicly accessible

**Estimated Time:** 5-6 hours

---

### Phase 5: Rivvon - Hybrid URL Support

**Goal:** Ensure Rivvon can load textures from both R2 and Google Drive

**Location:** `apps/rivvon/src/modules/`

- [ ] **Verify textureService.js**:
  - [ ] Confirm it uses URLs from API response (should work as-is)
- [ ] **Test texture loading**:
  - [ ] Create R2 texture in Slyce → Load in Rivvon ✓
  - [ ] Create Drive texture in Slyce → Load in Rivvon ✓
  - [ ] Check CORS works for Drive URLs
  - [ ] Verify performance is acceptable
- [ ] **Handle error cases**:
  - [ ] Drive file unavailable (show error message)
  - [ ] Slow Drive response (loading indicator)

**Estimated Time:** 1-2 hours

---

### Phase 6: Data Migration

**Goal:** Migrate existing R2 textures to Google Drive

**Location:** `apps/slyce/src/views/` (admin page)

- [ ] **Backend**: Create admin endpoints (`routes/admin.ts`):
  - [ ] `GET /admin/export-textures` - List all user textures
  - [ ] `PUT /admin/texture-tile/:id/storage` - Update tile storage info
  - [ ] `PUT /admin/texture-set/:id/storage` - Update texture set provider
  - [ ] `DELETE /admin/cleanup-r2` - Delete migrated R2 files
- [ ] **Frontend**: Create `MigrationView.vue`:
  - [ ] List textures to migrate
  - [ ] Progress UI for each texture
  - [ ] Fetch tiles from R2 → Upload to Drive
  - [ ] Update database via admin endpoints
- [ ] **Router**: Add `/admin/migrate` route
- [ ] **Execute migration**:
  - [ ] Run migration for all your textures
  - [ ] Verify in Rivvon
  - [ ] Verify in "My Textures"
- [ ] **Cleanup**: Delete R2 files after confirmation

**Estimated Time:** 2-3 hours implementation + 1 hour execution

---

### Phase 7: Polish & Production

**Goal:** Handle edge cases, improve UX, prepare for production

- [ ] **Error handling**:
  - [ ] Token expiry during upload (auto-refresh)
  - [ ] Drive quota exceeded (clear error message)
  - [ ] Network failures (retry logic)
- [ ] **UX improvements**:
  - [ ] Upload progress indicators
  - [ ] Success/error notifications
  - [ ] Loading states during auth
- [ ] **Google Cloud Console**:
  - [ ] Submit OAuth app for verification
  - [ ] Add privacy policy URL
  - [ ] Move from testing to production
- [ ] **Documentation**:
  - [ ] Update README files
  - [ ] Document environment variables
  - [ ] Add deployment notes
- [ ] **Testing**:
  - [ ] End-to-end test all flows
  - [ ] Test on different browsers
  - [ ] Test slow network conditions
- [ ] **Cleanup**:
  - [ ] Remove Auth0 references
  - [ ] Remove unused dependencies
  - [ ] Update .env.example files

**Estimated Time:** 4-6 hours

---

## Total Estimated Effort

| Phase | Estimated Time |
|-------|---------------|
| Phase 0: Database Schema | 0.5 hours |
| Phase 1: Backend Auth | 4-6 hours |
| Phase 2: Frontend Auth | 4-5 hours |
| Phase 3: Backend Drive Support | 2-3 hours |
| Phase 4: Frontend Drive Upload | 5-6 hours |
| Phase 5: Rivvon Integration | 1-2 hours |
| Phase 6: Data Migration | 3-4 hours |
| Phase 7: Polish & Production | 4-6 hours |
| **Total** | **24-33 hours** |

---

## Success Criteria

✅ **Authentication**
- User can log in with Google (single consent screen)
- Session persists across page reloads
- Auth0 completely removed

✅ **Storage**
- New textures default to Google Drive
- Existing R2 textures continue to work
- Database tracks storage provider per texture

✅ **Upload Flow**
- Slyce uploads KTX2 tiles directly to user's Google Drive
- Files are publicly accessible (anyone with link)
- Thumbnails remain on R2
- Progress indication works

✅ **Consumption**
- Rivvon loads textures from both R2 and Google Drive
- No CORS issues
- Performance is acceptable
- Error handling for unavailable files

✅ **Migration**
- Existing textures migrated from R2 to Google Drive
- Migration tool works reliably
- Old R2 files cleaned up after confirmation

✅ **Production Ready**
- OAuth app verified by Google
- Error handling covers edge cases
- Documentation updated
- No Auth0 dependencies remain

---

## Google Cloud Setup Checklist

### 1. Create Project
- Go to [Google Cloud Console](https://console.cloud.google.com)
- Create new project: **"Rivvon"** or **"Slyce"**

### 2. Enable APIs
- **Google Drive API**: Enable from API Library
- **Google People API**: Enable (for profile info)

### 3. Configure OAuth Consent Screen
- User type: **External**
- App name: **"Slyce"**
- User support email: Your email
- Developer contact: Your email
- App logo: (optional) Upload Slyce logo
- Application home page: `https://slyce.rivvon.ca`
- Application privacy policy: (create a simple one) `https://slyce.rivvon.ca/privacy`
- Application terms of service: (optional)

### 4. Add OAuth Scopes
Add these scopes in the consent screen configuration:
- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/drive.file` (App-created files only)

**Consent Screen Preview:**
```
Slyce wants to:
• See your email address
• See your personal info (name, picture)
• See, edit, create, and delete only the specific 
  Google Drive files you use with this app
```

### 5. Create OAuth 2.0 Credentials
- Type: **OAuth 2.0 Client ID**
- Application type: **Web application**
- Name: **"Slyce Web Client"**

**Authorized JavaScript origins:**
```
https://slyce.rivvon.ca
http://localhost:5173
http://localhost:5174
```

**Authorized redirect URIs:**
```
https://slyce.rivvon.ca/callback
http://localhost:5173/callback
http://localhost:5174/callback
```

- Click **Create**
- Save **Client ID** and **Client Secret**


### 6. Test Users (During Development)
While app is in "Testing" mode:
- Add your Google account as test user
- Add any collaborator accounts

### 7. Publishing (Production)
Once ready for production:
- **Submit for verification** (required for `drive.file` scope)
- Prepare verification materials:
  - Privacy policy (required)
  - Explanation of how you use Drive access
  - YouTube demo video (optional but helpful)
- Google review process: **1-2 weeks typically**
- After approval, app moves to "In Production"

### 8. Set Cloudflare Secrets
```bash
cd apps/api

# Store secrets (only 2 needed - no encryption key!)
wrangler secret put GOOGLE_CLIENT_ID
# Paste your Google Client ID

wrangler secret put GOOGLE_CLIENT_SECRET
# Paste your Google Client Secret

# Note: No REFRESH_TOKEN_ENCRYPTION_KEY needed
# Refresh tokens are stored in HTTP-only cookies, not the database
```

### 9. Update Environment Variables

**Slyce** (`.env`):
```bash
VITE_GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
VITE_API_URL=https://api.rivvon.ca
VITE_APP_URL=https://slyce.rivvon.ca
```

**API** (`wrangler.toml` vars section - non-secret):
```toml
[vars]
CORS_ORIGINS = "https://slyce.rivvon.ca,https://rivvon.ca,http://localhost:5173"
APP_URL = "https://slyce.rivvon.ca"
```

---

## Privacy Policy Requirements

Google requires a privacy policy for OAuth apps. Here's a minimal template:

**Key points to cover:**
1. What data you collect (email, name, profile picture)
2. How you use Google Drive access (storing user-created textures)
3. That you don't access other Drive files
4. How users can revoke access
5. Data retention policy
6. Contact information

**Host at:** `https://slyce.rivvon.ca/privacy` (can be static page)

---

## Security Best Practices Summary

### ✅ Implemented
- **HTTP-only cookies** for refresh tokens (not stored in database)
- **HTTP-only cookies** for sessions
- **CSRF state validation** via backend-managed HTTP-only cookie (not sessionStorage)
- **Restricted cookie paths** (`Path=/api/auth` for refresh token)
- **Consistent cookie attributes** (`HttpOnly; Secure; SameSite=Lax` on all auth cookies)
- **Minimal OAuth scopes** (`drive.file` only)
- **Authorization Code Flow** (not GIS Token Client) - tokens never exposed to frontend
- **HTTPS everywhere**
- **Cloudflare Secrets** for Google client credentials
- **Short-lived access tokens** (1 hour, in-memory only, never localStorage)

### ✅ Recommended Additional Measures
- **Rate limiting** on auth endpoints (Cloudflare has built-in DDoS protection)
- **Audit logging** for auth events (log to Cloudflare Analytics)
- **User token revocation** UI in settings

---

## Troubleshooting Guide

### Issue: "redirect_uri_mismatch" error

**Cause:** Redirect URI not registered in Google Console

**Fix:**
1. Go to Google Cloud Console → APIs & Services → Credentials
2. Edit your OAuth 2.0 Client ID
3. Add exact redirect URI to "Authorized redirect URIs" list
4. Must match exactly including protocol, domain, port, and path

### Issue: Google Drive files not loading in Rivvon

**Cause:** Public sharing not set correctly

**Fix:**
1. Check file permissions in Google Drive
2. Ensure permission type is "anyone" with role "reader"
3. Verify public URL format: `https://drive.google.com/uc?id={FILE_ID}&export=download`
4. Check browser console for CORS errors

### Issue: "Access blocked" during OAuth consent

**Cause:** App not verified or test user not added

**Fix:**
- If in development: Add your Google account to test users in consent screen
- If in production: Complete verification process
- Temporary: Click "Advanced" → "Go to Slyce (unsafe)" (only for testing)

### Issue: Refresh token not provided

**Cause:** Google only sends refresh token on first consent

**Fix:**
1. Revoke app access: https://myaccount.google.com/permissions
2. Log in again (will trigger new consent)
3. OR use `access_type=offline` and `prompt=consent` parameters

### Issue: Upload fails midway

**Cause:** Token expired during long upload

**Fix:**
- Implement token refresh in upload flow
- Check token expiry before each upload
- Request new token if < 5 minutes remaining

---

## Future Enhancements

### Phase 8+ Ideas

- **Batch operations**: Delete multiple textures at once
- **Texture sharing**: Share texture sets with other users via Drive
- **Folder customization**: Let users choose where to save textures
- **Offline support**: Cache textures for offline playback
- **CDN caching**: Proxy popular textures through Cloudflare for speed
- **Analytics**: Track texture views and downloads
- **Texture marketplace**: Public gallery of community textures
- **Collaborative editing**: Multiple users working on same texture set
- **Version control**: Keep history of texture updates

---

## Resources & References

### Google APIs
- **OAuth 2.0**: https://developers.google.com/identity/protocols/oauth2
- **Drive API v3**: https://developers.google.com/drive/api/v3/reference
- **Resumable Upload**: https://developers.google.com/drive/api/guides/manage-uploads#resumable
- **Permissions API**: https://developers.google.com/drive/api/reference/rest/v3/permissions
- **OAuth Scopes**: https://developers.google.com/identity/protocols/oauth2/scopes#drive

### Cloudflare
- **Workers**: https://developers.cloudflare.com/workers/
- **D1 Database**: https://developers.cloudflare.com/d1/
- **R2 Storage**: https://developers.cloudflare.com/r2/
- **Wrangler CLI**: https://developers.cloudflare.com/workers/wrangler/

### Web Crypto API
- **SubtleCrypto**: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto
- **AES-GCM**: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt

### Three.js
- **KTX2Loader**: https://threejs.org/docs/#examples/en/loaders/KTX2Loader
- **Texture**: https://threejs.org/docs/#api/en/textures/Texture

---

## Glossary

- **Auth0**: Third-party authentication service (being replaced)
- **D1**: Cloudflare's serverless SQL database (SQLite-based)
- **Drive API**: Google's RESTful API for Drive file operations
- **JWKS**: JSON Web Key Set (public keys for JWT verification)
- **JWT**: JSON Web Token (authentication token format)
- **KTX2**: Khronos Texture 2.0 (compressed GPU texture format)
- **OAuth 2.0**: Open standard for authorization
- **R2**: Cloudflare's S3-compatible object storage
- **Refresh Token**: Long-lived token for obtaining new access tokens
- **Resumable Upload**: Upload protocol that supports pause/resume
- **Scope**: OAuth permission level (e.g., `drive.file`)
- **Worker**: Cloudflare's serverless compute platform

---

## Appendix: Migration Script Example

Complete migration script for reference:

```javascript
// apps/slyce/src/views/MigrationView.vue (excerpts)

async function migrateTexture(textureSet, tiles) {
  const { useGoogleDrive } = await import('@/composables/useGoogleDrive')
  const drive = useGoogleDrive()
  
  // 1. Create folder in Drive
  const folderName = `${textureSet.name}-${textureSet.id.slice(0, 6)}`
  console.log(`Creating folder: ${folderName}`)
  
  const folder = await drive.createFolder(
    folderName,
    drive.slyceFolderId.value
  )
  
  // 2. Download & re-upload each tile
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]
    console.log(`Migrating tile ${i + 1}/${tiles.length}`)
    
    // Download from R2
    const response = await fetch(`https://cdn.rivvon.ca/${tile.r2_key}`)
    if (!response.ok) throw new Error(`Failed to download tile ${tile.tile_index}`)
    
    const blob = await response.blob()
    
    // Upload to Drive
    const fileName = `${tile.tile_index}.ktx2`
    const driveFile = await drive.uploadFile(blob, fileName, folder.id)
    
    // Update database
    await fetch(`/admin/texture-tile/${tile.id}/storage`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        driveFileId: driveFile.fileId,
        publicUrl: driveFile.webContentLink
      })
    })
    
    // Update progress
    progress.value[textureSet.id] = i + 1
  }
  
  // 3. Update texture set
  await fetch(`/admin/texture-set/${textureSet.id}/storage`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storageProvider: 'google-drive',
      driveFolderId: folder.id
    })
  })
  
  console.log(`✓ Migrated: ${textureSet.name}`)
}
```

---

**End of Google Drive Integration Plan**

*Last Updated: January 22, 2026*
*Monorepo Context: rivvon-app (api + slyce + rivvon)*
