export const MAX_CLIP_BYTES = 1_000_000_000; // 1 GB (decimal), shared by client and API.
export const CLIP_UPLOAD_PART_BYTES = 8 * 1024 * 1024;
export const MAX_CLIP_SINGLE_UPLOAD_BYTES = 64 * 1024 * 1024;
export const MAX_CLIP_INSPECTION_BYTES = 128 * 1024 * 1024;
export const MAX_CLIP_DURATION = 60;
export const MAX_CLIP_SIDE = 1920;
export const MAX_CLIP_PIXELS = 1920 * 1080;
export const MAX_CLIP_FPS = 60;
export const CLIP_MIME_TYPE = 'video/mp4';

// Inspect AVC's SPS rather than trusting the filename, MIME, or upload form.
// The initial resource format is deliberately limited to progressive 8-bit 4:2:0.
export function validateClipAvc(description) {
    const bytes = new Uint8Array(description || []);
    if (bytes.length < 8 || bytes[0] !== 1 || ![66, 77, 100].includes(bytes[1])) throw new Error('Use an SDR H.264 MP4 clip (Baseline, Main, or High profile).');
    let offset = 6;
    const count = bytes[5] & 31;
    if (!count) throw new Error('The clip has no AVC sequence parameters.');
    for (let index = 0; index < count; index++) {
        const size = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2;
        if (!size || offset + size > bytes.length) throw new Error('Invalid AVC parameters.');
        const raw = bytes.slice(offset + 1, offset + size); offset += size;
        const rbsp = [];
        for (let i = 0; i < raw.length; i++) {
            if (i >= 2 && raw[i] === 3 && raw[i - 1] === 0 && raw[i - 2] === 0) continue;
            rbsp.push(raw[i]);
        }
        let bit = 0;
        const read = (n = 1) => { let result = 0; for (let i = 0; i < n; i++) { if (bit >= rbsp.length * 8) throw new Error('Truncated AVC parameters.'); result = result * 2 + ((rbsp[bit >> 3] >> (7 - (bit++ & 7))) & 1); } return result; };
        const ue = () => { let zeros = 0; while (!read()) { if (++zeros > 24) throw new Error('Invalid AVC parameters.'); } return 2 ** zeros - 1 + read(zeros); };
        const se = () => { const value = ue(); return value % 2 ? (value + 1) / 2 : -value / 2; };
        const profile = read(8); read(16); ue();
        if (profile !== bytes[1]) throw new Error('Inconsistent AVC profile parameters.');
        if (profile === 100) {
            if (ue() !== 1 || ue() !== 0 || ue() !== 0) throw new Error('Use an 8-bit 4:2:0 clip.');
            read();
            if (read()) for (let list = 0; list < 8; list++) if (read()) {
                let last = 8, next = 8;
                for (let j = 0; j < (list < 6 ? 16 : 64); j++) { if (next) next = (last + se() + 256) % 256; last = next || last; }
            }
        }
        ue(); const order = ue();
        if (order === 0) ue();
        else if (order === 1) { read(); se(); se(); const cycles = ue(); if (cycles > 255) throw new Error('Invalid AVC parameters.'); for (let i = 0; i < cycles; i++) se(); }
        else if (order !== 2) throw new Error('Invalid AVC parameters.');
        ue(); read(); ue(); ue();
        if (!read()) throw new Error('Interlaced clips are not supported. Convert to progressive MP4.');
    }
}

// Works with Mediabunny Input in the browser and a bounded R2 source in Workers.
export async function inspectClipInput(input) {
    const tracks = await input.getVideoTracks();
    if (tracks.length !== 1) throw new Error('Choose an MP4 with one video track.');
    const track = tracks[0], config = await track.getDecoderConfig();
    if (!/^avc1\./i.test(config?.codec || '')) throw new Error('Choose an H.264 MP4 clip. Other codecs are not supported yet.');
    validateClipAvc(config.description);
    const color = config.colorSpace;
    if (color && ((color.transfer && !['bt709', 'smpte170m', 'iec61966-2-1'].includes(color.transfer))
        || (color.primaries && !['bt709', 'smpte170m', 'bt470bg'].includes(color.primaries)))) throw new Error('HDR and wide-gamut clips are not supported. Convert to SDR MP4.');
    const width = track.displayWidth, height = track.displayHeight;
    const start = await track.getFirstTimestamp();
    const duration = (await track.computeDuration()) - start;
    const stats = await track.computePacketStats();
    const fps = stats.averagePacketRate;
    if (![width, height, track.codedWidth, track.codedHeight].every(n => Number.isInteger(n) && n > 0 && n <= MAX_CLIP_SIDE)
        || width * height > MAX_CLIP_PIXELS || track.codedWidth * track.codedHeight > MAX_CLIP_PIXELS
        || !Number.isFinite(duration) || duration <= 0 || duration > MAX_CLIP_DURATION + 1e-6
        || !Number.isFinite(start) || !Number.isFinite(fps) || fps <= 0 || fps > MAX_CLIP_FPS + 0.01) {
        throw new Error('Clips must be at most 60 seconds, 60 fps, and 1920 × 1080 pixels (portrait is supported).');
    }
    return { width, height, duration, firstTimestamp: start, fps, codec: config.codec, rotation: track.rotation, codedWidth: track.codedWidth, codedHeight: track.codedHeight };
}
