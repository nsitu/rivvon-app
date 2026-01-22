import { ref, watch } from 'vue'
import { useAuth0 } from '@auth0/auth0-vue'

/**
 * Composable for handling Auth0 errors with user-friendly messages
 */
export function useAuthErrorHandler() {
    const { error: authError } = useAuth0()
    const errorMessage = ref(null)

    watch(authError, (error) => {
        if (!error) {
            errorMessage.value = null
            return
        }

        // Map Auth0 errors to user-friendly messages
        switch (error.error) {
            case 'login_required':
                errorMessage.value = 'Your session has expired. Please log in again.'
                break
            case 'consent_required':
                errorMessage.value = 'Additional permissions required. Please log in again.'
                break
            case 'access_denied':
                errorMessage.value = 'Access denied. Please check your permissions.'
                break
            case 'invalid_grant':
                errorMessage.value = 'Session invalid. Please log in again.'
                break
            case 'unauthorized':
                errorMessage.value = 'You are not authorized. Please log in.'
                break
            default:
                errorMessage.value = error.message || 'Authentication error. Please try again.'
        }

        console.error('Auth0 Error:', error)
    })

    function clearError() {
        errorMessage.value = null
    }

    return {
        errorMessage,
        clearError
    }
}
