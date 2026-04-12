<script setup>
    import { ref, computed, onUnmounted } from 'vue';
    import { useSlyceStore } from '../../stores/slyceStore';

    const app = useSlyceStore();

    const props = defineProps({
        containerWidth: {
            type: Number,
            required: true
        },
        containerHeight: {
            type: Number,
            required: true
        },
        offsetX: {
            type: Number,
            default: 0
        },
        offsetY: {
            type: Number,
            default: 0
        }
    });

    // Get the actual rotation value (normalized to 0, 90, 180, 270)
    const normalizedRotation = computed(() => {
        const rotation = (app.fileInfo?.rotation || 0) % 360;
        return rotation < 0 ? rotation + 360 : rotation;
    });

    // Check if rotation requires dimension swap (90° or 270° rotations)
    const isRotated90or270 = computed(() => {
        return normalizedRotation.value === 90 || normalizedRotation.value === 270;
    });

    // The video element displays with rotation applied, so we need effective dimensions
    // that match what the user actually sees on screen
    const effectiveVideoWidth = computed(() =>
        isRotated90or270.value ? (app.fileInfo?.height || 1) : (app.fileInfo?.width || 1)
    );
    const effectiveVideoHeight = computed(() =>
        isRotated90or270.value ? (app.fileInfo?.width || 1) : (app.fileInfo?.height || 1)
    );

    // Drag state
    const isDragging = ref(false);
    const dragMode = ref(null); // 'move', 'n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'
    const activePointerId = ref(null);
    const activeTouchId = ref(null);
    const dragStart = ref({ x: 0, y: 0 });
    const dragInitial = ref({ cropX: 0, cropY: 0, cropWidth: 0, cropHeight: 0 });

    // Scale factors to map between effective video size and displayed preview size
    const scaleX = computed(() => props.containerWidth / effectiveVideoWidth.value);
    const scaleY = computed(() => props.containerHeight / effectiveVideoHeight.value);

    // Transform original crop coordinates to display coordinates based on rotation
    const displayCropX = computed(() => {
        const rotation = normalizedRotation.value;
        const origH = app.fileInfo?.height || 0;

        if (rotation === 90) {
            // 90° CW: display X = original Y
            return app.cropY || 0;
        } else if (rotation === 270) {
            // 270° CW (or 90° CCW): display X = origHeight - origY - cropHeight
            return origH - (app.cropY || 0) - (app.cropHeight || 0);
        }
        return app.cropX || 0;
    });

    const displayCropY = computed(() => {
        const rotation = normalizedRotation.value;
        const origW = app.fileInfo?.width || 0;

        if (rotation === 90) {
            // 90° CW: display Y = origWidth - origX - cropWidth
            return origW - (app.cropX || 0) - (app.cropWidth || 0);
        } else if (rotation === 270) {
            // 270° CW: display Y = original X
            return app.cropX || 0;
        }
        return app.cropY || 0;
    });

    const displayCropWidth = computed(() => {
        return isRotated90or270.value ? (app.cropHeight || 0) : (app.cropWidth || 0);
    });

    const displayCropHeight = computed(() => {
        return isRotated90or270.value ? (app.cropWidth || 0) : (app.cropHeight || 0);
    });

    // Scaled crop values for display (in screen pixels)
    const scaledCropX = computed(() => displayCropX.value * scaleX.value);
    const scaledCropY = computed(() => displayCropY.value * scaleY.value);
    const scaledCropWidth = computed(() => displayCropWidth.value * scaleX.value);
    const scaledCropHeight = computed(() => displayCropHeight.value * scaleY.value);

    // Convert display coordinates back to original coordinates for storage
    const setOriginalFromDisplay = (dispX, dispY, dispW, dispH) => {
        const rotation = normalizedRotation.value;
        const origW = app.fileInfo?.width || 0;
        const origH = app.fileInfo?.height || 0;

        if (rotation === 90) {
            // Reverse of 90° CW transformation
            app.cropY = dispX;
            app.cropX = origW - dispY - dispH;
            app.cropHeight = dispW;
            app.cropWidth = dispH;
        } else if (rotation === 270) {
            // Reverse of 270° CW transformation
            app.cropY = origH - dispX - dispW;
            app.cropX = dispY;
            app.cropHeight = dispW;
            app.cropWidth = dispH;
        } else {
            app.cropX = dispX;
            app.cropY = dispY;
            app.cropWidth = dispW;
            app.cropHeight = dispH;
        }
    };

    function beginDrag(mode, clientX, clientY) {
        isDragging.value = true;
        dragMode.value = mode;
        dragStart.value = { x: clientX, y: clientY };
        dragInitial.value = {
            cropX: displayCropX.value,
            cropY: displayCropY.value,
            cropWidth: displayCropWidth.value,
            cropHeight: displayCropHeight.value
        };

        document.body.style.userSelect = 'none';
    }

    function computeDragResult(clientX, clientY) {
        const deltaX = clientX - dragStart.value.x;
        const deltaY = clientY - dragStart.value.y;

        // Convert screen delta to video pixel delta (using effective dimensions)
        const videoDeltaX = Math.round(deltaX / scaleX.value);
        const videoDeltaY = Math.round(deltaY / scaleY.value);

        const maxWidth = effectiveVideoWidth.value;
        const maxHeight = effectiveVideoHeight.value;

        const initial = dragInitial.value;

        let newX = initial.cropX;
        let newY = initial.cropY;
        let newWidth = initial.cropWidth;
        let newHeight = initial.cropHeight;

        if (dragMode.value === 'move') {
            // Move the entire crop region
            newX = initial.cropX + videoDeltaX;
            newY = initial.cropY + videoDeltaY;

            // Clamp to video bounds
            newX = Math.max(0, Math.min(newX, maxWidth - initial.cropWidth));
            newY = Math.max(0, Math.min(newY, maxHeight - initial.cropHeight));
        } else {
            // Resize based on handle
            // Handle horizontal resizing
            if (dragMode.value.includes('w')) {
                newX = Math.max(0, Math.min(initial.cropX + videoDeltaX, initial.cropX + initial.cropWidth - 1));
                newWidth = initial.cropWidth - (newX - initial.cropX);
            }
            if (dragMode.value.includes('e')) {
                newWidth = Math.max(1, Math.min(initial.cropWidth + videoDeltaX, maxWidth - initial.cropX));
            }

            // Handle vertical resizing
            if (dragMode.value.includes('n')) {
                newY = Math.max(0, Math.min(initial.cropY + videoDeltaY, initial.cropY + initial.cropHeight - 1));
                newHeight = initial.cropHeight - (newY - initial.cropY);
            }
            if (dragMode.value.includes('s')) {
                newHeight = Math.max(1, Math.min(initial.cropHeight + videoDeltaY, maxHeight - initial.cropY));
            }
        }

        return {
            deltaX,
            deltaY,
            newX,
            newY,
            newWidth,
            newHeight,
            movedX: newX !== initial.cropX || newWidth !== initial.cropWidth,
            movedY: newY !== initial.cropY || newHeight !== initial.cropHeight,
        };
    }

    function applyDragResult(result) {
        setOriginalFromDisplay(result.newX, result.newY, result.newWidth, result.newHeight);
    }

    function cleanupDragListeners() {
        document.removeEventListener('pointermove', onPointerDrag);
        document.removeEventListener('pointerup', stopPointerDrag);
        document.removeEventListener('pointercancel', stopPointerDrag);
        document.removeEventListener('touchmove', onTouchDrag);
        document.removeEventListener('touchend', stopTouchDrag);
        document.removeEventListener('touchcancel', stopTouchDrag);

        document.body.style.userSelect = '';
    }

    // Drag handlers
    const startPointerDrag = (mode, event) => {
        if (event.pointerType === 'touch') return;

        event.preventDefault();
        if (activePointerId.value !== null || activeTouchId.value !== null) return;

        activePointerId.value = event.pointerId;
        beginDrag(mode, event.clientX, event.clientY);

        if (event.currentTarget?.setPointerCapture) {
            event.currentTarget.setPointerCapture(event.pointerId);
        }

        document.addEventListener('pointermove', onDrag);
        document.addEventListener('pointerup', stopPointerDrag);
        document.addEventListener('pointercancel', stopPointerDrag);
    };

    const startTouchDrag = (mode, event) => {
        if (activeTouchId.value !== null || activePointerId.value !== null) return;

        const touch = event.changedTouches?.[0];
        if (!touch) return;

        if (mode !== 'move') {
            event.preventDefault();
        }

        activeTouchId.value = touch.identifier;
        beginDrag(mode, touch.clientX, touch.clientY);

        document.addEventListener('touchmove', onTouchDrag, { passive: false });
        document.addEventListener('touchend', stopTouchDrag);
        document.addEventListener('touchcancel', stopTouchDrag);
    };

    const onPointerDrag = (event) => {
        if (!isDragging.value || event.pointerId !== activePointerId.value) return;

        event.preventDefault();
        applyDragResult(computeDragResult(event.clientX, event.clientY));
    };

    const onTouchDrag = (event) => {
        if (!isDragging.value || activeTouchId.value === null) return;

        const touch = Array.from(event.changedTouches || []).find((item) => item.identifier === activeTouchId.value)
            || Array.from(event.touches || []).find((item) => item.identifier === activeTouchId.value);

        if (!touch) return;

        const result = computeDragResult(touch.clientX, touch.clientY);
        const totalMotion = Math.abs(result.deltaX) + Math.abs(result.deltaY);

        if (totalMotion < 2) return;

        if (dragMode.value === 'move') {
            const dominantAxis = Math.abs(result.deltaY) >= Math.abs(result.deltaX) ? 'y' : 'x';
            const movedInDominantAxis = dominantAxis === 'y' ? result.movedY : result.movedX;

            if (!movedInDominantAxis) {
                stopTouchDrag();
                return;
            }
        }

        event.preventDefault();
        applyDragResult(result);
    };

    const stopPointerDrag = (event) => {
        if (event && event.pointerId !== activePointerId.value) return;

        isDragging.value = false;
        dragMode.value = null;
        activePointerId.value = null;
        cleanupDragListeners();
    };

    const stopTouchDrag = (event) => {
        if (event && activeTouchId.value !== null) {
            const endedTouch = Array.from(event.changedTouches || []).find((item) => item.identifier === activeTouchId.value);
            if (!endedTouch) return;
        }

        isDragging.value = false;
        dragMode.value = null;
        activeTouchId.value = null;
        cleanupDragListeners();
    };

    onUnmounted(() => {
        activePointerId.value = null;
        activeTouchId.value = null;
        cleanupDragListeners();
    });
</script>

<template>
    <div
        class="crop-overlay-container"
        :style="{
            left: `${props.offsetX}px`,
            top: `${props.offsetY}px`,
            width: `${props.containerWidth}px`,
            height: `${props.containerHeight}px`
        }"
    >
        <!-- Crop overlay -->
        <div
            class="crop-overlay"
            :style="{
                left: `${scaledCropX}px`,
                top: `${scaledCropY}px`,
                width: `${scaledCropWidth}px`,
                height: `${scaledCropHeight}px`
            }"
            @pointerdown="startPointerDrag('move', $event)"
            @touchstart.stop="startTouchDrag('move', $event)"
        >
            <!-- Resize handles -->
            <div
                class="handle handle-nw"
                @pointerdown.stop="startPointerDrag('nw', $event)"
                @touchstart.stop="startTouchDrag('nw', $event)"
            />
            <div
                class="handle handle-ne"
                @pointerdown.stop="startPointerDrag('ne', $event)"
                @touchstart.stop="startTouchDrag('ne', $event)"
            />
            <div
                class="handle handle-sw"
                @pointerdown.stop="startPointerDrag('sw', $event)"
                @touchstart.stop="startTouchDrag('sw', $event)"
            />
            <div
                class="handle handle-se"
                @pointerdown.stop="startPointerDrag('se', $event)"
                @touchstart.stop="startTouchDrag('se', $event)"
            />
            <div
                class="handle handle-n"
                @pointerdown.stop="startPointerDrag('n', $event)"
                @touchstart.stop="startTouchDrag('n', $event)"
            />
            <div
                class="handle handle-s"
                @pointerdown.stop="startPointerDrag('s', $event)"
                @touchstart.stop="startTouchDrag('s', $event)"
            />
            <div
                class="handle handle-e"
                @pointerdown.stop="startPointerDrag('e', $event)"
                @touchstart.stop="startTouchDrag('e', $event)"
            />
            <div
                class="handle handle-w"
                @pointerdown.stop="startPointerDrag('w', $event)"
                @touchstart.stop="startTouchDrag('w', $event)"
            />

            <!-- Dimension label -->
            <div class="crop-dimensions">
                {{ app.cropWidth }} × {{ app.cropHeight }}
            </div>
        </div>
    </div>
</template>

<style scoped>
    .crop-overlay-container {
        position: absolute;
        pointer-events: none;
        overflow: visible;
        z-index: 2;
    }

    .crop-overlay {
        position: absolute;
        --crop-border-width: 2px;
        --crop-handle-size: 1rem;
        border: var(--crop-border-width) dashed #10b981;
        cursor: move;
        box-sizing: border-box;
        pointer-events: auto;
        z-index: 2;
    }

    .handle {
        position: absolute;
        width: var(--crop-handle-size);
        height: var(--crop-handle-size);
        /* background: #10b981;
        border: 1px solid #fff; */
        background: #ffffff;
        border: 3px solid #10b981;

        border-radius: 2px;
        box-sizing: border-box;
        pointer-events: auto;
        touch-action: none;
        z-index: 1;
    }

    .handle-nw {
        top: calc(var(--crop-border-width) * -1);
        left: calc(var(--crop-border-width) * -1);
        cursor: nw-resize;
    }

    .handle-ne {
        top: calc(var(--crop-border-width) * -1);
        right: calc(var(--crop-border-width) * -1);
        cursor: ne-resize;
    }

    .handle-sw {
        bottom: calc(var(--crop-border-width) * -1);
        left: calc(var(--crop-border-width) * -1);
        cursor: sw-resize;
    }

    .handle-se {
        bottom: calc(var(--crop-border-width) * -1);
        right: calc(var(--crop-border-width) * -1);
        cursor: se-resize;
    }

    .handle-n {
        top: calc(var(--crop-border-width) * -1);
        left: 50%;
        transform: translateX(-50%);
        cursor: n-resize;
    }

    .handle-s {
        bottom: calc(var(--crop-border-width) * -1);
        left: 50%;
        transform: translateX(-50%);
        cursor: s-resize;
    }

    .handle-e {
        top: 50%;
        right: calc(var(--crop-border-width) * -1);
        transform: translateY(-50%);
        cursor: e-resize;
    }

    .handle-w {
        top: 50%;
        left: calc(var(--crop-border-width) * -1);
        transform: translateY(-50%);
        cursor: w-resize;
    }

    .crop-dimensions {
        position: absolute;
        top: 1rem;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(16, 185, 129, 0.9);
        color: #fff;
        padding: 2px 8px;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        border-radius: 4px;
    }
</style>
