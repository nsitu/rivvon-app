import { onUnmounted, watch } from 'vue';
import {
    createMouseTiltController,
    getCircularTiltAnglesAtProgress,
} from '../../modules/viewer/mouseTiltMotion';

const SCROLL_TILT_LERP = 0.055;
const SCROLL_TILT_WHEEL_TURNS_PER_PIXEL = 1 / 1800;
const SCROLL_TILT_TOUCH_TURNS_PER_PIXEL = 1 / 900;
const SCROLL_TILT_SETTLE_EPSILON = 0.0001;

const INTERACTIVE_UI_SELECTOR = [
    'a[href]',
    'button',
    'input',
    'textarea',
    'select',
    'label',
    '[contenteditable="true"]',
    '[role="button"]',
    '[role="dialog"]',
    '[role="menuitem"]',
    '.toolbar-main-button',
    '.toolbar-utility-button',
    '.launcher-menu-action',
    '.tools-option',
    '.tools-inline-action',
    '.launcher-panel',
    '.tools-panel',
    '.about-panel',
    '.export-video-panel',
    '.p-select',
    '.p-select-overlay',
    '.p-scrollpanel',
    '.p-inputnumber',
    '.p-toggleswitch',
].join(', ');

const ACTIVE_OVERLAY_SELECTOR = '.launcher-panel.active, .tools-panel.active, .about-panel.active, .export-video-panel.active';

function normalizeWheelDelta(delta, deltaMode) {
    if (deltaMode === 1) {
        return delta * 16;
    }

    if (deltaMode === 2) {
        return delta * window.innerHeight;
    }

    return delta;
}

function getPrimaryWheelDelta(event) {
    const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;

    return normalizeWheelDelta(dominantDelta, event.deltaMode);
}

function findTouchByIdentifier(touches, identifier) {
    for (const touch of touches) {
        if (touch.identifier === identifier) {
            return touch;
        }
    }

    return null;
}

export function useScrollTilt(ctx) {
    const cameraController = createMouseTiltController();

    let isActive = false;
    let hasInteracted = false;
    let targetPhase = 0;
    let currentPhase = 0;
    let activeTouchId = null;
    let lastTouchPoint = null;
    let texturePhaseTurns = 0;
    let texturePhasePrimed = false;

    function resetMotionState() {
        hasInteracted = false;
        targetPhase = 0;
        currentPhase = 0;
        activeTouchId = null;
        lastTouchPoint = null;
        texturePhaseTurns = 0;
        texturePhasePrimed = false;
    }

    function hasBlockingViewerContext() {
        if (
            ctx.app.isDrawingMode
            || ctx.app.isWalkMode
            || ctx.app.drawingBrowserVisible
            || ctx.app.textureCreatorVisible
            || ctx.app.textureBrowserVisible
            || ctx.app.textPanelVisible
            || ctx.app.emojiPickerVisible
            || ctx.app.realtimeSamplerVisible
            || ctx.app.toolsPanelVisible
            || ctx.app.aboutPanelVisible
        ) {
            return true;
        }

        if (typeof document === 'undefined') {
            return false;
        }

        return !!document.querySelector(ACTIVE_OVERLAY_SELECTOR);
    }

    function isEventFromInteractiveUI(target) {
        if (!(target instanceof Element)) {
            return false;
        }

        return !!target.closest(INTERACTIVE_UI_SELECTOR);
    }

    function shouldHandleInputEvent(target) {
        if (!isActive || !cameraController.isActive) {
            return false;
        }

        if (hasBlockingViewerContext()) {
            return false;
        }

        return !isEventFromInteractiveUI(target);
    }

    function applyPhaseDelta(deltaTurns) {
        if (!Number.isFinite(deltaTurns) || deltaTurns === 0) {
            return;
        }

        targetPhase += deltaTurns;
        hasInteracted = true;
    }

    function getScrollControlledTileManagers() {
        const activeTileManagers = Array.isArray(ctx.tileManagers?.value)
            ? ctx.tileManagers.value.filter(Boolean)
            : [];

        if (activeTileManagers.length > 0) {
            return activeTileManagers;
        }

        return ctx.tileManager?.value ? [ctx.tileManager.value] : [];
    }

    function primeTexturePhaseFromScene() {
        if (texturePhasePrimed) {
            return;
        }

        const referenceTileManager = getScrollControlledTileManagers().find(
            (tileManager) => typeof tileManager?.getLayerCycleProgress === 'function',
        );

        texturePhaseTurns = referenceTileManager?.getLayerCycleProgress?.() ?? 0;
        texturePhasePrimed = true;
    }

    function syncTextureLayerProgress(deltaTurns) {
        if (!ctx.app.textureAnimationEnabled || !Number.isFinite(deltaTurns) || deltaTurns === 0) {
            return;
        }

        primeTexturePhaseFromScene();
        texturePhaseTurns += deltaTurns;

        for (const tileManager of getScrollControlledTileManagers()) {
            tileManager.setLayerCycleProgress?.(texturePhaseTurns);
        }
    }

    function _onWheel(event) {
        if (event.ctrlKey || !shouldHandleInputEvent(event.target)) {
            return;
        }

        const pixelDelta = getPrimaryWheelDelta(event);
        if (!Number.isFinite(pixelDelta) || pixelDelta === 0) {
            return;
        }

        event.preventDefault();
        applyPhaseDelta(pixelDelta * SCROLL_TILT_WHEEL_TURNS_PER_PIXEL);
    }

    function _onTouchStart(event) {
        if (event.touches.length !== 1 || !shouldHandleInputEvent(event.target)) {
            activeTouchId = null;
            lastTouchPoint = null;
            return;
        }

        const touch = event.touches[0];
        activeTouchId = touch.identifier;
        lastTouchPoint = { x: touch.clientX, y: touch.clientY };
    }

    function _onTouchMove(event) {
        if (activeTouchId == null || !lastTouchPoint || !shouldHandleInputEvent(event.target)) {
            return;
        }

        const touch = findTouchByIdentifier(event.touches, activeTouchId);
        if (!touch) {
            return;
        }

        const deltaX = lastTouchPoint.x - touch.clientX;
        const deltaY = lastTouchPoint.y - touch.clientY;
        lastTouchPoint = { x: touch.clientX, y: touch.clientY };

        const pixelDelta = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;
        if (!Number.isFinite(pixelDelta) || pixelDelta === 0) {
            return;
        }

        event.preventDefault();
        applyPhaseDelta(pixelDelta * SCROLL_TILT_TOUCH_TURNS_PER_PIXEL);
    }

    function _clearTouchState(touches = null) {
        if (activeTouchId == null) {
            return;
        }

        if (touches && findTouchByIdentifier(touches, activeTouchId)) {
            return;
        }

        activeTouchId = null;
        lastTouchPoint = null;
    }

    function _onTouchEnd(event) {
        _clearTouchState(event.touches);
    }

    function _onTouchCancel(event) {
        _clearTouchState(event.touches);
    }

    function _addListeners() {
        window.addEventListener('wheel', _onWheel, { passive: false });
        window.addEventListener('touchstart', _onTouchStart, { passive: true });
        window.addEventListener('touchmove', _onTouchMove, { passive: false });
        window.addEventListener('touchend', _onTouchEnd, { passive: true });
        window.addEventListener('touchcancel', _onTouchCancel, { passive: true });
    }

    function _removeListeners() {
        window.removeEventListener('wheel', _onWheel);
        window.removeEventListener('touchstart', _onTouchStart);
        window.removeEventListener('touchmove', _onTouchMove);
        window.removeEventListener('touchend', _onTouchEnd);
        window.removeEventListener('touchcancel', _onTouchCancel);
    }

    function attach(camera, controls) {
        cameraController.attach(camera, controls);
        cameraController.setRibbonSeries(ctx.ribbonSeries.value);
    }

    function activate() {
        if (!ctx.camera.value || !ctx.controls.value) {
            return;
        }

        cameraController.attach(ctx.camera.value, ctx.controls.value);
        cameraController.setRibbonSeries(ctx.ribbonSeries.value);
        resetMotionState();
        isActive = cameraController.activate(ctx.controls.value.target?.clone());

        if (!isActive) {
            return;
        }

        primeTexturePhaseFromScene();
        _addListeners();
    }

    function deactivate({ restoreBaseline = true } = {}) {
        _removeListeners();
        _clearTouchState();

        if (cameraController.isActive) {
            cameraController.deactivate({ restoreBaseline });
        }

        isActive = false;
        resetMotionState();
    }

    function tick() {
        if (!isActive || !cameraController.isActive || !hasInteracted) {
            return;
        }

        const previousPhase = currentPhase;
        currentPhase += (targetPhase - currentPhase) * SCROLL_TILT_LERP;

        if (Math.abs(targetPhase - currentPhase) <= SCROLL_TILT_SETTLE_EPSILON) {
            currentPhase = targetPhase;
        }

        cameraController.apply(getCircularTiltAnglesAtProgress(currentPhase));
        syncTextureLayerProgress(currentPhase - previousPhase);
    }

    function syncWithMode(mode) {
        if (mode === 'scrollTilt') {
            if (!isActive) {
                activate();
            }
            return;
        }

        if (isActive) {
            deactivate();
        }
    }

    watch(
        () => ctx.ribbonSeries.value,
        () => {
            cameraController.setRibbonSeries(ctx.ribbonSeries.value);

            if (isActive && cameraController.isActive) {
                cameraController.captureBaseline(ctx.controls.value?.target?.clone());
            }
        },
    );

    watch(
        () => ctx.tileManager?.value,
        () => {
            texturePhasePrimed = false;
        },
    );

    watch(
        () => ctx.tileManagers?.value,
        () => {
            texturePhasePrimed = false;
        },
    );

    watch(
        () => ctx.app.viewerControlMode,
        (mode) => syncWithMode(mode),
    );

    onUnmounted(() => {
        deactivate({ restoreBaseline: false });
        cameraController.detach();
    });

    return {
        attach,
        tick,
        activate,
        deactivate,
        syncWithMode,
    };
}