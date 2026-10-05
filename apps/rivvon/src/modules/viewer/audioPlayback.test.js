import { describe, expect, it } from 'vitest';
import { getAudioPlaybackUrl } from './audioPlayback.js';

describe('CORS audio playback URLs', () => {
    it('uses a stable cache namespace distinct from legacy non-CORS previews', () => {
        const original = 'https://cdn.rivvon.ca/audio/example/audio.mp4';
        const playback = getAudioPlaybackUrl(original);
        expect(playback).toBe(`${original}?rivvon_audio_cors=1`);
        expect(getAudioPlaybackUrl(original)).toBe(playback);
        expect(getAudioPlaybackUrl(playback)).toBe(playback);
    });

    it('preserves other query parameters and fragments', () => {
        const playback = new URL(getAudioPlaybackUrl('https://cdn.rivvon.ca/audio/example/audio.mp4?variant=small#t=2'));
        expect(playback.searchParams.get('variant')).toBe('small');
        expect(playback.searchParams.get('rivvon_audio_cors')).toBe('1');
        expect(playback.hash).toBe('#t=2');
    });

    it('leaves signed, local and other-provider URLs unchanged', () => {
        for (const url of ['https://example.com/audio.mp4?signature=abc%2Fdef', 'blob:https://rivvon.ca/test', '/audio/test.mp4', '']) {
            expect(getAudioPlaybackUrl(url)).toBe(url);
        }
    });
});
