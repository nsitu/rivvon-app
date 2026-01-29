<script setup>
    import { computed } from 'vue';
    import { useAppStore } from '../stores/appStore';

    const app = useAppStore();

    const isVisible = computed(() => {
        return app.isDrawingMode && app.hasActiveStrokes && app.countdownProgress > 0;
    });

    const progressPercent = computed(() => {
        return Math.min(100, app.countdownProgress * 100);
    });

    // Opacity increases as we approach the end
    const barOpacity = computed(() => {
        const progress = app.countdownProgress;
        // Start at 0.3 opacity, increase to 1.0 as progress approaches 1
        return 0.3 + (progress * 0.7);
    });

    // Color intensifies approaching the final countdown
    const barColor = computed(() => {
        if (app.inFinalCountdown) {
            return 'rgba(34, 197, 94, 1)'; // Green during final countdown
        }
        // Subtle gray that transitions to green
        const progress = app.countdownProgress;
        const r = Math.round(200 - (progress * 166)); // 200 -> 34
        const g = Math.round(200 + (progress * -3));   // 200 -> 197
        const b = Math.round(200 - (progress * 106)); // 200 -> 94
        return `rgba(${r}, ${g}, ${b}, 1)`;
    });
</script>

<template>
    <div
        class="countdown-progress-container"
        :class="{ visible: isVisible }"
    >
        <div
            class="countdown-progress-bar"
            :style="{
                width: progressPercent + '%',
                opacity: barOpacity,
                backgroundColor: barColor
            }"
        ></div>
    </div>
</template>

<style scoped>
    .countdown-progress-container {
        position: fixed;
        top: 4rem;
        /* Below the header */
        left: 0;
        right: 0;
        height: 4px;
        z-index: 99;
        background: rgba(255, 255, 255, 0.1);
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.3s ease, visibility 0.3s ease;
    }

    .countdown-progress-container.visible {
        opacity: 1;
        visibility: visible;
    }

    .countdown-progress-bar {
        height: 100%;
        transition: width 0.05s linear, background-color 0.3s ease;
        border-radius: 0 2px 2px 0;
    }
</style>
