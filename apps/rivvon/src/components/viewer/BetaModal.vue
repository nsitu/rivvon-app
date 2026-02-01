<script setup>
    import { computed } from 'vue';
    import { useViewerStore } from '../../stores/viewerStore';
    import { useGoogleAuth } from '../../composables/shared/useGoogleAuth';

    const app = useViewerStore();
    const { login } = useGoogleAuth();

    // Contextual content based on reason
    const title = computed(() => {
        switch (app.betaModalReason) {
            case 'texture-auth':
                return 'Sign In Required';
            case 'access-denied':
                return 'Access Denied';
            default:
                return 'Beta Access';
        }
    });

    const description = computed(() => {
        switch (app.betaModalReason) {
            case 'texture-auth':
                return 'This texture is stored on Google Drive and requires beta access to load. Textures created with Slyce are stored securely in your Google Drive.';
            case 'access-denied':
                return 'Unable to access this texture. You may need to sign in with the Google account that owns this texture, or request access from the owner.';
            default:
                return 'Rivvon is currently in beta. To use Google Drive features and save your textures, you\'ll need to be added as a beta tester.';
        }
    });

    // Show both buttons for default and texture-auth flows
    const showRequestAccess = computed(() => {
        return app.betaModalReason !== 'access-denied';
    });

    const signInButtonText = computed(() => {
        return 'I\'m already a tester — Sign in';
    });

    // Show the storage info note for texture-related flows
    const showStorageNote = computed(() => {
        return app.betaModalReason === 'texture-auth' || app.betaModalReason === 'access-denied';
    });

    function close() {
        app.hideBetaModal();
    }

    function proceed() {
        close();
        login();
    }
</script>

<template>
    <Teleport to="body">
        <div
            class="beta-modal"
            :class="{ visible: app.betaModalVisible }"
            @click.self="close"
        >
            <div class="beta-modal-content">
                <div class="beta-modal-header">
                    <h2>{{ title }}</h2>
                </div>

                <div class="beta-modal-body">
                    <p>{{ description }}</p>



                    <div class="beta-modal-actions">
                        <a
                            v-if="showRequestAccess"
                            href="https://docs.google.com/forms/d/e/1FAIpQLSeRF-9eEIPWz4Es1IVMcS5TSSDcSnsFvPj1wS9QKkHVKFeAqA/viewform?usp=publish-editor"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="beta-btn beta-btn-primary"
                        >
                            Request Beta Access
                        </a>
                        <button
                            class="beta-btn"
                            :class="showRequestAccess ? 'beta-btn-secondary' : 'beta-btn-primary'"
                            @click="proceed"
                        >
                            {{ signInButtonText }}
                        </button>
                    </div>

                    <p class="beta-note">
                        <template v-if="showStorageNote">
                            <span class="material-symbols-outlined info-icon">info</span>
                            Rivvon textures are stored in Google Drive.
                        </template>
                        <template v-else>
                            After requesting access, you'll receive an email once approved.
                        </template>
                    </p>
                </div>

                <button
                    class="beta-modal-close"
                    @click="close"
                >&times;</button>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
    .beta-modal {
        position: fixed;
        inset: 0;
        z-index: 200;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease;
    }

    .beta-modal.visible {
        opacity: 1;
        pointer-events: auto;
    }

    .beta-modal-content {
        position: relative;
        background: #111827;
        border-radius: 0.5rem;
        padding: 2rem;
        max-width: 28rem;
        margin: 1rem;
        text-align: center;
    }

    .beta-modal-header h2 {
        color: white;
        font-size: 1.5rem;
        font-weight: bold;
        margin-bottom: 1rem;
    }

    .beta-modal-body p {
        color: #d1d5db;
        margin-bottom: 1rem;
    }

    .beta-modal-actions {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin: 1.5rem 0;
    }

    .beta-btn {
        width: 100%;
        padding: 0.75rem 1.5rem;
        border-radius: 0.25rem;
        text-align: center;
        text-decoration: none;
        font-size: 1rem;
        transition: background-color 0.2s ease;
        cursor: pointer;
        border: none;
    }

    .beta-btn-primary {
        background: #2563eb;
        color: white;
    }

    .beta-btn-primary:hover {
        background: #3b82f6;
    }

    .beta-btn-secondary {
        background: #374151;
        color: white;
    }

    .beta-btn-secondary:hover {
        background: #4b5563;
    }

    .beta-note {
        color: #6b7280;
        font-size: 0.875rem;
        font-style: italic;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.25rem;
    }

    .beta-note .info-icon {
        font-size: 1rem;
        vertical-align: middle;
    }

    .beta-note a {
        color: #60a5fa;
        text-decoration: none;
    }

    .beta-note a:hover {
        text-decoration: underline;
    }

    .beta-modal-close {
        position: absolute;
        top: 1rem;
        right: 1rem;
        background: transparent;
        color: #6b7280;
        font-size: 1.5rem;
        padding: 0;
        min-width: auto;
        min-height: auto;
        line-height: 1;
    }

    .beta-modal-close:hover {
        color: white;
        background: transparent;
    }
</style>
