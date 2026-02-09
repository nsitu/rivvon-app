<script setup>
    import { ref, computed, watch, onMounted } from 'vue';
    import Dialog from 'primevue/dialog';
    import Select from 'primevue/select';
    import InputNumber from 'primevue/inputnumber';

    const props = defineProps({
        visible: { type: Boolean, default: false },
        exportInfo: { type: Object, default: () => ({}) }
    });

    const emit = defineEmits(['update:visible', 'export', 'cancel']);

    // --- Form state ---
    const resolutionPreset = ref('1080p');
    const customWidth = ref(1920);
    const customHeight = ref(1080);
    const format = ref('mp4');
    const durationMode = ref('auto');
    const customDuration = ref(5);
    const fps = ref(30);
    const cameraMovement = ref('none');

    const cameraMovementOptions = [
        { label: 'None', value: 'none', description: 'Camera stays fixed' },
        { label: 'Orbit', value: 'orbit', description: 'Full horizontal turntable — useful as reference' },
        { label: 'Conical Sweep', value: 'conicalSweep', description: 'Circle perpendicular to the view — subtle dolly and pitch shift' },
        { label: 'Figure Eight', value: 'figureEight', description: 'Lissajous ∞ path — contained parallax with a flowing feel' },
        { label: 'Gentle Sway', value: 'gentleSway', description: 'Horizontal pendulum with forward/back dolly — elliptical handheld feel' },
        { label: 'Drift', value: 'drift', description: 'Tilted elliptical drift — asymmetric and organic' },
    ];

    const cameraMovementDescription = computed(() => {
        const opt = cameraMovementOptions.find(o => o.value === cameraMovement.value);
        return opt?.description ?? '';
    });

    // --- Preset options ---
    const resolutionOptions = [
        { label: '1080p (1920×1080)', value: '1080p' },
        { label: '720p (1280×720)', value: '720p' },
        { label: '480p (854×480)', value: '480p' },
        { label: '4K (3840×2160)', value: '4k' },
        { label: 'Vertical 1080p (1080×1920)', value: '1080p-v' },
        { label: 'Vertical 4K (2160×3840)', value: '4k-v' },
        { label: 'Square 1080 (1080×1080)', value: 'square' },
        { label: 'Custom', value: 'custom' }
    ];

    const formatOptions = [
        { label: 'MP4 (H.264)', value: 'mp4' },
        { label: 'WebM (VP9)', value: 'webm' }
    ];

    const durationOptions = [
        { label: 'One full cycle (seamless loop)', value: 'auto' },
        { label: 'Custom duration', value: 'custom' }
    ];

    // --- Computed ---
    const resolvedWidth = computed(() => {
        switch (resolutionPreset.value) {
            case '1080p': return 1920;
            case '720p': return 1280;
            case '480p': return 854;
            case '4k': return 3840;
            case '1080p-v': return 1080;
            case '4k-v': return 2160;
            case 'square': return 1080;
            case 'custom': return customWidth.value;
            default: return 1920;
        }
    });

    const resolvedHeight = computed(() => {
        switch (resolutionPreset.value) {
            case '1080p': return 1080;
            case '720p': return 720;
            case '480p': return 480;
            case '4k': return 2160;
            case '1080p-v': return 1920;
            case '4k-v': return 3840;
            case 'square': return 1080;
            case 'custom': return customHeight.value;
            default: return 1080;
        }
    });

    const seamlessLoopDuration = computed(() => {
        return props.exportInfo?.seamlessLoopDuration ?? 3.0;
    });

    const resolvedDuration = computed(() => {
        if (durationMode.value === 'auto') {
            // When camera movement is active, span 2 full animation cycles
            // so the camera path feels slow and cinematic (~8s instead of ~4s).
            const cycles = cameraMovement.value !== 'none' ? 2 : 1;
            return seamlessLoopDuration.value * cycles;
        }
        return customDuration.value;
    });

    const totalFrames = computed(() => {
        return Math.ceil(resolvedDuration.value * fps.value);
    });

    const estimatedSize = computed(() => {
        // Rough estimate: bitrate * duration / 8
        const bitrate = 8_000_000; // 8 Mbps
        const bytes = (bitrate * resolvedDuration.value) / 8;
        if (bytes > 1024 * 1024) return `~${(bytes / 1024 / 1024).toFixed(1)} MB`;
        return `~${(bytes / 1024).toFixed(0)} KB`;
    });

    const hasWebCodecs = computed(() => {
        return props.exportInfo?.hasWebCodecs ?? false;
    });

    // --- Methods ---
    function handleExport() {
        emit('export', {
            width: resolvedWidth.value,
            height: resolvedHeight.value,
            fps: fps.value,
            format: format.value,
            duration: resolvedDuration.value,
            cameraMovement: cameraMovement.value,
        });
    }

    function handleClose() {
        emit('update:visible', false);
    }
</script>

<template>
    <Dialog
        :visible="visible"
        @update:visible="handleClose"
        header="Export Video"
        modal
        :closable="true"
        :style="{ width: '28rem' }"
        class="export-video-dialog"
    >
        <!-- WebCodecs warning -->
        <div
            v-if="!hasWebCodecs"
            class="warning-banner"
        >
            <span class="material-symbols-outlined">warning</span>
            <span>WebCodecs API not available. Use Chrome 94+ or Edge 94+.</span>
        </div>

        <div class="form-grid">
            <!-- Resolution -->
            <div class="form-field">
                <label>Resolution</label>
                <Select
                    v-model="resolutionPreset"
                    :options="resolutionOptions"
                    option-label="label"
                    option-value="value"
                    class="w-full"
                />
            </div>

            <!-- Custom dimensions (only shown when 'custom' selected) -->
            <div
                v-if="resolutionPreset === 'custom'"
                class="form-field form-row"
            >
                <div class="flex-1">
                    <label>Width</label>
                    <InputNumber
                        v-model="customWidth"
                        :min="320"
                        :max="7680"
                        :step="2"
                        class="w-full"
                    />
                </div>
                <span class="dimension-x">×</span>
                <div class="flex-1">
                    <label>Height</label>
                    <InputNumber
                        v-model="customHeight"
                        :min="240"
                        :max="4320"
                        :step="2"
                        class="w-full"
                    />
                </div>
            </div>

            <!-- Format -->
            <div class="form-field">
                <label>Format</label>
                <Select
                    v-model="format"
                    :options="formatOptions"
                    option-label="label"
                    option-value="value"
                    class="w-full"
                />
            </div>

            <!-- Duration -->
            <div class="form-field">
                <label>Duration</label>
                <Select
                    v-model="durationMode"
                    :options="durationOptions"
                    option-label="label"
                    option-value="value"
                    class="w-full"
                />
            </div>

            <!-- Auto duration info -->
            <div
                v-if="durationMode === 'auto'"
                class="info-box"
            >
                <span class="material-symbols-outlined">animation</span>
                <div>
                    <div class="info-value">{{ resolvedDuration.toFixed(2) }}s</div>
                    <div class="info-label">
                        {{ cameraMovement !== 'none'
                            ? 'Two animation cycles — slower camera movement'
                            : 'Seamless loop — all animations return to start' }}
                    </div>
                </div>
            </div>

            <!-- Custom duration input -->
            <div
                v-if="durationMode === 'custom'"
                class="form-field"
            >
                <label>Seconds</label>
                <InputNumber
                    v-model="customDuration"
                    :min="0.5"
                    :max="120"
                    :step="0.5"
                    :min-fraction-digits="1"
                    :max-fraction-digits="1"
                    suffix=" s"
                    class="w-full"
                />
            </div>

            <!-- Camera movement -->
            <div class="form-field">
                <label>Camera Movement</label>
                <Select
                    v-model="cameraMovement"
                    :options="cameraMovementOptions"
                    optionLabel="label"
                    optionValue="value"
                    class="w-full"
                />
                <div
                    class="field-description"
                    v-if="cameraMovementDescription"
                >
                    {{ cameraMovementDescription }}
                </div>
            </div>

            <!-- Summary -->
            <div class="summary-row">
                <div class="summary-item">
                    <span class="summary-label">Frames</span>
                    <span class="summary-value">{{ totalFrames }}</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">Duration</span>
                    <span class="summary-value">{{ resolvedDuration.toFixed(2) }}s</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">Size</span>
                    <span class="summary-value">{{ estimatedSize }}</span>
                </div>
            </div>
        </div>

        <!-- Footer buttons -->
        <template #footer>
            <div class="dialog-footer">
                <button
                    class="btn btn-secondary"
                    @click="handleClose"
                >
                    Cancel
                </button>
                <button
                    class="btn btn-primary"
                    :disabled="!hasWebCodecs"
                    @click="handleExport"
                >
                    <span class="material-symbols-outlined">videocam</span>
                    Export
                </button>
            </div>
        </template>
    </Dialog>
</template>

<style scoped>
    .form-grid {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .form-field {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .form-field label {
        font-size: 0.8rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.6));
    }

    .form-row {
        flex-direction: row;
        align-items: flex-end;
        gap: 0.5rem;
    }

    .dimension-x {
        padding-bottom: 0.5rem;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.5));
        font-size: 1.1rem;
    }

    .flex-1 {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .info-box {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        border-radius: 8px;
        background: var(--p-primary-color, #6366f1);
        background: rgba(99, 102, 241, 0.12);
        border: 1px solid rgba(99, 102, 241, 0.25);
    }

    .info-box .material-symbols-outlined {
        font-size: 1.5rem;
        color: var(--p-primary-color, #6366f1);
    }

    .info-value {
        font-size: 1.1rem;
        font-weight: 600;
    }

    .info-label {
        font-size: 0.78rem;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.6));
        margin-top: 0.125rem;
    }

    .field-description {
        font-size: 0.78rem;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.5));
        margin-top: 0.375rem;
    }

    .summary-row {
        display: flex;
        justify-content: space-between;
        padding: 0.75rem 0;
        border-top: 1px solid var(--p-content-border-color, rgba(255, 255, 255, 0.1));
    }

    .summary-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
    }

    .summary-label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.5));
    }

    .summary-value {
        font-size: 0.95rem;
        font-weight: 600;
    }

    .warning-banner {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1rem;
        margin-bottom: 1rem;
        border-radius: 8px;
        background: rgba(239, 68, 68, 0.15);
        border: 1px solid rgba(239, 68, 68, 0.3);
        color: #fca5a5;
        font-size: 0.85rem;
    }

    .warning-banner .material-symbols-outlined {
        font-size: 1.25rem;
        color: #ef4444;
    }

    .dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: 0.75rem;
    }

    .btn {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.625rem 1.25rem;
        border-radius: 8px;
        font-size: 0.9rem;
        font-weight: 500;
        border: none;
        cursor: pointer;
        transition: background 0.15s ease;
    }

    .btn .material-symbols-outlined {
        font-size: 1.1rem;
    }

    .btn-secondary {
        background: var(--p-content-hover-background, rgba(255, 255, 255, 0.08));
        color: var(--p-text-color, #fff);
    }

    .btn-secondary:hover {
        background: rgba(255, 255, 255, 0.15);
    }

    .btn-primary {
        background: var(--p-primary-color, #6366f1);
        color: var(--p-primary-contrast-color, #fff);
    }

    .btn-primary:hover {
        filter: brightness(1.1);
    }

    .btn-primary:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
</style>
