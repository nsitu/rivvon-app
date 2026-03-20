// src/composables/viewer/useCinematicCamera.js
// Vue composable wrapping CinematicCamera module.
// Provides reactive state for UI binding and bridges between the
// non-reactive module and Vue's reactivity system.

import { ref, shallowRef, computed } from 'vue';
import { CinematicCamera } from '../../modules/viewer/cinematicCamera';

/**
 * Composable for cinematic camera authoring and playback.
 * Usage:
 *   const cinematic = useCinematicCamera();
 *   cinematic.init(camera, controls);
 *   cinematic.captureROI();
 *   cinematic.startPlayback();
 */
export function useCinematicCamera() {
    /** @type {import('vue').ShallowRef<CinematicCamera|null>} */
    const instance = shallowRef(null);

    // Reactive state mirrors
    const isPlaying = ref(false);
    const roiCount = ref(0);
    const hasROIs = computed(() => roiCount.value > 0);

    /**
     * Initialize the cinematic camera system.
     * @param {import('three').PerspectiveCamera} camera
     * @param {import('three').OrbitControls} controls
     */
    function init(camera, controls) {
        if (instance.value) {
            instance.value.dispose();
        }
        instance.value = new CinematicCamera({ camera, controls });
        isPlaying.value = false;
        roiCount.value = 0;
    }

    /**
     * Capture the current camera state as an ROI.
     * @returns {{ roi: Object, index: number } | null}
     */
    function captureROI() {
        if (!instance.value || isPlaying.value) return null;
        const result = instance.value.captureROI();
        roiCount.value = instance.value.roiCount;
        return result;
    }

    /**
     * Remove an ROI by index.
     * @param {number} index
     */
    function removeROI(index) {
        if (!instance.value || isPlaying.value) return;
        instance.value.removeROI(index);
        roiCount.value = instance.value.roiCount;
    }

    /** Clear all captured ROIs. */
    function clearROIs() {
        if (!instance.value) return;
        if (isPlaying.value) stopPlayback();
        instance.value.clearROIs();
        roiCount.value = 0;
    }

    /**
     * Discard auto-generated ROIs when ribbon geometry changes.
     * Manual ROIs are preserved.
     */
    function invalidateAutoROIs() {
        if (!instance.value) return;
        instance.value.invalidateAutoROIs();
        roiCount.value = instance.value.roiCount;
        isPlaying.value = instance.value.isPlaying;
    }

    /**
     * Start cinematic playback (disables OrbitControls).
     * If no manual ROIs exist, generates defaults from ribbonSeries geometry.
     * @param {import('../../modules/viewer/ribbonSeries').RibbonSeries} [ribbonSeries]
     */
    function startPlayback(ribbonSeries) {
        if (!instance.value) return;
        instance.value.startPlayback(ribbonSeries);
        roiCount.value = instance.value.roiCount;
        isPlaying.value = instance.value.isPlaying;
    }

    /** Stop cinematic playback (re-enables OrbitControls). */
    function stopPlayback() {
        if (!instance.value) return;
        instance.value.stopPlayback();
        isPlaying.value = false;
    }

    /**
     * Toggle playback on/off.
     * @param {import('../../modules/viewer/ribbonSeries').RibbonSeries} [ribbonSeries]
     */
    function togglePlayback(ribbonSeries) {
        if (isPlaying.value) {
            stopPlayback();
        } else {
            startPlayback(ribbonSeries);
        }
    }

    /**
     * Per-frame tick for real-time playback. Call from render loop.
     * @param {number} deltaSeconds
     */
    function tick(deltaSeconds) {
        if (!instance.value || !isPlaying.value) return;
        instance.value.update(deltaSeconds);
    }

    /**
     * Get the auto-calculated loop duration in seconds.
     * @returns {number}
     */
    function getLoopDuration() {
        if (!instance.value) return 0;
        return instance.value.getLoopDuration();
    }

    /**
     * Get the raw CinematicCamera instance (for export code).
     * @returns {CinematicCamera|null}
     */
    function getInstance() {
        return instance.value;
    }

    /**
     * Get telemetry snapshot from the CinematicCamera instance.
     * @returns {Object|null}
     */
    function getTelemetry() {
        return instance.value?.getTelemetry() ?? null;
    }

    /**
     * Sample position and target at an arbitrary arc-length u.
     * @param {number} u
     * @returns {{ position: Vector3, target: Vector3 } | null}
     */
    function getTelemetryAtU(u) {
        return instance.value?.getTelemetryAtU(u) ?? null;
    }

    /**
     * Get spline track geometry for the debug overlay.
     * @param {number} [sampleCount=100]
     * @returns {Object|null}
     */
    function getTrackGeometry(sampleCount = 100) {
        return instance.value?.getTrackGeometry(sampleCount) ?? null;
    }

    /** Cleanup. */
    function dispose() {
        if (instance.value) {
            instance.value.dispose();
            instance.value = null;
        }
        isPlaying.value = false;
        roiCount.value = 0;
    }

    return {
        // Reactive state
        isPlaying,
        roiCount,
        hasROIs,

        // Methods
        init,
        captureROI,
        removeROI,
        clearROIs,
        invalidateAutoROIs,
        startPlayback,
        stopPlayback,
        togglePlayback,
        tick,
        getLoopDuration,
        getTelemetry,
        getTelemetryAtU,
        getTrackGeometry,
        getInstance,
        dispose
    };
}
