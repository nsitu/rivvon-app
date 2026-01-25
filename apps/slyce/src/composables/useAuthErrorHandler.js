import { computed } from 'vue'
import { useGoogleAuth } from '@/composables/useGoogleAuth'

/**
 * Composable for handling Google Auth errors with user-friendly messages
 */
export function useAuthErrorHandler() {
    const { error } = useGoogleAuth()

    // Transform raw error into user-friendly message
    const errorMessage = computed(() => {
        if (!error.value) return null
        return error.value
    })

    function clearError() {
        const { clearError: clearAuthError } = useGoogleAuth()
        clearAuthError()
    }

    return {
        errorMessage,
        clearError
    }
}
