<script setup>
    import { computed } from 'vue';
    import { useAppStore } from '../stores/appStore';

    const app = useAppStore();

    const emit = defineEmits(['click']);

    const isVisible = computed(() => {
        return app.isDrawingMode && app.hasActiveStrokes;
    });
</script>

<template>
    <button
        class="finish-drawing-btn"
        :class="{ visible: isVisible }"
        title="Finish drawing and create ribbons"
        @click="emit('click')"
    >
        <img
            src="/check.svg"
            class="finish-icon"
            alt="Finish"
        />
        <span
            v-if="app.countdownSeconds"
            class="countdown"
        >
            {{ app.countdownSeconds }}
        </span>
    </button>
</template>

<style scoped>
    .finish-drawing-btn {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 100;
        width: 6rem;
        height: 6rem;
        border-radius: 50%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.25rem;
        background: rgba(34, 197, 94, 0.9);
        border: none;
        cursor: pointer;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transition: opacity 0.3s ease, visibility 0.3s ease, transform 0.2s ease;
    }

    .finish-drawing-btn.visible {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
    }

    .finish-drawing-btn:hover {
        background: rgba(34, 197, 94, 1);
        transform: translate(-50%, -50%) scale(1.05);
    }

    .finish-drawing-btn:active {
        transform: translate(-50%, -50%) scale(0.95);
    }

    .finish-icon {
        width: 2.5rem;
        height: 2.5rem;
        filter: invert(1);
    }

    .countdown {
        color: white;
        font-size: 1.25rem;
        font-weight: bold;
    }
</style>
