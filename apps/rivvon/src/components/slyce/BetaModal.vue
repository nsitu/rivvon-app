<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-50 flex items-center justify-center p-5 bg-black/70 backdrop-blur-sm"
      @click.self="close"
    >
      <div
        class="relative w-full max-w-md bg-linear-to-br from-slate-900 to-slate-800 border border-white/10 shadow-2xl animate-slide-in"
      >
        <!-- Header -->
        <div class="px-6 pt-6 pb-4 border-b border-white/10">
          <h2 class="text-xl font-semibold text-white m-0">Beta Access</h2>
        </div>

        <!-- Body -->
        <div class="p-6">
          <p class="text-white/85 leading-relaxed mb-4">
            Rivvon is currently in <span class="text-amber-400 font-semibold">beta</span>. To use Google Drive features,
            you'll need to be added as a beta tester.
          </p>

          <!-- Actions -->
          <div class="flex flex-col gap-3 rivvon-modal-actions">
            <Button
              href="https://docs.google.com/forms/d/e/1FAIpQLSeRF-9eEIPWz4Es1IVMcS5TSSDcSnsFvPj1wS9QKkHVKFeAqA/viewform?usp=publish-editor"
              as="a"
              target="_blank"
              rel="noopener noreferrer"
              severity="info"
              class="rivvon-workflow-button"
            >
              Request Beta Access
            </Button>
            <Button
              type="button"
              @click="proceedToLogin"
              severity="secondary"
              variant="outlined"
              class="rivvon-workflow-button"
            >
              I'm already a tester — Sign in
            </Button>
          </div>

          <p class="text-sm text-white/50 mt-6 mb-0">
            After requesting access, you'll receive an email once approved.
          </p>
        </div>

        <!-- Close button -->
        <Button
          type="button"
          @click="close"
          text
          rounded
          severity="secondary"
          aria-label="Close beta access dialog"
          class="absolute top-3 right-3"
        >
          <span class="material-symbols-outlined">close</span>
        </Button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
  import { ref } from 'vue'
  import Button from 'primevue/button'
  import { useGoogleAuth } from '../../composables/shared/useGoogleAuth'

  const { login } = useGoogleAuth()

  const isOpen = ref(false)

  function open() {
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  function proceedToLogin() {
    close()
    login()
  }

  // Expose methods for parent components
  defineExpose({ open, close })
</script>

<style scoped>
  @keyframes slide-in {
    from {
      opacity: 0;
      transform: translateY(-20px);
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .animate-slide-in {
    animation: slide-in 0.3s ease-out;
  }
</style>
