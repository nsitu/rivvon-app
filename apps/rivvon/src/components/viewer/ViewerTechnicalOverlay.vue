<script setup>
    import { computed } from 'vue';
    import CinematicTechnicalOverlay from './CinematicTechnicalOverlay.vue';
    import HeadTrackingTechnicalOverlay from './HeadTrackingTechnicalOverlay.vue';
    import ViewerStatusOverlay from './ViewerStatusOverlay.vue';

    const props = defineProps({
        cinematicCamera: { type: Object, default: null },
        headTracking: { type: Object, default: null },
        viewerControlMode: { type: String, default: 'orbit' },
        visible: { type: Boolean, default: false },
        fps: { type: Number, default: 0 },
    });

    const activeContext = computed(() => {
        if (props.cinematicCamera?.isPlaying?.value) {
            return 'cinematic';
        }

        if (props.viewerControlMode === 'headTracking') {
            return 'headTracking';
        }

        return 'default';
    });
</script>

<template>
    <CinematicTechnicalOverlay
        :cinematic-camera="cinematicCamera"
        :visible="visible && activeContext === 'cinematic'"
    />

    <HeadTrackingTechnicalOverlay
        :head-tracking="headTracking"
        :visible="visible && activeContext === 'headTracking'"
    />

    <ViewerStatusOverlay
        :fps="fps"
        :visible="visible && activeContext === 'default'"
    />
</template>