<script setup>
    import { computed } from 'vue';
    import CinematicDebugOverlay from './CinematicDebugOverlay.vue';
    import HeadTrackingDebugOverlay from './HeadTrackingDebugOverlay.vue';

    const props = defineProps({
        cinematicCamera: { type: Object, default: null },
        headTracking: { type: Object, default: null },
        viewerControlMode: { type: String, default: 'orbit' },
        visible: { type: Boolean, default: false },
    });

    const activeContext = computed(() => {
        if (props.cinematicCamera?.isPlaying?.value) {
            return 'cinematic';
        }

        if (props.viewerControlMode === 'headTracking') {
            return 'headTracking';
        }

        return null;
    });
</script>

<template>
    <CinematicDebugOverlay
        :cinematic-camera="cinematicCamera"
        :visible="visible && activeContext === 'cinematic'"
    />

    <HeadTrackingDebugOverlay
        :head-tracking="headTracking"
        :visible="visible && activeContext === 'headTracking'"
    />
</template>