import { inspectMp4Colour } from './videoColourMetadata.js';
import { getRuntimeAssetUrl } from '../shared/runtimeAssets.js';

const keys = ['primaries', 'transfer', 'matrix', 'fullRange'];
const enums = {
    primaries: { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9, smpte432: 12 },
    transfer: { bt709: 1, smpte170m: 6, 'iec61966-2-1': 13, 'pq': 16, 'hlg': 18 },
    matrix: { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6, 'bt2020-ncl': 9 },
};
const missing = (colour, key) => colour[key] == null || (key !== 'fullRange' && colour[key] === 2);
const agrees = (a, b) => keys.every(key => a[key] === b[key]);
const abortError = () => new DOMException('Video export cancelled', 'AbortError');

export function planSpsColourRepair(metadata, decoderColourSpaces = []) {
    const skip = reason => ({ status: 'skipped', reason });
    if (!metadata.sps?.length || !metadata.sampleEntries?.every(entry => entry === 'avc1' || entry === 'avc3')) {
        return skip('No inspectable AVC SPS was found.');
    }
    if (!metadata.sps.some(sps => keys.some(key => missing(sps, key)))) return { status: 'not-needed' };
    const colour = metadata.container?.[0];
    if (!colour || keys.some(key => missing(colour, key)) || !metadata.container.every(c => agrees(c, colour))) {
        return skip('Container colour declarations are missing or inconsistent.');
    }
    if (!decoderColourSpaces.length || decoderColourSpaces.some(c => !c || typeof c.fullRange !== 'boolean'
        || !agrees(colour, { primaries: enums.primaries[c.primaries], transfer: enums.transfer[c.transfer],
            matrix: enums.matrix[c.matrix], fullRange: c.fullRange }))) {
        return skip('Encoder colour declarations are missing, unsupported or disagree with the container.');
    }
    if (metadata.sps.some(sps => keys.some(key => !missing(sps, key) && sps[key] !== colour[key]))) {
        return skip('Existing SPS colour fields conflict with the declared output.');
    }
    if (![metadata.timescale, metadata.movieTimescale].every(n => Number.isInteger(n) && n > 0 && n <= 0x7fffffff)) {
        return skip('The original MP4 clocks cannot be preserved by the repair tool.');
    }
    return { status: 'needed', colour: { ...colour }, tool: 'FFmpeg h264_metadata',
        bitstreamFilter: `h264_metadata=colour_primaries=${colour.primaries}:transfer_characteristics=${colour.transfer}:matrix_coefficients=${colour.matrix}:video_full_range_flag=${Number(colour.fullRange)}` };
}

export function getSpsColourRepairArgs(plan, metadata) {
    const colour = plan.colour;
    return ['-copyts', '-i', 'input.mp4', '-map', '0:v:0', '-c:v', 'copy', '-bsf:v', plan.bitstreamFilter,
        '-color_primaries', String(colour.primaries), '-color_trc', String(colour.transfer), '-colorspace', String(colour.matrix),
        '-color_range', colour.fullRange ? 'pc' : 'tv', '-avoid_negative_ts', 'disabled',
        '-video_track_timescale', String(metadata.timescale), '-movie_timescale', String(metadata.movieTimescale),
        '-movflags', '+faststart+write_colr', 'repaired.mp4'];
}

// Compare run-length timing tables without allocating one entry per frame.
function sameTimeline(a, b) {
    let ai = 0, bi = 0, ar = a[0]?.count ?? 0, br = b[0]?.count ?? 0;
    while (ai < a.length && bi < b.length) {
        if (a[ai].value !== b[bi].value) return false;
        const step = Math.min(ar, br);
        if (step <= 0) return false;
        ar -= step; br -= step;
        if (!ar) ar = a[++ai]?.count ?? 0;
        if (!br) br = b[++bi]?.count ?? 0;
    }
    return ai === a.length && bi === b.length;
}

export function assertSpsColourRepair(before, after, colour) {
    if (!after.sps.length || after.container.length !== before.container.length
        || !after.sps.every(sps => agrees(sps, colour)) || !after.container.every(c => agrees(c, colour))) {
        throw new Error('SPS colour repair did not produce matching bitstream and container declarations.');
    }
    const formatKeys = ['width', 'height', 'chromaFormat', 'bitDepthLuma', 'bitDepthChroma'];
    const edits = metadata => (metadata.edits ?? []).filter(edit => edit.mediaTime !== 0 || edit.rateInteger !== 1
        || edit.rateFraction !== 0 || edit.duration !== metadata.movieDurationTicks);
    if (after.sps.length !== before.sps.length || before.sps.some((sps, i) => formatKeys.some(key => sps[key] !== after.sps[i][key]))
        || ['frameCount', 'durationTicks', 'timescale', 'mediaDurationTicks', 'movieTimescale', 'movieDurationTicks'].some(key => before[key] !== after[key])
        || !sameTimeline(before.sampleTiming, after.sampleTiming) || !sameTimeline(before.compositionTiming, after.compositionTiming)
        || JSON.stringify(edits(before)) !== JSON.stringify(edits(after))) {
        throw new Error('SPS colour repair changed the video format or frame timing.');
    }
}

export async function repairMissingSpsColour(data, { decoderColourSpaces, signal, onStatus } = {}) {
    if (signal?.aborted) throw abortError();
    const before = inspectMp4Colour(data, { includeTiming: true });
    const plan = planSpsColourRepair(before, decoderColourSpaces);
    if (plan.status !== 'needed') return { data, repair: plan };
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ffmpeg = new FFmpeg();
    let terminated = false;
    const logs = [];
    const dispose = () => {
        signal?.removeEventListener('abort', dispose);
        if (!terminated) { terminated = true; ffmpeg.terminate(); }
    };
    const check = () => { if (signal?.aborted || terminated) throw abortError(); };
    signal?.addEventListener('abort', dispose, { once: true });
    ffmpeg.on('log', ({ message }) => { logs.push(message); if (logs.length > 20) logs.shift(); });
    try {
        check(); onStatus?.('Loading SPS colour repair tool…');
        check();
        const base = `${import.meta.env.BASE_URL}vendor/ffmpeg/0.12.10/`;
        await ffmpeg.load({ coreURL: `${base}ffmpeg-core.js`, wasmURL: getRuntimeAssetUrl('ffmpegCoreWasm') });
        check(); onStatus?.('Adding missing H.264 colour declarations…');
        check();
        // writeFile transfers its buffer; retain the original for validation/test copies.
        await ffmpeg.writeFile('input.mp4', data.slice());
        check();
        if (await ffmpeg.exec(getSpsColourRepairArgs(plan, before)) !== 0) {
            throw new Error(`H.264 colour repair failed: ${logs.slice(-6).join('\n')}`);
        }
        check();
        const repaired = await ffmpeg.readFile('repaired.mp4');
        const after = inspectMp4Colour(repaired, { includeTiming: true });
        assertSpsColourRepair(before, after, plan.colour);
        return { data: repaired, repair: { ...plan, status: 'added', originalSps: before.sps,
            sampleConversion: false, timingPreserved: true } };
    } catch (error) { if (signal?.aborted) throw abortError(); throw error; }
    finally { dispose(); }
}
