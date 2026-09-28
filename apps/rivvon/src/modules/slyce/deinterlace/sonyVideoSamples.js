import { Input, MPEG_TS, BlobSource, EncodedPacketSink, VideoSample } from 'mediabunny';
import { GpuBwdif } from './gpuBwdif.js';

export function checkAbort(signal) {
    if (signal?.aborted) throw new DOMException('Video processing aborted.', 'AbortError');
}

export function boundedMediaOperation(operation, signal, message = 'Video decoder stopped responding.') {
    return new Promise((resolve, reject) => {
        let settled = false;
        const abort = () => finish(reject, new DOMException('Video processing aborted.', 'AbortError'));
        const timer = setTimeout(() => finish(reject, new Error(message)), 30000);
        function finish(callback, value) {
            if (settled) {
                if (callback === resolve) value?.close?.();
                return;
            }
            settled = true;
            clearTimeout(timer); signal?.removeEventListener('abort', abort); callback(value);
        }
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        Promise.resolve(operation).then(value => finish(resolve, value), error => finish(reject, error));
    });
}

/** Native decoder with bounded backpressure; each output owns its native PTS. */
export async function* decodeSonyFrames(track, profile, signal) {
    checkAbort(signal);
    if (typeof VideoDecoder === 'undefined') throw new Error('This browser does not support WebCodecs video decoding.');
    const config = {
        ...await track.getDecoderConfig(), codedWidth: profile.width, codedHeight: profile.height,
        hardwareAcceleration: 'prefer-software',
        colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
    };
    if (!(await VideoDecoder.isConfigSupported(config)).supported) throw new Error('This browser cannot decode Sony A7 interlaced H.264 video.');
    const queue = [], waiters = new Set();
    let failure = null, done = false, stopped = false;
    const notify = () => { for (const wake of waiters) wake(); waiters.clear(); };
    const wait = async (watchdog = true) => {
        let wake;
        const pending = new Promise(resolve => { wake = resolve; waiters.add(wake); });
        try { await (watchdog ? boundedMediaOperation(pending, signal) : pending); }
        finally { waiters.delete(wake); }
    };
    const decoder = new VideoDecoder({
        output(frame) { if (stopped) frame.close(); else queue.push(frame); notify(); },
        error(error) { failure = error; notify(); },
    });
    decoder.addEventListener('dequeue', notify);
    const abort = () => { if (decoder.state !== 'closed') decoder.close(); notify(); };
    signal?.addEventListener('abort', abort, { once: true });
    let pump;
    try {
        decoder.configure(config);
        pump = (async () => {
            try {
                for await (const packet of new EncodedPacketSink(track).packets()) {
                    // Texture encoding can pause the consumer for a long time;
                    // backpressure is not a stalled decoder. Only time out waits
                    // where the consumer is actually asking for another frame.
                    while (!stopped && !failure && queue.length + decoder.decodeQueueSize > 8) {
                        checkAbort(signal);
                        await wait(false);
                    }
                    if (stopped || failure) break;
                    checkAbort(signal);
                    decoder.decode(packet.toEncodedVideoChunk());
                }
                if (!stopped && !failure) await boundedMediaOperation(decoder.flush(), signal);
            } catch (error) { if (!stopped) failure = error; }
            finally { done = true; notify(); }
        })();
        while (true) {
            checkAbort(signal);
            if (failure) throw failure;
            if (queue.length) {
                const frame = queue.shift(); notify();
                try { yield frame; } finally { frame.close(); }
            } else if (done) break;
            else await wait();
        }
    } finally {
        stopped = true; abort();
        signal?.removeEventListener('abort', abort);
        for (const frame of queue) frame.close();
        queue.length = 0;
        // Closing the decoder wakes pending flush/decode operations. Do not
        // leave an unobserved producer rejection when a range ends early.
        await pump;
    }
}

/** Full-quality progressive samples, numbered at field rate, including ranges. */
export async function* sonyVideoSamples({ file, profile }, frameStart, frameEnd, signal) {
    checkAbort(signal);
    const input = new Input({ formats: [MPEG_TS], source: new BlobSource(file) });
    let gpu, frames;
    try {
        gpu = await GpuBwdif.create(profile.width, profile.height);
        const track = await input.getPrimaryVideoTrack();
        frames = decodeSonyFrames(track, profile, signal);
        const firstFrame = Math.floor((frameStart - 1) / 2);
        let decodedIndex = 0;
        const nextFrame = async () => {
            checkAbort(signal);
            const result = await frames.next();
            if (result.done) {
                if (decodedIndex !== profile.decodedFrameCount) throw new Error(`Interlaced video ended after ${decodedIndex} of ${profile.decodedFrameCount} decoded frames.`);
                return null;
            }
            const frame = result.value;
            const expectedTime = profile.origin + decodedIndex * profile.frameDuration;
            if (Math.abs(frame.timestamp / 1e6 - expectedTime) > 0.0001) throw new Error('The interlaced decoder returned an unexpected frame count or timestamp.');
            decodedIndex++;
            return frame;
        };
        // Decode preroll from the start for reliable H.264 references. Only
        // upload the preceding frame and requested range to the GPU.
        const begin = Math.max(0, firstFrame - 1);
        for (let i = 0; i < begin; i++) {
            const frame = await nextFrame();
            if (!frame) throw new Error('The selected frame range is outside the video.');
            frame.close();
        }
        let current = 0, previous = 0, next = 1;
        let frame = await nextFrame();
        if (!frame) return;
        await boundedMediaOperation(gpu.upload(frame, current), signal, 'GPU frame upload stopped responding.'); frame.close();
        for (let index = begin; ; index++) {
            frame = await nextFrame();
            if (frame) {
                await boundedMediaOperation(gpu.upload(frame, next), signal, 'GPU frame upload stopped responding.'); frame.close();
            }
            for (let field = 0; field < 2; field++) {
                const number = index * 2 + field + 1;
                if (number < frameStart) continue;
                if (number > frameEnd) return;
                const timestamp = Math.round((number - 1) * profile.fieldDuration * 1e6);
                const duration = Math.round(number * profile.fieldDuration * 1e6) - timestamp;
                const output = await boundedMediaOperation(gpu.frame(
                    previous, current, frame ? next : current, field,
                    (index === 0 && field === 0) || (!frame && field === 1), timestamp, duration,
                ), signal, 'GPU deinterlacing stopped responding.');
                const sample = new VideoSample(output);
                try { yield sample; } finally { sample.close(); }
                if (number === frameEnd) return;
            }
            if (!frame) break;
            const free = index === begin ? 2 : previous;
            previous = current; current = next; next = free;
        }
    } finally {
        await frames?.return();
        gpu?.dispose(); input.dispose();
    }
}
