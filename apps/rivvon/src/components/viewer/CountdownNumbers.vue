<script setup>
    import { computed } from 'vue';
    import { useViewerStore } from '../../stores/viewerStore';

    const app = useViewerStore();

    // Countdown numbers visible only during final countdown
    const isCountdownVisible = computed(() => {
        return app.isDrawingMode && app.inFinalCountdown && app.countdownSeconds > 0;
    });
</script>

<template>
    <!-- Countdown numbers in center -->
    <div
        class="countdown-numbers"
        :class="{ visible: isCountdownVisible }"
    >
        <span class="countdown-digit">{{ app.countdownSeconds }}</span>
    </div>
</template>

<style scoped>
    .countdown-numbers {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 100;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transition: opacity 0.3s ease, visibility 0.3s ease;
    }

    .countdown-numbers.visible {
        opacity: 1;
        visibility: visible;
    }

    .countdown-digit {
        font-size: 6rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.9);
        text-shadow: 0 2px 20px rgba(0, 0, 0, 0.5);
        font-variant-numeric: tabular-nums;
    }
</style>
