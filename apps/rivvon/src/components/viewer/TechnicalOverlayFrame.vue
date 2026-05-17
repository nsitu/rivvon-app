<script setup>
    defineProps({
        visible: { type: Boolean, default: false },
        title: { type: String, default: '' },
        metricsText: { type: String, default: '' },
    });
</script>

<template>
    <Transition name="fade">
        <div
            v-if="visible"
            class="technical-overlay"
        >
            <div
                v-if="title"
                class="technical-overlay-header"
            >
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
        bottom: calc(var(--viewer-bottom-chrome-height, 6.4rem) + 0.5rem);
        right: 12px;
        z-index: 4;
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: min(26rem, calc(100vw - 24px));
        max-width: calc(100vw - 24px);
        pointer-events: auto;
        user-select: none;
    }

    .technical-overlay-header {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        align-self: flex-start;
        padding: 6px 10px;

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

        border-radius: 8px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        max-width: 100%;
        pointer-events: none;
    }

    @media (max-width: 640px) {
        .technical-overlay {
            left: 12px;
            right: 12px;
            width: auto;
            max-width: none;
        }

        .technical-overlay-header {
            align-self: stretch;
            justify-content: space-between;
        }
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