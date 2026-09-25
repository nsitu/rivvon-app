<script setup>

    import { useSlyceStore } from '../../stores/slyceStore';
    import ScrollPanel from 'primevue/scrollpanel';
    const app = useSlyceStore()  // Pinia store

</script>
<template>
    <ScrollPanel
        v-if="app.messages.length > 0"
        class="rivvon-scroll-panel activity-log-scroll"
    >
        <div id="activity-log">
            <p v-for="message in app.messages">{{ message }}</p>
        </div>
    </ScrollPanel>
</template>
<style scoped>

    #activity-log {
        padding: 1rem;
        border: 1px solid #ccc;
        border-radius: 0.5rem;
    }

    .activity-log-scroll {
        flex: none;
        height: 15rem;
        max-height: 15rem;
    }
</style>
