<template>
  <div v-if="!isAuthenticated && !isLoading" class="login-prompt">
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

<script setup>
import { useAuth0 } from '@auth0/auth0-vue'

const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0()

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

@media (max-width: 640px) {
  .login-prompt {
    padding: 2rem 1rem;
    margin: 1rem;
  }
  
  .btn-login-large {
    padding: 0.875rem 2rem;
    font-size: 1rem;
  }
}
</style>
