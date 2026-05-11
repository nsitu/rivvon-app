<script setup>
    import { computed } from 'vue';
    import { useSlyceStore } from '../../stores/slyceStore';
    const app = useSlyceStore()  // Pinia store

    function getProcessingTileStyle(tile) {
        const decodePercent = Math.max(0, Math.min(100, (tile.decodeProgress ?? 0) * 100));
        const encodePercent = Math.max(0, Math.min(decodePercent, (tile.encodeProgress ?? 0) * 100));

        if (encodePercent >= 100) {
            return {
                background: 'var(--processing-encoded)',
            };
        }

        return {
            background: `linear-gradient(90deg, var(--processing-encoding) 0%, var(--processing-encoding) ${encodePercent}%, var(--processing-decoding) ${encodePercent}%, var(--processing-decoding) ${decodePercent}%, var(--processing-empty) ${decodePercent}%, var(--processing-empty) 100%)`,
        };
    }

    // Compute sorted status entries for consistent ordering
    const statusEntries = computed(() => {
        const entries = Object.entries(app.status).filter(([key]) => {
            if (/^Tile \d+( Error)?$/i.test(key)) {
                return false;
            }
            return true;
        });

        return entries.sort((a, b) => {
            // Priority ordering: System, Processing, Tiles, then errors at bottom
            const priority = (key) => {
                if (key === 'System') return 0;
                if (key === 'Processing') return 1;
                if (key === 'Frame Limit') return 2;
                if (key.startsWith('Tile')) {
                    // Extract tile number for numeric sorting
                    const match = key.match(/Tile (\d+)/);
                    return match ? 3 + parseInt(match[1], 10) : 100;
                }
                if (key.includes('Error')) return 1000;
                return 500;
            };
            return priority(a[0]) - priority(b[0]);
        });
    });

    // Check if a status key represents an error
    const isError = (key) => key.includes('Error');
</script>
<template>
    <div
        v-if="statusEntries.length > 0"
        class="status-container"
    >
        <div
            v-for="[key, value] in statusEntries"
            :key="key"
            class="status-box"
            :class="{ 'status-error': isError(key) }"
        >
            <h4 class="status-title">{{ key }}</h4>
            <template v-if="key === 'Processing' && app.processingProgress">
                <div class="status-value processing-value">{{ value }}</div>
                <div
                    class="processing-bar"
                    role="progressbar"
                    aria-label="Processing progress"
                    :aria-valuenow="app.processingProgress.overallPercent"
                    aria-valuemin="0"
                    aria-valuemax="100"
                >
                    <div
                        v-for="(tile, index) in app.processingProgress.tiles"
                        :key="`processing-tile-${index}`"
                        class="processing-tile"
                        :style="getProcessingTileStyle(tile)"
                    ></div>
                </div>
                <div class="processing-summary">
                    <span
                        v-if="app.processingProgress.legendStates?.complete"
                        class="processing-summary-item"
                    >
                        <span class="processing-swatch processing-swatch-encoded"></span>
                        Complete
                    </span>
                    <span
                        v-if="app.processingProgress.legendStates?.encoding"
                        class="processing-summary-item"
                    >
                        <span class="processing-swatch processing-swatch-encoding"></span>
                        Encoding
                    </span>
                    <span
                        v-if="app.processingProgress.legendStates?.decoding"
                        class="processing-summary-item"
                    >
                        <span class="processing-swatch processing-swatch-decoding"></span>
                        Decoding
                    </span>
                    <span
                        v-if="app.processingProgress.legendStates?.queued"
                        class="processing-summary-item"
                    >
                        <span class="processing-swatch processing-swatch-queued"></span>
                        Queued
                    </span>
                </div>
            </template>
            <div
                v-else
                class="status-value"
                v-html="value"
            ></div>
        </div>
    </div>
</template>
<style scoped>
    .status-container {
        --processing-empty: color-mix(in srgb, var(--bg-secondary) 72%, #111827 28%);
        --processing-decoding: #9ca3af;
        --processing-encoding: #86efac;
        --processing-encoded: #22c55e;
    }

    .status-container {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .status-box {
        padding: 0.75rem 1rem;
        border: 1px solid var(--border-primary);
        border-radius: 0.5rem;
        background: var(--bg-secondary);
        text-align: left;
    }

    .status-box.status-error {
        border-color: #fca5a5;
        background: #fef2f2;
    }

    @media (prefers-color-scheme: dark) {
        .status-box.status-error {
            background: #450a0a;
        }
    }

    .status-title {
        margin: 0 0 0.25rem 0;
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--text-secondary);
    }

    .status-error .status-title {
        color: #dc2626;
    }

    @media (prefers-color-scheme: dark) {
        .status-error .status-title {
            color: #fca5a5;
        }
    }

    .status-value {
        font-size: 0.875rem;
        color: var(--text-tertiary);
    }

    .processing-value {
        margin-bottom: 0.55rem;
    }

    .processing-bar {
        display: flex;
        gap: 0;
        align-items: center;
        margin-bottom: 0.65rem;
    }

    .processing-tile {
        flex: 1 1 0;
        height: 0.7rem;
        min-width: 0;
        border-radius: 0;
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border-primary) 70%, transparent 30%);
        background: var(--processing-empty);
        overflow: hidden;
    }

    .processing-summary {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem 0.85rem;
        font-size: 0.78rem;
        color: var(--text-secondary);
    }

    .processing-summary-item {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
    }

    .processing-swatch {
        width: 0.7rem;
        height: 0.7rem;
        border-radius: 999px;
        display: inline-block;
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border-primary) 70%, transparent 30%);
    }

    .processing-swatch-decoding {
        background: var(--processing-decoding);
    }

    .processing-swatch-queued {
        background: var(--processing-empty);
    }

    .processing-swatch-encoding {
        background: var(--processing-encoding);
    }

    .processing-swatch-encoded {
        background: var(--processing-encoded);
    }

    .status-error .status-value {
        color: #991b1b;
    }

    @media (prefers-color-scheme: dark) {
        .status-error .status-value {
            color: #fca5a5;
        }
    }
</style>