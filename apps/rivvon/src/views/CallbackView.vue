<script setup>
    import { onMounted } from 'vue';
    import { useRouter, useRoute } from 'vue-router';
    import LoadingIndicator from '../components/shared/LoadingIndicator.vue';
    import { useGoogleAuth } from '../composables/shared/useGoogleAuth';

    const router = useRouter();
    const route = useRoute();
    const { checkSession } = useGoogleAuth();

    onMounted(async () => {
        // The OAuth callback has been handled by the backend
        // The session cookie should now be set
        // We just need to check the session and redirect

        console.log('[CallbackView] Processing OAuth callback...');

        try {
            // Check if we have a valid session now
            await checkSession();
            console.log('[CallbackView] Session checked, redirecting to home');
        } catch (error) {
            console.error('[CallbackView] Session check failed:', error);
        }

        // Redirect to home (or to saved redirect path)
        const savedRedirect = sessionStorage.getItem('auth_redirect');
        sessionStorage.removeItem('auth_redirect');

        if (savedRedirect && savedRedirect !== '/callback') {
            router.replace(savedRedirect);
        } else {
            router.replace('/');
        }
    });
</script>

<template>
    <div class="callback-view">
        <LoadingIndicator
            class="loading-container"
            message="Completing sign in..."
        />
    </div>
</template>

<style scoped>
    .callback-view {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #1a1a2e;
    }

</style>
