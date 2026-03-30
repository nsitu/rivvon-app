<script setup>
    import { computed } from 'vue';

    const props = defineProps({
        isCapturing: Boolean,
        currentTileIndex: Number,
        currentRow: Number,
        tileHeight: Number,
        completedTiles: Number,
        maxTiles: Number,
        encodingTiles: Number,
        fps: Number,
        cameraResolution: String,
        potResolution: Number
    });

    const emit = defineEmits([
        'start',
        'stop',
        'toggle-camera',
        'update:cameraResolution',
        'update:maxTiles',
        'update:potResolution'
    ]);

    const statusText = computed(() => {
        if (!props.isCapturing) return 'Ready';
        const enc = props.encodingTiles > 0 ? ` | Encoding ${props.encodingTiles}` : '';
        return `Tile ${props.completedTiles}/${props.maxTiles} | Row ${props.currentRow}/${props.tileHeight} | ${props.fps} fps${enc}`;
    });
</script>

<template>
    <div class="realtime-controls">
        <!-- Status bar -->
        <div class="realtime-status">
            <span class="status-text">{{ statusText }}</span>
        </div>

        <!-- Controls row -->
        <div class="realtime-actions">
            <!-- Start / Stop -->
            <button
                class="realtime-btn"
                :class="{ active: isCapturing }"
                @click="isCapturing ? emit('stop') : emit('start')"
            >
                <span class="material-symbols-outlined">
                    {{ isCapturing ? 'stop_circle' : 'videocam' }}
                </span>
                <span class="btn-label">{{ isCapturing ? 'Stop' : 'Start' }}</span>
            </button>

            <!-- Camera flip -->
            <button
                class="realtime-btn"
                :disabled="!isCapturing"
                @click="emit('toggle-camera')"
            >
                <span class="material-symbols-outlined">video_camera_back_add</span>
                <span class="btn-label">Flip</span>
            </button>

            <!-- Resolution selector -->
            <select
                class="realtime-select"
                :value="cameraResolution"
                :disabled="isCapturing"
                @change="emit('update:cameraResolution', ($event.target).value)"
            >
                <option value="240p">240p</option>
                <option value="480p">480p</option>
                <option value="720p">720p</option>
            </select>

            <!-- Tile resolution selector -->
            <select
                class="realtime-select"
                :value="potResolution"
                :disabled="isCapturing"
                @change="emit('update:potResolution', Number(($event.target).value))"
            >
                <option :value="128">128²</option>
                <option :value="256">256²</option>
                <option :value="512">512²</option>
            </select>

            <!-- Max tiles slider -->
            <div class="slider-group">
                <label>Max tiles: {{ maxTiles }}</label>
                <input
                    type="range"
                    min="4"
                    max="32"
                    step="1"
                    :value="maxTiles"
                    :disabled="isCapturing"
                    @input="emit('update:maxTiles', Number(($event.target).value))"
                />
            </div>

        </div>
    </div>
</template>

<style scoped>
    .realtime-controls {
        position: fixed;
        top: 60px;
        right: 16px;
        z-index: 100;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(8px);
        border-radius: 12px;
        padding: 12px 16px;
        color: white;
        font-size: 13px;
        pointer-events: auto;
        min-width: 260px;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .realtime-status {
        text-align: center;
        font-variant-numeric: tabular-nums;
    }

    .status-text {
        opacity: 0.9;
    }

    .realtime-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }

    .realtime-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        background: rgba(255, 255, 255, 0.12);
        border: none;
        border-radius: 8px;
        padding: 6px 10px;
        color: white;
        cursor: pointer;
        font-size: 12px;
        transition: background 0.15s;
    }

    .realtime-btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.22);
    }

    .realtime-btn:disabled {
        opacity: 0.4;
        cursor: default;
    }

    .realtime-btn.active {
        background: rgba(244, 67, 54, 0.6);
    }

    .realtime-btn .material-symbols-outlined {
        font-size: 18px;
    }

    .btn-label {
        white-space: nowrap;
    }

    .realtime-select {
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        color: white;
        padding: 4px 6px;
        font-size: 12px;
        cursor: pointer;
    }

    .realtime-select:disabled {
        opacity: 0.4;
        cursor: default;
    }

    .slider-group {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 90px;
    }

    .slider-group label {
        font-size: 11px;
        opacity: 0.7;
    }

    .slider-group input[type='range'] {
        width: 100%;
        accent-color: #64b5f6;
    }
</style>
