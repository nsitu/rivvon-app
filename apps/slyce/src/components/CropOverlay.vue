<script setup>
    import { ref, computed, onUnmounted } from 'vue';
    import { useAppStore } from '../stores/appStore';

    const app = useAppStore();

    const props = defineProps({
        containerWidth: {
            type: Number,
            required: true
        },
        containerHeight: {
            type: Number,
            required: true
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

    // Drag handlers
    const startDrag = (mode, event) => {
        isDragging.value = true;
        dragMode.value = mode;
        dragStart.value = { x: event.clientX, y: event.clientY };
        dragInitial.value = {
            cropX: displayCropX.value,
            cropY: displayCropY.value,
            cropWidth: displayCropWidth.value,
            cropHeight: displayCropHeight.value
        };

        // Prevent text selection during drag
        document.body.style.userSelect = 'none';

        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', stopDrag);
    };

    const onDrag = (event) => {
        if (!isDragging.value) return;

        const deltaX = event.clientX - dragStart.value.x;
        const deltaY = event.clientY - dragStart.value.y;

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

        // Convert display coordinates back to original and store
        setOriginalFromDisplay(newX, newY, newWidth, newHeight);
    };

    const stopDrag = () => {
        isDragging.value = false;
        dragMode.value = null;
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', stopDrag);
    };

    onUnmounted(() => {
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', stopDrag);
    });
</script>

<template>
    <div
        class="crop-overlay-container"
        :style="{
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
            @mousedown="startDrag('move', $event)"
        >
            <!-- Resize handles -->
            <div
                class="handle handle-nw"
                @mousedown.stop="startDrag('nw', $event)"
            />
            <div
                class="handle handle-ne"
                @mousedown.stop="startDrag('ne', $event)"
            />
            <div
                class="handle handle-sw"
                @mousedown.stop="startDrag('sw', $event)"
            />
            <div
                class="handle handle-se"
                @mousedown.stop="startDrag('se', $event)"
            />
            <div
                class="handle handle-n"
                @mousedown.stop="startDrag('n', $event)"
            />
            <div
                class="handle handle-s"
                @mousedown.stop="startDrag('s', $event)"
            />
            <div
                class="handle handle-e"
                @mousedown.stop="startDrag('e', $event)"
            />
            <div
                class="handle handle-w"
                @mousedown.stop="startDrag('w', $event)"
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
        top: 0;
        left: 0;
        pointer-events: none;
    }

    .crop-overlay {
        position: absolute;
        border: 2px dashed #10b981;
        cursor: move;
        box-sizing: border-box;
        pointer-events: auto;
    }

    .handle {
        position: absolute;
        width: 10px;
        height: 10px;
        background: #10b981;
        border: 1px solid #fff;
        border-radius: 2px;
        pointer-events: auto;
    }

    .handle-nw {
        top: -5px;
        left: -5px;
        cursor: nw-resize;
    }

    .handle-ne {
        top: -5px;
        right: -5px;
        cursor: ne-resize;
    }

    .handle-sw {
        bottom: -5px;
        left: -5px;
        cursor: sw-resize;
    }

    .handle-se {
        bottom: -5px;
        right: -5px;
        cursor: se-resize;
    }

    .handle-n {
        top: -5px;
        left: 50%;
        transform: translateX(-50%);
        cursor: n-resize;
    }

    .handle-s {
        bottom: -5px;
        left: 50%;
        transform: translateX(-50%);
        cursor: s-resize;
    }

    .handle-e {
        top: 50%;
        right: -5px;
        transform: translateY(-50%);
        cursor: e-resize;
    }

    .handle-w {
        top: 50%;
        left: -5px;
        transform: translateY(-50%);
        cursor: w-resize;
    }

    .crop-dimensions {
        position: absolute;
        top: 8px;
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
