import {
    BlobSource,
    BufferTarget,
    Conversion,
    EncodedPacketSink,
    EncodedVideoPacketSource,
    Input,
    MPEG_TS,
    Mp4OutputFormat,
    Output,
} from 'mediabunny';
import { isTransportStreamFile } from './videoFile.js';
import { inspectSonyAvchd } from './sonyAvchd.js';

const remuxPromises = new WeakMap();
const interlacedSources = new WeakMap();

export function getInterlacedSource(file) {
    return interlacedSources.get(file) ?? null;
}

/**
 * Remux an MPEG transport stream into a browser-playable, video-only MP4.
 *
 * The H.264 video packets are copied without re-encoding. Audio and subtitle
 * tracks are intentionally omitted because the setup preview is muted and
 * texture generation only consumes video frames.
 */
async function createTransportStreamMp4(file) {
    if (!(file instanceof Blob) || !file.size) {
        throw new Error('A non-empty transport stream file is required for preview remuxing.');
    }

    const input = new Input({
        formats: [MPEG_TS],
        source: new BlobSource(file),
    });
    const target = new BufferTarget();
    const output = new Output({
        format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
        target,
    });

    try {
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error('The transport stream has no video track.');
        const profile = await inspectSonyAvchd(track);
        if (profile) {
            // The generic conversion currently derives a half-height AVC config
            // and trims leading reordered fields. Preserve every field packet,
            // normalize by the earliest presentation time, and supply the SPS
            // dimensions validated by our field-aware inspector.
            const source = new EncodedVideoPacketSource('avc');
            output.addVideoTrack(source, { frameRate: 1 / profile.fieldDuration });
            await output.start();
            const decoderConfig = {
                ...await track.getDecoderConfig(),
                codedWidth: profile.width, codedHeight: profile.height,
                displayAspectWidth: profile.width, displayAspectHeight: profile.height,
            };
            for await (const packet of new EncodedPacketSink(track).packets()) {
                await source.add(packet.clone({
                    timestamp: packet.timestamp - profile.origin,
                    duration: profile.frameDuration,
                }), { decoderConfig });
            }
            source.close();
            await output.finalize();
        } else {
            await remuxProgressive(input, output);
        }

        if (!target.buffer) {
            throw new Error('The MP4 preview remux produced no output.');
        }

        const sourceName = typeof file.name === 'string' && file.name.trim()
            ? file.name.trim()
            : 'video.mts';
        const outputName = sourceName.replace(/\.(?:mts|m2ts)$/i, '') + '.mp4';
        const outputBlob = new Blob([target.buffer], { type: 'video/mp4' });

        // Keep the remuxed source identifiable after replacing the original MTS.
        const result = typeof File === 'function'
            ? new File([outputBlob], outputName, {
                type: 'video/mp4',
                lastModified: typeof file.lastModified === 'number' ? file.lastModified : Date.now(),
            })
            : outputBlob;
        if (profile) interlacedSources.set(result, { file, profile });
        return result;
    } finally {
        input.dispose();
    }
}

async function remuxProgressive(input, output) {
    const conversion = await Conversion.init({
        input,
        output,
        tracks: 'primary',
        audio: { discard: true },
        copy: { mode: 'forced' },
        showWarnings: false,
    });

    if (!conversion.isValid) {
        const discardedReasons = conversion.discardedTracks
            .map(({ reason }) => reason)
            .filter(Boolean);
        const reason = discardedReasons.length > 0
            ? ` (${discardedReasons.join(', ')})`
            : '';
        throw new Error(`This transport stream cannot be remuxed to MP4${reason}.`);
    }
    await conversion.execute();
}

/**
 * Return a browser-friendly preview source. Transport streams are remuxed once;
 * supported interlaced sources retain their original field stream for sampling.
 */
export function getVideoProcessingFile(file) {
    if (!isTransportStreamFile(file)) {
        return Promise.resolve(file);
    }

    return remuxTransportStreamToMp4(file);
}

export function remuxTransportStreamToMp4(file) {
    if (!(file instanceof Blob) || !file.size) {
        return Promise.reject(new Error('A non-empty transport stream file is required for preview remuxing.'));
    }

    const cachedPromise = remuxPromises.get(file);
    if (cachedPromise) {
        return cachedPromise;
    }

    const remuxPromise = createTransportStreamMp4(file).catch((error) => {
        remuxPromises.delete(file);
        throw error;
    });
    remuxPromises.set(file, remuxPromise);
    return remuxPromise;
}
