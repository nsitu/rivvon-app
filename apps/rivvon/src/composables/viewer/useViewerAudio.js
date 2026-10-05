import { onMounted, onUnmounted, reactive } from 'vue';
import {
    clampAudioValue, getAmplitudeTarget, getAudioRms, smoothAudioAmplitude,
} from '../../modules/viewer/audioReactivity.js';

export function createViewerAudioController({
    createMedia = () => new Audio(),
    createContext = () => {
        const Constructor = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Constructor) throw new Error('Audio analysis is unavailable in this browser.');
        return new Constructor();
    },
} = {}) {
    const state = reactive({
        track: null, playing: false, pending: false, buffering: false,
        currentTime: 0, duration: 0, volume: 0.8, muted: false, loop: true,
        reactiveEnabled: false, sensitivity: 3, amount: 0.2, level: 0,
        error: '', analysisError: '', blocked: false,
    });
    let media = null;
    let context = null;
    let source = null;
    let gain = null;
    let splitter = null;
    let analysers = [];
    let samples = [];
    let channelCount = 0;
    let amplitude = 0;
    let lastTick = null;
    let lastMeter = 0;
    let generation = 0;
    let disposed = false;
    let resumeWhenUnblocked = false;
    const blockers = new Set();
    const listeners = [];

    function resetSignal() {
        amplitude = 0;
        state.level = 0;
        lastTick = null;
    }

    function syncTransport() {
        if (!media) return;
        state.currentTime = Number.isFinite(media.currentTime) ? media.currentTime : 0;
        if (Number.isFinite(media.duration)) state.duration = media.duration;
    }

    function ensureMedia() {
        if (media) return media;
        media = createMedia();
        // Must precede src, including the first request, for Web Audio access to CDN data.
        media.crossOrigin = 'anonymous';
        media.preload = 'metadata';
        media.loop = state.loop;
        const on = (type, callback) => {
            media.addEventListener(type, callback);
            listeners.push([type, callback]);
        };
        on('playing', () => {
            if (state.blocked) { media.pause(); return; }
            state.playing = true;
            state.pending = false;
            state.buffering = false;
            state.error = '';
        });
        on('pause', () => { state.playing = false; state.buffering = false; resetSignal(); });
        on('ended', () => { state.playing = false; resetSignal(); syncTransport(); });
        on('waiting', () => { state.buffering = true; resetSignal(); });
        on('seeking', resetSignal);
        on('timeupdate', syncTransport);
        on('loadedmetadata', syncTransport);
        on('durationchange', syncTransport);
        on('error', () => {
            state.error = 'This track could not be loaded. Try Play again or choose another track.';
            state.playing = false;
            state.pending = false;
            state.buffering = false;
            resetSignal();
        });
        return media;
    }

    function setVolume(value) {
        state.volume = clampAudioValue(value, 0, 1, 0.8);
        syncVolume();
    }

    function setMuted(value) {
        state.muted = Boolean(value);
        syncVolume();
    }

    function syncVolume() {
        const value = state.muted ? 0 : state.volume;
        if (gain && source) gain.gain.value = value;
        if (media) media.volume = gain && source ? 1 : value;
    }

    function clearAnalysis() {
        if (splitter && source) source.disconnect(splitter);
        splitter?.disconnect();
        analysers.forEach((analyser) => analyser.disconnect());
        splitter = null;
        analysers = [];
        samples = [];
        channelCount = 0;
    }

    function ensureGraph() {
        if (!context) context = createContext();
        if (!source) {
            gain = context.createGain();
            gain.connect(context.destination);
            source = context.createMediaElementSource(ensureMedia());
            source.connect(gain);
        }
        syncVolume();
        const nextChannels = Math.round(clampAudioValue(state.track?.channel_count, 1, 32, 2));
        if (nextChannels !== channelCount) {
            clearAnalysis();
            splitter = context.createChannelSplitter(nextChannels);
            source.connect(splitter);
            for (let index = 0; index < nextChannels; index += 1) {
                const analyser = context.createAnalyser();
                analyser.fftSize = 1024;
                splitter.connect(analyser, index);
                analysers.push(analyser);
                samples.push(new Float32Array(analyser.fftSize));
            }
            channelCount = nextChannels;
        }
        state.analysisError = '';
    }

    async function play() {
        if (disposed || !state.track || state.blocked) return;
        const element = ensureMedia();
        const request = ++generation;
        state.pending = true;
        state.error = '';
        // Invoke both resume and play inside the original gesture, before awaiting either.
        let resumePromise = Promise.resolve();
        try {
            ensureGraph();
            resumePromise = context.resume();
        } catch (error) {
            state.analysisError = error.message || 'Audio analysis is unavailable.';
            syncVolume();
        }
        let playPromise;
        try {
            if (element.error) element.load();
            playPromise = element.play();
        } catch (error) {
            playPromise = Promise.reject(error);
        }
        const [resumeResult, playResult] = await Promise.allSettled([resumePromise, playPromise]);
        if (disposed || request !== generation) return;
        state.pending = false;
        if (resumeResult.status === 'rejected') {
            state.analysisError = 'Audio analysis could not start. Press Play to try again.';
        }
        if (playResult.status === 'rejected') {
            state.playing = false;
            state.error = playResult.reason?.name === 'NotAllowedError'
                ? 'Press Play to start this track.'
                : 'Unable to play this track. Try again or choose another track.';
            resetSignal();
        } else {
            state.playing = !element.paused;
        }
    }

    function pause({ preserveResume = false } = {}) {
        generation += 1;
        if (!preserveResume) resumeWhenUnblocked = false;
        media?.pause();
        state.playing = false;
        state.pending = false;
        state.buffering = false;
        resetSignal();
    }

    function activate(track) {
        if (disposed) return;
        pause();
        if (!track?.playback_url) {
            state.error = 'This track is unavailable.';
            return;
        }
        state.track = { id: track.id, name: track.name, playback_url: track.playback_url,
            channel_count: track.channel_count };
        state.duration = Math.max(0, Number(track.duration) || 0);
        state.currentTime = 0;
        state.analysisError = '';
        const element = ensureMedia();
        element.src = track.playback_url;
        // Trim and tape-speed changes are already encoded into the published asset.
        element.playbackRate = 1;
        element.load();
        return play();
    }

    function seek(value) {
        if (!media || !state.duration) return;
        media.currentTime = clampAudioValue(value, 0, state.duration);
        syncTransport();
        resetSignal();
    }

    function setLoop(value) {
        state.loop = Boolean(value);
        if (media) media.loop = state.loop;
    }

    function setBlocked(reason, blocked) {
        if (disposed) return;
        const wasBlocked = blockers.size > 0;
        if (blocked) blockers.add(reason);
        else blockers.delete(reason);
        state.blocked = blockers.size > 0;
        if (!wasBlocked && state.blocked) {
            resumeWhenUnblocked = state.playing || state.pending;
            pause({ preserveResume: true });
        } else if (wasBlocked && !state.blocked && resumeWhenUnblocked) {
            resumeWhenUnblocked = false;
            void play();
        }
    }

    function tick(now) {
        const delta = lastTick === null ? 1 / 60 : Math.max(0, (now - lastTick) / 1000);
        lastTick = now;
        let target = 0;
        if (state.playing && !state.buffering && !state.blocked && !state.analysisError
            && context?.state === 'running' && !media?.seeking) {
            analysers.forEach((analyser, index) => analyser.getFloatTimeDomainData(samples[index]));
            target = getAmplitudeTarget(getAudioRms(samples), state.sensitivity);
        }
        amplitude = smoothAudioAmplitude(amplitude, target, delta);
        if (now - lastMeter >= 100) {
            state.level = amplitude;
            lastMeter = now;
        }
        return amplitude;
    }

    function remove() {
        pause();
        if (media) {
            media.removeAttribute('src');
            media.load();
        }
        state.track = null;
        state.currentTime = 0;
        state.duration = 0;
        state.error = '';
        state.analysisError = '';
    }

    function dispose() {
        remove();
        disposed = true;
        listeners.forEach(([type, listener]) => media?.removeEventListener(type, listener));
        clearAnalysis();
        source?.disconnect();
        gain?.disconnect();
        if (context) void context.close().catch(() => {});
        context = null;
        media = null;
    }

    return { state, activate, play, pause, seek, remove, dispose, tick, setVolume, setMuted,
        setLoop, setBlocked, getAmplitude: () => state.reactiveEnabled && !state.blocked ? amplitude : 0 };
}

export function useViewerAudio() {
    const controller = createViewerAudioController();
    const visibilityChanged = () => controller.setBlocked('visibility', document.hidden);
    onMounted(() => {
        document.addEventListener('visibilitychange', visibilityChanged);
        visibilityChanged();
    });
    onUnmounted(() => {
        document.removeEventListener('visibilitychange', visibilityChanged);
        controller.dispose();
    });
    return controller;
}
