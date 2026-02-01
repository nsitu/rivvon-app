<template>
  <div
    v-if="isLoading"
    class="auth-loading"
  >
    <div class="spinner"></div>
  </div>
</template>

<script setup>
  import { useGoogleAuth } from '../../composables/shared/useGoogleAuth'

  const { isLoading } = useGoogleAuth()
</script>

<style scoped>
  .auth-loading {
    position: fixed;
    top: 0;
    /* Below header/logo */
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    gap: 1rem;
    background: rgba(17, 24, 39, 0.95);
    /* Dark mode: gray-900 */
    z-index: 100;
    /* Below header, above content */
  }

  .spinner {
    width: 48px;
    height: 48px;
    border: 4px solid #374151;
    /* gray-700 */
    border-top: 4px solid #60a5fa;
    /* blue-400 */
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .auth-loading p {
    color: #d1d5db;
    /* gray-300 */
    font-size: 1rem;
    margin: 0;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }

    100% {
      transform: rotate(360deg);
    }
  }

  .auth-loading p {
    color: #6b7280;
    font-size: 1rem;
    margin: 0;
  }
</style>
