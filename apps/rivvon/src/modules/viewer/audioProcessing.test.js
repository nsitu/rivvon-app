import { describe, expect, it } from 'vitest';
import {
    AUDIO_PLAYBACK_RATE_STOPS,
    getAudioOutputDuration,
    MAX_AUDIO_PLAYBACK_RATE,
    MIN_AUDIO_PLAYBACK_RATE,
    normalizeAudioPlaybackRate,
} from './audioProcessing.js';

describe('audio playback-rate processing', () => {
    it('exposes the discrete playback-rate stops used by the editor', () => {
        expect(AUDIO_PLAYBACK_RATE_STOPS).toEqual([0.125, 0.25, 0.5, 1, 2, 4, 8]);
    });

    it('maps a source selection to the expected saved duration', () => {
        expect(getAudioOutputDuration(0, 80, 8)).toBe(10);
        expect(getAudioOutputDuration(12, 22, 1)).toBe(10);
        expect(getAudioOutputDuration(0, 10, 0.5)).toBe(20);
    });

    it('clamps invalid playback rates to the supported range', () => {
        expect(normalizeAudioPlaybackRate(0)).toBe(MIN_AUDIO_PLAYBACK_RATE);
        expect(normalizeAudioPlaybackRate(99)).toBe(MAX_AUDIO_PLAYBACK_RATE);
        expect(normalizeAudioPlaybackRate('not a rate')).toBe(1);
    });
});
