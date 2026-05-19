<script setup>
    import { ref, computed, watch, onUnmounted } from 'vue';
    import TechnicalOverlayFrame from './TechnicalOverlayFrame.vue';
    import { useViewerStore } from '../../stores/viewerStore';
    import { getStorageUsage } from '../../services/localStorage.js';
    import { getJsHeapTelemetry } from '../../utils/memory-utils.js';

    const app = useViewerStore();

    const props = defineProps({
        visible: { type: Boolean, default: false },
        fps: { type: Number, default: 0 },
        perfTelemetry: { type: Object, default: null },
    });

    const storageMB = ref(null);
    const heapTelemetry = ref(null);
    let pollTimer = null;

    const SPARKLINE_WIDTH = 132;
    const SPARKLINE_HEIGHT = 36;
    const SPARKLINE_PADDING = 3;

    function updateHeapTelemetry() {
        heapTelemetry.value = getJsHeapTelemetry();
    }

    async function updateDiagnostics() {
        updateHeapTelemetry();

        const { used } = await getStorageUsage();
        storageMB.value = (used / (1024 * 1024)).toFixed(1);
    }

    watch(() => props.visible, (vis) => {
        if (vis) {
            updateDiagnostics();
            pollTimer = setInterval(updateDiagnostics, 5000);
        } else {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }, { immediate: true });

    onUnmounted(() => clearInterval(pollTimer));

    function formatMs(value) {
        return Number.isFinite(value) ? `${value.toFixed(1)} ms` : 'n/a';
    }

    function formatSeconds(value) {
        return Number.isFinite(value) && value > 0 ? `${value.toFixed(2)} s` : 'n/a';
    }

    function formatAge(value) {
        if (!Number.isFinite(value) || value == null) {
            return 'n/a';
        }

        if (value < 1000) {
            return `${Math.round(value)} ms`;
        }

        return `${(value / 1000).toFixed(2)} s`;
    }

    function formatFlowSpeed(value) {
        if (!Number.isFinite(value) || value === 0) {
            return '0.00 t/s';
        }

        return `${value > 0 ? '+' : ''}${value.toFixed(2)} t/s`;
    }

    function formatFlowOffset(value) {
        return Number.isFinite(value) ? value.toFixed(3) : '0.000';
    }

    function formatTurnsPerSecond(value) {
        if (!Number.isFinite(value) || value === 0) {
            return '0.000 t/s';
        }

        return `${value > 0 ? '+' : ''}${value.toFixed(3)} t/s`;
    }

    function formatDirection(value) {
        return value < 0 ? 'rev' : 'fwd';
    }

    function formatHeapTelemetry(heap) {
        if (!heap) {
            return 'n/a';
        }

        return `used ${heap.usedMB.toFixed(1)} MB | total ${heap.totalMB.toFixed(1)} MB | limit ${heap.limitMB.toFixed(0)} MB`;
    }

    const sparkline = computed(() => {
        const history = Array.isArray(props.perfTelemetry?.fpsHistory)
            ? props.perfTelemetry.fpsHistory.filter(value => Number.isFinite(value))
            : [];

        if (history.length === 0) {
            return null;
        }

        const minValue = Math.min(...history, 30);
        const maxValue = Math.max(...history, 60);
        const range = Math.max(1, maxValue - minValue);
        const valueToY = (value) => {
            const normalized = (value - minValue) / range;
            return SPARKLINE_HEIGHT - SPARKLINE_PADDING - (normalized * (SPARKLINE_HEIGHT - SPARKLINE_PADDING * 2));
        };
        const points = history.map((value, index) => {
            const x = history.length === 1
                ? SPARKLINE_WIDTH / 2
                : (index / (history.length - 1)) * SPARKLINE_WIDTH;
            return `${x.toFixed(1)},${valueToY(value).toFixed(1)}`;
        }).join(' ');
        const latest = history[history.length - 1] ?? 0;
        const state = latest >= 56 ? 'ok' : (latest >= 48 ? 'warn' : 'bad');

        return {
            points,
            latest,
            minLabel: Math.round(minValue),
            maxLabel: Math.round(maxValue),
            targetY: valueToY(60),
            warningY: valueToY(45),
            state,
        };
    });

    const metricsText = computed(() => {
        const perf = props.perfTelemetry ?? {};
        const wrapSummary = perf.wrapEventsTotal
            ? `${formatAge(perf.lastWrapAgeMs)} ago | ${perf.lastWrapTiles > 0 ? '+' : ''}${perf.lastWrapTiles} tile | ${perf.lastWrapMaterialCount || 0} seg | ${formatMs(perf.lastWrapFlowUpdateMs)}`
            : 'none yet';
        const wrapCadence = perf.lastWrapIntervalMs
            ? ` | cadence ${formatAge(perf.lastWrapIntervalMs)}`
            : '';
        const cycleMultiple = perf.flowCycleMultiple ? ` | x${perf.flowCycleMultiple}` : '';
        const flowAlignState = perf.flowAlignmentEnabled
            ? (perf.flowAlignmentCapable ? (perf.flowAligned ? 'aligned' : 'native') : 'manual')
            : 'off';
        const layerControlState = perf.suppressLayerAnimation
            ? 'scroll'
            : (perf.textureAnimationEnabled ? 'auto' : 'off');
        const layerRuntimeState = perf.internalLayerAnimationEnabled ? 'tm-on' : 'tm-off';
        const lines = [
            `FPS       ${props.fps}`,
            `Frame     ${formatMs(perf.avgFrameMs)} avg | ${formatMs(perf.maxFrameMs)} max`,
            `Phases    tick ${formatMs(perf.avgTileTickMs)} | flow ${formatMs(perf.avgFlowUpdateMs)} | render ${formatMs(perf.avgRenderMs)}`,
            `Wrap      ${wrapSummary}${wrapCadence}`,
            `Period    tile ${formatSeconds(perf.tileWrapPeriod)} | tex ${formatSeconds(perf.textureCyclePeriod)} | flow ${formatSeconds(perf.flowCyclePeriod)}${cycleMultiple}`,
            `Texture   ${perf.effectiveTileCount || 0} cycle tiles | ${perf.layerCount || 0} layers | ${perf.repeatMode || 'wrap'}`,
            `Cycle     ${layerControlState} ${layerRuntimeState} | layer ${perf.currentLayer || 0}/${Math.max((perf.layerCount || 1) - 1, 0)} | frame ${perf.layerCycleFrame || 0}/${Math.max((perf.layerCycleFrameCount || 1) - 1, 0)} | ${formatDirection(perf.layerDirection)}`,
            `Changes   ${perf.layerChangeCount || 0} total | last ${formatAge(perf.lastLayerChangeAgeMs)}`,
            `Source    ${perf.textureSourceLabel || 'default'} | ${perf.textureVariant || 'unknown'} | expected ${perf.expectedLayerCount || 0} | decoded ${perf.decodedDepthLabel || 'n/a'}`,
            `Decode    array ${perf.arrayTextureCount || 0} | other ${perf.nonArrayTextureCount || 0} | metadata fallback ${perf.metadataFallbackCount || 0}`,
            `Control   ${perf.viewerControlMode || 'orbit'} | tilt ${perf.scrollDrivenTiltEnabled ? 'on' : 'off'} | layer ${perf.scrollDrivenLayerCycleEnabled ? 'on' : 'off'} | flow ${perf.scrollDrivenFlowEnabled ? 'on' : 'off'}`,
            `Scroll    ${perf.scrollTiltActive ? 'active' : 'idle'} | block ${perf.scrollTiltBlockingContext ? 'yes' : 'no'} | vel ${formatTurnsPerSecond(perf.scrollTiltVelocity)}`,
            `Flow      ${perf.flowEnabled ? 'on' : 'off'} ${formatFlowSpeed(perf.flowSpeed)} | frac ${formatFlowOffset(perf.flowOffset)} | tile ${perf.tileFlowOffset ?? 0}`,
            `Align     ${flowAlignState} | wraps ${perf.wrapEventsTotal || 0} total | ${perf.activeFlowMaterialCount || 0} active | ${perf.cachedFlowMaterialCount || 0} cached`,
            `Heap      ${formatHeapTelemetry(heapTelemetry.value)}`,
            `Renderer  ${app.rendererType.toUpperCase()}`
        ];
        if (storageMB.value !== null) {
            lines.push(`Storage   ${storageMB.value} MB`);
        }
        return lines.join('\n');
    });
</script>

<template>
    <TechnicalOverlayFrame
        :visible="visible"
        :metrics-text="metricsText"
    >
        <div
            v-if="sparkline"
            class="fps-sparkline"
        >
            <div class="fps-sparkline-header">
                <span class="fps-sparkline-title">FPS Trend</span>
                <span class="fps-sparkline-value">{{ sparkline.latest }}</span>
            </div>

            <svg
                class="fps-sparkline-chart"
                :viewBox="`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`"
                preserveAspectRatio="none"
                aria-hidden="true"
            >
                <line
                    class="fps-sparkline-guide fps-sparkline-guide--target"
                    x1="0"
                    :y1="sparkline.targetY"
                    :x2="SPARKLINE_WIDTH"
                    :y2="sparkline.targetY"
                />
                <line
                    class="fps-sparkline-guide fps-sparkline-guide--warning"
                    x1="0"
                    :y1="sparkline.warningY"
                    :x2="SPARKLINE_WIDTH"
                    :y2="sparkline.warningY"
                />
                <polyline
                    :class="['fps-sparkline-line', `fps-sparkline-line--${sparkline.state}`]"
                    :points="sparkline.points"
                />
            </svg>

            <div class="fps-sparkline-scale">
                <span>{{ sparkline.maxLabel }}</span>
                <span>{{ sparkline.minLabel }}</span>
            </div>
        </div>
    </TechnicalOverlayFrame>
</template>

<style scoped>
    .fps-sparkline {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        min-width: 0;
        width: 100%;
        padding: 0.55rem 0.7rem 0.6rem;
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(6px);
    }

    .fps-sparkline-header,
    .fps-sparkline-scale {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        font-size: 10px;
        color: rgba(255, 255, 255, 0.72);
        letter-spacing: 0.05em;
        text-transform: uppercase;
    }

    .fps-sparkline-title {
        color: rgba(255, 255, 255, 0.82);
    }

    .fps-sparkline-value {
        font-size: 12px;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.92);
    }

    .fps-sparkline-chart {
        width: 100%;
        height: 40px;
        overflow: visible;
    }

    .fps-sparkline-guide {
        stroke-width: 1;
        stroke-dasharray: 3 3;
        opacity: 0.35;
    }

    .fps-sparkline-guide--target {
        stroke: rgba(255, 255, 255, 0.38);
    }

    .fps-sparkline-guide--warning {
        stroke: rgba(255, 159, 67, 0.6);
    }

    .fps-sparkline-line {
        fill: none;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
    }

    .fps-sparkline-line--ok {
        stroke: #5eead4;
    }

    .fps-sparkline-line--warn {
        stroke: #fbbf24;
    }

    .fps-sparkline-line--bad {
        stroke: #f87171;
    }
</style>
