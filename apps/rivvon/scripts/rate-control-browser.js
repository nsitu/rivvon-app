import * as MB from 'mediabunny';
import { createExportYuvConversion } from '../src/modules/viewer/exportYuvConversion.js';
import { collectExportEnvironment } from '../src/modules/viewer/exportColourReport.js';

const params = new URLSearchParams(location.search);
const sourceUrl = params.get('source');
const sha256 = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
const hashList = hashes => sha256(new TextEncoder().encode(hashes.join('\n')));
const results = [];
const environment = await collectExportEnvironment();
const status = document.querySelector('#status');
const codecSupport = [];
const codecName = codec => codec.startsWith('avc') ? 'avc' : /^(hev1|hvc1)/.test(codec) ? 'hevc'
    : codec.startsWith('vp09') ? 'vp9' : codec.startsWith('av01') ? 'av1' : null;
const codecExtension = codec => codecName(codec) === 'avc' ? { avc: { format: 'avc' } }
    : codecName(codec) === 'hevc' ? { hevc: { format: 'hevc' } } : {};

function render() {
    document.querySelector('#results').replaceChildren(...results.map(result => {
        const row = document.createElement('tr');
        const reference = results.find(item => item.inputSha256 && item.width === result.width && item.height === result.height);
        const values = [result.path, `${result.width ?? result.outputWidth ?? '—'}×${result.height ?? result.outputHeight ?? '—'}`,
            result.hardwareAcceleration, result.codec ?? 'avc1.640032', result.bitrateMode ?? 'variable',
            result.latencyMode ?? (result.explicitQuality ? 'quality (explicit)' : 'quality (default)'),
            result.bitrateMode === 'quantizer' ? `QP ${result.quantizer}` : result.bitrate / 1e6,
            result.error ?? (result.actualBitrate / 1e6).toFixed(3), `${result.encodedFrames ?? '—'}/${result.frames ?? '—'}`,
            result.inputSha256 ? String(result.inputSha256 === reference.inputSha256) : '—'];
        row.replaceChildren(...values.map(value => { const cell = document.createElement('td'); cell.textContent = value; return cell; }));
        return row;
    }));
    document.querySelector('#report').textContent = JSON.stringify({ environment, sourceUrl, codecSupport, results }, null, 2);
}

async function encode({ path, hardwareAcceleration, bitrate, quantizer, explicitQuality,
    latencyMode = explicitQuality ? 'quality' : undefined, codec = 'avc1.640032', bitrateMode = 'variable', outputWidth, outputHeight }) {
    const input = new MB.Input({ formats: MB.ALL_FORMATS, source: new MB.UrlSource(sourceUrl) });
    let encoder, output, converter, encoderError;
    const inputHashes = [], outputHashes = [], packets = [], hashesPending = [];
    let encodedBytes = 0, frames = 0, encoderConfig, decoderConfig;
    const capture = (data, timestamp, type, meta) => {
        const cfg = meta?.decoderConfig;
        if (cfg && !decoderConfig) {
            const desc = cfg.description;
            const header = desc ? (ArrayBuffer.isView(desc)
                ? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength) : new Uint8Array(desc)) : null;
            decoderConfig = { codec: cfg.codec, codedWidth: cfg.codedWidth, codedHeight: cfg.codedHeight,
                descriptionHeader: header ? [...header.subarray(0, 8)] : null, colorSpace: cfg.colorSpace };
        }
        encodedBytes += data.byteLength;
        packets.push({ bytes: data.byteLength, timestamp, type });
        const index = outputHashes.length; outputHashes.push(null);
        hashesPending.push(sha256(data).then(hash => { outputHashes[index] = hash; }));
    };
    try {
        const track = await input.getPrimaryVideoTrack();
        const sourceWidth = await track.getDisplayWidth(), sourceHeight = await track.getDisplayHeight(), fps = 30;
        const width = outputWidth ?? sourceWidth, height = outputHeight ?? sourceHeight;
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
        converter = createExportYuvConversion(width, height, { method: 'gpu', fullRange: false });
        const pixels = new Uint8Array(width * height * 3 / 2);
        const config = { codec, width, height, displayWidth: width, displayHeight: height,
            ...(bitrateMode === 'quantizer' ? {} : { bitrate }), bitrateMode,
            framerate: fps, hardwareAcceleration, alpha: 'discard', ...codecExtension(codec),
            ...(latencyMode ? { latencyMode } : {}) };
        let source;
        if (path === 'native') {
            const support = await VideoEncoder.isConfigSupported(config);
            if (!support.supported) throw new Error('Native configuration is unsupported.');
            encoderConfig = config;
            encoder = new VideoEncoder({
                output(chunk, meta) {
                    const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
                    capture(data, chunk.timestamp, chunk.type, meta);
                },
                error(error) { encoderError = error; },
            });
            encoder.configure(config);
        } else {
            output = new MB.Output({ format: new MB.Mp4OutputFormat(), target: new MB.BufferTarget() });
            source = new MB.VideoSampleSource({ codec: codecName(codec), fullCodecString: config.codec,
                quality: new MB.Quality(bitrateMode === 'quantizer' ? { quantizer } : { bitrate, bitrateMode }), hardwareAcceleration,
                ...(latencyMode ? { latencyMode } : {}),
                onEncoderConfig(value) { encoderConfig = JSON.parse(JSON.stringify(value)); },
                onEncodedPacket(packet, meta) { capture(packet.data, Math.round(packet.timestamp * 1e6), packet.type, meta); },
            });
            output.addVideoTrack(source, { frameRate: fps }); await output.start();
        }
        for await (const sample of new MB.VideoSampleSink(track).samples(0, 3)) {
            let frame, videoSample;
            try {
                context.fillStyle = '#000'; context.fillRect(0, 0, width, height);
                context.drawImage(sample.toCanvasImageSource(), 0, 0, width, height);
                converter.convert(canvas, pixels);
                inputHashes.push(await sha256(pixels));
                frame = new VideoFrame(pixels, { format: 'I420', codedWidth: width, codedHeight: height,
                    timestamp: Math.round(frames / fps * 1e6), duration: Math.round(1e6 / fps),
                    colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false } });
                const options = { keyFrame: frames % 60 === 0,
                    ...(bitrateMode === 'quantizer' ? { [codecName(codec)]: { quantizer } } : {}) };
                if (encoder) {
                    if (encoderError) throw encoderError;
                    encoder.encode(frame, options);
                    if (encoder.encodeQueueSize > 4) await new Promise((resolve, reject) => {
                        const ready = () => { encoder.removeEventListener('dequeue', ready); clearTimeout(timer); resolve(); };
                        const timer = setTimeout(() => { encoder.removeEventListener('dequeue', ready); reject(encoderError ?? new Error('Encoder queue stalled.')); }, 10000);
                        encoder.addEventListener('dequeue', ready, { once: true });
                    });
                } else {
                    videoSample = new MB.VideoSample(frame); await source.add(videoSample, options);
                }
                frames++;
            } finally { videoSample?.close(); frame?.close(); sample.close(); }
        }
        if (encoder) await encoder.flush(); else await output.finalize();
        if (encoderError) throw encoderError;
        await Promise.all(hashesPending);
        // The optional local capture server persists MP4s for independent slice
        // inspection. The comparison also works on a plain Vite dev server.
        if (params.get('saveQp') === '1' && bitrateMode === 'quantizer' && output?.target.buffer) {
            const saved = await fetch(`/__qp_output/${hardwareAcceleration}-qp${quantizer}.mp4`, {
                method: 'POST', body: output.target.buffer,
            });
            if (!saved.ok) throw new Error('Could not save local QP diagnostic output.');
        }
        return { path, hardwareAcceleration, bitrate, quantizer, explicitQuality, latencyMode, codec, bitrateMode,
            encoderConfig, decoderConfig, width, height, fps, frames,
            sourceWidth, sourceHeight, resize: 'stretch-to-output-dimensions',
            encodedFrames: packets.length, encodedBytes, actualBitrate: encodedBytes * 8 / (frames / fps),
            inputSha256: await hashList(inputHashes), outputSha256: await hashList(outputHashes),
            conversion: converter.info, packets };
    } finally {
        if (encoder?.state !== 'closed') encoder?.close();
        await output?.cancel(); converter?.dispose(); input.dispose();
    }
}

async function run(explicitQuality) {
    if (!sourceUrl) { status.textContent = 'Add ?source=/path/to/a/detailed-source.mp4'; return; }
    const buttons = [...document.querySelectorAll('button')]; buttons.forEach(button => { button.disabled = true; });
    try {
        for (const hardwareAcceleration of (explicitQuality ? ['prefer-hardware'] : ['no-preference', 'prefer-hardware', 'prefer-software'])) {
            for (const bitrate of [50_000_000, 100_000_000]) for (const path of ['native', 'mediabunny']) {
                status.textContent = `Encoding ${path}, ${hardwareAcceleration}, ${bitrate / 1e6} Mb/s${explicitQuality ? ', explicit quality latency' : ''}…`;
                try { results.push(await encode({ path, hardwareAcceleration, bitrate, explicitQuality })); }
                catch (error) { results.push({ path, hardwareAcceleration, bitrate, explicitQuality, error: String(error) }); }
                render();
            }
        }
        status.textContent = `Completed ${results.length} cases.`;
    } finally { buttons.forEach(button => { button.disabled = false; }); }
}
document.querySelector('#run').addEventListener('click', () => run(false));
document.querySelector('#quality').addEventListener('click', () => run(true));

document.querySelector('#quantizers').addEventListener('click', async () => {
    if (!sourceUrl) { status.textContent = 'Add ?source=/path/to/a/detailed-source.mp4'; return; }
    const buttons = [...document.querySelectorAll('button')]; buttons.forEach(button => { button.disabled = true; });
    try {
        for (const hardwareAcceleration of ['prefer-hardware', 'prefer-software']) {
            for (const quantizer of [16, 20, 24, 28, 32, 36]) for (const path of ['native', 'mediabunny']) {
                const settings = { path, hardwareAcceleration, quantizer, bitrateMode: 'quantizer',
                    codec: 'avc1.640032', latencyMode: 'quality', outputWidth: 2160, outputHeight: 2160 };
                status.textContent = `Encoding ${path}, ${hardwareAcceleration}, QP ${quantizer}, no bitrate…`;
                try { results.push(await encode(settings)); }
                catch (error) { results.push({ ...settings, error: String(error) }); }
                render();
            }
        }
        status.textContent = `Completed ${results.length} quantizer cases.`;
    } finally { buttons.forEach(button => { button.disabled = false; }); }
});

document.querySelector('#profile-latency').addEventListener('click', async () => {
    if (!sourceUrl) { status.textContent = 'Add ?source=/path/to/a/detailed-source.mp4'; return; }
    const buttons = [...document.querySelectorAll('button')]; buttons.forEach(button => { button.disabled = true; });
    try {
        for (const codec of ['avc1.640032', 'avc1.4D0032']) for (const latencyMode of ['quality', 'realtime']) {
            for (const bitrateMode of ['constant', 'variable']) for (const bitrate of [25_928_000, 51_856_000]) {
                for (const path of ['native', 'mediabunny']) {
                    const settings = { path, hardwareAcceleration: 'prefer-hardware', bitrate, bitrateMode, codec, latencyMode };
                    status.textContent = `Encoding ${path}, ${codec}, ${latencyMode}, ${bitrateMode}, ${bitrate / 1e6} Mb/s…`;
                    try { results.push(await encode(settings)); }
                    catch (error) { results.push({ ...settings, error: String(error) }); }
                    render();
                }
            }
        }
        status.textContent = `Completed ${results.length} cases.`;
    } finally { buttons.forEach(button => { button.disabled = false; }); }
});

document.querySelector('#dimensions').addEventListener('click', async () => {
    if (!sourceUrl) { status.textContent = 'Add ?source=/path/to/a/detailed-source.mp4'; return; }
    const buttons = [...document.querySelectorAll('button')]; buttons.forEach(button => { button.disabled = true; });
    try {
        // Keep codec/profile/level, frame timing and rate mode fixed. Scaling is
        // intentional: square content is stretched for the 16:9 shape controls.
        for (const [outputWidth, outputHeight] of [[640, 640], [1080, 1080], [1920, 1920], [2160, 2160], [1280, 720], [1920, 1080]]) {
            const preferences = outputWidth === outputHeight && [1080, 2160].includes(outputWidth)
                ? ['prefer-hardware', 'prefer-software'] : ['prefer-hardware'];
            for (const hardwareAcceleration of preferences) {
                const bitrates = hardwareAcceleration === 'prefer-hardware' ? [2_000_000, 8_000_000, 25_928_000, 51_856_000]
                    : [25_928_000, 51_856_000];
                for (const bitrate of bitrates) {
                    const settings = { path: 'native', hardwareAcceleration, bitrate, bitrateMode: 'constant',
                        codec: 'avc1.640032', latencyMode: 'quality', outputWidth, outputHeight };
                    status.textContent = `Encoding ${outputWidth}×${outputHeight}, ${hardwareAcceleration}, CBR ${bitrate / 1e6} Mb/s…`;
                    try { results.push(await encode(settings)); }
                    catch (error) { results.push({ ...settings, error: String(error) }); }
                    render();
                }
            }
        }
        status.textContent = `Completed ${results.length} cases.`;
    } finally { buttons.forEach(button => { button.disabled = false; }); }
});

document.querySelector('#codecs').addEventListener('click', async () => {
    if (!sourceUrl) { status.textContent = 'Add ?source=/path/to/a/detailed-source.mp4'; return; }
    const buttons = [...document.querySelectorAll('button')]; buttons.forEach(button => { button.disabled = true; });
    const bitrates = [2_000_000, 8_000_000, 25_928_000, 51_856_000];
    // Every candidate's declared level/tier accommodates 2160-square at 30 fps
    // and the highest target. Alternative tiers avoid mistaking a rejected tier
    // for absence of codec support. Keep the chosen string fixed across rates.
    const codecs = [
        { label: 'H.264', candidates: ['avc1.640032'] },
        { label: 'H.265 / HEVC', candidates: ['hev1.1.6.H150.B0', 'hev1.1.6.L156.B0'] },
        { label: 'AV1', candidates: ['av01.0.12H.08', 'av01.0.14M.08'] },
        { label: 'VP9', candidates: ['vp09.00.50.08'] },
    ];
    try {
        for (const { label, candidates } of codecs) for (const bitrateMode of ['constant', 'variable']) {
            status.textContent = `Checking ${label}, ${bitrateMode} hardware-preference support…`;
            let selected;
            for (const codec of candidates) {
                const checks = [];
                for (const bitrate of bitrates) {
                    const config = { codec, width: 2160, height: 2160, displayWidth: 2160, displayHeight: 2160,
                        bitrate, bitrateMode, framerate: 30, hardwareAcceleration: 'prefer-hardware',
                        alpha: 'discard', latencyMode: 'quality', ...codecExtension(codec) };
                    try {
                        const support = await VideoEncoder.isConfigSupported(config);
                        checks.push({ config, supported: support.supported, recognizedConfig: support.config });
                    } catch (error) { checks.push({ config, supported: false, error: String(error) }); }
                }
                codecSupport.push({ label, codec, bitrateMode, checks });
                if (checks.every(check => check.supported)) { selected = codec; break; }
            }
            if (!selected) {
                for (const bitrate of bitrates) results.push({ path: 'native', codec: candidates[0], label, hardwareAcceleration: 'prefer-hardware',
                    bitrateMode, latencyMode: 'quality', bitrate, outputWidth: 2160, outputHeight: 2160,
                    error: 'No tested codec configuration supports the complete target range.' });
                render(); continue;
            }
            for (const bitrate of bitrates) {
                const settings = { path: 'native', hardwareAcceleration: 'prefer-hardware', codec: selected, label,
                    bitrateMode, bitrate, latencyMode: 'quality', outputWidth: 2160, outputHeight: 2160 };
                status.textContent = `Encoding ${label}, ${bitrateMode}, ${bitrate / 1e6} Mb/s…`;
                try { results.push({ ...await encode(settings), label }); }
                catch (error) { results.push({ ...settings, error: String(error) }); }
                render();
            }
        }
        status.textContent = `Completed ${results.length} codec cases.`;
    } finally { buttons.forEach(button => { button.disabled = false; }); }
});
