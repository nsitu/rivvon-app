import {
    ALL_FORMATS,
    AudioBufferSink,
    AudioBufferSource as MediaAudioBufferSource,
    AudioSampleSink,
    BlobSource,
    BufferTarget,
    Input,
    Mp4OutputFormat,
    Output,
} from 'mediabunny';

const DEFAULT_WAVEFORM_BINS = 1200;
export const MIN_AUDIO_PLAYBACK_RATE = 0.125;
export const MAX_AUDIO_PLAYBACK_RATE = 16;
export const AUDIO_PLAYBACK_RATE_STOPS = Object.freeze([0.125, 0.25, 0.5, 1, 2, 4, 8]);

export function getAudioPlaybackRateStopIndex(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return AUDIO_PLAYBACK_RATE_STOPS.indexOf(1);

    return AUDIO_PLAYBACK_RATE_STOPS.reduce((closestIndex, stop, index, stops) => (
        Math.abs(stop - numericValue) < Math.abs(stops[closestIndex] - numericValue)
            ? index
            : closestIndex
    ), AUDIO_PLAYBACK_RATE_STOPS.indexOf(1));
}

export function normalizeAudioPlaybackRate(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 1;
    return Math.min(MAX_AUDIO_PLAYBACK_RATE, Math.max(MIN_AUDIO_PLAYBACK_RATE, numericValue));
}

export function getSuggestedAudioPlaybackRate({ sourceKind = 'file', frameRate } = {}) {
    if (sourceKind === 'recording') return 1;

    const roundedFrameRate = Math.round(Number(frameRate));
    if (roundedFrameRate === 240) return 8;
    if (roundedFrameRate === 120) return 4;
    return 1;
}

export function getAudioOutputDuration(start, end, playbackRate = 1) {
    const sourceDuration = Math.max(0, Number(end) - Number(start));
    return sourceDuration / normalizeAudioPlaybackRate(playbackRate);
}

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
        const videoTrack = await input.getPrimaryVideoTrack();
        const frameRate = videoTrack
            ? (await videoTrack.computePacketStats()).averagePacketRate
            : null;
        return {
            duration,
            sampleRate: track.sampleRate,
            channelCount: track.numberOfChannels,
            codec: track.codec,
            frameRate,
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

async function renderAudioAtPlaybackRate(track, { start, end, playbackRate, onProgress }) {
    const OfflineAudioContextConstructor = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (!OfflineAudioContextConstructor) {
        throw new Error('This browser does not support offline audio processing.');
    }

    const sink = new AudioBufferSink(track);
    const decodedBuffers = [];
    const sourceDuration = end - start;
    let sampleRate = Number(track.sampleRate) || 0;
    let channelCount = Number(track.numberOfChannels) || 0;

    for await (const wrappedBuffer of sink.buffers(start, end)) {
        const { buffer } = wrappedBuffer;
        sampleRate ||= buffer.sampleRate;
        channelCount ||= buffer.numberOfChannels;
        if (buffer.sampleRate !== sampleRate || buffer.numberOfChannels !== channelCount) {
            throw new Error('The audio track changes format during decoding.');
        }
        decodedBuffers.push(wrappedBuffer);
        const decodedEnd = Math.min(end, wrappedBuffer.timestamp + wrappedBuffer.duration);
        onProgress?.(.05 + Math.max(0, Math.min(1, (decodedEnd - start) / sourceDuration)) * .45);
    }

    if (!decodedBuffers.length || !sampleRate || !channelCount) {
        throw new Error('The selected audio range could not be decoded.');
    }

    const rate = normalizeAudioPlaybackRate(playbackRate);
    const inputFrameCount = Math.max(1, Math.ceil(sourceDuration * sampleRate));
    const outputFrameCount = Math.max(1, Math.ceil((sourceDuration / rate) * sampleRate));
    const context = new OfflineAudioContextConstructor(channelCount, outputFrameCount, sampleRate);
    const inputBuffer = context.createBuffer(channelCount, inputFrameCount, sampleRate);

    for (const wrappedBuffer of decodedBuffers) {
        const { buffer } = wrappedBuffer;
        const sourceRate = buffer.sampleRate;
        const firstFrame = Math.max(0, Math.floor((start - wrappedBuffer.timestamp) * sourceRate));
        const lastFrame = Math.min(buffer.length, Math.ceil((end - wrappedBuffer.timestamp) * sourceRate));
        const frameCount = Math.max(0, lastFrame - firstFrame);
        const destinationFrame = Math.max(0, Math.floor(
            (wrappedBuffer.timestamp + firstFrame / sourceRate - start) * sampleRate,
        ));
        const copyFrameCount = Math.min(frameCount, inputFrameCount - destinationFrame);
        if (copyFrameCount <= 0) continue;

        for (let channel = 0; channel < channelCount; channel += 1) {
            const sourceData = buffer.getChannelData(channel).subarray(firstFrame, firstFrame + copyFrameCount);
            inputBuffer.getChannelData(channel).set(sourceData, destinationFrame);
        }
    }

    onProgress?.(.55);
    const source = context.createBufferSource();
    source.buffer = inputBuffer;
    source.playbackRate.value = rate;
    source.connect(context.destination);
    source.start(0);
    const renderedBuffer = await context.startRendering();
    onProgress?.(.82);
    return renderedBuffer;
}

export async function trimAudioSource(file, { start = 0, end, playbackRate = 1, onProgress } = {}) {
    if (!(file instanceof Blob) || !file.size) throw new Error('A source file is required.');
    const sourceInput = createInput(file);
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    try {
        const track = await sourceInput.getPrimaryAudioTrack();
        if (!track) throw new Error('The selected file does not contain an audio track.');
        if (!(await track.canDecode())) throw new Error('This browser cannot decode the audio track in that file.');
        const duration = await track.computeDuration();
        const boundedStart = Math.max(0, Number(start) || 0);
        const boundedEnd = Math.min(duration, Number.isFinite(Number(end)) ? Number(end) : duration);
        if (!(boundedEnd > boundedStart)) throw new Error('The selected audio range is invalid.');
        const rate = normalizeAudioPlaybackRate(playbackRate);
        const renderedBuffer = await renderAudioAtPlaybackRate(track, {
            start: boundedStart,
            end: boundedEnd,
            playbackRate: rate,
            onProgress,
        });
        const audioSource = new MediaAudioBufferSource({ codec: 'aac', bitrate: 128_000 });
        output.addAudioTrack(audioSource);
        await output.start();
        await audioSource.add(renderedBuffer);
        onProgress?.(.95);
        await output.finalize();
        onProgress?.(1);
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
