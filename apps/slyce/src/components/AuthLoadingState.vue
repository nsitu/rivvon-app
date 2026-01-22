<template>
  <div v-if="isLoading" class="auth-loading">
    <div class="spinner"></div>
    <p>Checking authentication...</p>
  </div>
</template>

<script setup>
import { useAuth0 } from '@auth0/auth0-vue'

const { isLoading } = useAuth0()
</script>

<style scoped>
.auth-loading {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  gap: 1rem;
  background: rgba(255, 255, 255, 0.95);
  z-index: 9999;
}

.spinner {
  width: 48px;
  height: 48px;
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
  font-size: 1rem;
  margin: 0;
}
</style>
