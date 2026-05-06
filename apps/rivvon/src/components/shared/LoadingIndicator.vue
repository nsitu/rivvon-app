<script setup>
    defineProps({
        message: {
            type: String,
            default: 'Loading...',
        },
        statusText: {
            type: String,
            default: '',
        },
    });
</script>

<template>
    <div
        class="loading-indicator"
        role="status"
        aria-live="polite"
    >
        <div
            class="loading-indicator-spinner"
            aria-hidden="true"
        ></div>
        <p
            v-if="message"
            class="loading-indicator-text"
        >{{ message }}</p>
        <p
            v-if="statusText"
            class="loading-indicator-status"
        >{{ statusText }}</p>
    </div>
</template>

<style scoped>
    .loading-indicator {
        --loading-indicator-direction: column;
        --loading-indicator-gap: 1rem;
        --loading-indicator-spinner-size: 48px;
        --loading-indicator-spinner-border-width: 4px;
        --loading-indicator-spinner-track: rgba(255, 255, 255, 0.2);
        --loading-indicator-spinner-head: #fff;
        --loading-indicator-text-color: #fff;
        --loading-indicator-text-size: 1rem;
        --loading-indicator-text-weight: 600;
        --loading-indicator-text-letter-spacing: 0.05em;
        --loading-indicator-text-line-height: 1.4;
        --loading-indicator-status-color: rgba(255, 255, 255, 0.72);
        --loading-indicator-status-size: 0.875rem;
        --loading-indicator-status-weight: 500;
        --loading-indicator-status-letter-spacing: normal;
        --loading-indicator-status-line-height: 1.4;
        display: flex;
        flex-direction: var(--loading-indicator-direction);
        align-items: center;
        justify-content: center;
        gap: var(--loading-indicator-gap);
        text-align: center;
        color: var(--loading-indicator-text-color);
        font-size: var(--loading-indicator-text-size);
    }

    .loading-indicator-spinner {
        width: var(--loading-indicator-spinner-size);
        height: var(--loading-indicator-spinner-size);
        border: var(--loading-indicator-spinner-border-width) solid var(--loading-indicator-spinner-track);
        border-top-color: var(--loading-indicator-spinner-head);
        border-radius: 50%;
        animation: loading-indicator-spin 1s linear infinite;
    }

    .loading-indicator-text {
        margin: 0;
        color: inherit;
        font-size: inherit;
        line-height: var(--loading-indicator-text-line-height);
        font-weight: var(--loading-indicator-text-weight);
        letter-spacing: var(--loading-indicator-text-letter-spacing);
    }

    .loading-indicator-status {
        margin: -0.35rem 0 0;
        color: var(--loading-indicator-status-color);
        font-size: var(--loading-indicator-status-size);
        line-height: var(--loading-indicator-status-line-height);
        font-weight: var(--loading-indicator-status-weight);
        letter-spacing: var(--loading-indicator-status-letter-spacing);
    }

    @keyframes loading-indicator-spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>