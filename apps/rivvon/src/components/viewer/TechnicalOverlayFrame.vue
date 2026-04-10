<script setup>
    defineProps({
        visible: { type: Boolean, default: false },
        title: { type: String, default: 'Technical Overlay' },
        metricsText: { type: String, default: '' },
    });
</script>

<template>
    <Transition name="fade">
        <div
            v-if="visible"
            class="technical-overlay"
        >
            <div class="technical-overlay-header">
                <span class="technical-overlay-title">{{ title }}</span>
                <slot name="header-meta" />
            </div>

            <slot />

            <pre
                v-if="metricsText"
                class="technical-overlay-metrics"
            >{{ metricsText }}</pre>
        </div>
    </Transition>
</template>

<style scoped>
    .technical-overlay {
        position: fixed;
        bottom: 80px;
        right: 16px;
        z-index: 4;
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: auto;
        user-select: none;
    }

    .technical-overlay-header {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        align-self: flex-start;
        padding: 6px 10px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.62);
        backdrop-filter: blur(8px);
    }

    .technical-overlay-title {
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.86);
    }

    .technical-overlay-metrics {
        margin: 0;
        padding: 8px 12px;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        font-size: 11px;
        line-height: 1.5;
        color: rgba(255, 255, 255, 0.8);
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(6px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        white-space: pre;
        pointer-events: none;
    }

    .fade-enter-active,
    .fade-leave-active {
        transition: opacity 0.3s ease;
    }

    .fade-enter-from,
    .fade-leave-to {
        opacity: 0;
    }
</style>