<template>
  <div class="callback-container">
    <div class="callback-content">
      <div class="spinner"></div>
      <h2>Processing login...</h2>
      <p>Please wait while we complete your authentication.</p>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useAuth0 } from '@auth0/auth0-vue'
import { useRouter } from 'vue-router'

const { handleRedirectCallback, isAuthenticated } = useAuth0()
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
