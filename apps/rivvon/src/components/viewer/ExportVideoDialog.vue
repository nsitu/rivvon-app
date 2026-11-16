<script setup>
import { createClipTimingPlan, getClipExportPeriod } from '../../modules/viewer/clipTiming.js';
    import { isVideoPreflightReady } from '../../modules/viewer/videoBitrateEstimate.js';
    import { getSdrBitrate } from '../../modules/viewer/exportColour.js';
    import { getBasicVideoQuality, getVideoQuantizerMax, resolveVideoRateControl, resolveFfmpegVideoRateControl, VIDEO_QUALITY_LEVELS, VIDEO_QUALITY_OPTIONS, X264_ENCODER_PRESETS } from '../../modules/viewer/videoRateControl.js';
    import { ref, computed, watch, inject, onBeforeUnmount } from 'vue';
    import { VIEWER_AUDIO_KEY } from '../../modules/viewer/audioReactivity.js';
    import Accordion from 'primevue/accordion';
    import AccordionPanel from 'primevue/accordionpanel';
    import AccordionHeader from 'primevue/accordionheader';
    import AccordionContent from 'primevue/accordioncontent';
    import Button from 'primevue/button';
    import Select from 'primevue/select';
    import InputNumber from 'primevue/inputnumber';
    import Slider from 'primevue/slider';
    import Message from 'primevue/message';
    import InputText from 'primevue/inputtext';
    import Textarea from 'primevue/textarea';
    import ToggleSwitch from 'primevue/toggleswitch';
    import PanelActionBar from '../shared/PanelActionBar.vue';
    import ScrollPanel from 'primevue/scrollpanel';
    import ExportColourReport from './ExportColourReport.vue';
    import { useViewerStore } from '../../stores/viewerStore';
    import {
        EXPORT_ASPECT_RATIO_OPTIONS,
        getExportResolutionOptions,
        normalizeExportDimensionSettings,
    } from '../../modules/viewer/exportVideoDimensions';
    import {
        DEFAULT_SEAMLESS_LOOP_COUNT,
        SEAMLESS_LOOP_COUNT_OPTIONS,
        normalizeMotionLoopDurationMultiplier,
    } from '../../modules/viewer/seamlessLoop.js';

    const app = useViewerStore();
    const viewerAudio = inject(VIEWER_AUDIO_KEY, null);

    const props = defineProps({
        visible: { type: Boolean, default: false },
        exportInfo: { type: Object, default: () => ({}) },
        initialSettings: { type: Object, default: null },
        isEncoding: { type: Boolean, default: false },
        isPreflighting: { type: Boolean, default: false },
        exportStatus: { type: String, default: '' },
        encodedFilename: { type: String, default: '' },
        encodedSize: { type: Number, default: 0 },
        draftStorage: { type: Object, default: () => ({}) },
        colourReport: { type: Object, default: null },
        preflight: { type: Object, default: null },
        canShare: { type: Boolean, default: false },
        canPublish: { type: Boolean, default: false },
        isAuthenticated: { type: Boolean, default: false },
        publishState: { type: Object, default: () => ({}) },
        canSaveToDrive: { type: Boolean, default: false },
        driveState: { type: Object, default: () => ({}) },
    });

    const emit = defineEmits([
        'update:visible', 'request-export', 'request-download', 'request-share',
        'request-publish', 'request-cancel-publish', 'request-open-published',
        'request-save-to-drive', 'request-cancel-drive', 'request-open-drive',
        'request-cancel', 'settings-change', 'request-open-drafts', 'request-retry-save', 'request-preflight',
    ]);

    // --- Form state ---
    const format = ref('mp4');
    const videoCodec = ref('av1');
    const encodingMethod = ref('webcodecs');
    const hardwareAcceleration = ref('prefer-hardware');
    const videoRange = ref('limited');
    const yuvConversion = ref('gpu');
    const exportMode = ref('ribbons');
    const durationMode = ref('loop');
    const customDuration = ref(5);
    const cycleCount = ref(DEFAULT_SEAMLESS_LOOP_COUNT);

    const cycleCountOptions = SEAMLESS_LOOP_COUNT_OPTIONS;
    const fps = ref(30);
    const artworkMotionMode = computed(() => app.artworkMotionMode);
    const webcodecsRateControl = ref('quantizer');
    const ffmpegRateControl = ref('quantizer');
    const bitrateMode = computed({
        get: () => usesWebCodecs.value ? webcodecsRateControl.value : ffmpegRateControl.value,
        set: value => { rateControlNotice.value = ''; if (usesWebCodecs.value) webcodecsRateControl.value = value; else ffmpegRateControl.value = value; },
    });
    const basicQualityLevel = ref('medium');
    const webcodecsQuantizer = ref(23);
    const ffmpegQuantizer = ref(23);
    const quantizer = computed({
        get: () => usesWebCodecs.value ? webcodecsQuantizer.value : ffmpegQuantizer.value,
        set: value => { if (usesWebCodecs.value) webcodecsQuantizer.value = value; else ffmpegQuantizer.value = value; },
    });
    const crf = ref(23);
    const encoderPreset = ref('veryfast');
    const rateControlNotice = ref('');
    const encoderPresetOptions = X264_ENCODER_PRESETS.map(value => ({ label: value, value }));
    const backgroundInterpolation = ref('crossfade');
    const backgroundInterpolationOptions = [
        { label: 'Crossfade', value: 'crossfade' },
        { label: 'Motion interpolation (RIFE)', value: 'rife' },
    ];
    const publishName = ref('');
    const publishDescription = ref('');
    const publishPublic = ref(true);

    const exportModeOptions = computed(() => {
        const options = [];
        const modes = props.exportInfo?.modes || {};

        if (props.exportInfo?.supportsRibbonExport !== false && modes.ribbons) {
            options.push({ label: 'Ribbon Geometry', value: 'ribbons' });
        }

        if (modes.textureOnly) {
            options.push({ label: 'Texture Only', value: 'textureOnly' });
        }

        return options;
    });

    const activeModeInfo = computed(() => {
        const modes = props.exportInfo?.modes || {};
        if (exportMode.value === 'textureOnly' && modes.textureOnly) {
            return modes.textureOnly;
        }

        return modes.ribbons || modes.textureOnly || {};
    });

    const textureOnlyMode = computed(() => exportMode.value === 'textureOnly');

    function isCircularOrbitMovement(value) {
        return value === 'circularOrbit' || value === 'circularOrbitReverse';
    }

    function getCircularOrbitDirectionLabel(value) {
        return value === 'circularOrbitReverse' ? 'clockwise' : 'counterclockwise';
    }

    // --- Preset options ---
    const aspectRatioOptions = EXPORT_ASPECT_RATIO_OPTIONS;

    const exportDimensionSettings = computed(() => normalizeExportDimensionSettings({
        aspectRatioPreset: app.exportAspectRatioPreset,
        resolutionPreset: app.exportResolutionPreset,
        customWidth: app.exportCustomWidth,
        customHeight: app.exportCustomHeight,
    }));
    const aspectRatioPreset = computed({
        get: () => exportDimensionSettings.value.aspectRatioPreset,
        set: (value) => {
            app.setExportAspectRatioPreset(value);
        },
    });
    const resolutionPreset = computed({
        get: () => exportDimensionSettings.value.resolutionPreset,
        set: (value) => {
            app.setExportResolutionPreset(value);
        },
    });
    const customWidth = computed({
        get: () => exportDimensionSettings.value.customWidth,
        set: (value) => {
            app.setExportCustomWidth(value);
        },
    });
    const customHeight = computed({
        get: () => exportDimensionSettings.value.customHeight,
        set: (value) => {
            app.setExportCustomHeight(value);
        },
    });
    const resolutionOptions = computed(() => getExportResolutionOptions(aspectRatioPreset.value));
    const exportLogoOverlayEnabled = computed(() => app.exportLogoOverlayEnabled);
    const exportLogoOverlayCorner = computed(() => app.exportLogoOverlayCorner);

    const formatOptions = [
        { label: 'MP4 (H.264)', value: 'mp4' },
        { label: 'MP4 (AV1)', value: 'mp4-av1' },
        { label: 'WebM (VP9)', value: 'webm' }
    ];
    const formatSelection = computed({
        get: () => format.value === 'mp4' && videoCodec.value === 'av1' ? 'mp4-av1' : format.value,
        set: value => { format.value = value === 'mp4-av1' ? 'mp4' : value; videoCodec.value = value === 'mp4-av1' ? 'av1' : value === 'webm' ? 'vp9' : 'avc'; },
    });

    const encodingMethodOptions = computed(() => [
        { label: 'FFmpeg WASM', value: 'ffmpeg', disabled: videoCodec.value === 'av1' },
        { label: 'WebCodecs', value: 'webcodecs' },
    ]);
    const hardwareAccelerationOptions = [
        { label: 'Browser decides', value: 'no-preference' },
        { label: 'Prefer hardware', value: 'prefer-hardware' },
        { label: 'Prefer software', value: 'prefer-software' },
    ];
    const usesWebCodecs = computed(() => videoCodec.value === 'av1' || format.value === 'webm' || encodingMethod.value === 'webcodecs');
    const selectedEncodingMethod = computed({ get: () => usesWebCodecs.value ? 'webcodecs' : 'ffmpeg', set: value => { rateControlNotice.value = ''; encodingMethod.value = value; } });
    const videoRangeOptions = [
        { label: 'Limited (recommended)', value: 'limited' },
        { label: 'Full', value: 'full' },
        { label: 'Browser default', value: 'auto' },
    ];
    const usesExplicitYuv = computed(() => format.value === 'mp4' && (!usesWebCodecs.value || videoRange.value !== 'auto'));
    const yuvConversionOptions = [
        { label: 'GPU shader', value: 'gpu' },
        { label: 'CPU', value: 'cpu' },
    ];

    const durationOptions = [
        { label: 'Looping Cycle', value: 'loop', icon: 'all_inclusive' },
        { label: 'Custom', value: 'custom', icon: 'schedule' }
    ];

    const rateControlOptions = computed(() => usesWebCodecs.value ? [
        { label: 'Quality presets', value: 'basic' },
        { label: 'Variable bitrate (VBR)', value: 'variable' },
        { label: 'Constant bitrate (CBR)', value: 'constant' },
        { label: 'Constant quantizer (QP)', value: 'quantizer' },
    ] : [
        { label: 'Constant quality (CRF)', value: 'crf' },
        { label: 'Average bitrate (ABR)', value: 'variable' },
        { label: 'Constant quantizer (QP)', value: 'quantizer' },
    ]);
    const rateControlDescription = computed(() => ({
        basic: 'Choose a named quality level. The preset selects compression settings; it does not analyse the content or set a file-size limit.',
        variable: usesWebCodecs.value ? 'Targets an average bitrate, allowing complex frames to use more data and simpler frames less. Actual bitrate and file size depend on the content, browser and encoder.'
            : 'Requests x264’s single-pass average bitrate. Individual frames and the final file size can vary.',
        constant: 'Useful for broadcast or bandwidth-constrained delivery. Prioritises a steady data rate over consistent quality. Actual bitrate can vary by browser and encoder; this is not a hard file-size limit.',
        quantizer: usesWebCodecs.value ? 'Uses a fixed quantizer instead of a bitrate target. File size depends on the content. No bitrate fallback is used.'
            : 'Advanced: specifies x264’s constant quantizer rather than a quality or bitrate target. CRF is recommended for most exports. File size depends on the content.',
        crf: 'Recommended for most exports. Targets quality using x264’s constant rate factor. The encoder varies quantization with the content; this is different from a fixed QP.',
    })[bitrateMode.value]);
    const quantizerMax = computed(() => getVideoQuantizerMax(format.value, videoCodec.value));
    const quantizerCodecLabel = computed(() => videoCodec.value === 'av1' ? 'AV1' : format.value === 'webm' ? 'VP9' : 'H.264');
    const showBitrateCeilingWarning = computed(() => usesWebCodecs.value && videoCodec.value === 'avc'
        && ['variable', 'constant'].includes(bitrateMode.value) && hardwareAcceleration.value !== 'prefer-software');
    const usesQualityEstimate = computed(() => ['basic', 'quantizer', 'crf'].includes(bitrateMode.value));
    const usesCrf = computed(() => bitrateMode.value === 'crf');
    const qualitySliderValue = computed({ get: () => usesCrf.value ? crf.value : quantizer.value,
        set: value => { if (usesCrf.value) crf.value = value; else quantizer.value = value; } });
    const qualitySliderLabel = computed(() => usesCrf.value ? 'Constant rate factor (CRF)' : `${usesWebCodecs.value ? quantizerCodecLabel.value : 'x264'} quantization parameter (QP)`);
    const qualitySliderUnit = computed(() => usesCrf.value ? 'CRF' : 'QP');
    const basicQualityDescription = computed(() => {
        const plan = getBasicVideoQuality(basicQualityLevel.value, { videoCodec: videoCodec.value,
            format: format.value, width: resolvedWidth.value, height: resolvedHeight.value });
        const label = VIDEO_QUALITY_OPTIONS.find(option => option.value === basicQualityLevel.value)?.label;
        return `${label} first requests ${quantizerCodecLabel.value} QP ${plan.quantizer}. If quantizer encoding is unavailable, Mediabunny can use VBR at ${(plan.fallbackBitrate / 1_000_000).toFixed(2)} Mb/s for ${resolvedWidth.value}×${resolvedHeight.value}. Neither is a size cap; bitrate fallback depends on the browser and driver.`;
    });
    // Keep the slider within its codec's range when changing format (e.g. AV1 → AVC).
    watch([quantizerMax, usesWebCodecs], ([max]) => {
        if (Number.isInteger(quantizer.value)) quantizer.value = Math.min(max, Math.max(0, quantizer.value));
    });

    function applyInitialDimensionSettings(settings = null) {
        if (!settings) {
            return;
        }

        app.setExportDimensionSettings(settings);

        if (settings.layoutStrategy) {
            app.setTextureOverviewLayoutStrategy(settings.layoutStrategy);
        }
    }

    // --- Computed ---
    const resolvedWidth = computed(() => exportDimensionSettings.value.width);

    const resolvedHeight = computed(() => exportDimensionSettings.value.height);
    const bitrateMbps = ref(getSdrBitrate(resolvedWidth.value, resolvedHeight.value) / 1_000_000);
    const rateControlState = computed(() => {
        try {
            const bits = bitrateMbps.value == null ? null : Math.round(bitrateMbps.value * 1_000_000);
            return { control: (usesWebCodecs.value ? resolveVideoRateControl : resolveFfmpegVideoRateControl)({ bitrateMode: bitrateMode.value, bitrate: bits, quantizer: quantizer.value,
                crf: crf.value, encoderPreset: encoderPreset.value,
                quality: basicQualityLevel.value,
                format: format.value, videoCodec: videoCodec.value, encodingMethod: usesWebCodecs.value ? 'webcodecs' : 'ffmpeg' }), error: '' };
        } catch (error) { return { control: null, error: error.message }; }
    });

    const seamlessLoopDuration = computed(() => {
        return activeModeInfo.value?.seamlessLoopDuration ?? 3.0;
    });

    const cinematicAutoDuration = computed(() => {
        return activeModeInfo.value?.cinematicAutoDuration ?? seamlessLoopDuration.value;
    });

    const recordedCameraDuration = computed(() => {
        return activeModeInfo.value?.recordedCameraMotionDuration || seamlessLoopDuration.value;
    });

    const cycleDetails = computed(() => {
        return activeModeInfo.value?.cycleDetails ?? [];
    });

    const loopSummaryLabel = computed(() => {
        return activeModeInfo.value?.loopLabel || 'Seamless Material Loop';
    });

    const resolvedDuration = computed(() => {
        if (durationMode.value === 'loop') {
            if (!textureOnlyMode.value && artworkMotionMode.value === 'cinematic') {
                return cinematicAutoDuration.value * cycleCount.value;
            }
            if (!textureOnlyMode.value && artworkMotionMode.value === 'recordedOrbit') {
                return recordedCameraDuration.value * cycleCount.value;
            }
            const cyclicArtworkMotion = !textureOnlyMode.value
                && ['circularTilt', 'circularOrbit', 'circularOrbitReverse', 'tumbleOrbit'].includes(artworkMotionMode.value);
            const motionMultiplier = cyclicArtworkMotion
                ? Math.max(1, normalizeMotionLoopDurationMultiplier(app.viewerMotionLoopCount)) : 1;
            return seamlessLoopDuration.value * motionMultiplier * cycleCount.value;
        }
        return customDuration.value;
    });

    const durationSummaryLabel = computed(() => {
        if (durationMode.value === 'custom') {
            return textureOnlyMode.value
                ? `Custom export length overrides the ${formatDuration(seamlessLoopDuration.value)} texture-loop target.`
                : `Custom export length overrides the ${formatDuration(seamlessLoopDuration.value)} seamless-loop target.`;
        }
        if (textureOnlyMode.value) {
            return `Texture overview returns to its starting tile, layer, and flow state after ${formatDuration(seamlessLoopDuration.value)}.`;
        }
        if (artworkMotionMode.value === 'cinematic') {
            if (activeModeInfo.value?.hasROIs) {
                return `Camera path auto-aligns from ${formatDuration(activeModeInfo.value?.cinematicDuration || 0)} to ${formatDuration(cinematicAutoDuration.value)} for a cleaner seam.`;
            }
            return `No saved cinematic views yet, so auto mode falls back to the ${formatDuration(seamlessLoopDuration.value)} material loop.`;
        }
        if (artworkMotionMode.value === 'recordedOrbit') {
            return `Captured camera movement returns to its starting view after ${formatDuration(recordedCameraDuration.value)}.`;
        }
        if (artworkMotionMode.value === 'circularTilt') {
            return `Artwork tilt follows the selected motion rate over ${formatDuration(resolvedDuration.value)}.`;
        }
        if (isCircularOrbitMovement(artworkMotionMode.value)) {
            return `A ${getCircularOrbitDirectionLabel(artworkMotionMode.value)} orbit follows the selected motion rate over ${formatDuration(resolvedDuration.value)}.`;
        }
        if (artworkMotionMode.value === 'tumbleOrbit') {
            return `A seamless three-axis artwork tumble over ${formatDuration(resolvedDuration.value)}.`;
        }
        return `Seamless loop — enabled cycles return to start after ${formatDuration(seamlessLoopDuration.value)}.`;
    });

    const loopDetailsSummary = computed(() => {
        if (durationMode.value === 'custom') {
            return textureOnlyMode.value
                ? `Base texture-only loop is ${formatDuration(seamlessLoopDuration.value)}, but the export will run for ${formatDuration(resolvedDuration.value)}. Active cycles may be cut mid-loop.`
                : `Base seamless loop is ${formatDuration(seamlessLoopDuration.value)}, but the export will run for ${formatDuration(resolvedDuration.value)}. Active cycles may be cut mid-loop.`;
        }

        if (textureOnlyMode.value) {
            return `Auto mode uses the ${formatDuration(seamlessLoopDuration.value)} seamless texture loop so tile placement, layer cycling, and conveyor flow land back on frame zero together.`;
        }

        if (artworkMotionMode.value === 'cinematic') {
            if (activeModeInfo.value?.hasROIs) {
                return `The authored camera loop is ${formatDuration(activeModeInfo.value?.cinematicDuration || 0)}. Auto mode aligns it to ${formatDuration(cinematicAutoDuration.value)} so camera and material cycles land together.`;
            }

            return `No authored camera loop is available, so auto mode uses the ${formatDuration(seamlessLoopDuration.value)} seamless material loop.`;
        }
        if (artworkMotionMode.value === 'recordedOrbit') {
            return `Recorded camera motion, including its synthesized return path, repeats every ${formatDuration(recordedCameraDuration.value)} in auto mode.`;
        }

        if (artworkMotionMode.value === 'circularTilt') {
            return `Elliptical Tilt retains the viewer's tilt angles and motion rate. Auto mode spans ${formatDuration(resolvedDuration.value)} so artwork and material cycles return together.`;
        }

        if (isCircularOrbitMovement(artworkMotionMode.value)) {
            return `Circular Orbit (${getCircularOrbitDirectionLabel(artworkMotionMode.value)}) retains the viewer's motion rate. Auto mode spans ${formatDuration(resolvedDuration.value)} so artwork and material cycles return together.`;
        }

        if (artworkMotionMode.value === 'tumbleOrbit') {
            return `Tumble Orbit retains the viewer's motion rate. Auto mode spans ${formatDuration(resolvedDuration.value)} so artwork and material cycles return together.`;
        }

        return `Auto mode uses the ${formatDuration(seamlessLoopDuration.value)} seamless material loop so enabled cycles return to frame zero together.`;
    });

    const clipExportPeriod = computed(() => {
        if (!app.backgroundTextureEnabled || app.backgroundTextureSource?.kind !== 'clip') return null;
        const manual = durationMode.value === 'custom';
        const loops = manual ? 1 : cycleCount.value;
        return getClipExportPeriod(manual ? resolvedDuration.value : resolvedDuration.value / loops, fps.value, loops, manual);
    });
    const clipTiming = computed(() => app.backgroundClipDuration > 0 && clipExportPeriod.value
        ? createClipTimingPlan(app.backgroundClipDuration, clipExportPeriod.value.targetDuration, app.backgroundClipPlaybackMode) : null);
    watch(() => [props.visible, clipExportPeriod.value?.targetDuration], () => {
        app.backgroundClipPreviewDuration = props.visible ? clipExportPeriod.value?.targetDuration || 0 : 0;
    }, { immediate: true });
    onBeforeUnmount(() => { app.backgroundClipPreviewDuration = 0; });
    const totalFrames = computed(() => clipExportPeriod.value?.totalFrames ?? Math.ceil(resolvedDuration.value * fps.value));

    const estimatedSize = computed(() => {
        if (!preflightReady.value) return '—';
        const rate = props.preflight.bitrate;
        const bytes = (rate * totalFrames.value / fps.value) / 8;
        if (bytes > 1024 * 1024) return `~${(bytes / 1024 / 1024).toFixed(1)} MiB`;
        return `~${(bytes / 1024).toFixed(0)} KiB`;
    });

    const encodingAvailable = computed(() => {
        return usesWebCodecs.value ? (props.exportInfo?.hasWebCodecs ?? false) : typeof WebAssembly !== 'undefined';
    });
    const canEncode = computed(() => encodingAvailable.value && Boolean(rateControlState.value.control));
    const preflightReady = computed(() => canEncode.value && isVideoPreflightReady(props.preflight, getExportSettings()));
    const estimatedEncodingTime = computed(() => {
        if (!preflightReady.value) return '—';
        const seconds = Math.max(1, Math.ceil(props.preflight.estimatedEncodingSeconds));
        if (seconds < 60) return `~${seconds}s`;
        if (seconds < 3600) return `~${Math.floor(seconds / 60)}m ${seconds % 60}s`;
        const minutes = Math.ceil(seconds / 60);
        return `~${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    });

    const hasEncodedVideo = computed(() => Boolean(props.encodedFilename));
    const isPublishing = computed(() => Boolean(props.publishState?.isPublishing));
    const isPublished = computed(() => Boolean(props.publishState?.videoId));
    const isSavingDrive = computed(() => Boolean(props.driveState?.isSaving));
    const isSavedToDrive = computed(() => Boolean(props.driveState?.fileId));

    const encodedSizeLabel = computed(() => {
        const bytes = Number(props.encodedSize) || 0;
        if (bytes <= 0) return '';
        if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
        return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
    });

    watch(
        () => [
            props.visible,
            props.initialSettings?.aspectRatioPreset,
            props.initialSettings?.resolutionPreset,
            props.initialSettings?.customWidth,
            props.initialSettings?.customHeight,
            props.initialSettings?.layoutStrategy,
        ],
        ([visible]) => {
            if (!visible || !props.initialSettings) {
                return;
            }

            applyInitialDimensionSettings(props.initialSettings);
        },
        { immediate: true }
    );

    // Seed the suggestion after initial dimensions are applied. Once shown,
    // numeric bitrate stays explicit and is not rescaled on resolution changes.
    let rateControlInitialized = false;
    watch(() => props.visible, visible => {
        if (!visible) return;
        const settings = props.initialSettings;
        if (settings?.format) format.value = settings.format;
        if (settings?.format) videoCodec.value = settings.videoCodec ?? (settings.format === 'webm' ? 'vp9' : 'avc');
        if (settings?.encodingMethod) encodingMethod.value = settings.encodingMethod;
        if (settings?.hardwareAcceleration) hardwareAcceleration.value = settings.hardwareAcceleration;
        if (settings?.videoRange) videoRange.value = settings.videoRange;
        if (settings?.yuvConversion) yuvConversion.value = settings.yuvConversion;
        if (settings?.fps != null) fps.value = settings.fps;
        if (settings?.durationMode) durationMode.value = settings.durationMode;
        if (settings?.customDuration != null) customDuration.value = settings.customDuration;
        if (settings?.loopCount != null) cycleCount.value = settings.loopCount;
        if (settings?.backgroundInterpolation) backgroundInterpolation.value = settings.backgroundInterpolation;
        if (!rateControlInitialized) {
            bitrateMbps.value = getSdrBitrate(resolvedWidth.value, resolvedHeight.value, settings?.quality) / 1_000_000;
            rateControlInitialized = true;
        }
        if (settings?.bitrate != null) bitrateMbps.value = settings.bitrate / 1_000_000;
        if (settings?.bitrateMode) {
            const availableModes = usesWebCodecs.value ? ['basic', 'variable', 'constant', 'quantizer'] : ['variable', 'crf', 'quantizer'];
            if (availableModes.includes(settings.bitrateMode)) bitrateMode.value = settings.bitrateMode;
            else {
                bitrateMode.value = usesWebCodecs.value ? 'quantizer' : 'crf';
                rateControlNotice.value = `The saved ${settings.bitrateMode} mode is unavailable with this encoder. Review the selected ${usesWebCodecs.value ? 'QP' : 'CRF'} setting; values are not converted between these modes.`;
            }
        }
        if (VIDEO_QUALITY_LEVELS.includes(settings?.quality)) basicQualityLevel.value = settings.quality;
        if (settings?.quantizer != null) quantizer.value = settings.quantizer;
        if (settings?.crf != null) crf.value = settings.crf;
        if (settings?.encoderPreset) encoderPreset.value = settings.encoderPreset;
    }, { immediate: true });

    watch(
        () => [props.visible, props.exportInfo?.defaultExportMode, exportModeOptions.value.map((option) => option.value).join(',')],
        ([visible]) => {
            if (!visible) {
                return;
            }

            const availableModes = exportModeOptions.value.map((option) => option.value);
            const preferredMode = props.exportInfo?.defaultExportMode;
            exportMode.value = availableModes.includes(preferredMode)
                ? preferredMode
                : (availableModes[0] || 'ribbons');

        },
        { immediate: true }
    );

    watch(() => props.encodedFilename, (filename) => {
        if (!filename) {
            return;
        }

        publishName.value = filename.replace(/\.[^.]+$/, '');
        publishDescription.value = '';
        publishPublic.value = true;
    });

    watch([
        aspectRatioPreset,
        resolutionPreset,
        customWidth,
        customHeight,
        () => app.textureOverviewLayoutStrategy,
        format,
        videoCodec,
        encodingMethod,
        hardwareAcceleration,
        videoRange,
        yuvConversion,
        exportMode,
        durationMode,
        customDuration,
        cycleCount,
        fps,
        artworkMotionMode,
        bitrateMode,
        basicQualityLevel,
        crf,
        encoderPreset,
        bitrateMbps,
        quantizer,
        backgroundInterpolation,
        exportLogoOverlayEnabled,
        exportLogoOverlayCorner,
        () => app.flowState,
        () => app.flowSpeed,
        () => app.filmstripStyleEnabled,
        () => app.filmstripMotionEnabled,
        () => app.filmstripMotionSpeed,
        () => app.filmstripGapLength,
        () => app.filmstripHoleLength,
        () => app.proceduralPathMode !== 'mobius' && app.undulationEnabled,
        () => app.flowCycleAlignmentEnabled,
        () => app.textureAnimationEnabled,
        () => app.textureAnimationReversed,
        () => app.preferredTextureMaxResolution,
        () => app.renderFilterMode,
        () => app.transparentShadowsEnabled,
        () => app.overlapOnlyTransparencyEnabled,
        () => app.transparencyMethod,
        () => app.transparencyMode,
        () => app.transparencyReferenceColor,
        () => app.transparentShadowsThresholdMin,
        () => app.transparentShadowsThresholdMax,
        () => app.peakTroughTransparencyEnabled,
        () => app.peakTroughBlurEnabled,
        () => app.peakTroughBlurAmount,
        () => app.peakTroughGradientStart,
        () => app.peakTroughGradientEnd,
        () => app.gradientMapStops,
        () => app.gradientMapMix,
        () => app.backgroundTextureGradientMapMix,
        () => app.backgroundTextureVerticalAlignment,
        () => app.backgroundTextureSource,
        () => app.backgroundTextureBlendMode,
        () => app.backgroundTextureBlendStrength,
        () => app.artworkBlendMode,
        () => app.artworkBlendStrength,
        () => app.contrast,
        () => app.saturation,
        () => app.textureRepeatMode,
        () => app.textureFlipVertical,
    ], () => {
        if (!props.visible) {
            return;
        }

        emit('settings-change', getRememberedSettings());
    }, { deep: true });

    function formatDuration(value) {
        const numeric = Number(value);

        if (!Number.isFinite(numeric) || numeric <= 0) {
            return 'Off';
        }

        return `${numeric.toFixed(numeric >= 10 ? 1 : 2)}s`;
    }

    // --- Methods ---
    // Keep form choices independently of encoded output, including inactive
    // encoder preferences and values that have not passed preflight yet.
    function getRememberedSettings() {
        return {
            format: format.value,
            videoCodec: videoCodec.value,
            encodingMethod: encodingMethod.value,
            hardwareAcceleration: hardwareAcceleration.value,
            videoRange: videoRange.value,
            yuvConversion: yuvConversion.value,
            fps: fps.value,
            durationMode: durationMode.value,
            customDuration: customDuration.value,
            loopCount: cycleCount.value,
            bitrateMode: bitrateMode.value,
            bitrate: bitrateMbps.value == null ? null : Math.round(bitrateMbps.value * 1_000_000),
            quality: basicQualityLevel.value,
            quantizer: quantizer.value,
            crf: crf.value,
            encoderPreset: encoderPreset.value,
            backgroundInterpolation: backgroundInterpolation.value,
        };
    }

    function getExportSettings() {
        return {
            exportMode: exportMode.value,
            width: resolvedWidth.value,
            height: resolvedHeight.value,
            fps: fps.value,
            totalFrames: totalFrames.value,
            format: format.value,
            videoCodec: videoCodec.value,
            encodingMethod: usesWebCodecs.value ? 'webcodecs' : 'ffmpeg',
            hardwareAcceleration: usesWebCodecs.value ? hardwareAcceleration.value : null,
            videoRange: format.value === 'mp4' && usesWebCodecs.value ? videoRange.value : null,
            yuvConversion: usesExplicitYuv.value ? yuvConversion.value : null,
            duration: durationMode.value === 'custom' ? resolvedDuration.value : null,
            resolvedDuration: resolvedDuration.value,
            loopCount: durationMode.value === 'loop'
                ? cycleCount.value
                : DEFAULT_SEAMLESS_LOOP_COUNT,
            artworkMotionMode: textureOnlyMode.value ? 'none' : artworkMotionMode.value,
            ...rateControlState.value.control,
            ...(!usesWebCodecs.value ? { encoderPreset: encoderPreset.value } : {}),
            backgroundInterpolation: textureOnlyMode.value || app.backgroundMode === 'gradient'
                ? 'crossfade' : backgroundInterpolation.value,
            logoOverlayEnabled: exportLogoOverlayEnabled.value,
            logoOverlayCorner: exportLogoOverlayCorner.value,
        };
    }

    function handleExport() {
        if (!preflightReady.value || props.isEncoding) return;
        emit('request-export', getExportSettings());
    }

    function handlePreflight() {
        if (!canEncode.value || props.isEncoding) return;
        emit('request-preflight', getExportSettings());
    }

    function handleDownload() {
        emit('request-download');
    }

    function handleShare() {
        emit('request-share');
    }

    function handlePublish() {
        emit('request-publish', {
            name: publishName.value,
            description: publishDescription.value,
            isPublic: publishPublic.value,
        });
    }

    function handleCancel() {
        emit('request-cancel');
    }

    function handleClose() {
        emit('update:visible', false);
    }
</script>

<template>
    <div
        class="export-video-panel"
        :class="{ active: visible }"
        role="dialog"
        aria-modal="true"
        aria-label="Export Video"
    >
        <div class="export-video-panel-container viewer-chrome-panel-container">
            <div class="export-video-panel-content">
                <ScrollPanel class="rivvon-scroll-panel export-video-panel-scroll">
                    <div class="export-video-panel-body">
                    <p v-if="viewerAudio?.state.track || viewerAudio?.state.microphoneActive || viewerAudio?.state.microphonePending" class="warning-banner" role="status">
                        Viewer audio and audio reactive zoom are available during live viewing only.
                        Video exports do not include them. Library playback pauses during encoding and resumes afterward.
                        Microphone input stops during encoding; start it again afterward.
                    </p>
                    <div
                        v-if="!encodingAvailable"
                        class="warning-banner"
                    >
                        <span class="material-symbols-outlined">warning</span>
                        <span>The selected video encoder is not available in this browser.</span>
                    </div>

                    <div class="form-grid">
                        <div
                            v-if="exportModeOptions.length > 1"
                            class="form-field"
                        >
                            <label>Export Mode</label>
                            <Select
                                v-model="exportMode"
                                :options="exportModeOptions"
                                option-label="label"
                                option-value="value"
                                :disabled="isEncoding"
                                class="w-full"
                            />
                        </div>

                        <div class="form-field">
                            <label for="videoExportFormat">Format</label>
                            <Select
                                v-model="formatSelection"
                                input-id="videoExportFormat"
                                :options="formatOptions"
                                option-label="label"
                                option-value="value"
                                :disabled="isEncoding"
                                class="w-full"
                            />
                            <div v-if="videoCodec === 'av1'" class="field-description">AV1 in an MP4 container using WebCodecs. Keeps the colour range and conversion selected below. Encoder and playback support depend on the browser and device.</div>
                        </div>

                        <div v-if="format === 'mp4'" class="form-field">
                            <label for="videoEncodingMethod">Encoding method</label>
                            <Select v-model="selectedEncodingMethod" :options="encodingMethodOptions" option-label="label"
                                option-value="value" option-disabled="disabled" input-id="videoEncodingMethod" :disabled="isEncoding" class="w-full" />
                            <div class="field-description">
                                {{ selectedEncodingMethod === 'ffmpeg'
                                    ? 'Consistent BT.709 limited colour. Encoding runs on the CPU and loads a 32 MB encoder; pixel conversion is selected below.'
                                    : 'Uses the browser encoder. Colour can vary by browser and device. Keeps the original encoded video without metadata repair; inspect the final colour report.' }}
                            </div>
                        </div>

                        <div v-if="usesWebCodecs" class="form-field">
                            <label for="videoHardwarePreference">Encoder preference</label>
                            <Select v-model="hardwareAcceleration" :options="hardwareAccelerationOptions" option-label="label"
                                option-value="value" input-id="videoHardwarePreference" :disabled="isEncoding" class="w-full" />
                            <div class="field-description">Controls compression, independently of colour conversion. The browser may choose another encoder.</div>
                        </div>

                        <div v-if="format === 'mp4' && usesWebCodecs" class="form-field">
                            <label id="videoColourRangeLabel" for="videoColourRange">Colour range</label>
                            <Select v-model="videoRange" :options="videoRangeOptions" option-label="label"
                                option-value="value" input-id="videoColourRange" :disabled="isEncoding" class="w-full"
                                aria-labelledby="videoColourRangeLabel"
                                :pt="{ label: { 'aria-describedby': 'videoColourRangeHelp' } }" />
                            <div id="videoColourRangeHelp" class="field-description">
                                {{ videoRange === 'auto'
                                    ? 'The browser chooses RGB-to-YUV conversion and range, which can differ between hardware and software encoders. Skips explicit YUV conversion and its readback step.'
                                    : videoRange === 'full'
                                        ? 'Converts actual pixels to BT.709 full range (0–255). Some players handle full range poorly. Export stops if its colour declarations do not match.'
                                        : 'Converts actual pixels to BT.709 limited range (luma 16–235, chroma 16–240). Missing colour declarations are reported as warnings; conflicting output declarations stop export.' }}
                            </div>
                        </div>

                        <div v-if="usesExplicitYuv" class="form-field">
                            <label for="videoYuvConversion">Colour conversion</label>
                            <Select v-model="yuvConversion" :options="yuvConversionOptions" option-label="label"
                                option-value="value" input-id="videoYuvConversion" :disabled="isEncoding" class="w-full"
                                :pt="{ label: { 'aria-describedby': 'videoYuvConversionHelp' } }" />
                            <div id="videoYuvConversionHelp" class="field-description">
                                {{ yuvConversion === 'gpu'
                                    ? 'Converts pixels on the GPU, then reads YUV bytes back for encoding. This reads less data than the CPU method, but speed depends on your device. Falls back to CPU if needed; see the colour report.'
                                    : 'Reads RGBA pixels back, then converts them on the CPU. Useful for compatibility or comparison.' }}
                                Both use BT.709 and the selected range, only during export. Viewer navigation is unaffected.
                            </div>
                        </div>

                        <div class="form-field">
                            <label>Aspect Ratio</label>
                            <Select
                                v-model="aspectRatioPreset"
                                :options="aspectRatioOptions"
                                option-label="label"
                                option-value="value"
                                :disabled="isEncoding"
                                class="w-full"
                            >
                                <template #value="{ value }">
                                    <div class="aspect-ratio-option">
                                        <span class="material-symbols-outlined">{{aspectRatioOptions.find(o => o.value
                                            === value)?.icon}}</span>
                                        <span>{{aspectRatioOptions.find(o => o.value === value)?.label}}</span>
                                    </div>
                                </template>
                                <template #option="{ option }">
                                    <div class="aspect-ratio-option">
                                        <span class="material-symbols-outlined">{{ option.icon }}</span>
                                        <span>{{ option.label }}</span>
                                    </div>
                                </template>
                            </Select>
                        </div>

                        <div
                            v-if="aspectRatioPreset !== 'custom'"
                            class="form-field"
                        >
                            <label>Resolution</label>
                            <Select
                                v-model="resolutionPreset"
                                :options="resolutionOptions"
                                option-label="label"
                                option-value="value"
                                :disabled="isEncoding"
                                class="w-full"
                            />
                        </div>

                        <div
                            v-if="aspectRatioPreset === 'custom' || resolutionPreset === 'custom'"
                            class="form-field custom-width-field"
                        >
                            <label for="videoExportCustomWidth">Width</label>
                            <InputNumber
                                v-model="customWidth"
                                :min="320"
                                :max="8192"
                                :step="2"
                                :disabled="isEncoding"
                                input-id="videoExportCustomWidth"
                                class="w-full"
                            />
                        </div>
                        <div
                            v-if="aspectRatioPreset === 'custom' || resolutionPreset === 'custom'"
                            class="form-field"
                        >
                            <label for="videoExportCustomHeight">Height</label>
                            <InputNumber
                                v-model="customHeight"
                                :min="240"
                                :max="8192"
                                :step="2"
                                :disabled="isEncoding"
                                input-id="videoExportCustomHeight"
                                class="w-full"
                            />
                        </div>

                        <div class="form-field">
                            <label for="videoBitrateMode">Rate control</label>
                            <Select v-model="bitrateMode" :options="rateControlOptions" option-label="label" option-value="value" option-disabled="disabled"
                                input-id="videoBitrateMode" placeholder="Choose rate control" :disabled="isEncoding" :invalid="Boolean(rateControlState.error)" class="w-full"
                                :pt="{ label: { 'aria-describedby': 'videoBitrateModeHelp' } }" />
                            <div id="videoBitrateModeHelp" class="field-description">
                                {{ rateControlDescription }}
                            </div>
                            <Message v-if="rateControlState.error" severity="error" :closable="false">{{ rateControlState.error }}</Message>
                            <Message v-if="rateControlNotice" severity="info" :closable="false">{{ rateControlNotice }}</Message>
                        </div>

                        <div v-if="!usesQualityEstimate" class="form-field">
                            <label for="videoTargetBitrate">Target bitrate</label>
                            <InputNumber v-model="bitrateMbps" input-id="videoTargetBitrate" :min="0.000001" :max-fraction-digits="6"
                                suffix=" Mb/s" :use-grouping="false" :disabled="isEncoding" :invalid="Boolean(rateControlState.error)" fluid
                                :pt="{ pcInputText: { root: { 'aria-describedby': showBitrateCeilingWarning ? 'videoTargetBitrateHelp videoBitrateCeilingWarning' : 'videoTargetBitrateHelp' } } }" />
                            <div id="videoTargetBitrateHelp" class="field-description">
                                1 Mb/s = 1,000,000 bits/s. Sent as {{ rateControlState.control?.bitrate?.toLocaleString() ?? '—' }} bits/s to {{ usesWebCodecs ? 'WebCodecs' : 'x264' }}.
                                Higher rates generally retain more detail and produce larger files. This value stays fixed when resolution changes.
                            </div>
                        </div>

                        <div v-else class="form-field" :class="{ 'quantizer-field': bitrateMode !== 'basic' }">
                            <template v-if="bitrateMode === 'basic'">
                                <label for="videoQualityLevel">Quality level</label>
                                <Select v-model="basicQualityLevel" input-id="videoQualityLevel" :options="VIDEO_QUALITY_OPTIONS"
                                    option-label="label" option-value="value" :disabled="isEncoding" class="w-full"
                                    :pt="{ label: { 'aria-describedby': 'videoQualityLevelHelp' } }" />
                                <div id="videoQualityLevelHelp" class="field-description">{{ basicQualityDescription }}</div>
                            </template>
                            <template v-else>
                            <div class="quantizer-heading">
                                <label id="videoQuantizerLabel" for="videoQuantizerNumber">{{ qualitySliderLabel }}</label>
                            </div>
                            <div class="quantizer-controls">
                                <div class="quantizer-slider-column">
                                    <div class="quantizer-slider-space">
                                        <Slider v-model="qualitySliderValue" :min="0" :max="quantizerMax" :step="usesCrf ? 0.5 : 1" :disabled="isEncoding"
                                            aria-labelledby="videoQuantizerLabel" class="quantizer-slider"
                                            :pt="{ handle: { id: 'videoQuantizer', 'aria-describedby': 'videoQuantizerHelp videoQuantizerScale',
                                                'aria-valuetext': `${qualitySliderUnit} ${qualitySliderValue ?? 'unset'} of ${quantizerMax}`, 'aria-disabled': isEncoding,
                                                'aria-invalid': Boolean(rateControlState.error), tabindex: isEncoding ? -1 : 0 } }" />
                                    </div>
                                    <div id="videoQuantizerScale" class="quantizer-scale">
                                        <span><strong>0 · More detail</strong><span>Larger files</span></span>
                                        <span><strong>{{ quantizerMax }} · Less detail</strong><span>Smaller files</span></span>
                                    </div>
                                </div>
                                <InputNumber v-model="qualitySliderValue" input-id="videoQuantizerNumber" class="quantizer-number"
                                    :min="0" :max="quantizerMax" :step="usesCrf ? 0.5 : 1" :max-fraction-digits="usesCrf ? 2 : 0"
                                    :use-grouping="false" :disabled="isEncoding" :invalid="Boolean(rateControlState.error)" fluid
                                    :pt="{ pcInputText: { root: { 'aria-labelledby': 'videoQuantizerLabel', 'aria-describedby': 'videoQuantizerHelp videoQuantizerScale' } } }" />
                            </div>
                            <div id="videoQuantizerHelp" class="field-description">
                                <template v-if="usesWebCodecs">
                                {{ quantizerCodecLabel }} uses a 0–{{ quantizerMax }} scale. Lower QP means less compression; file size depends on the content.
                                The same QP does not mean the same quality across codecs. Zero does not guarantee a lossless export.
                                Sent as the encoder quantizer; export stops if this mode is unsupported.
                                </template>
                                <template v-else-if="!usesCrf">
                                    x264 QP uses a 0–51 scale. Lower values retain more detail and generally produce larger files.
                                    Sent as -qp, with no bitrate target or CRF. QP values are not equivalent to CRF values or guaranteed to match another encoder’s QP.
                                    Colour conversion still occurs, so QP 0 does not guarantee a lossless copy of the source.
                                </template>
                                <template v-else>
                                    x264 CRF uses a 0–51 scale, with 23 as its default. Lower values target higher quality and generally produce larger files.
                                    Sent as -crf, with no bitrate target. CRF 23 is not equivalent to WebCodecs QP 23.
                                    Colour conversion still occurs, so CRF 0 does not guarantee a lossless copy of the source.
                                </template>
                            </div>
                            </template>
                        </div>
                        <div v-if="!usesWebCodecs" class="form-field">
                            <label for="videoEncoderPreset">Encoding effort</label>
                            <Select v-model="encoderPreset" input-id="videoEncoderPreset" :options="encoderPresetOptions"
                                option-label="label" option-value="value" :disabled="isEncoding" class="w-full"
                                :pt="{ label: { 'aria-describedby': 'videoEncoderPresetHelp' } }" />
                            <div id="videoEncoderPresetHelp" class="field-description">
                                Selects x264’s native encoding preset, independently of CRF, QP or bitrate. Slower presets take longer and may compress more efficiently.
                                These are x264 speed/compression presets, not Mediabunny quality levels. Veryfast is the default here.
                            </div>
                        </div>
                        <Message v-if="showBitrateCeilingWarning" id="videoBitrateCeilingWarning" severity="warn" :closable="false"
                            class="bitrate-ceiling-warning">
                            H.264 bitrate targets may be limited by the browser or driver. Chrome’s hardware-preferred path plateaued
                            around 7–9 Mb/s in our tests, even with CBR; this is not a universal ceiling. Actual size may differ from
                            the estimate. Try constant QP or FFmpeg WASM if the bitrate is too low.
                        </Message>

                        <div v-if="!textureOnlyMode && app.backgroundMode !== 'gradient' && app.animatedBackgroundEnabled && app.textureAnimationEnabled !== false && app.backgroundBaseEnabled !== false"
                            class="form-field">
                            <label for="export-background-interpolation">Background interpolation</label>
                            <Select v-model="backgroundInterpolation" input-id="export-background-interpolation"
                                :options="backgroundInterpolationOptions" option-label="label" option-value="value"
                                :disabled="isEncoding" aria-describedby="export-background-interpolation-help" class="w-full" />
                            <div id="export-background-interpolation-help" class="field-description">
                                {{ backgroundInterpolation === 'rife'
                                    ? 'Generates intermediate background frames during export. Can reduce ghosting and takes substantially longer. Processing is limited to 1280 pixels before resizing to the texture size.'
                                    : 'Blends neighboring background layers, matching the scene preview.' }}
                            </div>
                        </div>

                        <div class="form-field duration-field">
                            <label>Duration</label>
                            <Select
                                v-model="durationMode"
                                :options="durationOptions"
                                option-label="label"
                                option-value="value"
                                :disabled="isEncoding"
                                class="w-full"
                            >
                                <template #value="{ value }">
                                    <div class="duration-option">
                                        <span class="material-symbols-outlined">{{durationOptions.find(o => o.value
                                            === value)?.icon}}</span>
                                        <span>{{durationOptions.find(o => o.value === value)?.label}}</span>
                                    </div>
                                </template>
                                <template #option="{ option }">
                                    <div class="duration-option">
                                        <span class="material-symbols-outlined">{{ option.icon }}</span>
                                        <span>{{ option.label }}</span>
                                    </div>
                                </template>
                            </Select>
                            <div
                                v-if="durationMode === 'custom'"
                                class="field-description warning-inline"
                            >
                                <span class="material-symbols-outlined">warning</span> Custom durations may not loop
                                cleanly.
                            </div>
                        </div>

                        <div
                            v-if="durationMode === 'loop'"
                            class="form-field loop-count-field"
                        >
                            <label>Loop Count</label>
                            <Select
                                v-model="cycleCount"
                                :options="cycleCountOptions"
                                option-label="label"
                                option-value="value"
                                :disabled="isEncoding"
                                class="w-full"
                            />
                        </div>

                        <div
                            v-if="durationMode === 'custom'"
                            class="form-field seconds-field"
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
                                :disabled="isEncoding"
                                class="w-full"
                            />
                        </div>

                        <div v-if="clipTiming" class="form-field clip-timing-note" role="status">
                            <span>Background clip: {{ clipTiming.rate.toFixed(3) }}× (+{{ ((clipTiming.rate - 1) * 100).toFixed(1) }}%)</span>
                            <small v-if="clipTiming.mode === 'alignLoop'">{{ clipTiming.repetitions }} full repetitions per {{ clipTiming.targetDuration.toFixed(3) }} s loop. The source clip's end-to-start cut remains visible if it is not seamless.</small>
                            <small v-else>Original speed repeats independently. The exported file may end partway through the clip; enable “Speed up to align with loop” under Background Media to align it.</small>
                        </div>
                        <Accordion class="loop-details-accordion">
                            <AccordionPanel value="0">
                                <AccordionHeader>
                                    <span class="accordion-header-text">
                                        <span class="material-symbols-outlined">schedule</span>
                                        Loop Details
                                    </span>
                                </AccordionHeader>
                                <AccordionContent>
                                    <div class="loop-summary-card">
                                        <div class="loop-summary-label">{{ loopSummaryLabel }}</div>
                                        <div class="loop-summary-value">{{ formatDuration(seamlessLoopDuration) }}</div>
                                        <div class="loop-summary-copy">{{ loopDetailsSummary }}</div>
                                    </div>

                                    <div class="loop-cycle-list">
                                        <div
                                            v-for="cycle in cycleDetails"
                                            :key="cycle.key"
                                            class="loop-cycle-row"
                                        >
                                            <div class="loop-cycle-top">
                                                <span class="loop-cycle-label">{{ cycle.label }}</span>
                                                <span class="loop-cycle-duration">{{ cycle.active ?
                                                    formatDuration(cycle.duration) : cycle.statusLabel }}</span>
                                            </div>
                                            <div class="loop-cycle-detail">{{ cycle.detail }}</div>
                                            <div class="loop-cycle-implication">{{ cycle.implication }}</div>
                                        </div>
                                    </div>
                                </AccordionContent>
                            </AccordionPanel>
                        </Accordion>

                    </div>
                    <ExportColourReport v-if="hasEncodedVideo && colourReport?.phase === 'complete'"
                        :report="colourReport" :filename="encodedFilename" />
                    <div v-if="hasEncodedVideo" class="export-draft-notice" role="status">
                        <p v-if="isPublished && !draftStorage.state">Published to the video gallery. The browser draft has been deleted to free up space.</p>
                        <p v-else-if="draftStorage.state === 'saved'">Saved in this browser. Find this encoding in Video Gallery → Drafts after signing in or reopening Rivvon.</p>
                        <p v-else-if="draftStorage.state === 'saving'">Saving this encoding in your browser… Keep this tab open until saving finishes.</p>
                        <template v-else>
                            <p>{{ draftStorage.error || 'This encoding is available in this tab.' }} Download it before leaving, or retry saving.</p>
                            <Button type="button" severity="secondary" variant="outlined" @click="emit('request-retry-save')">Retry saving</Button>
                        </template>
                        <p v-if="draftStorage.thumbnailError || draftStorage.publicationError">{{ draftStorage.thumbnailError || draftStorage.publicationError }}</p>
                    </div>
                    </div>
                </ScrollPanel>

                <div
                    v-if="exportStatus"
                    class="export-status-card"
                    :class="{ ready: hasEncodedVideo, busy: isEncoding }"
                >
                    <span class="material-symbols-outlined">{{ hasEncodedVideo ? 'task_alt' : (isEncoding ?
                        'progress_activity' : 'info') }}</span>
                    <div class="export-status-copy">
                        <div class="export-status-text">{{ exportStatus }}</div>
                        <div
                            v-if="hasEncodedVideo"
                            class="export-status-meta"
                        >
                            {{ encodedFilename }}<span v-if="encodedSizeLabel"> · {{ encodedSizeLabel }}</span>
                        </div>
                    </div>
                </div>

                <section
                    v-if="hasEncodedVideo && canPublish"
                    class="publish-video-card"
                >
                    <div class="publish-video-heading">
                        <span class="material-symbols-outlined">video_library</span>
                        <div>
                            <strong>{{ isPublished ? 'Published video' : 'Publish to Gallery' }}</strong>
                            <p>{{ isPublished ? publishState.status : 'Upload this encoded file and its thumbnail to the Rivvon video gallery.' }}</p>
                        </div>
                    </div>

                    <template v-if="!isPublished">
                        <div class="publish-video-fields">
                            <div class="form-field">
                                <label for="publish-video-name">Title</label>
                                <InputText
                                    id="publish-video-name"
                                    v-model="publishName"
                                    :disabled="isPublishing"
                                    maxlength="120"
                                />
                            </div>
                            <div class="form-field publish-description-field">
                                <label for="publish-video-description">Description</label>
                                <Textarea
                                    id="publish-video-description"
                                    v-model="publishDescription"
                                    :disabled="isPublishing"
                                    rows="2"
                                    maxlength="2000"
                                    auto-resize
                                />
                            </div>
                        </div>
                        <div class="toggle-row publish-visibility-row">
                            <div class="toggle-text">
                                <label>Public Gallery</label>
                                <div class="field-description">Turn off to keep this entry in My Videos only.</div>
                            </div>
                            <div class="toggle-control">
                                <span class="toggle-copy">{{ publishPublic ? 'On' : 'Off' }}</span>
                                <ToggleSwitch
                                    v-model="publishPublic"
                                    :disabled="isPublishing"
                                    aria-label="Publish video publicly"
                                />
                            </div>
                        </div>
                    </template>

                    <div
                        v-if="publishState.status || publishState.error"
                        class="publish-video-status"
                        :class="{ error: publishState.error }"
                    >
                        <span class="material-symbols-outlined">{{ publishState.error ? 'warning' : (isPublished ? 'cloud_done' : 'cloud_upload') }}</span>
                        <span>{{ publishState.error || publishState.status }}</span>
                    </div>
                </section>

                <div
                    v-if="hasEncodedVideo && canSaveToDrive && (driveState.status || driveState.error)"
                    class="publish-video-status drive-video-status"
                    :class="{ error: driveState.error }"
                >
                    <span class="material-symbols-outlined">{{ driveState.error ? 'warning' : (isSavedToDrive ? 'cloud_done' : 'drive_file_move') }}</span>
                    <span>{{ driveState.error || driveState.status }}</span>
                </div>

                <div class="preflight-description field-description" role="status">
                    <template v-if="isPreflighting">Preflight is measuring a short sample. You can cancel without saving a video.</template>
                    <template v-else-if="preflightReady">
                        Preflight complete · {{ preflight.sampleFrames }} frames at {{ preflight.encodingFps.toFixed(1) }} processing FPS.
                        Estimates use {{ preflight.sampleDuration.toFixed(2) }}s at the start; later content and system load can vary.
                        Initial setup is included; final packaging is excluded.
                    </template>
                    <template v-else>Run preflight to check these settings and estimate bitrate, size and encoding time from a short sample. The sample is discarded.</template>
                </div>
                <div class="summary-row" aria-label="Video export summary" aria-live="polite">
                    <div class="summary-item">
                        <span class="summary-label">Frames</span>
                        <span class="summary-value">{{ totalFrames }}</span>
                    </div>
                    <div class="summary-item">
                        <span class="summary-label">Duration</span>
                        <span class="summary-value">{{ resolvedDuration.toFixed(2) }}s</span>
                    </div>
                    <div class="summary-item">
                        <span class="summary-label">Est. size</span>
                        <span class="summary-value">{{ estimatedSize }}</span>
                    </div>
                    <div class="summary-item">
                        <span class="summary-label">Est. bitrate</span>
                        <span class="summary-value">{{ preflightReady ? `~${(preflight.bitrate / 1_000_000).toFixed(2)} Mb/s` : '—' }}</span>
                    </div>
                    <div class="summary-item">
                        <span class="summary-label">Est. encode time</span>
                        <span class="summary-value">{{ estimatedEncodingTime }}</span>
                    </div>
                </div>

                <PanelActionBar class="export-video-panel-footer">
                    <template #leading v-if="hasEncodedVideo && !isAuthenticated">
                        <div class="gallery-login-notice" role="status">
                            Login required to save this video to the gallery.
                        </div>
                    </template>
                    <template v-if="isEncoding || isPublishing || isSavingDrive">
                        <Button
                            type="button"
                            severity="secondary"
                            variant="outlined"
                            @click="isPublishing ? emit('request-cancel-publish') : (isSavingDrive ? emit('request-cancel-drive') : handleCancel())"
                        >
                            <span class="material-symbols-outlined">cancel</span>
                            {{ isPublishing || isSavingDrive ? 'Cancel Upload' : isPreflighting ? 'Cancel preflight' : 'Cancel Encode' }}
                        </Button>
                    </template>
                    <template v-else-if="hasEncodedVideo">
                        <Button
                            type="button"
                            severity="secondary"
                            variant="outlined"
                            @click="handleClose"
                        >
                            <span class="material-symbols-outlined">close</span>
                            Close
                        </Button>
                        <Button type="button" severity="secondary" variant="outlined" @click="emit('request-open-drafts')">
                            <span class="material-symbols-outlined" aria-hidden="true">video_library</span>
                            Drafts
                        </Button>
                        <Button
                            v-if="canShare"
                            type="button"
                            severity="secondary"
                            variant="outlined"
                            @click="handleShare"
                        >
                            <span class="material-symbols-outlined">share</span>
                            Share
                        </Button>
                        <Button
                            v-if="canSaveToDrive && isSavedToDrive"
                            type="button"
                            severity="secondary"
                            variant="outlined"
                            @click="emit('request-open-drive')"
                        >
                            <span class="material-symbols-outlined">open_in_new</span>
                            Open Drive
                        </Button>
                        <Button
                            v-else-if="canSaveToDrive"
                            type="button"
                            severity="secondary"
                            variant="outlined"
                            @click="emit('request-save-to-drive')"
                        >
                            <span class="material-symbols-outlined">drive_file_move</span>
                            Save to Drive
                        </Button>
                        <Button
                            v-if="canPublish && isPublished"
                            type="button"
                            severity="secondary"
                            variant="outlined"
                            @click="emit('request-open-published')"
                        >
                            <span class="material-symbols-outlined">open_in_new</span>
                            Open Video
                        </Button>
                        <Button
                            v-else-if="canPublish"
                            type="button"
                            severity="secondary"
                            variant="outlined"
                            :disabled="!publishName.trim()"
                            @click="handlePublish"
                        >
                            <span class="material-symbols-outlined">cloud_upload</span>
                            Publish
                        </Button>
                        <Button
                            v-else-if="!isAuthenticated"
                            type="button"
                            severity="secondary"
                            variant="outlined"
                            disabled
                            title="Login required to save this video to the gallery"
                            aria-label="Login required to save this video to the gallery"
                        >
                            <span class="material-symbols-outlined">video_library</span>
                            Publish
                        </Button>
                        <Button
                            type="button"
                            @click="handleDownload"
                        >
                            <span class="material-symbols-outlined">download_done</span>
                            Download
                        </Button>
                    </template>
                    <template v-else>
                        <Button
                            type="button"
                            severity="secondary"
                            variant="outlined"
                            @click="handleClose"
                        >
                            <span class="material-symbols-outlined">close</span>
                            Cancel
                        </Button>
                        <Button
                            v-if="!preflightReady"
                            type="button"
                            :disabled="!canEncode"
                            @click="handlePreflight"
                        >
                            Run preflight
                        </Button>
                        <Button
                            v-else
                            type="button"
                            @click="handleExport"
                        >
                            <span class="material-symbols-outlined">videocam</span>
                            Encode
                        </Button>
                    </template>
                </PanelActionBar>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .export-video-panel {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 5;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease;
        display: flex;
        flex-direction: column;
    }

    .export-video-panel.active {
        pointer-events: auto;
        opacity: 1;
    }

    .export-video-panel-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        background: rgba(0, 0, 0, 0.8);
    }

    .export-video-panel-content {
        flex: 1;
        width: 100%;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        padding: 1.5rem 1.25rem;
        gap: 1rem;
    }

    .export-video-panel-body {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .export-video-panel-footer {
        --panel-action-bar-padding: 0.85rem 0 0;
    }

    .gallery-login-notice {
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.7));
        font-size: 0.82rem;
    }

    .publish-video-card {
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
        padding: 1rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 0.85rem;
        background: rgba(255, 255, 255, 0.045);
    }

    .publish-video-heading {
        display: flex;
        align-items: flex-start;
        gap: 0.7rem;
    }

    .publish-video-heading .material-symbols-outlined {
        color: var(--p-primary-color, #6366f1);
    }

    .publish-video-heading strong {
        display: block;
        font-size: 0.95rem;
    }

    .publish-video-heading p {
        margin: 0.2rem 0 0;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.62));
        font-size: 0.8rem;
        line-height: 1.4;
    }

    .publish-video-fields {
        display: flex;
        flex-wrap: wrap;
        gap: 0.7rem;
    }

    .publish-description-field {
        flex-grow: 2;
    }

    .publish-visibility-row {
        padding-top: 0.1rem;
    }

    .publish-video-status {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.7));
        font-size: 0.82rem;
    }

    .publish-video-status.error {
        color: var(--p-red-300, #fca5a5);
    }

    .drive-video-status {
        padding: 0.75rem 0.9rem;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 0.7rem;
        background: rgba(255, 255, 255, 0.035);
    }

    .publish-video-status .material-symbols-outlined {
        font-size: 1.15rem;
    }

    @media (max-width: 767px) {
        .export-video-panel-footer {
            --panel-action-bar-gap: 0.5rem;
            --panel-action-bar-button-min-width: 0;
            --panel-action-bar-mobile-basis: 0;
        }

        .export-video-panel-footer :deep(.panel-action-bar-actions) {
            flex-wrap: nowrap;
        }

        .export-video-panel-footer :deep(.p-button) {
            flex: 1 1 0;
            min-width: 0;
            padding-inline: 0.7rem;
        }
    }

    .form-grid {
        display: grid;
        container-type: inline-size;
        /* All controls share tracks; partial rows keep the same field width.
           The minimum fits one column even on narrow mobile panels. */
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
        align-items: start;
        gap: 0.7rem;
        padding: 0.25rem 0.1rem 0.35rem;
    }

    .form-grid > .form-field {
        min-width: 0;
    }

    /* Two 18rem tracks plus their 0.7rem gap must fit before spanning two
       fields. On narrower panels the pair stays within the single track. */
    @container (min-width: 36.7rem) {
        .quantizer-field {
            grid-column: span 2;
        }
    }

    .custom-width-field {
        grid-column: 1;
    }

    .bitrate-ceiling-warning,
    .clip-timing-note {
        grid-column: 1 / -1;
    }

    .quantizer-heading,
    .quantizer-scale {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 0.75rem;
    }

    .quantizer-controls {
        display: grid;
        grid-template-columns: minmax(0, 3fr) minmax(0, 1fr);
        gap: 0.75rem;
        align-items: start;
    }

    .quantizer-slider-column,
    .quantizer-number {
        min-width: 0;
    }

    .quantizer-number :deep(input) {
        min-width: 0;
    }

    .quantizer-slider-space {
        display: flex;
        align-items: center;
        min-height: var(--rivvon-button-min-target-size, 44px);
        padding-inline: 0.75rem;
    }

    .quantizer-slider {
        flex: 1;
    }

    .quantizer-scale {
        font-size: 0.78rem;
        color: var(--p-text-muted-color);
    }

    .quantizer-scale > span {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
    }

    .quantizer-scale > span:last-child {
        text-align: right;
    }

    .form-field {
        display: flex;
        flex-direction: column;
        flex: 1 1 13rem;
        min-width: 13rem;
        gap: 0.375rem;
    }

    .aspect-ratio-option {
        display: flex;
        align-items: center;
        gap: 0.45rem;
    }

    .duration-option {
        display: flex;
        align-items: center;
        gap: 0.45rem;
    }

    .aspect-ratio-option .material-symbols-outlined {
        font-size: 1.1rem;
        line-height: 1;
        flex-shrink: 0;
    }

    .duration-option .material-symbols-outlined {
        font-size: 1.1rem;
        line-height: 1;
        flex-shrink: 0;
    }

    .form-field label {
        font-size: 0.8rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.6));
    }

    .field-description {
        font-size: 0.78rem;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.5));
        margin-top: 0.375rem;
    }

    .warning-inline {
        display: flex;
        align-items: center;
        gap: 0.35rem;
    }

    .warning-inline .material-symbols-outlined {
        font-size: 1rem;
        line-height: 1;
        flex-shrink: 0;
    }

    .loop-details-accordion {
        width: 100%;
        grid-column: 1 / -1;
    }

    .accordion-header-text {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-weight: 600;
        font-size: 0.9rem;
    }

    .accordion-header-text .material-symbols-outlined {
        font-size: 1.25rem;
    }

    .loop-summary-card {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        padding: 0.85rem 1rem;
        border-radius: 0.85rem;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .loop-summary-label {
        font-size: 0.7rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.55));
    }

    .loop-summary-value {
        font-size: 1.1rem;
        font-weight: 600;
    }

    .loop-summary-copy {
        font-size: 0.8rem;
        line-height: 1.5;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.68));
    }

    .loop-cycle-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin-top: 0.85rem;
    }

    .loop-cycle-row {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding: 0.75rem 0 0;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
    }

    .loop-cycle-row:first-child {
        border-top: none;
        padding-top: 0;
    }

    .loop-cycle-top {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 1rem;
    }

    .loop-cycle-label {
        font-size: 0.86rem;
        font-weight: 600;
    }

    .loop-cycle-duration {
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--p-primary-color, #6366f1);
    }

    .loop-cycle-detail,
    .loop-cycle-implication {
        font-size: 0.78rem;
        line-height: 1.45;
    }

    .loop-cycle-detail {
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.58));
    }

    .loop-cycle-implication {
        color: var(--p-text-color, rgba(255, 255, 255, 0.86));
    }

    .toggle-row {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1rem;
    }

    .toggle-text {
        flex: 1;
        min-width: 0;
    }

    .toggle-control {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        padding-top: 0.1rem;
    }

    .toggle-copy {
        min-width: 1.8rem;
        font-size: 0.78rem;
        font-weight: 500;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.6));
        text-align: right;
    }

    .logo-overlay-group {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        align-items: stretch;
        gap: 0.7rem;
        flex: 1 1 100%;
    }

    .logo-overlay-group .form-field {
        flex: 1 1 13rem;
    }

    .logo-overlay-group .logo-preview-frame {
        flex: 1 1 13rem;
        min-height: unset;
    }

    .logo-preview-frame {
        display: flex;
        min-height: 6.5rem;
        padding: 0.9rem;
        border-radius: 0.75rem;
        background:
            radial-gradient(circle at top left, rgba(255, 255, 255, 0.08), transparent 45%),
            linear-gradient(135deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02));
        border: 1px solid rgba(255, 255, 255, 0.06);
        overflow: hidden;
    }

    .logo-preview-frame.logo-corner-top-left {
        justify-content: flex-start;
        align-items: flex-start;
    }

    .logo-preview-frame.logo-corner-top-right {
        justify-content: flex-end;
        align-items: flex-start;
    }

    .logo-preview-frame.logo-corner-bottom-right {
        justify-content: flex-end;
        align-items: flex-end;
    }

    .logo-preview-frame.logo-corner-bottom-left {
        justify-content: flex-start;
        align-items: flex-end;
    }

    .logo-preview-image {
        display: block;
        width: min(12rem, 60%);
        height: auto;
        max-width: 100%;
        filter: drop-shadow(0 0.35rem 0.75rem rgba(0, 0, 0, 0.35));
    }

    .summary-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(6rem, 1fr));
        gap: 0.75rem;
        padding: 0.7rem 0 0.85rem;
        border-bottom: 1px solid var(--p-content-border-color, rgba(255, 255, 255, 0.1));
        flex-shrink: 0;
    }

    .preflight-description {
        flex-shrink: 0;
        margin-top: 0.7rem;
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

    .export-status-card {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 0.85rem 1rem;
        border-radius: 0.85rem;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .export-status-card.busy {
        background: rgba(59, 130, 246, 0.12);
        border-color: rgba(59, 130, 246, 0.28);
    }

    .export-status-card.ready {
        background: rgba(34, 197, 94, 0.12);
        border-color: rgba(34, 197, 94, 0.26);
    }

    .export-status-card .material-symbols-outlined {
        font-size: 1.25rem;
        line-height: 1.2;
        color: rgba(255, 255, 255, 0.9);
    }

    .export-status-copy {
        min-width: 0;
    }

    .export-status-text {
        font-size: 0.86rem;
        line-height: 1.45;
        color: rgba(255, 255, 255, 0.92);
    }

    .export-status-meta {
        margin-top: 0.2rem;
        font-size: 0.76rem;
        color: var(--p-text-muted-color, rgba(255, 255, 255, 0.62));
        word-break: break-word;
    }

</style>
