<script setup>
    import { computed, onUnmounted, ref, watch } from 'vue';
    import { MathUtils } from 'three';
    import DebugOverlayFrame from './DebugOverlayFrame.vue';

    const MIN_AXIS_RANGES = {
        yaw: MathUtils.degToRad(12),
        pitch: MathUtils.degToRad(10),
        roll: MathUtils.degToRad(12),
    };

    const props = defineProps({
        headTracking: { type: Object, default: null },
        visible: { type: Boolean, default: false },
    });

    const metricsText = ref('');
    const snapshot = ref(null);

    let animFrameId = null;

    function clamp01(value) {
        return Math.min(Math.max(value, 0), 1);
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function formatSigned(value, digits = 2) {
        if (!Number.isFinite(value)) return 'n/a';
        return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
    }

    function formatDegrees(value) {
        if (!Number.isFinite(value)) return 'n/a';
        const deg = MathUtils.radToDeg(value);
        return `${deg >= 0 ? '+' : ''}${deg.toFixed(1)}°`;
    }

    function formatPercent(value) {
        if (!Number.isFinite(value)) return 'n/a';
        return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
    }

    function formatFactor(value) {
        if (!Number.isFinite(value)) return 'n/a';
        return `${value.toFixed(3)}x`;
    }

    function createBarStyle(value, limit) {
        if (!Number.isFinite(value) || !Number.isFinite(limit) || limit <= 0) {
            return { left: '50%', width: '0%' };
        }

        const magnitude = clamp01(Math.abs(value) / limit) * 50;
        return {
            left: value >= 0 ? '50%' : `${50 - magnitude}%`,
            width: `${magnitude}%`,
        };
    }

    function resolveAxisRange(inputValue, outputValue, minimumRange) {
        const maxMagnitude = Math.max(
            Math.abs(inputValue ?? 0),
            Math.abs(outputValue ?? 0),
            minimumRange,
        );

        return maxMagnitude * 1.08;
    }

    function formatMetrics(currentSnapshot) {
        if (!currentSnapshot) return '';

        const pose = currentSnapshot.pose;
        const raw = pose?.raw;
        const mapped = currentSnapshot.mappedInput;
        const controller = currentSnapshot.controller;

        return [
            `state  ${currentSnapshot.errorMessage ? 'error' : currentSnapshot.calibrating ? 'calibrating' : currentSnapshot.active ? 'active' : currentSnapshot.selected ? 'starting' : 'inactive'}  detect ${currentSnapshot.detectionStatus}${currentSnapshot.faceDetected ? '  face yes' : '  face no'}`,
            `video  ${currentSnapshot.video?.videoWidth ?? 0}x${currentSnapshot.video?.videoHeight ?? 0}  ready ${currentSnapshot.video?.readyState ?? 0}  t ${currentSnapshot.video?.currentTime?.toFixed?.(3) ?? '0.000'}s`,
            `face   center (${formatSigned(raw?.frameCenter?.x)}, ${formatSigned(raw?.frameCenter?.y)})  pos (${formatSigned(raw?.position?.x)}, ${formatSigned(raw?.position?.y)}, ${formatSigned(raw?.position?.z)})`,
            `frame  delta (${formatSigned(mapped?.frameX)}, ${formatSigned(mapped?.frameY)})  postdz (${formatSigned(controller?.effective?.frameX)}, ${formatSigned(controller?.effective?.frameY)})`,
            `pose   yaw ${formatDegrees(pose?.yaw)}  pitch ${formatDegrees(pose?.pitch)}  roll ${formatDegrees(pose?.roll)}  scale ${pose?.scale?.toFixed?.(4) ?? 'n/a'}  src ${raw?.source ?? 'n/a'}`,
            `delta  yaw ${formatDegrees(mapped?.yaw)}  pitch ${formatDegrees(mapped?.pitch)}  roll ${formatDegrees(mapped?.roll)}  scale ${formatPercent(mapped?.scaleDelta)}`,
            `postdz yaw ${formatDegrees(controller?.effective?.yaw)}  pitch ${formatDegrees(controller?.effective?.pitch)}  roll ${formatDegrees(controller?.effective?.roll)}  scale ${formatPercent(controller?.effective?.scaleDelta)}`,
            `map    ribbon rot (${formatDegrees(controller?.mapped?.ribbonYaw)}, ${formatDegrees(controller?.mapped?.ribbonPitch)}, ${formatDegrees(controller?.mapped?.ribbonRoll)})`,
            `move   ribbon pos (${formatSigned(controller?.mapped?.ribbonTranslateX)}, ${formatSigned(controller?.mapped?.ribbonTranslateY)})  world (${formatSigned(controller?.mapped?.worldOffsetX)}, ${formatSigned(controller?.mapped?.worldOffsetY)})  dolly ${formatFactor(controller?.mapped?.dollyFactor)}`,
            `cam    dist ${controller?.currentDistance?.toFixed?.(3) ?? 'n/a'} / ${controller?.baselineDistance?.toFixed?.(3) ?? 'n/a'}  calib ${currentSnapshot.calibrationStableFrames}/${currentSnapshot.calibrationTargetFrames}`,
            currentSnapshot.statusMessage ? `note   ${currentSnapshot.statusMessage}` : '',
        ].filter(Boolean).join('\n');
    }

    const stateChip = computed(() => {
        if (snapshot.value?.errorMessage) {
            return { label: 'Error', className: 'is-error' };
        }
        if (snapshot.value?.calibrating) {
            return { label: 'Calibrating', className: 'is-calibrating' };
        }
        if (snapshot.value?.active) {
            return { label: 'Active', className: 'is-active' };
        }
        if (snapshot.value?.selected) {
            return { label: 'Starting', className: 'is-muted' };
        }
        return { label: 'Idle', className: 'is-muted' };
    });

    const sourceLabel = computed(() => {
        const source = snapshot.value?.pose?.raw?.source;
        return source ? `source: ${source}` : 'source: none';
    });

    const calibrationProgress = computed(() => {
        const stableFrames = snapshot.value?.calibrationStableFrames ?? 0;
        const targetFrames = snapshot.value?.calibrationTargetFrames ?? 1;
        return `${clamp01(stableFrames / targetFrames) * 100}%`;
    });

    const faceMarkerStyle = computed(() => {
        const center = snapshot.value?.pose?.raw?.frameCenter ?? { x: 0, y: 0 };
        const neutralScale = snapshot.value?.neutralScale ?? 0;
        const poseScale = snapshot.value?.pose?.scale ?? 0;
        const relativeScale = neutralScale > 0 ? (poseScale / neutralScale) : 1;
        const size = 18 + (clamp(relativeScale, 0.4, 1.8) - 0.4) / 1.4 * 28;

        return {
            left: `${((clamp(center.x, -1, 1) + 1) / 2) * 100}%`,
            top: `${((1 - clamp(center.y, -1, 1)) / 2) * 100}%`,
            width: `${size}px`,
            height: `${size}px`,
        };
    });

    const axisRows = computed(() => {
        const mapped = snapshot.value?.mappedInput ?? {};
        const controller = snapshot.value?.controller ?? {};
        const controllerMapped = controller.mapped ?? {};
        const yawRange = resolveAxisRange(mapped.yaw, controllerMapped.ribbonYaw, MIN_AXIS_RANGES.yaw);
        const pitchRange = resolveAxisRange(mapped.pitch, controllerMapped.ribbonPitch, MIN_AXIS_RANGES.pitch);
        const rollRange = resolveAxisRange(mapped.roll, controllerMapped.ribbonRoll, MIN_AXIS_RANGES.roll);

        return [
            {
                key: 'yaw',
                label: 'Yaw',
                inputText: formatDegrees(mapped.yaw),
                outputText: formatDegrees(controllerMapped.ribbonYaw),
                inputStyle: createBarStyle(mapped.yaw ?? 0, yawRange),
                outputStyle: createBarStyle(controllerMapped.ribbonYaw ?? 0, yawRange),
            },
            {
                key: 'pitch',
                label: 'Pitch',
                inputText: formatDegrees(mapped.pitch),
                outputText: formatDegrees(controllerMapped.ribbonPitch),
                inputStyle: createBarStyle(mapped.pitch ?? 0, pitchRange),
                outputStyle: createBarStyle(controllerMapped.ribbonPitch ?? 0, pitchRange),
            },
            {
                key: 'roll',
                label: 'Roll',
                inputText: formatDegrees(mapped.roll),
                outputText: formatDegrees(controllerMapped.ribbonRoll),
                inputStyle: createBarStyle(mapped.roll ?? 0, rollRange),
                outputStyle: createBarStyle(controllerMapped.ribbonRoll ?? 0, rollRange),
            },
        ];
    });

    const scaleSummary = computed(() => ({
        input: formatPercent(snapshot.value?.mappedInput?.scaleDelta),
        output: formatFactor(snapshot.value?.controller?.mapped?.dollyFactor),
        distance: snapshot.value?.controller?.currentDistance?.toFixed?.(3) ?? 'n/a',
        baseline: snapshot.value?.controller?.baselineDistance?.toFixed?.(3) ?? 'n/a',
    }));

    const positionSummary = computed(() => ({
        frame: `${formatSigned(snapshot.value?.mappedInput?.frameX)} / ${formatSigned(snapshot.value?.mappedInput?.frameY)}`,
        ribbon: `${formatSigned(snapshot.value?.controller?.mapped?.ribbonTranslateX)} / ${formatSigned(snapshot.value?.controller?.mapped?.ribbonTranslateY)}`,
        world: `${formatSigned(snapshot.value?.controller?.mapped?.worldOffsetX)} / ${formatSigned(snapshot.value?.controller?.mapped?.worldOffsetY)}`,
    }));

    function tick() {
        if (!props.visible || !props.headTracking) {
            metricsText.value = '';
            snapshot.value = null;
            return;
        }

        const nextSnapshot = props.headTracking.getDebugSnapshot?.() ?? null;
        snapshot.value = nextSnapshot;
        metricsText.value = formatMetrics(nextSnapshot);

        animFrameId = requestAnimationFrame(tick);
    }

    function startLoop() {
        stopLoop();
        animFrameId = requestAnimationFrame(tick);
    }

    function stopLoop() {
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }

        metricsText.value = '';
        snapshot.value = null;
    }

    watch(
        () => props.visible,
        (isVisible) => {
            if (isVisible) {
                startLoop();
                return;
            }

            stopLoop();
        },
        { immediate: true }
    );

    onUnmounted(() => {
        stopLoop();
    });
</script>

<template>
    <DebugOverlayFrame
        :visible="visible"
        title="Head Tracking"
        :metrics-text="metricsText"
    >
        <div class="head-tracking-panel">
            <section class="head-tracking-card">
                <div class="card-header">
                    <span class="card-title">Face Frame</span>
                    <span
                        class="state-chip"
                        :class="stateChip.className"
                    >{{ stateChip.label }}</span>
                </div>

                <div class="face-frame">
                    <div class="face-frame-grid"></div>
                    <div class="face-frame-crosshair is-horizontal"></div>
                    <div class="face-frame-crosshair is-vertical"></div>
                    <div
                        class="face-marker"
                        :style="faceMarkerStyle"
                    >
                        <span class="face-marker-core"></span>
                    </div>
                </div>

                <div class="card-footer">
                    <span>{{ sourceLabel }}</span>
                    <span>delta: {{ positionSummary.frame }}</span>
                    <div class="calibration-meter">
                        <span class="calibration-label">calibration</span>
                        <div class="calibration-track">
                            <div
                                class="calibration-fill"
                                :style="{ width: calibrationProgress }"
                            ></div>
                        </div>
                    </div>
                </div>
            </section>

            <section class="head-tracking-card mapping-card">
                <div class="card-header">
                    <span class="card-title">Ribbon Mapping</span>
                    <span class="legend">input / ribbon</span>
                </div>

                <div
                    v-for="axis in axisRows"
                    :key="axis.key"
                    class="axis-row"
                >
                    <div class="axis-header">
                        <span>{{ axis.label }}</span>
                        <span>{{ axis.inputText }} → {{ axis.outputText }}</span>
                    </div>
                    <div class="axis-meter">
                        <div class="axis-center"></div>
                        <div
                            class="axis-bar axis-input"
                            :style="axis.inputStyle"
                        ></div>
                        <div
                            class="axis-bar axis-output"
                            :style="axis.outputStyle"
                        ></div>
                    </div>
                </div>

                <div class="scale-summary">
                    <div class="scale-summary-item is-wide">
                        <span class="scale-label">Frame Delta</span>
                        <strong>{{ positionSummary.frame }}</strong>
                    </div>
                    <div class="scale-summary-item is-wide">
                        <span class="scale-label">Ribbon Shift</span>
                        <strong>{{ positionSummary.ribbon }}</strong>
                    </div>
                    <div class="scale-summary-item is-wide">
                        <span class="scale-label">World Offset</span>
                        <strong>{{ positionSummary.world }}</strong>
                    </div>
                    <div class="scale-summary-item">
                        <span class="scale-label">Scale Delta</span>
                        <strong>{{ scaleSummary.input }}</strong>
                    </div>
                    <div class="scale-summary-item">
                        <span class="scale-label">Camera Dolly</span>
                        <strong>{{ scaleSummary.output }}</strong>
                    </div>
                    <div class="scale-summary-item is-wide">
                        <span class="scale-label">Distance</span>
                        <strong>{{ scaleSummary.distance }} / {{ scaleSummary.baseline }}</strong>
                    </div>
                </div>
            </section>
        </div>
    </DebugOverlayFrame>
</template>

<style scoped>
    .head-tracking-panel {
        display: grid;
        grid-template-columns: 180px minmax(0, 1fr);
        gap: 8px;
        width: 520px;
    }

    .head-tracking-card {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(6px);
        color: rgba(255, 255, 255, 0.82);
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        font-size: 11px;
    }

    .mapping-card {
        min-width: 0;
    }

    .card-header,
    .card-footer,
    .axis-header,
    .scale-summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
    }

    .card-title,
    .legend,
    .scale-label,
    .calibration-label {
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 10px;
        color: rgba(255, 255, 255, 0.62);
    }

    .state-chip {
        padding: 3px 8px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        border: 1px solid rgba(255, 255, 255, 0.14);
    }

    .state-chip.is-active {
        color: #7ef4c1;
        background: rgba(13, 74, 56, 0.52);
    }

    .state-chip.is-calibrating {
        color: #ffd17d;
        background: rgba(98, 61, 5, 0.48);
    }

    .state-chip.is-error {
        color: #ff9e9e;
        background: rgba(106, 18, 18, 0.45);
    }

    .state-chip.is-muted {
        color: rgba(255, 255, 255, 0.68);
        background: rgba(255, 255, 255, 0.08);
    }

    .face-frame {
        position: relative;
        aspect-ratio: 1;
        border-radius: 8px;
        overflow: hidden;
        background:
            radial-gradient(circle at center, rgba(114, 187, 255, 0.09), transparent 58%),
            linear-gradient(135deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.01));
        border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .face-frame-grid {
        position: absolute;
        inset: 0;
        background-image:
            linear-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.08) 1px, transparent 1px);
        background-size: 33.333% 33.333%;
        opacity: 0.45;
    }

    .face-frame-crosshair {
        position: absolute;
        background: rgba(255, 255, 255, 0.18);
    }

    .face-frame-crosshair.is-horizontal {
        left: 0;
        right: 0;
        top: 50%;
        height: 1px;
        transform: translateY(-0.5px);
    }

    .face-frame-crosshair.is-vertical {
        top: 0;
        bottom: 0;
        left: 50%;
        width: 1px;
        transform: translateX(-0.5px);
    }

    .face-marker {
        position: absolute;
        display: grid;
        place-items: center;
        border: 1px solid rgba(126, 244, 193, 0.8);
        border-radius: 50%;
        background: rgba(126, 244, 193, 0.12);
        box-shadow: 0 0 0 1px rgba(126, 244, 193, 0.18) inset;
        transform: translate(-50%, -50%);
    }

    .face-marker-core {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #7ef4c1;
        box-shadow: 0 0 18px rgba(126, 244, 193, 0.55);
    }

    .card-footer {
        align-items: flex-start;
        flex-direction: column;
        gap: 8px;
    }

    .calibration-meter {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .calibration-track,
    .axis-meter {
        position: relative;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
    }

    .calibration-track {
        height: 6px;
    }

    .calibration-fill {
        position: absolute;
        inset: 0 auto 0 0;
        background: linear-gradient(90deg, #ffd17d, #7ef4c1);
    }

    .axis-row {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .axis-meter {
        height: 18px;
    }

    .axis-center {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 50%;
        width: 1px;
        background: rgba(255, 255, 255, 0.18);
        transform: translateX(-0.5px);
    }

    .axis-bar {
        position: absolute;
        top: 50%;
        height: 100%;
        transform: translateY(-50%);
        border-radius: 999px;
    }

    .axis-input {
        background: rgba(114, 187, 255, 0.3);
    }

    .axis-output {
        top: 3px;
        bottom: 3px;
        height: auto;
        background: linear-gradient(90deg, rgba(255, 209, 125, 0.95), rgba(255, 143, 103, 0.95));
        transform: none;
    }

    .scale-summary {
        flex-wrap: wrap;
        margin-top: 4px;
        padding-top: 8px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
    }

    .scale-summary-item {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 92px;
    }

    .scale-summary-item.is-wide {
        min-width: 140px;
    }

    @media (max-width: 720px) {
        .head-tracking-panel {
            width: min(92vw, 520px);
            grid-template-columns: 1fr;
        }
    }
</style>