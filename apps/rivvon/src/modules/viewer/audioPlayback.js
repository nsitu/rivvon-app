// Old native previews loaded CDN assets without Origin. Those immutable cache
// entries can lack both Access-Control-Allow-Origin and Vary: Origin, so they
// cannot be reused by the viewer's Web Audio source. Use one stable CORS cache
// namespace for every audio player; do not create a new URL on each playback.
export function getAudioPlaybackUrl(value) {
    if (!value) return '';
    try {
        const url = new URL(value);
        // Only modify our public CDN URLs. Other providers may use signed URLs.
        if (url.origin !== 'https://cdn.rivvon.ca') return value;
        url.searchParams.set('rivvon_audio_cors', '1');
        return url.href;
    } catch {
        return value;
    }
}
