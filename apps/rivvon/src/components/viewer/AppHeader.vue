<script setup>
    import { ref, computed } from 'vue';
    import { useViewerStore } from '../../stores/viewerStore';
    import { useGoogleAuth } from '../../composables/shared/useGoogleAuth';
    import Dialog from 'primevue/dialog';
    import Button from 'primevue/button';
    import Menu from 'primevue/menu';

    const app = useViewerStore();
    const { user, isAuthenticated, login, logout } = useGoogleAuth();

    const showInfoDialog = ref(false);
    const menu = ref();

    function toggleMenu(event) {
        menu.value.toggle(event);
    }

    function handleLoginClick() {
        // Show beta modal before login
        app.showBetaModal();
    }

    // Build menu items based on auth state
    const menuItems = computed(() => {
        const items = [
            {
                label: 'About Rivvon',
                icon: 'pi pi-info-circle',
                command: () => {
                    showInfoDialog.value = true;
                }
            }
        ];

        if (isAuthenticated.value) {
            items.unshift({
                label: user.value?.name || user.value?.email || 'User',
                icon: 'pi pi-user',
                disabled: true,
                class: 'menu-user-item'
            });
            items.push({
                separator: true
            });
            items.push({
                label: 'Sign out',
                icon: 'pi pi-sign-out',
                command: () => {
                    logout();
                }
            });
        } else {
            items.push({
                separator: true
            });
            items.push({
                label: 'Sign in with Google',
                icon: 'pi pi-sign-in',
                command: () => {
                    handleLoginClick();
                }
            });
        }

        return items;
    });
</script>

<template>
    <header
        class="app-header"
        :class="{ hidden: app.isFullscreen }"
    >
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

        <!-- Menu button and popup -->
        <div class="menu-container">
            <Button
                type="button"
                class="menu-toggle-btn"
                @click="toggleMenu"
                aria-haspopup="true"
                aria-controls="header_menu"
                text
            ><span class="material-symbols-outlined">
                    menu
                </span>
            </Button>
            <Menu
                ref="menu"
                id="header_menu"
                :model="menuItems"
                :popup="true"
            />
        </div>

        <!-- Info Dialog -->
        <Dialog
            v-model:visible="showInfoDialog"
            header="About Rivvon"
            :modal="true"
            :dismissableMask="true"
            class="info-dialog"
            :style="{ width: '90vw', maxWidth: '600px' }"
        >
            <div class="info-content">
                <p>
                    Rivvon renders animated ribbons via GPU shaders using multi-layered KTX2 texture tiles.
                </p>
                <p>
                    Textures are created by extracting
                    <a
                        target="_blank"
                        href="https://en.wikipedia.org/wiki/Slit-scan_photography"
                    >cross sections</a>
                    from video files using
                    <a
                        target="_blank"
                        href="https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API"
                    >WebCodecs</a>,
                    <a
                        target="_blank"
                        href="https://github.com/Vanilagy/mediabunny"
                    >mediabunny</a>, and
                    <a
                        target="_blank"
                        href="https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API"
                    >Canvas</a>.
                    Textures are encoded using
                    <a
                        target="_blank"
                        href="https://github.com/BinomialLLC/basis_universal"
                    >Basis Encoder</a>.
                </p>
                <p>
                    Animations are achieved by taking multiple cross sections of the same video.
                    Each cross section samples pixels from each frame.
                    This can be done using one of two strategies: a linear sampling pattern that stays on the same row
                    for each sample (planar cross section), or a periodic function that achieves a wave-based,
                    directly loopable animation.
                </p>
                <p class="info-credit">
                    Created by <a
                        target="_blank"
                        href="https://nsitu.ca"
                    >Harold Sikkema</a>
                </p>
            </div>
        </Dialog>
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
        transition: opacity 0.3s ease, transform 0.3s ease;
    }

    .app-header.hidden {
        opacity: 0;
        transform: translateY(-100%);
        pointer-events: none;
    }

    .app-header>* {
        pointer-events: auto;
    }

    .app-logo {
        display: block;
        text-decoration: none;
        padding: 2rem 3rem;
    }

    .app-logo img {
        height: 1.5rem;
        width: auto;
    }

    .app-logo:hover {
        background: rgba(0, 0, 0, 0.25);
    }

    .menu-container {
        display: flex;
        align-items: center;
    }

    .menu-toggle-btn {
        padding: 2rem 1rem;
        color: white !important;
        border: none !important;
        cursor: pointer;
        background: transparent !important;
    }

    .menu-toggle-btn:hover {
        background: rgba(0, 0, 0, 0.25) !important;
        border: 1px solid transparent !important;
    }

    /* Mobile adjustments */
    @media (max-width: 768px) {
        .app-logo {
            padding-left: 2rem;
            padding-right: 2rem;
        }

    }

    /* Info dialog content */
    .info-content {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        font-size: 0.9rem;
        line-height: 1.6;
        color: var(--text-secondary);
    }

    .info-content a {
        color: var(--text-primary);
        text-decoration: underline;
        transition: opacity 0.2s;
    }

    .info-content a:hover {
        opacity: 0.8;
    }

    .info-credit {
        margin-top: 0.5rem;
        padding-top: 1rem;
        border-top: 1px solid var(--border-primary);
        font-size: 0.85rem;
    }
</style>
