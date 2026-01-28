<script setup>
    import { RouterView } from 'vue-router';
    import { onMounted } from 'vue';
    import { useAppStore } from './stores/appStore';

    const app = useAppStore();

    onMounted(() => {
        // Add app-active class to body when Vue app loads
        document.body.classList.add('app-active');
    });
</script>

<template>
    <RouterView />
</template>

<style>

    /* Global styles that apply to entire app */
    * {
        box-sizing: border-box;
    }
</style>
