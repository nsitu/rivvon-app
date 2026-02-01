<script setup>
    import { RouterView, useRoute } from 'vue-router';
    import { onMounted, computed } from 'vue';
    import { useViewerStore } from './stores/viewerStore';
    import AuthLoadingState from './components/slyce/AuthLoadingState.vue';

    const app = useViewerStore();
    const route = useRoute();

    // Viewer mode is active when NOT on slyce routes
    const isViewerMode = computed(() => !route.path.startsWith('/slyce'));

    onMounted(() => {
        // Add app-active class to body when Vue app loads
        document.body.classList.add('app-active');
    });
</script>

<template>
    <div :class="{ 'viewer-mode': isViewerMode }">
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
