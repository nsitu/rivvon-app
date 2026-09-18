import { computed, ref, shallowRef, watch } from 'vue';
import { createCameraMotionTrack } from '../../modules/viewer/cameraMotionTrack.js';

const SAMPLE_RATE = 30;
const SAMPLE_INTERVAL_MS = 1000 / SAMPLE_RATE;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function captureCameraState(camera, controls, elapsedSeconds) {
    return {
        t: elapsedSeconds,
        position: camera.position.toArray(),
        target: controls.target.toArray(),
        quaternion: camera.quaternion.toArray(),
        fov: camera.fov,
    };
}

export function useCameraMotionCapture(ctx) {
    const isRecording = ref(false);
    const isPlaying = ref(false);
    const isPreviewing = ref(false);
    const currentTime = ref(0);
    const duration = ref(0);
    const sampleCount = ref(0);
    const track = shallowRef(null);

    let recordingStartMs = 0;
    let lastSampleMs = 0;
    let samples = [];
    let savedCameraState = null;
    let savedControlsEnabled = true;
    let savedEnableDamping = false;

    const hasRecording = computed(() => Boolean(track.value?.isValid));
    const closureDuration = computed(() => track.value?.closureDuration ?? 0);

    function getCamera() {
        return ctx.camera.value;
    }

    function getControls() {
        return ctx.controls.value;
    }

    function savePlaybackState() {
        if (savedCameraState) return true;

        const camera = getCamera();
        const controls = getControls();
        if (!camera || !controls) return false;

        savedCameraState = {
            position: camera.position.clone(),
            quaternion: camera.quaternion.clone(),
            fov: camera.fov,
            target: controls.target.clone(),
        };
        savedControlsEnabled = controls.enabled;
        savedEnableDamping = controls.enableDamping;
        controls.enabled = false;
        controls.enableDamping = false;
        return true;
    }

    function restorePlaybackState() {
        const camera = getCamera();
        const controls = getControls();
        if (!camera || !controls || !savedCameraState) {
            savedCameraState = null;
            return;
        }

        camera.position.copy(savedCameraState.position);
        camera.quaternion.copy(savedCameraState.quaternion);
        camera.fov = savedCameraState.fov;
        camera.updateProjectionMatrix();
        controls.target.copy(savedCameraState.target);
        controls.enabled = savedControlsEnabled;
        controls.enableDamping = savedEnableDamping;
        controls.update();
        savedCameraState = null;
    }

    function applyTrackTime(seconds) {
        const camera = getCamera();
        const controls = getControls();
        const activeTrack = track.value;
        if (!camera || !controls || !activeTrack) return false;

        const sample = activeTrack.sampleAt(seconds);
        if (!sample) return false;

        camera.position.fromArray(sample.position);
        camera.quaternion.fromArray(sample.quaternion);
        camera.fov = sample.fov;
        camera.updateProjectionMatrix();
        controls.target.fromArray(sample.target);
        camera.updateMatrixWorld(true);
        return true;
    }

    function startRecording() {
        const camera = getCamera();
        const controls = getControls();
        if (!camera || !controls || isRecording.value || isPlaying.value || isPreviewing.value) {
            return false;
        }

        if (ctx.cinematicCamera?.isPlaying?.value) {
            return false;
        }

        samples = [];
        track.value = null;
        currentTime.value = 0;
        duration.value = 0;
        sampleCount.value = 0;
        recordingStartMs = performance.now();
        lastSampleMs = recordingStartMs;
        samples.push(captureCameraState(camera, controls, 0));
        sampleCount.value = 1;
        isRecording.value = true;
        return true;
    }

    function stopRecording() {
        if (!isRecording.value) return track.value;

        const camera = getCamera();
        const controls = getControls();
        const now = performance.now();
        const elapsed = Math.max(0, (now - recordingStartMs) / 1000);

        if (camera && controls && elapsed > samples[samples.length - 1].t) {
            samples.push(captureCameraState(camera, controls, elapsed));
        }

        isRecording.value = false;
        sampleCount.value = samples.length;
        const nextTrack = createCameraMotionTrack(samples);
        track.value = nextTrack;
        duration.value = nextTrack?.duration ?? 0;
        currentTime.value = 0;
        samples = [];
        return nextTrack;
    }

    function startPlayback() {
        if (!track.value?.isValid || isRecording.value) return false;
        if (!savePlaybackState()) return false;

        isPreviewing.value = false;
        isPlaying.value = true;
        currentTime.value = clamp(currentTime.value, 0, Math.max(0, duration.value - 0.0001));
        applyTrackTime(currentTime.value);
        return true;
    }

    function stopPlayback() {
        if (!isPlaying.value && !isPreviewing.value && !savedCameraState) return;

        isPlaying.value = false;
        isPreviewing.value = false;
        restorePlaybackState();
    }

    function togglePlayback() {
        if (isPlaying.value || isPreviewing.value) {
            stopPlayback();
            return false;
        }

        return startPlayback();
    }

    function seek(seconds) {
        if (!track.value?.isValid || isRecording.value) return false;
        if (!savePlaybackState()) return false;

        const nextTime = clamp(Number(seconds) || 0, 0, Math.max(0, duration.value - 0.0001));
        currentTime.value = nextTime;
        applyTrackTime(nextTime);
        if (!isPlaying.value) {
            isPreviewing.value = true;
        }
        return true;
    }

    function clearRecording() {
        stopPlayback();
        isRecording.value = false;
        samples = [];
        track.value = null;
        currentTime.value = 0;
        duration.value = 0;
        sampleCount.value = 0;
    }

    function sample(now = performance.now()) {
        if (!isRecording.value) return;

        const elapsed = Math.max(0, (now - recordingStartMs) / 1000);
        currentTime.value = elapsed;

        if (now - lastSampleMs < SAMPLE_INTERVAL_MS) return;

        const camera = getCamera();
        const controls = getControls();
        if (!camera || !controls) return;

        samples.push(captureCameraState(camera, controls, elapsed));
        sampleCount.value = samples.length;
        lastSampleMs = now;
    }

    function tick(deltaSeconds) {
        if (!isPlaying.value || !track.value?.isValid) return;

        currentTime.value = (currentTime.value + Math.max(0, Number(deltaSeconds) || 0)) % Math.max(0.001, duration.value);
        applyTrackTime(currentTime.value);
    }

    function applyAtTime(seconds) {
        if (!track.value?.isValid) return false;
        return applyTrackTime(seconds);
    }

    function getTrack() {
        return track.value;
    }

    function getLoopDuration() {
        return duration.value;
    }

    function dispose() {
        clearRecording();
    }

    watch(() => ctx.app.viewerControlMode, (mode) => {
        if (mode !== 'orbit') {
            if (isRecording.value) stopRecording();
            if (isPlaying.value || isPreviewing.value) stopPlayback();
        }
    });

    watch(() => ctx.cinematicCamera?.isPlaying?.value ?? false, (playing) => {
        if (!playing) return;
        if (isRecording.value) stopRecording();
        if (isPlaying.value || isPreviewing.value) stopPlayback();
    });

    return {
        isRecording,
        isPlaying,
        isPreviewing,
        hasRecording,
        currentTime,
        duration,
        closureDuration,
        sampleCount,
        startRecording,
        stopRecording,
        startPlayback,
        stopPlayback,
        togglePlayback,
        seek,
        clearRecording,
        sample,
        tick,
        applyAtTime,
        getTrack,
        getLoopDuration,
        dispose,
    };
}
