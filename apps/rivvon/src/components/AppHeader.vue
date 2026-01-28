<script setup>
    import { computed } from 'vue';
    import { useAppStore } from '../stores/appStore';
    import { useGoogleAuth } from '../composables/useGoogleAuth';

    const app = useAppStore();
    const { user, isAuthenticated, login, logout } = useGoogleAuth();

    function handleLoginClick() {
        // Show beta modal before login
        app.showBetaModal();
    }
</script>

<template>
    <header class="app-header">
        <!-- Logo -->
        <a
            href="/"
            class="app-logo"
        >
            <img
                src="/rivvon.svg"
                alt="Rivvon"
            />
        </a>

        <!-- Auth controls -->
        <div class="auth-container">
            <!-- Login button (when not authenticated) -->
            <button
                v-if="!isAuthenticated"
                class="auth-btn login-btn"
                title="Sign in with Google"
                @click="handleLoginClick"
            >
                <span class="material-symbols-outlined">person</span>
            </button>

            <!-- User info (when authenticated) -->
            <div
                v-else
                class="user-info"
            >
                <span class="user-name">{{ app.userName }}</span>
                <button
                    class="auth-btn logout-btn"
                    title="Sign out"
                    @click="logout"
                >
                    <span class="material-symbols-outlined">logout</span>
                </button>
            </div>
        </div>
    </header>
</template>

<style scoped>
    .app-header {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 10;
        display: flex;
        background: rgba(0, 0, 0, 0.5);
        justify-content: space-between;
        align-items: flex-start;
        pointer-events: none;
    }

    .app-header>* {
        pointer-events: auto;
    }

    .app-logo {
        display: block;
        text-decoration: none;
        padding: 0.75em 3em;
    }

    .app-logo img {
        height: 1.5rem;
        width: auto;
    }

    .app-logo:hover {
        background: rgba(0, 0, 0, 0.25);
    }

    .auth-container {
        display: flex;
        align-items: center;
    }

    .auth-btn {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.7em 1.3em;
        color: white;
        border: none;
        cursor: pointer;
    }

    .auth-btn:hover {
        background: rgba(0, 0, 0, 0.25);
    }

    .user-info {
        display: flex;
        align-items: center;
        gap: 1rem;
    }

    .user-name {
        color: white;
        font-size: 0.9rem;

    }

    .logout-btn {
        padding: 0.75em;
        min-width: auto;
        min-height: auto;
    }

    /* Mobile adjustments */
    @media (max-width: 768px) {
        .app-logo {
            padding: 0.5em 1.5em;
        }

        .app-logo img {
            height: 1rem;
        }

        .btn-text {
            display: none;
        }
    }
</style>
