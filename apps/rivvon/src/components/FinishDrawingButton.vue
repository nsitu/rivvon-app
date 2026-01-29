<script setup>
    import { computed } from 'vue';
    import { useAppStore } from '../stores/appStore';

    const app = useAppStore();

    const emit = defineEmits(['click']);

    // Checkmark button visible when drawing and has strokes
    const isButtonVisible = computed(() => {
        return app.isDrawingMode && app.hasActiveStrokes;
    });

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

    <!-- Finish button in bottom right -->
    <button
        class="finish-drawing-btn"
        :class="{ visible: isButtonVisible }"
        title="Finish drawing and create ribbons"
        @click="emit('click')"
    >
        <img
            src="/check.svg"
            class="finish-icon"
            alt="Finish"
        />
    </button>
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

    .finish-drawing-btn {
        position: fixed;
        bottom: 6rem;
        /* Above the bottom toolbar */
        right: 1rem;
        z-index: 100;
        width: 4rem;
        height: 4rem;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(34, 197, 94, 0.9);
        border: none;
        cursor: pointer;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transition: opacity 0.3s ease, visibility 0.3s ease, transform 0.2s ease;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .finish-drawing-btn.visible {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
    }

    .finish-drawing-btn:hover {
        background: rgba(34, 197, 94, 1);
        transform: scale(1.1);
    }

    .finish-drawing-btn:active {
        transform: scale(0.95);
    }

    .finish-icon {
        width: 2rem;
        height: 2rem;
        filter: invert(1);
    }
</style>
