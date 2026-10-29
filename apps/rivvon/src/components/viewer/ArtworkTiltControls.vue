<script setup>
    import { computed, useId } from 'vue';
    import Slider from 'primevue/slider';
    import { useViewerStore } from '../../stores/viewerStore';
    import { MIN_ARTWORK_TILT_DEGREES, MAX_ARTWORK_TILT_DEGREES } from '../../../../../packages/shared-types/src/artworkTilt.js';

    defineProps({ disabled: { type: Boolean, default: false } });
    const app = useViewerStore();
    const id = useId();
    const horizontal = computed({
        get: () => app.artworkTiltHorizontalDegrees,
        set: value => app.setArtworkTiltHorizontalDegrees(value),
    });
    const vertical = computed({
        get: () => app.artworkTiltVerticalDegrees,
        set: value => app.setArtworkTiltVerticalDegrees(value),
    });
</script>

<template>
    <div class="artwork-tilt-controls">
        <div class="tools-slider">
            <label :id="`${id}-horizontal`">
                Horizontal Tilt
                <span class="tools-slider-value" aria-hidden="true">{{ horizontal }}°</span>
            </label>
            <Slider v-model="horizontal" :min="MIN_ARTWORK_TILT_DEGREES" :max="MAX_ARTWORK_TILT_DEGREES"
                :step="0.5" :disabled="disabled" :aria-labelledby="`${id}-horizontal`"
                :pt="{ handle: { 'aria-valuetext': `${horizontal} degrees`, 'aria-describedby': `${id}-help` } }" />
        </div>
        <div class="tools-slider">
            <label :id="`${id}-vertical`">
                Vertical Tilt
                <span class="tools-slider-value" aria-hidden="true">{{ vertical }}°</span>
            </label>
            <Slider v-model="vertical" :min="MIN_ARTWORK_TILT_DEGREES" :max="MAX_ARTWORK_TILT_DEGREES"
                :step="0.5" :disabled="disabled" :aria-labelledby="`${id}-vertical`"
                :pt="{ handle: { 'aria-valuetext': `${vertical} degrees`, 'aria-describedby': `${id}-help` } }" />
        </div>
        <div :id="`${id}-help`" class="artwork-tilt-help">
            Maximum angle from center on each axis. Equal angles make a circular loop; 0° stops tilt on that axis.
        </div>
    </div>
</template>

<style scoped>
    .artwork-tilt-controls {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        min-width: 0;
    }

    .artwork-tilt-help {
        padding: 0 1rem;
        font-size: 0.78rem;
        line-height: 1.35;
        color: var(--p-text-muted-color);
    }
</style>
