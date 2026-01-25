<template>
  <div class="callback-container">
    <div class="callback-content">
      <div v-if="error" class="error-state">
        <h2>Login Error</h2>
        <p>{{ errorMessage }}</p>
        <button @click="goHome" class="btn-home">Go to Home</button>
      </div>
      <div v-else>
        <div class="spinner"></div>
        <h2>Processing login...</h2>
        <p>Please wait while we complete your authentication.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useGoogleAuth } from '../composables/useGoogleAuth'

const router = useRouter()
const route = useRoute()
const { checkSession } = useGoogleAuth()

const error = ref(false)
const errorMessage = ref('')

onMounted(async () => {
  // Check for error in URL (from OAuth callback)
  if (route.query.error) {
    error.value = true
    errorMessage.value = getErrorMessage(route.query.error)
    return
  }

  // If we get here via OAuth redirect, the backend has already set the cookies
  // Just check the session and redirect
  try {
    await checkSession()
    
    // Redirect to home or previous page after successful login
    const redirectTo = sessionStorage.getItem('auth_redirect') || '/'
    sessionStorage.removeItem('auth_redirect')
    router.push(redirectTo)
  } catch (err) {
    console.error('Login callback error:', err)
    error.value = true
    errorMessage.value = 'An unexpected error occurred. Please try again.'
  }
})

function getErrorMessage(errorCode) {
  const messages = {
    'access_denied': 'Access was denied. Please try again.',
    'invalid_state': 'Security validation failed. Please try logging in again.',
    'token_exchange_failed': 'Authentication failed. Please try again.',
    'missing_code': 'Authentication incomplete. Please try again.',
    'callback_failed': 'An error occurred during login. Please try again.',
  }
  return messages[errorCode] || 'An authentication error occurred. Please try again.'
}

function goHome() {
  router.push('/')
}
</script>

<style scoped>
.callback-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  text-align: center;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
}

.callback-content {
  background: white;
  padding: 3rem;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.spinner {
  width: 48px;
  height: 48px;
  border: 4px solid #f3f4f6;
  border-top: 4px solid #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 1.5rem;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

h2 {
  margin: 0 0 0.5rem;
  color: #2d3748;
  font-size: 1.5rem;
}

p {
  color: #6b7280;
  margin: 0;
}
</style>
