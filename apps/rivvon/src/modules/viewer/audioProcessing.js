import {
    ALL_FORMATS,
    AudioSampleSink,
    BlobSource,
    BufferTarget,
    Conversion,
    Input,
    Mp4OutputFormat,
    Output,
} from 'mediabunny';

const DEFAULT_WAVEFORM_BINS = 1200;

function createInput(file) {
    return new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
}

export async function inspectAudioSource(file) {
    if (!(file instanceof Blob) || !file.size) throw new Error('Choose a non-empty audio or video file.');
    const input = createInput(file);
    try {
        const track = await input.getPrimaryAudioTrack();
        if (!track) throw new Error('The selected file does not contain an audio track.');
        if (!(await track.canDecode())) throw new Error('This browser cannot decode the audio track in that file.');
        const duration = await track.computeDuration();
        if (!Number.isFinite(duration) || duration <= 0) throw new Error('The audio track has an invalid duration.');
        return {
            duration,
            sampleRate: track.sampleRate,
            channelCount: track.numberOfChannels,
            codec: track.codec,
            sourceType: file.type || 'application/octet-stream',
        };
    } finally {
        input.dispose();
    }
}

export async function createAudioWaveform(file, { bins = DEFAULT_WAVEFORM_BINS, onProgress } = {}) {
    if (!(file instanceof Blob) || !file.size) throw new Error('A source file is required.');
    const input = createInput(file);
    try {
        const track = await input.getPrimaryAudioTrack();
        if (!track) throw new Error('The selected file does not contain an audio track.');
        if (!(await track.canDecode())) throw new Error('This browser cannot decode the audio track in that file.');
        const duration = await track.computeDuration();
        const peaks = new Float32Array(Math.max(32, Math.floor(bins)));
        const sink = new AudioSampleSink(track);
        let processedDuration = 0;

        for await (const sample of sink.samples()) {
            const data = new Float32Array(sample.allocationSize({ planeIndex: 0, format: 'f32' }) / 4);
            sample.copyTo(data, { planeIndex: 0, format: 'f32' });
            const start = Math.max(0, sample.timestamp);
            const end = Math.min(duration, sample.timestamp + sample.duration);
            const firstBin = Math.max(0, Math.floor((start / duration) * peaks.length));
            const lastBin = Math.min(peaks.length - 1, Math.ceil((end / duration) * peaks.length));
            const frames = Math.max(1, sample.numberOfFrames);
            const channels = Math.max(1, sample.numberOfChannels);

            for (let frame = 0; frame < frames; frame += 1) {
                let amplitude = 0;
                for (let channel = 0; channel < channels; channel += 1) {
                    amplitude = Math.max(amplitude, Math.abs(data[frame * channels + channel] || 0));
                }
                const ratio = frames <= 1 ? 0 : frame / (frames - 1);
                const bin = Math.min(peaks.length - 1, Math.max(firstBin, Math.floor((firstBin + (lastBin - firstBin) * ratio))));
                peaks[bin] = Math.max(peaks[bin], amplitude);
            }

            processedDuration = Math.max(processedDuration, end);
            onProgress?.(duration ? processedDuration / duration : 0);
            sample.close();
        }
        return { peaks: Array.from(peaks), duration };
    } finally {
        input.dispose();
    }
}

export async function trimAudioSource(file, { start = 0, end, onProgress } = {}) {
    if (!(file instanceof Blob) || !file.size) throw new Error('A source file is required.');
    const sourceInput = createInput(file);
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    try {
        const duration = await sourceInput.computeDuration();
        const boundedStart = Math.max(0, Number(start) || 0);
        const boundedEnd = Math.min(duration, Number.isFinite(Number(end)) ? Number(end) : duration);
        if (!(boundedEnd > boundedStart)) throw new Error('The selected audio range is invalid.');

        const conversion = await Conversion.init({
            input: sourceInput,
            output,
            video: { discard: true },
            audio: { forceTranscode: true, codec: 'aac', bitrate: 128_000 },
            trim: { start: boundedStart, end: boundedEnd },
            showWarnings: false,
        });
        if (!conversion.isValid) throw new Error('The selected audio cannot be encoded in this browser.');
        conversion.onProgress = (progress) => onProgress?.(progress);
        await conversion.execute();
        await output.finalize();
        const buffer = target.buffer;
        if (!buffer?.byteLength) throw new Error('Audio encoding produced an empty file.');
        return new Blob([buffer], { type: 'audio/mp4' });
    } finally {
        if (output.state === 'started' || output.state === 'finalizing') {
            await output.cancel().catch(() => {});
        }
        sourceInput.dispose();
    }
}
