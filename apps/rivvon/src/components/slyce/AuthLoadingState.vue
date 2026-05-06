<template>
  <LoadingIndicator
    v-if="isLoading"
    class="auth-loading"
  />
</template>

<script setup>
  import LoadingIndicator from '../shared/LoadingIndicator.vue'
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
</style>
