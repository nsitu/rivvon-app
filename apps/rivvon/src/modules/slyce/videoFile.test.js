import { describe, expect, it } from 'vitest';
import { isVideoFile, VIDEO_FILE_ACCEPT } from './videoFile.js';

describe('video file intake', () => {
    it('includes MTS in the picker accept value', () => {
        expect(VIDEO_FILE_ACCEPT).toContain('.mts');
        expect(VIDEO_FILE_ACCEPT).toContain('video/*');
    });

    it('accepts MTS files when the browser reports a generic MIME type', () => {
        expect(isVideoFile({ name: 'Sony clip.MTS', type: 'application/octet-stream' })).toBe(true);
        expect(isVideoFile({ name: 'Sony clip.mts', type: '' })).toBe(true);
    });

    it('accepts regular browser-reported video files', () => {
        expect(isVideoFile({ name: 'clip.mp4', type: 'video/mp4' })).toBe(true);
    });

    it('does not treat unrelated files as videos', () => {
        expect(isVideoFile({ name: 'notes.mtsx', type: 'application/octet-stream' })).toBe(false);
        expect(isVideoFile({ name: 'notes.txt', type: 'text/plain' })).toBe(false);
        expect(isVideoFile(null)).toBe(false);
    });
});
