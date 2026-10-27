<script setup>
    import { RouterView, useRoute, useRouter } from 'vue-router';
    import { onMounted, computed } from 'vue';
    import { useViewerStore } from './stores/viewerStore';
    import AuthLoadingState from './components/slyce/AuthLoadingState.vue';
    import Dialog from 'primevue/dialog';
    import Button from 'primevue/button';
    import { useAuthStore } from './stores/authStore.js';

    const app = useViewerStore();
    const route = useRoute();
    const router = useRouter();
    const auth = useAuthStore();
    const authNoticeVisible = computed({
        get: () => !!auth.error,
        set: visible => { if (!visible) auth.setError(null); },
    });

    function openDrafts() {
        auth.setError(null);
        app.hideBetaModal();
        router.push({ name: 'video-gallery', query: { tab: 'drafts' } });
    }

    // Viewer mode is active for the canvas shell; document-style pages opt out
    // through route metadata rather than relying on legacy URL names.
    const isViewerMode = computed(() => route.meta.layout !== 'document');

    onMounted(() => {
        // Add app-active class to body when Vue app loads
        document.body.classList.add('app-active');
    });
</script>

<template>
    <div
        :class="{ 'viewer-mode': isViewerMode }"
        :style="{ '--viewer-panel-background': app.viewerPanelBackgroundColor }"
    >
        <AuthLoadingState />
        <RouterView />
        <Dialog v-model:visible="authNoticeVisible" modal header="Sign-in notice"
            :style="{ width: 'min(30rem, calc(100vw - 2rem))' }">
            <p role="alert">{{ auth.error }}</p>
            <template #footer>
                <Button type="button" severity="secondary" variant="outlined" @click="authNoticeVisible = false">Close</Button>
                <Button type="button" @click="openDrafts">Open video drafts</Button>
            </template>
        </Dialog>
    </div>
</template>

<style>

    /* Global styles that apply to entire app */
    * {
        box-sizing: border-box;
    }
</style>
