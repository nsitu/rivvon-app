<script setup>
import { RouterView } from 'vue-router'
import AuthLoadingState from './components/AuthLoadingState.vue'
</script>

<template>
    <AuthLoadingState />
    <RouterView />
</template>

<style>
    /* Global styles */
    * {
        box-sizing: border-box;
    }
</style>
