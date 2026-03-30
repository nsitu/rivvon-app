<script setup>
    import { ref, watch, onUnmounted } from 'vue';

    const props = defineProps({
        visible: Boolean
    });

    const emit = defineEmits(['restart']);

    const countdown = ref(30);
    let timer = null;

    watch(() => props.visible, (show) => {
        if (show) {
            countdown.value = 30;
            timer = setInterval(() => {
                countdown.value--;
                if (countdown.value <= 0) {
                    clearInterval(timer);
                    timer = null;
                    emit('restart');
                }
            }, 1000);
        } else {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        }
    });

    onUnmounted(() => {
        if (timer) clearInterval(timer);
    });

    function handleRestart() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        emit('restart');
    }
</script>

<template>
    <Transition name="fade">
        <div
            v-if="visible"
            class="device-lost-overlay"
        >
            <div class="device-lost-card">
                <span class="device-lost-icon material-symbols-outlined">gpu</span>
                <h2 class="device-lost-title">GPU Connection Lost</h2>
                <p class="device-lost-message">
                    The graphics device was disconnected. This can happen after the tab is idle for a while.
                </p>
                <button
                    class="restart-btn"
                    @click="handleRestart"
                >
                    <span class="material-symbols-outlined">refresh</span>
                    Restart Viewer
                </button>
                <p class="countdown-text">
                    Auto-restarting in {{ countdown }}s
                </p>
            </div>
        </div>
    </Transition>
</template>

<style scoped>
    .device-lost-overlay {
        position: fixed;
        inset: 0;
        z-index: 100;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(12px);
        pointer-events: auto;
    }

    .device-lost-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
        padding: 2.5rem 3rem;
        border-radius: 1rem;
        background: rgba(30, 30, 40, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.1);
        max-width: 360px;
        text-align: center;
    }

    .device-lost-icon {
        font-size: 3rem;
        color: #f59e0b;
    }

    .device-lost-title {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 600;
        color: #fff;
    }

    .device-lost-message {
        margin: 0;
        font-size: 0.875rem;
        line-height: 1.5;
        color: rgba(255, 255, 255, 0.65);
    }

    .restart-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.625rem 1.5rem;
        border: none;
        border-radius: 0.5rem;
        background: #6366f1;
        color: #fff;
        font-size: 0.9375rem;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s ease;
    }

    .restart-btn:hover {
        background: #818cf8;
    }

    .restart-btn .material-symbols-outlined {
        font-size: 1.25rem;
    }

    .countdown-text {
        margin: 0;
        font-size: 0.8125rem;
        color: rgba(255, 255, 255, 0.4);
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
