<template>
  <div
    v-if="!isAuthenticated && !isLoading"
    class="login-prompt"
  >
    <div class="prompt-icon">🔒</div>
    <h2>Authentication Required</h2>
    <p class="prompt-description">
      Log in to upload and manage your textures on Rivvon CDN
    </p>
    <Button
      type="button"
      @click="openBetaModal"
      severity="info"
      class="login-action rivvon-workflow-button rivvon-workflow-button--large"
    >
      <span class="icon">🚀</span>
      Sign in with Google
    </Button>
    <p class="hint">Your textures will be stored in your Google Drive</p>

    <!-- Beta Access Modal -->
    <BetaModal ref="betaModalRef" />
  </div>
</template>

<script setup>
  import { ref } from 'vue'
  import Button from 'primevue/button'
  import { useGoogleAuth } from '../../composables/shared/useGoogleAuth'
  import BetaModal from './BetaModal.vue'

  const { isAuthenticated, isLoading } = useGoogleAuth()

  const betaModalRef = ref(null)

  function openBetaModal() {
    betaModalRef.value?.open()
  }
</script>

<style scoped>
  .login-prompt {
    text-align: center;
    padding: 3rem 2rem;
    background: linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%);
    border-radius: 12px;
    max-width: 480px;
    margin: 2rem auto;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  @media (prefers-color-scheme: dark) {
    .login-prompt {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
  }

  .prompt-icon {
    font-size: 4rem;
    margin-bottom: 1rem;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {

    0%,
    100% {
      transform: scale(1);
    }

    50% {
      transform: scale(1.1);
    }
  }

  .login-prompt h2 {
    margin: 0 0 1rem;
    color: var(--text-primary);
    font-size: 1.75rem;
  }

  .prompt-description {
    color: var(--text-secondary);
    margin-bottom: 2rem;
    font-size: 1rem;
    line-height: 1.6;
  }

  .login-action {
    min-width: 14rem;
  }

  .login-action .icon {
    font-size: 1.2rem;
  }

  .hint {
    font-size: 0.85rem;
    color: var(--text-tertiary);
    margin-top: 1rem;
  }

  @media (max-width: 640px) {
    .login-prompt {
      padding: 2rem 1rem;
      margin: 1rem;
    }

    .login-action {
      min-width: 0;
      width: 100%;
    }
  }
</style>
