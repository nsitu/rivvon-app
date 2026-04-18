// src/composables/viewer/useMouseTilt.js
// Mouse-position-based ribbon tilt control.
//
// Maps the cursor position on the viewport to yaw/pitch angles,
// then drives the ribbon transform root via HeadTrackingCameraController
// (the same controller used by the head-tracking modality).

import { watch } from 'vue';
import {
    createMouseTiltController,
    getMouseTiltAnglesFromNormalizedPosition,
    MOUSE_TILT_LERP,
} from '../../modules/viewer/mouseTiltMotion';

export function useMouseTilt(ctx) {
    const cameraController = createMouseTiltController();

    // Normalised mouse coordinates in [-1, 1], updated on every mousemove
    let rawX = 0;
    let rawY = 0;
    // Smoothed values advanced each tick
    let smoothX = 0;
    let smoothY = 0;

    let isActive = false;

    function _onMouseMove(event) {
        rawX = (event.clientX / window.innerWidth)  * 2 - 1;
        rawY = (event.clientY / window.innerHeight) * 2 - 1;
    }

    function _addListeners() {
        window.addEventListener('mousemove', _onMouseMove, { passive: true });
    }

    function _removeListeners() {
        window.removeEventListener('mousemove', _onMouseMove);
    }

    // ── Public API ─────────────────────────────────────────────────────

    function attach(camera, controls) {
        cameraController.attach(camera, controls);
        _syncRibbonSeries();
    }

    function _syncRibbonSeries() {
        cameraController.setRibbonSeries(ctx.ribbonSeries.value);
    }

    function activate() {
        if (!ctx.camera.value || !ctx.controls.value) return;

        cameraController.attach(ctx.camera.value, ctx.controls.value);
        _syncRibbonSeries();

        // Reset smooth state to current mouse position so there is no jump
        smoothX = rawX;
        smoothY = rawY;

        cameraController.activate(ctx.controls.value.target?.clone());
        _addListeners();
        isActive = true;
    }

    function deactivate({ restoreBaseline = true } = {}) {
        _removeListeners();
        if (cameraController.isActive) {
            cameraController.deactivate({ restoreBaseline });
        }
        isActive = false;
    }

    /**
     * Called once per frame from the render loop when this mode is active.
     * Advances smooth tracking and applies the tilt to the ribbon.
     */
    function tick() {
        if (!isActive || !cameraController.isActive) return;

        smoothX += (rawX - smoothX) * MOUSE_TILT_LERP;
        smoothY += (rawY - smoothY) * MOUSE_TILT_LERP;

        const { yaw, pitch } = getMouseTiltAnglesFromNormalizedPosition(smoothX, smoothY);

        cameraController.apply({ yaw, pitch });
    }

    /**
     * Called by useThreeSetup after Three.js initialises so the controller
     * knows about the camera/controls before any mode is selected.
     */
    function syncWithMode(mode) {
        if (mode === 'mouseTilt') {
            if (!isActive) activate();
        } else {
            if (isActive) deactivate();
        }
    }

    // Watch for RibbonSeries changes (e.g., ribbons rebuilt after texture load)
    watch(
        () => ctx.ribbonSeries.value,
        () => {
            cameraController.setRibbonSeries(ctx.ribbonSeries.value);
            if (isActive && cameraController.isActive) {
                // Re-capture baseline now that the ribbon root may have changed
                cameraController.captureBaseline(ctx.controls.value?.target?.clone());
            }
        },
    );

    // Watch for mode changes driven by the store
    watch(
        () => ctx.app.viewerControlMode,
        (mode) => syncWithMode(mode),
    );

    return {
        attach,
        tick,
        activate,
        deactivate,
        syncWithMode,
    };
}
