<script setup>
    import { computed } from 'vue';
    import Button from 'primevue/button';
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
                return 'This texture is stored on Google Drive and requires beta access to load. Textures created with Rivvon are stored securely in your Google Drive.';
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



                    <div class="beta-modal-actions rivvon-modal-actions">
                        <Button
                            v-if="showRequestAccess"
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
                            :severity="showRequestAccess ? 'secondary' : 'info'"
                            @click="proceed"
                        >
                            {{ signInButtonText }}
                        </Button>
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

                <Button
                    type="button"
                    class="beta-modal-close"
                    text
                    rounded
                    severity="secondary"
                    aria-label="Close beta access dialog"
                    @click="close"
                >
                    <span class="material-symbols-outlined">close</span>
                </Button>
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

    .beta-modal-actions .p-button {
        width: 100%;
        justify-content: center;
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
        width: 2.25rem;
        height: 2.25rem;
        padding: 0;
    }
</style>
