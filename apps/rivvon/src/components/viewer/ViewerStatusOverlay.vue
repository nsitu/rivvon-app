<script setup>
    import { ref, computed, watch, onUnmounted } from 'vue';
    import TechnicalOverlayFrame from './TechnicalOverlayFrame.vue';
    import { useViewerStore } from '../../stores/viewerStore';
    import { getStorageUsage } from '../../services/localStorage.js';

    const app = useViewerStore();

    const props = defineProps({
        visible: { type: Boolean, default: false },
        fps: { type: Number, default: 0 },
    });

    const storageMB = ref(null);
    let pollTimer = null;

    async function updateStorage() {
        const { used } = await getStorageUsage();
        storageMB.value = (used / (1024 * 1024)).toFixed(1);
    }

    watch(() => props.visible, (vis) => {
        if (vis) {
            updateStorage();
            pollTimer = setInterval(updateStorage, 5000);
        } else {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }, { immediate: true });

    onUnmounted(() => clearInterval(pollTimer));

    const metricsText = computed(() => {
        const lines = [
            `FPS  ${props.fps}`,
            `GPU  ${app.rendererType.toUpperCase()}`
        ];
        if (storageMB.value !== null) {
            lines.push(`IDB  ${storageMB.value} MB`);
        }
        return lines.join('\n');
    });
</script>

<template>
    <TechnicalOverlayFrame
        :visible="visible"
        :metrics-text="metricsText"
    />
</template>
