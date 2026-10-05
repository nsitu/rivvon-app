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
    const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
    const analysers = [];
    const context = {
        state: 'running', destination: {},
        createMediaElementSource: vi.fn(() => source),
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
    const controller = createViewerAudioController({ createMedia, createContext });
    return { controller, media, context, source, gain, analysers, createContext, createMedia };
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
