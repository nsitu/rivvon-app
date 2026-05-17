import { onUnmounted, watch } from 'vue';
import {
    createMouseTiltController,
    getCircularTiltAnglesAtProgress,
} from '../../modules/viewer/mouseTiltMotion';

const SCROLL_TILT_WHEEL_TURNS_PER_PIXEL = 1 / 1800;
const SCROLL_TILT_TOUCH_TURNS_PER_PIXEL = 1 / 900;
const SCROLL_DRIVEN_TILT_SCALE = 0.1;
const SCROLL_DRIVEN_FRICTION = 7;
const SCROLL_DRIVEN_INPUT_SETTLE_MS = 40;
const SCROLL_DRIVEN_MAX_STEP_SEC = 1 / 20;
const SCROLL_DRIVEN_MIN_INPUT_STEP_SEC = 1 / 240;
const SCROLL_DRIVEN_MAX_INPUT_STEP_SEC = 0.08;
const SCROLL_DRIVEN_VELOCITY_BLEND = 0.35;
const SCROLL_DRIVEN_VELOCITY_EPSILON = 0.002;

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
    let currentPhase = 0;
    let scrollVelocity = 0;
    let lastInputTimestampMs = null;
    let activeTouchId = null;
    let lastTouchPoint = null;
    let texturePhaseTurns = 0;
    let texturePhasePrimed = false;
    let undulationTimeSec = 0;
    let undulationPhasePrimed = false;

    function resetMotionState() {
        currentPhase = 0;
        scrollVelocity = 0;
        lastInputTimestampMs = null;
        activeTouchId = null;
        lastTouchPoint = null;
        texturePhaseTurns = 0;
        texturePhasePrimed = false;
        undulationTimeSec = 0;
        undulationPhasePrimed = false;
    }

    function clampInputStepSec(value) {
        if (!Number.isFinite(value) || value <= 0) {
            return SCROLL_DRIVEN_MIN_INPUT_STEP_SEC;
        }

        return Math.min(SCROLL_DRIVEN_MAX_INPUT_STEP_SEC, Math.max(SCROLL_DRIVEN_MIN_INPUT_STEP_SEC, value));
    }

    function hasEnabledScrollDrivenResponse() {
        return !!(
            ctx.app.scrollDrivenTiltEnabled
            || (ctx.app.textureAnimationEnabled && ctx.app.scrollDrivenLayerCycleEnabled)
            || (ctx.app.flowState !== 'off' && ctx.app.scrollDrivenFlowEnabled)
            || ctx.app.undulationEnabled
        );
    }

    function updateMomentumFromInput(deltaTurns, inputTimestampMs) {
        const numericTimestamp = Number(inputTimestampMs);
        const inputStepSec = Number.isFinite(numericTimestamp) && Number.isFinite(lastInputTimestampMs)
            ? clampInputStepSec((numericTimestamp - lastInputTimestampMs) / 1000)
            : (1 / 60);
        const nextVelocity = deltaTurns / inputStepSec;

        if (!Number.isFinite(nextVelocity)) {
            return;
        }

        if (Math.sign(nextVelocity) !== Math.sign(scrollVelocity) || Math.abs(scrollVelocity) <= SCROLL_DRIVEN_VELOCITY_EPSILON) {
            scrollVelocity = nextVelocity;
        } else {
            scrollVelocity += (nextVelocity - scrollVelocity) * SCROLL_DRIVEN_VELOCITY_BLEND;
        }

        lastInputTimestampMs = Number.isFinite(numericTimestamp) ? numericTimestamp : null;
    }

    function applyDrivenDelta(deltaTurns) {
        if (!Number.isFinite(deltaTurns) || deltaTurns === 0) {
            return false;
        }

        let applied = false;

        if (ctx.app.scrollDrivenTiltEnabled) {
            currentPhase += deltaTurns * SCROLL_DRIVEN_TILT_SCALE;
            applied = true;
        }

        applied = syncUndulationProgress(deltaTurns) || applied;
        applied = syncTextureLayerProgress(deltaTurns) || applied;
        applied = syncFlowProgress(deltaTurns) || applied;

        return applied;
    }

    function applyTiltFromCurrentPhase() {
        if (!ctx.app.scrollDrivenTiltEnabled) {
            return;
        }

        cameraController.apply(getCircularTiltAnglesAtProgress(currentPhase));
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

    function applyPhaseDelta(deltaTurns, inputTimestampMs = performance.now()) {
        if (!Number.isFinite(deltaTurns) || deltaTurns === 0) {
            return;
        }

        if (!hasEnabledScrollDrivenResponse()) {
            return;
        }

        if (!applyDrivenDelta(deltaTurns)) {
            return;
        }

        updateMomentumFromInput(deltaTurns, inputTimestampMs);
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
        if (
            !ctx.app.textureAnimationEnabled
            || !ctx.app.scrollDrivenLayerCycleEnabled
            || !Number.isFinite(deltaTurns)
            || deltaTurns === 0
        ) {
            return false;
        }

        primeTexturePhaseFromScene();
        texturePhaseTurns += deltaTurns;

        for (const tileManager of getScrollControlledTileManagers()) {
            tileManager.setLayerCycleProgress?.(texturePhaseTurns);
        }

        return true;
    }

    function primeUndulationPhaseFromScene() {
        if (undulationPhasePrimed) {
            return;
        }

        undulationTimeSec = performance.now() / 1000;
        undulationPhasePrimed = true;
    }

    function syncUndulationProgress(deltaTurns) {
        if (
            !ctx.app.undulationEnabled
            || !ctx.ribbonSeries?.value
            || typeof ctx.ribbonSeries.value.setUndulationTime !== 'function'
            || !Number.isFinite(deltaTurns)
            || deltaTurns === 0
        ) {
            return false;
        }

        primeUndulationPhaseFromScene();
        undulationTimeSec += deltaTurns * (ctx.ribbonSeries.value.getUndulationPeriod?.() || 3.0);
        ctx.ribbonSeries.value.setUndulationTime(undulationTimeSec);
        return true;
    }

    function syncFlowProgress(deltaTurns) {
        if (
            ctx.app.flowState === 'off'
            || !ctx.app.scrollDrivenFlowEnabled
            || !Number.isFinite(deltaTurns)
            || deltaTurns === 0
        ) {
            return false;
        }

        for (const tileManager of getScrollControlledTileManagers()) {
            tileManager.advanceFlowOffset?.(deltaTurns);
        }

        return true;
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
        applyPhaseDelta(pixelDelta * SCROLL_TILT_WHEEL_TURNS_PER_PIXEL, event.timeStamp);
    }

    function _onTouchStart(event) {
        if (event.touches.length !== 1 || !shouldHandleInputEvent(event.target)) {
            activeTouchId = null;
            lastTouchPoint = null;
            return;
        }

        const touch = event.touches[0];
        scrollVelocity = 0;
        lastInputTimestampMs = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
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
        const deltaTurns = pixelDelta * SCROLL_TILT_TOUCH_TURNS_PER_PIXEL;
        if (!applyDrivenDelta(deltaTurns)) {
            return;
        }

        updateMomentumFromInput(deltaTurns, event.timeStamp);
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
        primeUndulationPhaseFromScene();
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

    function tick(deltaSec = 0, nowMs = performance.now()) {
        if (!isActive || !cameraController.isActive) {
            return;
        }

        const safeDeltaSec = Math.min(SCROLL_DRIVEN_MAX_STEP_SEC, Math.max(0, Number(deltaSec) || 0));
        const timeSinceInputMs = Number.isFinite(lastInputTimestampMs) ? (nowMs - lastInputTimestampMs) : Infinity;

        if (
            safeDeltaSec > 0
            && hasEnabledScrollDrivenResponse()
            && Math.abs(scrollVelocity) > SCROLL_DRIVEN_VELOCITY_EPSILON
            && timeSinceInputMs >= SCROLL_DRIVEN_INPUT_SETTLE_MS
        ) {
            applyDrivenDelta(scrollVelocity * safeDeltaSec);
            scrollVelocity *= Math.exp(-SCROLL_DRIVEN_FRICTION * safeDeltaSec);

            if (Math.abs(scrollVelocity) <= SCROLL_DRIVEN_VELOCITY_EPSILON) {
                scrollVelocity = 0;
            }
        }

        applyTiltFromCurrentPhase();
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

    function getDebugState() {
        return {
            active: !!(isActive && cameraController.isActive),
            blockingContext: hasBlockingViewerContext(),
            hasEnabledResponse: hasEnabledScrollDrivenResponse(),
            layerDriverEnabled: !!(ctx.app.textureAnimationEnabled && ctx.app.scrollDrivenLayerCycleEnabled),
            scrollVelocity,
            texturePhaseTurns,
            texturePhasePrimed,
        };
    }

    watch(
        () => ctx.ribbonSeries.value,
        () => {
            cameraController.setRibbonSeries(ctx.ribbonSeries.value);
            undulationPhasePrimed = false;

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
        () => ctx.app.scrollDrivenTiltEnabled,
        (enabled) => {
            if (enabled) {
                return;
            }

            currentPhase = 0;
            cameraController.restoreBaseline?.();
        },
    );

    watch(
        () => ctx.app.scrollDrivenLayerCycleEnabled,
        () => {
            texturePhasePrimed = false;
        },
    );

    watch(
        () => ctx.app.textureAnimationEnabled,
        () => {
            texturePhasePrimed = false;
        },
    );

    watch(
        () => ctx.app.undulationEnabled,
        () => {
            undulationPhasePrimed = false;
        },
    );

    watch(
        () => [
            ctx.app.scrollDrivenTiltEnabled,
            ctx.app.scrollDrivenLayerCycleEnabled,
            ctx.app.scrollDrivenFlowEnabled,
            ctx.app.textureAnimationEnabled,
            ctx.app.undulationEnabled,
            ctx.app.flowState,
        ],
        () => {
            if (!hasEnabledScrollDrivenResponse()) {
                scrollVelocity = 0;
                lastInputTimestampMs = null;
            }
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
        getDebugState,
    };
}