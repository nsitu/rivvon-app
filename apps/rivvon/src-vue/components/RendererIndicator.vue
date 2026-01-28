<script setup>
    import { useAppStore } from '../stores/appStore';

    const app = useAppStore();
</script>

<template>
    <div
        v-if="app.debugMode"
        class="renderer-indicator"
        :class="app.rendererType"
    >
        {{ app.rendererType.toUpperCase() }}
    </div>
</template>

<style scoped>
    .renderer-indicator {
        position: fixed;
        top: 0.5rem;
        left: 50%;
        transform: translateX(-50%);
        z-index: 100;
        padding: 0.25rem 0.75rem;
        font-size: 0.75rem;
        font-family: monospace;
        border-radius: 0.25rem;
        background: rgba(0, 0, 0, 0.7);
        color: #888;
    }

    .renderer-indicator.webgpu {
        color: #4ade80;
    }

    .renderer-indicator.webgl {
        color: #facc15;
    }
</style>
