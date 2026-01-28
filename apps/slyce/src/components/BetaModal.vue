<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-50 flex items-center justify-center p-5 bg-black/70 backdrop-blur-sm"
      @click.self="close"
    >
      <div class="relative w-full max-w-md bg-linear-to-br from-slate-900 to-slate-800 border border-white/10 shadow-2xl animate-slide-in">
        <!-- Header -->
        <div class="px-6 pt-6 pb-4 border-b border-white/10">
          <h2 class="text-xl font-semibold text-white m-0">Beta Access</h2>
        </div>

        <!-- Body -->
        <div class="p-6">
          <p class="text-white/85 leading-relaxed mb-4">
            Slyce is currently in <span class="text-amber-400 font-semibold">beta</span>. To use Google Drive features, you'll need to be added as a beta tester.
          </p>
          <p class="text-white/85 leading-relaxed mb-6">
            Already a beta tester? You can proceed to sign in below.
          </p>

          <!-- Actions -->
          <div class="flex flex-col gap-3">
            <a
              href="https://docs.google.com/forms/d/e/1FAIpQLSeRF-9eEIPWz4Es1IVMcS5TSSDcSnsFvPj1wS9QKkHVKFeAqA/viewform?usp=publish-editor"
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center justify-center px-6 py-3.5 text-base font-semibold text-white no-underline bg-linear-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-500/40 transition-all duration-200"
            >
              Request Beta Access
            </a>
            <button
              @click="proceedToLogin"
              class="flex items-center justify-center px-6 py-3.5 text-base font-semibold text-white/90 bg-white/10 border border-white/20 hover:bg-white/15 hover:border-white/30 transition-all duration-200 cursor-pointer"
            >
              I'm already a tester — Sign in
            </button>
          </div>

          <p class="text-sm text-white/50 mt-6 mb-0">
            After requesting access, you'll receive an email once approved.
          </p>
        </div>

        <!-- Close button -->
        <button
          @click="close"
          class="absolute top-3 right-3 w-8 h-8 flex items-center justify-center bg-transparent border-none text-white/50 text-2xl cursor-pointer hover:text-white transition-colors"
        >
          &times;
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref } from 'vue'
import { useGoogleAuth } from '../composables/useGoogleAuth'

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
