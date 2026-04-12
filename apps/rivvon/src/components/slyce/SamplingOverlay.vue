<script setup>
    import { ref, computed, onMounted, onUnmounted } from 'vue';
    import { useSlyceStore } from '../../stores/slyceStore';

    const app = useSlyceStore();

    const props = defineProps({
        containerWidth: { type: Number, required: true },
        containerHeight: { type: Number, required: true },
        offsetX: { type: Number, default: 0 },
        offsetY: { type: Number, default: 0 },
        videoPlayer: { type: Object, default: null },
    });

    const canvasRef = ref(null);

    // --- Rotation ---
    const normalizedRotation = computed(() => ((app.fileInfo?.rotation || 0) % 360 + 360) % 360);
    const isRotated = computed(() => normalizedRotation.value === 90 || normalizedRotation.value === 270);

    // --- Display line orientation ---
    // In raw video: 'rows' = horizontal lines, 'columns' = vertical lines
    // After 90/270° rotation the browser swaps axes, so XOR with isRotated
    const isHorizontal = computed(() => (app.samplingAxis === 'rows') !== isRotated.value);

    // --- Effective video dimensions (perceived, post-rotation) ---
    const effectiveVideoW = computed(() => isRotated.value ? (app.fileInfo?.height || 1) : (app.fileInfo?.width || 1));
    const effectiveVideoH = computed(() => isRotated.value ? (app.fileInfo?.width || 1) : (app.fileInfo?.height || 1));

    // Scale from effective video coords to display pixels
    const scaleX = computed(() => props.containerWidth / effectiveVideoW.value);
    const scaleY = computed(() => props.containerHeight / effectiveVideoH.value);

    // --- Bounding region for lines (display coordinates) ---
    // Without crop: full display. With crop: the crop region mapped to display.
    const lineRegion = computed(() => {
        if (!app.cropMode) {
            return { x: 0, y: 0, w: props.containerWidth, h: props.containerHeight };
        }
        // Map crop coordinates to display space (same transform as CropOverlay)
        const rotation = normalizedRotation.value;
        let dx, dy, dw, dh;
        if (rotation === 90) {
            dx = app.cropY || 0;
            dy = (app.fileInfo?.width || 0) - (app.cropX || 0) - (app.cropWidth || 0);
            dw = app.cropHeight || 0;
            dh = app.cropWidth || 0;
        } else if (rotation === 270) {
            dx = (app.fileInfo?.height || 0) - (app.cropY || 0) - (app.cropHeight || 0);
            dy = app.cropX || 0;
            dw = app.cropHeight || 0;
            dh = app.cropWidth || 0;
        } else {
            dx = app.cropX || 0;
            dy = app.cropY || 0;
            dw = app.cropWidth || 0;
            dh = app.cropHeight || 0;
        }
        return {
            x: dx * scaleX.value,
            y: dy * scaleY.value,
            w: dw * scaleX.value,
            h: dh * scaleY.value,
        };
    });

    // --- Frame rate ---
    const frameRate = computed(() => {
        const fr = app.fileInfo?.r_frame_rate;
        if (!fr) return 30;
        if (typeof fr === 'string' && fr.includes('/')) {
            const [num, den] = fr.split('/').map(Number);
            return den ? num / den : 30;
        }
        return Number(fr) || 30;
    });

    // --- Frames used by the tile plan (same as videoProcessor's framesUsed) ---
    const framesUsed = computed(() => {
        const effectiveFrameCount = app.framesToSample > 0
            ? Math.min(app.framesToSample, app.frameCount)
            : app.frameCount;
        const pot = app.potResolution || 256;
        return Math.floor(effectiveFrameCount / pot) * pot;
    });

    // --- Planes positions (cosine distribution, normalized 0–1) ---
    function computePlanesPositions(count) {
        if (count <= 0) return [];
        if (count === 1) return [0.5];
        const positions = new Array(count);
        for (let i = 0; i < count; i++) {
            const t = (i / (count - 1)) * Math.PI;
            positions[i] = (Math.cos(t) + 1) / 2;
        }
        return positions;
    }

    // --- Wave positions for a given video time ---
    function computeWavePositions(count, currentTime) {
        const fc = framesUsed.value;
        if (fc <= 0) return new Array(count).fill(0.5);

        const omega = (2 * Math.PI) / fc;
        const currentFrame = Math.round(currentTime * frameRate.value);
        // Mirror tileBuilder: globalIndex = min(frameNumber, frameCount) - 1
        const globalIndex = Math.max(0, Math.min(currentFrame, fc) - 1);

        const positions = new Array(count);
        for (let i = 0; i < count; i++) {
            const phaseShift = (2 * Math.PI * i) / count;
            positions[i] = Math.max(0, Math.min(1,
                0.5 * Math.sin(omega * globalIndex + phaseShift) + 0.5
            ));
        }
        return positions;
    }

    // --- Drawing ---
    let cachedCtx = null;

    function ensureCanvasSize() {
        const canvas = canvasRef.value;
        if (!canvas) return false;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(props.containerWidth * dpr);
        const h = Math.round(props.containerHeight * dpr);
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
            cachedCtx = canvas.getContext('2d');
            cachedCtx.scale(dpr, dpr);
        }
        return !!cachedCtx;
    }

    function draw() {
        if (!ensureCanvasSize()) return;
        const ctx = cachedCtx;
        const w = props.containerWidth;
        const h = props.containerHeight;
        ctx.clearRect(0, 0, w, h);

        const count = app.crossSectionCount || 0;
        if (count <= 0) return;

        const isWaves = app.crossSectionType !== 'planes';

        // Compute normalized positions (0–1)
        let positions;
        if (!isWaves) {
            positions = computePlanesPositions(count);
        } else {
            const videoEl = props.videoPlayer?.videoElement;
            const currentTime = videoEl ? videoEl.currentTime : 0;
            positions = computeWavePositions(count, currentTime);
        }

        const region = lineRegion.value;
        const horizontal = isHorizontal.value;

        ctx.lineWidth = 1;

        if (isWaves) {
            // White → light-green gradient across cross-sections (first to last)
            for (let i = 0; i < positions.length; i++) {
                const frac = positions[i];
                const t = count > 1 ? i / (count - 1) : 0;
                const r = Math.round(255 - t * 111); // 255 → 144
                const g = Math.round(255 - t * 17);  // 255 → 238
                const b = Math.round(255 - t * 111); // 255 → 144
                ctx.strokeStyle = `rgba(${r},${g},${b},0.8)`;
                ctx.beginPath();
                if (horizontal) {
                    const y = region.y + frac * region.h;
                    ctx.moveTo(region.x, y);
                    ctx.lineTo(region.x + region.w, y);
                } else {
                    const x = region.x + frac * region.w;
                    ctx.moveTo(x, region.y);
                    ctx.lineTo(x, region.y + region.h);
                }
                ctx.stroke();
            }
        } else {
            // Planes: shimmer white lines with cycling opacity
            const now = performance.now() / 1000;
            for (let i = 0; i < positions.length; i++) {
                const frac = positions[i];
                const phase = (i / count) * Math.PI * 2;
                const opacity = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(now * 2 + phase));
                ctx.strokeStyle = `rgba(255,255,255,${opacity.toFixed(3)})`;
                ctx.beginPath();
                if (horizontal) {
                    const y = region.y + frac * region.h;
                    ctx.moveTo(region.x, y);
                    ctx.lineTo(region.x + region.w, y);
                } else {
                    const x = region.x + frac * region.w;
                    ctx.moveTo(x, region.y);
                    ctx.lineTo(x, region.y + region.h);
                }
                ctx.stroke();
            }
        }
    }

    // --- Animation loop ---
    let animFrameId = null;

    function animationLoop() {
        draw();
        animFrameId = requestAnimationFrame(animationLoop);
    }

    onMounted(() => {
        animFrameId = requestAnimationFrame(animationLoop);
    });

    onUnmounted(() => {
        if (animFrameId != null) cancelAnimationFrame(animFrameId);
    });
</script>

<template>
    <canvas
        ref="canvasRef"
        class="sampling-overlay"
        :style="{
            left: `${offsetX}px`,
            top: `${offsetY}px`,
            width: `${containerWidth}px`,
            height: `${containerHeight}px`
        }"
    />
</template>

<style scoped>
    .sampling-overlay {
        position: absolute;
        pointer-events: none;
        z-index: 1;
    }
</style>
