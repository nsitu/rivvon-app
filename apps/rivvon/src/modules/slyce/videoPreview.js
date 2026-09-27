import {
    BlobSource,
    BufferTarget,
    Conversion,
    Input,
    MPEG_TS,
    Mp4OutputFormat,
    Output,
} from 'mediabunny';
import { isTransportStreamFile } from './videoFile.js';

const remuxPromises = new WeakMap();

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

        if (!target.buffer) {
            throw new Error('The MP4 preview remux produced no output.');
        }

        return new Blob([target.buffer], { type: 'video/mp4' });
    } finally {
        input.dispose();
    }
}

/**
 * Return a browser/WebCodecs-friendly source for a video file. MPEG transport
 * streams are remuxed once and shared by the preview and texture sampler.
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
