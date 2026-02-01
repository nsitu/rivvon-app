<script setup>

    import { useSlyceStore } from '../../stores/slyceStore';
    const app = useSlyceStore()  // Pinia store

</script>
<template>
    <div
        id="activity-log"
        v-if="app.messages.length > 0"
    >
        <p v-for="message in app.messages">{{ message }}</p>
    </div>
</template>
<style scoped>

    #activity-log {
        max-height: 15rem;
        overflow-y: scroll;
        padding: 1rem;
        border: 1px solid #ccc;
        border-radius: 0.5rem;
    }
</style>