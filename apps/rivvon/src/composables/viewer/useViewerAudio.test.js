import { describe, expect, it, vi } from 'vitest';
import { createViewerAudioController } from './useViewerAudio.js';

const track = { id: 'one', name: 'First track', playback_url: 'https://cdn.example/one.mp4', duration: 20, channel_count: 2, playback_rate: 4 };

function harness() {
    const media = new EventTarget();
    Object.assign(media, { paused: true, seeking: false, currentTime: 0, duration: 20, error: null, volume: 1 });
    media.play = vi.fn(async () => {
        media.paused = false;
        media.dispatchEvent(new Event('playing'));
    });
    media.pause = vi.fn(() => {
        media.paused = true;
        media.dispatchEvent(new Event('pause'));
    });
    media.load = vi.fn();
    media.removeAttribute = vi.fn(() => { media.src = ''; });
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const microphoneSource = { connect: vi.fn(), disconnect: vi.fn() };
    const microphoneTrack = Object.assign(new EventTarget(), {
        label: 'Test microphone', readyState: 'live', stop: vi.fn(),
        getSettings: () => ({ channelCount: 2 }),
    });
    const stream = { getTracks: () => [microphoneTrack], getAudioTracks: () => [microphoneTrack] };
    const getUserMedia = vi.fn(async () => stream);
    const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
    const analysers = [];
    const context = {
        state: 'running', destination: {},
        createMediaElementSource: vi.fn(() => source),
        createMediaStreamSource: vi.fn(() => microphoneSource),
        createGain: vi.fn(() => gain),
        createChannelSplitter: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
        createAnalyser: vi.fn(() => {
            const sign = analysers.length % 2 ? -1 : 1;
            const analyser = { fftSize: 0, disconnect: vi.fn(), getFloatTimeDomainData: vi.fn((data) => data.fill(sign * 0.25)) };
            analysers.push(analyser);
            return analyser;
        }),
        resume: vi.fn(async () => {}), close: vi.fn(async () => {}),
    };
    const createContext = vi.fn(() => context);
    const createMedia = vi.fn(() => media);
    const controller = createViewerAudioController({ createMedia, createContext, getUserMedia });
    return { controller, media, context, source, gain, analysers, createContext, createMedia,
        microphoneSource, microphoneTrack, stream, getUserMedia };
}

describe('viewer audio controller', () => {
    it('avoids immutable CDN responses cached by older non-CORS previews', async () => {
        const { controller, media } = harness();
        await controller.activate({ ...track, playback_url: 'https://cdn.rivvon.ca/audio/test/audio.mp4' });
        expect(media.crossOrigin).toBe('anonymous');
        expect(media.src).toBe('https://cdn.rivvon.ca/audio/test/audio.mp4?rivvon_audio_cors=1');
        expect(controller.state.track.playback_url).toBe('https://cdn.rivvon.ca/audio/test/audio.mp4');
    });

    it('activates published audio at 1x and requests playback and context resume immediately', async () => {
        const { controller, media, context } = harness();
        const activated = controller.activate(track);
        expect(media.crossOrigin).toBe('anonymous');
        expect(media.src).toBe(track.playback_url);
        expect(media.playbackRate).toBe(1);
        expect(context.resume).toHaveBeenCalledOnce();
        expect(media.play).toHaveBeenCalledOnce();
        await activated;
        expect(controller.state.playing).toBe(true);
        expect(controller.state.duration).toBe(20);
    });

    it('keeps playback volume and mute independent of the stereo amplitude signal', async () => {
        const { controller, media, gain } = harness();
        await controller.activate(track);
        controller.state.reactiveEnabled = true;
        controller.tick(0);
        const amplitude = controller.getAmplitude();
        expect(amplitude).toBeGreaterThan(0);
        controller.setVolume(0.2);
        controller.setMuted(true);
        expect(gain.gain.value).toBe(0);
        expect(media.volume).toBe(1);
        // Identical input remains audible to the analyser at zero output gain.
        expect(controller.tick(16)).toBeGreaterThan(amplitude);
        controller.setMuted(false);
        expect(gain.gain.value).toBe(0.2);
    });

    it('reuses one element/source while rebuilding analysis for a new channel count', async () => {
        const { controller, context, createMedia, analysers } = harness();
        await controller.activate(track);
        await controller.activate({ ...track, id: 'two', playback_url: 'https://cdn.example/two.mp4', channel_count: 1 });
        expect(createMedia).toHaveBeenCalledOnce();
        expect(context.createMediaElementSource).toHaveBeenCalledOnce();
        expect(context.createChannelSplitter.mock.calls.map(([count]) => count)).toEqual([2, 1]);
        expect(analysers[0].disconnect).toHaveBeenCalledOnce();
        expect(controller.state.track.id).toBe('two');
    });

    it('resets the signal on pause, seek, buffering, end and removal', async () => {
        const { controller, media } = harness();
        await controller.activate(track);
        controller.state.reactiveEnabled = true;
        controller.tick(16);
        controller.seek(100);
        expect(media.currentTime).toBe(20);
        expect(controller.getAmplitude()).toBe(0);
        controller.tick(32);
        media.dispatchEvent(new Event('waiting'));
        expect(controller.getAmplitude()).toBe(0);
        media.dispatchEvent(new Event('playing'));
        controller.tick(48);
        controller.pause();
        expect(controller.getAmplitude()).toBe(0);
        await controller.play();
        controller.tick(64);
        media.dispatchEvent(new Event('ended'));
        expect(controller.state.playing).toBe(false);
        expect(controller.getAmplitude()).toBe(0);
        controller.remove();
        expect(controller.state.track).toBe(null);
        expect(media.src).toBe('');
    });

    it('waits for all blockers to clear and does not restart audio paused by the user', async () => {
        const { controller, media } = harness();
        await controller.activate(track);
        controller.setBlocked('export', true);
        controller.setBlocked('hidden', true);
        controller.setBlocked('export', false);
        expect(controller.state.playing).toBe(false);
        expect(media.play).toHaveBeenCalledTimes(1);
        controller.setBlocked('hidden', false);
        await Promise.resolve();
        expect(media.play).toHaveBeenCalledTimes(2);
        controller.pause();
        controller.setBlocked('export', true);
        controller.setBlocked('export', false);
        expect(media.play).toHaveBeenCalledTimes(2);
    });

    it('ignores a rejected play promise from a replaced track', async () => {
        const { controller, media } = harness();
        let rejectFirst;
        media.play.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectFirst = reject; }));
        const first = controller.activate(track);
        await controller.activate({ ...track, id: 'two', playback_url: 'https://cdn.example/two.mp4' });
        rejectFirst(new Error('superseded'));
        await first;
        expect(controller.state.track.id).toBe('two');
        expect(controller.state.error).toBe('');
        expect(controller.state.playing).toBe(true);
    });

    it('offers retry when autoplay is rejected', async () => {
        const { controller, media } = harness();
        media.play.mockRejectedValueOnce(new DOMException('gesture required', 'NotAllowedError'));
        await controller.activate(track);
        expect(controller.state.error).toBe('Press Play to start this track.');
        expect(controller.state.pending).toBe(false);
        await controller.play();
        expect(controller.state.playing).toBe(true);
        expect(controller.state.error).toBe('');
    });

    it('allows ordinary playback when analysis is unsupported', async () => {
        const { controller, createContext, media } = harness();
        createContext.mockImplementation(() => { throw new Error('Analysis unavailable'); });
        await controller.activate(track);
        expect(controller.state.playing).toBe(true);
        expect(controller.state.analysisError).toBe('Analysis unavailable');
        controller.setVolume(0.3);
        expect(media.volume).toBe(0.3);
        expect(controller.getAmplitude()).toBe(0);
    });

    it('releases audio resources and prevents a pending request from resurrecting playback', async () => {
        const { controller, media, context, source } = harness();
        let resolvePlay;
        media.play.mockImplementationOnce(() => new Promise((resolve) => { resolvePlay = resolve; }));
        const pending = controller.activate(track);
        controller.dispose();
        resolvePlay();
        await pending;
        media.dispatchEvent(new Event('playing'));
        expect(controller.state.track).toBe(null);
        expect(controller.state.playing).toBe(false);
        expect(context.close).toHaveBeenCalledOnce();
        expect(source.disconnect).toHaveBeenCalled();
        await controller.play();
        expect(media.play).toHaveBeenCalledOnce();
    });
});

describe('viewer microphone input', () => {
    it('requests permission in the gesture and analyses stereo input without speaker playback', async () => {
        const { controller, context, microphoneSource, stream, getUserMedia, createMedia } = harness();
        const pending = controller.startMicrophone();
        expect(context.resume).toHaveBeenCalledOnce();
        expect(getUserMedia).toHaveBeenCalledWith({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false,
        });
        expect(controller.state.microphonePending).toBe(true);
        await controller.startMicrophone();
        await pending;
        await controller.startMicrophone();
        expect(getUserMedia).toHaveBeenCalledOnce();
        expect(context.createMediaStreamSource).toHaveBeenCalledWith(stream);
        expect(context.createChannelSplitter).toHaveBeenCalledWith(2);
        expect(microphoneSource.connect).toHaveBeenCalledOnce();
        expect(microphoneSource.connect).not.toHaveBeenCalledWith(context.destination);
        expect(context.createGain).not.toHaveBeenCalled();
        expect(createMedia).not.toHaveBeenCalled();
        expect(controller.state.microphoneActive).toBe(true);
        expect(controller.state.microphonePending).toBe(false);
        expect(controller.state.microphoneName).toBe('Test microphone');
        expect(controller.state.reactiveEnabled).toBe(true);
        controller.tick(100);
        expect(controller.state.level).toBeGreaterThan(0);
        expect(controller.getAmplitude()).toBeGreaterThan(0);
        controller.setMuted(true);
        controller.tick(116);
        expect(controller.getAmplitude()).toBeGreaterThan(0);
    });

    it.each(['play', 'activate'])('pauses the library track and switches back through %s using its existing media source', async (action) => {
        const { controller, microphoneTrack, context } = harness();
        await controller.activate(track);
        await controller.startMicrophone();
        expect(controller.state.playing).toBe(false);
        expect(controller.state.track.id).toBe(track.id);
        if (action === 'play') await controller.play();
        else await controller.activate(track);
        expect(microphoneTrack.stop).toHaveBeenCalledOnce();
        expect(controller.state.microphoneActive).toBe(false);
        expect(controller.state.playing).toBe(true);
        expect(context.createMediaElementSource).toHaveBeenCalledOnce();
        controller.tick(100);
        expect(controller.getAmplitude()).toBeGreaterThan(0);
    });

    it.each(['stop', 'remove', 'dispose'])('stops capture and resets the signal immediately on %s', async (action) => {
        const { controller, microphoneTrack, microphoneSource, analysers } = harness();
        await controller.startMicrophone();
        controller.tick(100);
        if (action === 'stop') controller.stopMicrophone();
        if (action === 'remove') controller.remove();
        if (action === 'dispose') controller.dispose();
        expect(controller.getAmplitude()).toBe(0);
        expect(controller.state.level).toBe(0);
        expect(controller.state.microphoneActive).toBe(false);
        expect(microphoneTrack.stop).toHaveBeenCalledOnce();
        expect(microphoneSource.disconnect).toHaveBeenCalledOnce();
        expect(analysers.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
    });

    it.each(['cancel', 'suspend', 'replace', 'remove', 'dispose'])('releases a late permission grant after %s', async (action) => {
        const { controller, microphoneTrack, stream, getUserMedia, context } = harness();
        let grant;
        getUserMedia.mockImplementationOnce(() => new Promise((resolve) => { grant = resolve; }));
        const pending = controller.startMicrophone();
        if (action === 'cancel') controller.stopMicrophone();
        if (action === 'suspend') controller.setBlocked('visibility', true);
        if (action === 'replace') await controller.activate(track);
        if (action === 'remove') controller.remove();
        if (action === 'dispose') controller.dispose();
        grant(stream);
        await pending;
        expect(microphoneTrack.stop).toHaveBeenCalledOnce();
        expect(controller.state.microphoneActive).toBe(false);
        expect(controller.state.microphonePending).toBe(false);
        expect(context.createMediaStreamSource).not.toHaveBeenCalled();
    });

    it('stops on suspension and requires explicit restart after all blockers clear', async () => {
        const { controller, microphoneTrack, getUserMedia, media } = harness();
        await controller.activate(track);
        await controller.startMicrophone();
        controller.tick(100);
        controller.setBlocked('visibility', true);
        controller.setBlocked('export', true);
        expect(microphoneTrack.stop).toHaveBeenCalledOnce();
        expect(controller.getAmplitude()).toBe(0);
        expect(controller.state.microphoneNotice).toContain('Start it again');
        await controller.startMicrophone();
        expect(getUserMedia).toHaveBeenCalledOnce();
        controller.setBlocked('visibility', false);
        controller.setBlocked('export', false);
        expect(getUserMedia).toHaveBeenCalledOnce();
        expect(media.play).toHaveBeenCalledOnce();
        expect(controller.state.microphoneActive).toBe(false);
    });

    it('releases capture on device disconnection and reports a retryable error', async () => {
        const { controller, microphoneTrack } = harness();
        await controller.startMicrophone();
        controller.tick(100);
        microphoneTrack.dispatchEvent(new Event('ended'));
        expect(controller.state.microphoneActive).toBe(false);
        expect(controller.getAmplitude()).toBe(0);
        expect(microphoneTrack.stop).toHaveBeenCalledOnce();
        expect(controller.state.microphoneError).toContain('disconnected');
    });

    it.each([
        ['NotAllowedError', 'denied'], ['NotFoundError', 'No microphone'], ['NotReadableError', 'unavailable'],
    ])('reports %s and lets the user retry', async (name, message) => {
        const { controller, getUserMedia } = harness();
        getUserMedia.mockRejectedValueOnce(new DOMException('Input failed', name));
        await controller.startMicrophone();
        expect(controller.state.microphonePending).toBe(false);
        expect(controller.state.microphoneActive).toBe(false);
        expect(controller.state.microphoneError).toContain(message);
        await controller.startMicrophone();
        expect(controller.state.microphoneError).toBe('');
        expect(controller.state.microphoneActive).toBe(true);
    });

    it.each(['resume', 'graph'])('releases an acquired stream when %s fails', async (failure) => {
        const { controller, context, microphoneTrack } = harness();
        if (failure === 'resume') context.resume.mockRejectedValueOnce(new Error('resume failed'));
        else context.createMediaStreamSource.mockImplementationOnce(() => { throw new Error('graph failed'); });
        await controller.startMicrophone();
        expect(microphoneTrack.stop).toHaveBeenCalledOnce();
        expect(controller.state.microphoneActive).toBe(false);
        expect(controller.state.microphoneError).not.toBe('');
    });

    it('does not acquire input when analysis is unsupported', async () => {
        const { controller, createContext, getUserMedia } = harness();
        createContext.mockImplementationOnce(() => { throw new Error('Audio analysis unavailable'); });
        await controller.startMicrophone();
        expect(getUserMedia).not.toHaveBeenCalled();
        expect(controller.state.microphonePending).toBe(false);
        expect(controller.state.microphoneError).toBe('Audio analysis unavailable');
    });

    it('ignores a cancelled request rejection while a newer microphone request succeeds', async () => {
        const { controller, getUserMedia } = harness();
        let reject;
        getUserMedia.mockImplementationOnce(() => new Promise((resolve, fail) => { reject = fail; }));
        const old = controller.startMicrophone();
        controller.stopMicrophone();
        await controller.startMicrophone();
        reject(new DOMException('denied', 'NotAllowedError'));
        await old;
        expect(controller.state.microphoneActive).toBe(true);
        expect(controller.state.microphoneError).toBe('');
    });
});
