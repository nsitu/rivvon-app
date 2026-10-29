import * as THREE from 'three';
import { Input, ALL_FORMATS, UrlSource, CanvasSink } from 'mediabunny';
import { getClipInputFormats } from '../../../../packages/shared-types/src/clipAsset.js';
import { fetchClip, clipAssetUrl } from './clipService.js';
import { createClipTimingPlan, getClipLocalTime } from '../modules/viewer/clipTiming.js';

const consumers = new Set();
let accessScope = '';
export function setBackgroundClipAccessScope(scope) {
    if (scope === accessScope) return;
    accessScope = scope;
    for (const consumer of [...consumers]) consumer.release();
}
export function invalidateBackgroundClip(id) {
    for (const consumer of [...consumers]) if (consumer.id === id) consumer.release();
}
export function resumeBackgroundClips() { for (const consumer of consumers) consumer.resume(); }

export async function acquireBackgroundClip(source, { presetId = '', maxTextureSize = 4096, onError = () => {} } = {}) {
    const controller = new AbortController();
    const canvas = document.createElement('canvas');
    const video = document.createElement('video');
    let disposed = false, exporting = false, manualPause = false;
    const inputs = new Set();
    let decodedPlayback = false, liveDecoder = null, liveInput = null, liveBusy = false, liveGeneration = 0, lastDecodedTime = -Infinity;
    let nativeRate = 1, lastFrame = -1, lastTarget = 0, lastPlan, pauseTime = null, timeOffset = 0, lastSceneTime = 0;
    let videoFrameCallback = null, frameAvailable = true;
    let blocked = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    const consumer = { id: source.id, release, resume() { blocked = false; manualPause = false; onError(''); } };
    consumers.add(consumer);
    function release() {
        if (disposed) return;
        disposed = true; controller.abort();
        for (const input of inputs) input.dispose(); inputs.clear();
        if (videoFrameCallback != null) video.cancelVideoFrameCallback?.(videoFrameCallback);
        video.pause(); video.removeAttribute('src'); video.load();
        // An old runtime can survive until its asynchronous replacement commits.
        // Remove private pixels immediately when its account scope is retired.
        canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
        texture.needsUpdate = true; texture.dispose(); consumers.delete(consumer);
        document.removeEventListener('visibilitychange', visibility);
    }
    function visibility() { if (document.hidden) { pauseTime ??= lastSceneTime; video.pause(); stopDecodedPlayback(); } }
    document.addEventListener('visibilitychange', visibility);
    function createInput() {
        return new Input({ formats: getClipInputFormats(ALL_FORMATS), source: new UrlSource(clipAssetUrl(source.id, { presetId }), {
            requestInit: { credentials: 'include', cache: 'no-store' }, maxCacheSize: 4 * 1024 * 1024,
            getRetryDelay: () => null,
        }) });
    }
    async function openDecoder(signal, onCreate = () => {}) {
        const current = createInput(); inputs.add(current); onCreate(current);
        const abort = () => current.dispose();
        try {
            signal?.throwIfAborted(); signal?.addEventListener('abort', abort, { once: true });
            const track = await current.getPrimaryVideoTrack();
            if (!track || !await track.canDecode()) throw new Error('This browser cannot decode the video codec in this clip. Try a compatible browser or convert the video.');
            return { sink: new CanvasSink(track, { width: canvas.width, height: canvas.height, fit: 'fill' }),
                dispose() { signal?.removeEventListener('abort', abort); current.dispose(); inputs.delete(current); } };
        } catch (error) { signal?.removeEventListener('abort', abort); current.dispose(); inputs.delete(current); throw error; }
    }
    function stopDecodedPlayback() {
        liveGeneration++; liveDecoder?.dispose(); liveDecoder = null;
        liveInput?.dispose(); liveInput = null; lastDecodedTime = -Infinity;
    }
    try {
        const clip = await fetchClip(source.id, presetId, controller.signal);
        if (disposed) throw new Error('Clip access changed while loading');
        if (Math.max(clip.width, clip.height) > maxTextureSize) throw new Error('This clip exceeds the renderer texture limit');
        canvas.width = clip.width; canvas.height = clip.height;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Background video rendering is unavailable');
        const decoder = await openDecoder(controller.signal);
        try {
            const first = await decoder.sink.getCanvas(clip.firstTimestamp);
            if (!first || disposed) throw new Error('Could not decode the background clip');
            context.drawImage(first.canvas, 0, 0); texture.needsUpdate = true;
        } finally { decoder.dispose(); }
        const mimeType = clip.mime_type || clip.mimeType || 'video/mp4';
        decodedPlayback = !video.canPlayType(clip.codec ? `${mimeType}; codecs="${clip.codec}"` : mimeType);
        function useDecodedPlayback() {
            if (decodedPlayback || disposed) return;
            decodedPlayback = true; video.pause();
            if (videoFrameCallback != null) video.cancelVideoFrameCallback?.(videoFrameCallback);
            video.removeAttribute('src'); video.load();
            if (!blocked) onError('');
        }
        async function drawDecoded(localTime) {
            // Keep one decode in flight, dropping obsolete live frames instead
            // of queuing work. Export still awaits every requested timestamp.
            if (liveBusy || disposed || exporting || localTime === lastDecodedTime) return;
            liveBusy = true; const generation = liveGeneration;
            try {
                if (!liveDecoder) {
                    const decoder = await openDecoder(controller.signal, input => { liveInput = input; });
                    if (disposed || exporting || generation !== liveGeneration) { decoder.dispose(); return; }
                    liveDecoder = decoder;
                }
                const frame = await liveDecoder.sink.getCanvas(clip.firstTimestamp + localTime);
                if (disposed || exporting || generation !== liveGeneration) return;
                if (!frame) throw new Error('No decoded video frame was available');
                context.drawImage(frame.canvas, 0, 0); texture.needsUpdate = true; lastDecodedTime = localTime;
            } catch (error) {
                if (!disposed && !exporting && generation === liveGeneration) { blocked = true; onError(`Could not decode this clip: ${error.message}`); }
            } finally { liveBusy = false; }
        }
        video.crossOrigin = 'use-credentials'; video.muted = true; video.defaultMuted = true;
        video.playsInline = true; video.loop = true; video.preload = 'auto';
        video.addEventListener('error', useDecodedPlayback, { signal: controller.signal });
        if (!decodedPlayback) video.src = clipAssetUrl(source.id, { presetId });
        const watchFrames = () => {
            if (disposed || decodedPlayback || !video.requestVideoFrameCallback) return;
            videoFrameCallback = video.requestVideoFrameCallback(() => { frameAvailable = true; watchFrames(); });
        };
        watchFrames();
        if (blocked) onError('Reduced motion is enabled. Press Play to start the background clip.');
        const mode = () => lastPlan?.mode || 'native';
        function drawVideo() {
            const changed = video.requestVideoFrameCallback ? frameAvailable : video.currentTime !== lastFrame;
            if (video.readyState >= 2 && !video.seeking && changed) {
                context.drawImage(video, 0, 0, canvas.width, canvas.height);
                lastFrame = video.currentTime; frameAvailable = false; texture.needsUpdate = true;
            }
        }
        function update({ timeSeconds = 0, targetDuration = clip.duration, playbackMode = mode(), paused = false } = {}) {
            if (disposed || exporting) return;
            if (paused || manualPause || blocked || document.hidden) {
                if (pauseTime == null) pauseTime = lastSceneTime;
                if (liveInput) stopDecodedPlayback();
                video.pause(); return;
            }
            // Keep the displayed phase when rendering resumes after a pause.
            if (pauseTime != null) { timeOffset += timeSeconds - pauseTime; pauseTime = null; }
            lastSceneTime = timeSeconds;
            lastPlan = createClipTimingPlan(clip.duration, targetDuration, playbackMode);
            lastTarget = getClipLocalTime(timeSeconds - timeOffset, lastPlan);
            if (decodedPlayback) { void drawDecoded(lastTarget); return; }
            try {
                if (nativeRate !== lastPlan.rate) {
                    video.playbackRate = lastPlan.rate;
                    if (Math.abs(video.playbackRate - lastPlan.rate) > 1e-6) throw new Error('Unsupported playback rate');
                    nativeRate = lastPlan.rate;
                }
            } catch {
                useDecodedPlayback(); void drawDecoded(lastTarget); return;
            }
            if (video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - (clip.firstTimestamp + lastTarget)) > 0.2) {
                video.currentTime = clip.firstTimestamp + lastTarget;
            }
            if (video.paused && video.readyState >= 2) video.play().catch(error => {
                if (disposed || exporting || decodedPlayback || manualPause || error.name === 'AbortError') return;
                if (error.name === 'NotAllowedError') { blocked = true; onError('Press Play to start the background clip.'); }
                else useDecodedPlayback();
            });
            drawVideo();
        }
        async function beginExport({ targetDuration, playbackMode, signal } = {}) {
            if (disposed) throw new Error('Background clip is unavailable');
            if (exporting) throw new Error('A background clip capture is already in progress');
            const plan = createClipTimingPlan(clip.duration, targetDuration, playbackMode);
            const savedTime = video.currentTime, wasPaused = video.paused;
            const savedCanvas = document.createElement('canvas'); savedCanvas.width = canvas.width; savedCanvas.height = canvas.height;
            savedCanvas.getContext('2d').drawImage(canvas, 0, 0);
            exporting = true; video.pause(); stopDecodedPlayback();
            let decoder;
            try { decoder = await openDecoder(signal); }
            catch (error) { exporting = false; throw error; }
            let ended = false;
            return { plan,
                async prepareFrame(time) {
                    signal?.throwIfAborted();
                    if (disposed) throw new Error('Background clip access changed during export');
                    const frame = await decoder.sink.getCanvas(clip.firstTimestamp + getClipLocalTime(time, plan));
                    signal?.throwIfAborted();
                    if (!frame) throw new Error('Could not decode the requested background frame');
                    context.drawImage(frame.canvas, 0, 0); texture.needsUpdate = true;
                },
                dispose() {
                    if (ended) return; ended = true; decoder.dispose(); exporting = false;
                    if (!disposed) {
                        context.drawImage(savedCanvas, 0, 0); texture.needsUpdate = true;
                        if (!decodedPlayback) { video.currentTime = savedTime; lastFrame = -1; frameAvailable = true; if (!wasPaused && !blocked && !document.hidden) video.play().catch(() => {}); }
                    }
                    savedCanvas.width = savedCanvas.height = 1;
                },
            };
        }
        return { ...consumer, texture, duration: clip.duration, update, beginExport,
            getTime: () => Math.max(0, lastSceneTime - timeOffset),
            pause() { manualPause = true; pauseTime = lastSceneTime; video.pause(); stopDecodedPlayback(); },
            resume: consumer.resume,
        };
    } catch (error) { release(); throw error; }
}
