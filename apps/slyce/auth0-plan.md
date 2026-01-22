# Slyce - Auth0 Integration Plan

## Overview

Integrate Auth0 authentication into Slyce to enable authenticated texture uploads to the Rivvon API. Users will log in via Auth0, receive a JWT access token, and use it to authenticate API requests.

---

## Auth0 Configuration (Already Done in Auth0 Dashboard)

### Application Settings
- **Name**: `Slyce Frontend`
- **Type**: Single Page Application (SPA)
- **Domain**: `login.rivvon.ca`  (Custom domain via CNAME pointing to tenant)
- **Client ID**: `<your-client-id>`

### API Settings
- **API Name**: `Rivvon API`
- **Identifier (Audience)**: `https://api.rivvon.ca`
- **Scopes**: `upload:textures`, `delete:textures`

### Callback URLs
- Production: `https://slyce.rivvon.ca/callback`
- Development: `http://localhost:5173/callback`

---

## Implementation Plan

### Phase 1: Dependencies & Environment Setup

#### 1.1 Install Auth0 SDK

```bash
npm install @auth0/auth0-vue
```

#### 1.2 Create Environment Variables

Create `.env` file in slyce repository root:

```bash
# .env
VITE_AUTH0_DOMAIN=login.rivvon.ca
VITE_AUTH0_CLIENT_ID=<slyce-client-id>
VITE_AUTH0_AUDIENCE=https://api.rivvon.ca
VITE_AUTH0_REDIRECT_URI=http://localhost:5173/callback

# For production (Cloudflare Pages):
# Set these as environment variables in Cloudflare Pages dashboard
```

#### 1.3 Update `.gitignore`

```gitignore
.env
.env.local
```

---

### Phase 2: Auth0 Integration

#### 2.1 Configure Auth0 Plugin

Update `src/main.ts`:

```typescript
// filepath: src/main.ts
import { createApp } from 'vue'
import { createAuth0 } from '@auth0/auth0-vue'
import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(router)

app.use(
  createAuth0({
    domain: import.meta.env.VITE_AUTH0_DOMAIN,
    clientId: import.meta.env.VITE_AUTH0_CLIENT_ID,
    authorizationParams: {
      redirect_uri: import.meta.env.VITE_AUTH0_REDIRECT_URI || window.location.origin + '/callback',
      audience: import.meta.env.VITE_AUTH0_AUDIENCE,
      scope: 'openid profile email upload:textures delete:textures',
    },
    cacheLocation: 'localstorage', // Persist auth across page reloads
  })
)

app.mount('#app')
```

#### 2.2 Create Callback Route

Create `src/views/CallbackView.vue`:

```vue
// filepath: src/views/CallbackView.vue
<template>
  <div class="callback-container">
    <h2>Processing login...</h2>
    <p>Please wait while we complete your authentication.</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useAuth0 } from '@auth0/auth0-vue'
import { useRouter } from 'vue-router'

const { handleRedirectCallback } = useAuth0()
const router = useRouter()

onMounted(async () => {
  try {
    await handleRedirectCallback()
    // Redirect to home or previous page after successful login
    const redirectTo = sessionStorage.getItem('auth_redirect') || '/'
    sessionStorage.removeItem('auth_redirect')
    router.push(redirectTo)
  } catch (error) {
    console.error('Login callback error:', error)
    router.push('/')
  }
})
</script>

<style scoped>
.callback-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  text-align: center;
}
</style>
```

#### 2.3 Update Router

Update `src/router/index.ts` to include callback route:

```typescript
// filepath: src/router/index.ts
// ...existing code...
{
  path: '/callback',
  name: 'callback',
  component: () => import('../views/CallbackView.vue')
}
// ...existing code...
```

---

### Phase 3: UI Components

#### 3.1 Create Auth Button Component

Create `src/components/AuthButton.vue`:

```vue
// filepath: src/components/AuthButton.vue
<template>
  <div class="auth-button">
    <button v-if="!isAuthenticated" @click="login" class="btn-login">
      Login
    </button>
    
    <div v-else class="user-menu">
      <img v-if="user?.picture" :src="user.picture" :alt="user.name" class="avatar" />
      <span class="username">{{ user?.name || user?.email }}</span>
      <button @click="logout" class="btn-logout">
        Logout
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAuth0 } from '@auth0/auth0-vue'

const { loginWithRedirect, logout: auth0Logout, user, isAuthenticated } = useAuth0()

const login = () => {
  // Save current route to redirect back after login
  sessionStorage.setItem('auth_redirect', window.location.pathname)
  loginWithRedirect()
}

const logout = () => {
  auth0Logout({
    logoutParams: {
      returnTo: window.location.origin
    }
  })
}
</script>

<style scoped>
.auth-button {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.user-menu {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
}

.username {
  font-size: 0.9rem;
  color: #333;
}

.btn-login,
.btn-logout {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background-color 0.2s;
}

.btn-login {
  background-color: #0066cc;
  color: white;
}

.btn-login:hover {
  background-color: #0052a3;
}

.btn-logout {
  background-color: #f0f0f0;
  color: #333;
}

.btn-logout:hover {
  background-color: #e0e0e0;
}
</style>
```

#### 3.2 Create User Profile Component

Create `src/components/UserProfile.vue` for detailed user information:

```vue
// filepath: src/components/UserProfile.vue
<template>
  <div v-if="isAuthenticated" class="user-profile">
    <div class="profile-header">
      <img v-if="user?.picture" :src="user.picture" :alt="user.name" class="profile-avatar" />
      <div class="profile-info">
        <h3>{{ user?.name }}</h3>
        <p class="email">{{ user?.email }}</p>
        <span class="status-badge">✓ Authenticated</span>
      </div>
    </div>
    <div class="profile-meta">
      <p class="text-sm">Ready to upload textures to Rivvon CDN</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAuth0 } from '@auth0/auth0-vue'

const { user, isAuthenticated } = useAuth0()
</script>

<style scoped>
.user-profile {
  padding: 1.5rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 8px;
  margin-bottom: 2rem;
  color: white;
}

.profile-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.profile-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.3);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}

.profile-info h3 {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 600;
}

.email {
  color: rgba(255, 255, 255, 0.9);
  margin: 0.25rem 0;
  font-size: 0.9rem;
}

.status-badge {
  background: rgba(255, 255, 255, 0.2);
  color: white;
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 500;
  display: inline-block;
  margin-top: 0.5rem;
}

.profile-meta {
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  padding-top: 0.75rem;
}

.text-sm {
  font-size: 0.85rem;
  margin: 0;
  opacity: 0.9;
}
</style>
```

#### 3.3 Create Login Prompt Component

Create `src/components/LoginPrompt.vue` for unauthenticated users:

```vue
// filepath: src/components/LoginPrompt.vue
<template>
  <div v-if="!isAuthenticated" class="login-prompt">
    <div class="prompt-icon">🔒</div>
    <h2>Authentication Required</h2>
    <p class="prompt-description">
      Log in to upload and manage your textures on Rivvon CDN
    </p>
    <button @click="login" class="btn-login-large">
      <span class="icon">🚀</span>
      Login with Auth0
    </button>
    <p class="hint">Supports email, Google, and more authentication providers</p>
  </div>
</template>

<script setup lang="ts">
import { useAuth0 } from '@auth0/auth0-vue'

const { isAuthenticated, loginWithRedirect } = useAuth0()

const login = () => {
  sessionStorage.setItem('auth_redirect', window.location.pathname)
  loginWithRedirect()
}
</script>

<style scoped>
.login-prompt {
  text-align: center;
  padding: 3rem 2rem;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  border-radius: 12px;
  max-width: 480px;
  margin: 2rem auto;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.prompt-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

.login-prompt h2 {
  margin: 0 0 1rem;
  color: #2d3748;
  font-size: 1.75rem;
}

.prompt-description {
  color: #4a5568;
  margin-bottom: 2rem;
  font-size: 1rem;
  line-height: 1.6;
}

.btn-login-large {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 1rem 2.5rem;
  border: none;
  border-radius: 8px;
  font-size: 1.1rem;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-login-large:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(102, 126, 234, 0.5);
}

.btn-login-large:active {
  transform: translateY(0);
}

.btn-login-large .icon {
  font-size: 1.2rem;
}

.hint {
  font-size: 0.85rem;
  color: #718096;
  margin-top: 1rem;
}
</style>
```

#### 3.4 Create Auth Loading State Component

Create `src/components/AuthLoadingState.vue`:

```vue
// filepath: src/components/AuthLoadingState.vue
<template>
  <div v-if="isLoading" class="auth-loading">
    <div class="spinner"></div>
    <p>Checking authentication...</p>
  </div>
</template>

<script setup lang="ts">
import { useAuth0 } from '@auth0/auth0-vue'

const { isLoading } = useAuth0()
</script>

<style scoped>
.auth-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  gap: 1rem;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f4f6;
  border-top: 4px solid #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.auth-loading p {
  color: #6b7280;
  font-size: 0.9rem;
  margin: 0;
}
</style>
```

#### 3.5 Add Auth Button to App Layout

Update your main app component to include auth components:

```vue
// filepath: src/App.vue (or src/components/Header.vue)
<template>
  <div class="app-container">
    <header class="app-header">
      <div class="logo">
        <h1>Slyce</h1>
      </div>
      <nav class="nav-actions">
        <AuthButton />
      </nav>
    </header>
    
    <main class="app-main">
      <AuthLoadingState />
      <LoginPrompt />
      <UserProfile />
      
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import AuthButton from './components/AuthButton.vue'
import LoginPrompt from './components/LoginPrompt.vue'
import UserProfile from './components/UserProfile.vue'
import AuthLoadingState from './components/AuthLoadingState.vue'
</script>

<style scoped>
.app-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.logo h1 {
  margin: 0;
  font-size: 1.5rem;
  color: #2d3748;
}

.app-main {
  flex: 1;
  padding: 2rem;
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
}
</style>
```

---

### Phase 4: API Integration

#### 4.1 Create API Client with Auth

Create `src/services/api.ts`:

```typescript
// filepath: src/services/api.ts
import { useAuth0 } from '@auth0/auth0-vue'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://api.rivvon.ca'

export class RivvonAPI {
  private auth0: ReturnType<typeof useAuth0>

  constructor() {
    this.auth0 = useAuth0()
  }

  /**
   * Get access token for API requests
   */
  private async getAccessToken(): Promise<string> {
    try {
      const token = await this.auth0.getAccessTokenSilently()
      return token
    } catch (error) {
      console.error('Failed to get access token:', error)
      throw new Error('Authentication required')
    }
  }

  /**
   * Request a signed upload URL from the API
   */
  async requestUploadUrl(filename: string, contentType: string = 'application/octet-stream') {
    const token = await this.getAccessToken()

    const response = await fetch(`${API_BASE_URL}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        filename,
        contentType,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Upload request failed')
    }

    return response.json() as Promise<{
      uploadUrl: string
      textureId: string
      key: string
    }>
  }

  /**
   * Upload file directly to R2 using signed URL
   */
  async uploadFile(signedUrl: string, file: Blob, contentType: string = 'application/octet-stream') {
    const response = await fetch(signedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: file,
    })

    if (!response.ok) {
      throw new Error('File upload failed')
    }

    return response
  }

  /**
   * Complete texture upload workflow
   */
  async uploadTexture(file: Blob, filename: string) {
    // 1. Request signed URL
    const { uploadUrl, textureId, key } = await this.requestUploadUrl(
      filename,
      'application/octet-stream'
    )

    // 2. Upload file to R2
    await this.uploadFile(uploadUrl, file)

    // 3. Return texture info
    return {
      textureId,
      key,
      cdnUrl: `https://cdn.rivvon.ca/${key}`,
    }
  }

  /**
   * Get list of all textures (public endpoint)
   */
  async listTextures() {
    const response = await fetch(`${API_BASE_URL}/textures`)
    
    if (!response.ok) {
      throw new Error('Failed to fetch textures')
    }

    return response.json()
  }

  /**
   * Get texture metadata by ID (public endpoint)
   */
  async getTexture(textureId: string) {
    const response = await fetch(`${API_BASE_URL}/textures/${textureId}`)
    
    if (!response.ok) {
      throw new Error('Failed to fetch texture')
    }

    return response.json()
  }
}

// Export singleton instance
export const api = new RivvonAPI()
```

#### 4.2 Use API in Upload Component

Update your texture upload component with enhanced state handling:

```vue
// filepath: src/components/TextureUploader.vue (example usage)
<template>
  <div class="texture-uploader">
    <!-- Upload Button with Auth State -->
    <button 
      @click="handleUpload" 
      :disabled="!isAuthenticated || uploading || !hasTextureReady"
      :class="['btn-upload', { 'disabled': !isAuthenticated }]"
      :title="!isAuthenticated ? 'Login required to upload' : ''"
    >
      <span v-if="uploading" class="spinner-sm"></span>
      {{ uploadButtonText }}
    </button>

    <!-- Error Display -->
    <div v-if="uploadError" class="alert alert-error">
      <span class="icon">⚠️</span>
      {{ uploadError }}
      <button @click="uploadError = null" class="btn-close">×</button>
    </div>

    <!-- Success Display -->
    <div v-if="uploadSuccess" class="alert alert-success">
      <span class="icon">✓</span>
      {{ uploadSuccess }}
      <button @click="uploadSuccess = null" class="btn-close">×</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAuth0 } from '@auth0/auth0-vue'
import { api } from '../services/api'

const { isAuthenticated, error: authError } = useAuth0()
const uploading = ref(false)
const uploadError = ref<string | null>(null)
const uploadSuccess = ref<string | null>(null)
const hasTextureReady = ref(false) // Set this based on your texture processing state

// Watch for auth errors
watch(() => authError.value, (newError) => {
  if (newError) {
    uploadError.value = 'Authentication error. Please try logging in again.'
  }
})

const uploadButtonText = computed(() => {
  if (uploading.value) return 'Uploading...'
  if (!isAuthenticated.value) return 'Login Required'
  if (!hasTextureReady.value) return 'Process Texture First'
  return 'Upload to Rivvon CDN'
})

async function handleUpload(ktx2Blob: Blob, filename: string) {
  if (!isAuthenticated.value) {
    uploadError.value = 'Please log in to upload textures'
    return
  }

  if (!hasTextureReady.value) {
    uploadError.value = 'Please process a video into texture tiles first'
    return
  }

  uploading.value = true
  uploadError.value = null
  uploadSuccess.value = null

  try {
    const result = await api.uploadTexture(ktx2Blob, filename)
    uploadSuccess.value = `Texture uploaded successfully! ID: ${result.textureId}`
    console.log('CDN URL:', result.cdnUrl)
    
    // Optionally copy CDN URL to clipboard
    await navigator.clipboard.writeText(result.cdnUrl)
  } catch (error) {
    uploadError.value = error instanceof Error ? error.message : 'Upload failed'
    console.error('Upload error:', error)
  } finally {
    uploading.value = false
  }
}
</script>

<style scoped>
.texture-uploader {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.btn-upload {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 0.875rem 2rem;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.btn-upload:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn-upload:disabled {
  background: #cbd5e0;
  cursor: not-allowed;
  opacity: 0.6;
}

.btn-upload.disabled {
  background: #f56565;
}

.spinner-sm {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top: 2px solid white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.alert {
  padding: 1rem;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.alert-error {
  background: #fed7d7;
  color: #742a2a;
  border-left: 4px solid #f56565;
}

.alert-success {
  background: #c6f6d5;
  color: #22543d;
  border-left: 4px solid #48bb78;
}

.alert .icon {
  font-size: 1.25rem;
}

.btn-close {
  margin-left: auto;
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: inherit;
  opacity: 0.7;
  transition: opacity 0.2s;
}

.btn-close:hover {
  opacity: 1;
}
</style>
```

---

### Phase 5: UI/UX Best Practices

#### 5.1 Authentication State Management

**Always show current auth state clearly:**
- Loading spinner while checking authentication
- Login prompt when not authenticated
- User profile card when authenticated
- Clear error messages for auth failures

#### 5.2 User Feedback

**Provide immediate feedback for all actions:**
- Disable buttons during authentication
- Show loading indicators during upload
- Display success/error messages with clear explanations
- Auto-dismiss success messages after 5 seconds
- Keep error messages until user dismisses them

#### 5.3 Error Handling Strategy

**Handle common error scenarios:**

```typescript
// filepath: src/composables/useAuthErrorHandler.ts
import { ref, watch } from 'vue'
import { useAuth0 } from '@auth0/auth0-vue'

export function useAuthErrorHandler() {
  const { error: authError } = useAuth0()
  const errorMessage = ref<string | null>(null)

  watch(authError, (error) => {
    if (!error) {
      errorMessage.value = null
      return
    }

    // Map Auth0 errors to user-friendly messages
    switch (error.error) {
      case 'login_required':
        errorMessage.value = 'Your session has expired. Please log in again.'
        break
      case 'consent_required':
        errorMessage.value = 'Additional permissions required. Please log in again.'
        break
      case 'access_denied':
        errorMessage.value = 'Access denied. Please check your permissions.'
        break
      default:
        errorMessage.value = 'Authentication error. Please try again.'
    }

    console.error('Auth0 Error:', error)
  })

  return {
    errorMessage,
    clearError: () => { errorMessage.value = null }
  }
}
```

#### 5.4 Accessibility Considerations

- All auth buttons have proper ARIA labels
- Error messages have `role="alert"` for screen readers
- Loading states announce to screen readers
- Keyboard navigation works for all auth controls
- Focus management after login/logout

#### 5.5 Mobile Responsiveness

```css
/* Add to auth components */
@media (max-width: 640px) {
  .user-profile {
    padding: 1rem;
  }
  
  .profile-avatar {
    width: 48px;
    height: 48px;
  }
  
  .login-prompt {
    padding: 2rem 1rem;
    margin: 1rem;
  }
  
  .btn-login-large {
    padding: 0.875rem 2rem;
    font-size: 1rem;
  }
}
```

---

### Phase 6: Environment Variables for Production

#### 5.1 Cloudflare Pages Configuration

In Cloudflare Pages dashboard for `slyce.rivvon.ca`:

1. Go to **Settings → Environment Variables**
2. Add the following variables:

**Production Environment:**
```
VITE_AUTH0_DOMAIN=login.rivvon.ca
VITE_AUTH0_CLIENT_ID=<slyce-client-id>
VITE_AUTH0_AUDIENCE=https://api.rivvon.ca
VITE_AUTH0_REDIRECT_URI=https://slyce.rivvon.ca/callback
VITE_API_URL=https://api.rivvon.ca
```

**Preview Environment (optional):**
```
VITE_AUTH0_DOMAIN=login.rivvon.ca
VITE_AUTH0_CLIENT_ID=<slyce-client-id>
VITE_AUTH0_AUDIENCE=https://api.rivvon.ca
VITE_AUTH0_REDIRECT_URI=https://slyce-preview.pages.dev/callback
VITE_API_URL=https://api.rivvon.ca
```

---

### Phase 7: Testing Checklist

#### Authentication Flow
- [x] Local development login works
- [x] Callback redirect works correctly
- [x] User info displays after login
- [x] Access token is retrieved successfully
- [x] Logout clears session
- [x] Auth state persists across page reloads

#### UI Components
- [x] Login prompt displays for unauthenticated users
- [x] Loading state shows while checking authentication
- [x] User profile card displays with avatar, name, and email
- [x] Auth button shows correct state (login/logout)
- [x] Upload button is disabled when not authenticated
- [x] Upload button shows "Login Required" text when disabled
- [ ] Error messages display properly for auth failures

#### API Integration
- [ ] Upload request includes Bearer token
- [ ] Unauthorized requests fail gracefully with clear error messages
- [ ] Token refresh works automatically
- [ ] API errors are caught and displayed to user

#### Production
- [x] Production environment variables are set in Cloudflare Pages
- [x] Production login/logout works on `slyce.rivvon.ca`
- [x] Callback URL works in production
- [ ] CORS is properly configured

---

## Usage Flow

1. User visits `slyce.rivvon.ca`
2. User clicks "Login" button
3. Redirects to Auth0 login page
4. User authenticates (email/password, Google, etc.)
5. Auth0 redirects back to `slyce.rivvon.ca/callback`
6. Slyce stores access token
7. User processes video and creates KTX2 texture
8. User clicks "Upload"
9. Slyce requests signed URL from API (with Bearer token)
10. API validates token and returns signed R2 URL
11. Slyce uploads file directly to R2
12. Success! Texture is now available on CDN

---

## Troubleshooting

### "Login required" error when uploading
- Check that user is logged in (`isAuthenticated` is true)
- Verify access token is being retrieved
- Check browser console for token errors

### Callback redirect fails
- Verify callback URL in Auth0 matches exactly (including protocol and path)
- Check browser console for Auth0 errors
- Ensure `.env` has correct `VITE_AUTH0_REDIRECT_URI`

### CORS errors during upload
- Verify API CORS middleware allows `slyce.rivvon.ca`
- Check that API accepts `Authorization` header

### Token validation fails on API
- Verify `VITE_AUTH0_AUDIENCE` matches API identifier exactly
- Check that Auth0 API uses RS256 signing algorithm
- Ensure API has correct `AUTH0_DOMAIN` and `AUTH0_AUDIENCE` secrets

---

## Next Steps

After integration is complete:

1. Test full upload workflow end-to-end
2. Add error handling and user feedback
3. Implement upload progress indicators
4. Add retry logic for failed uploads
5. Consider adding user profile page
6. Implement texture management (list user's uploads, delete, etc.)