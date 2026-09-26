<script setup>
    import { RouterView, useRoute } from 'vue-router';
    import { onMounted, computed } from 'vue';
    import { useViewerStore } from './stores/viewerStore';
    import AuthLoadingState from './components/slyce/AuthLoadingState.vue';

    const app = useViewerStore();
    const route = useRoute();

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
    </div>
</template>

<style>

    /* Global styles that apply to entire app */
    * {
        box-sizing: border-box;
    }
</style>
