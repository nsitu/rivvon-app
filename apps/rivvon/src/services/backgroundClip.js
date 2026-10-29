import * as THREE from 'three';
import { Input, MP4, UrlSource, CanvasSink } from 'mediabunny';
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
    let disposed = false, input = null, exporting = false, manualPause = false;
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
        disposed = true; controller.abort(); input?.dispose(); input = null;
        if (videoFrameCallback != null) video.cancelVideoFrameCallback?.(videoFrameCallback);
        video.pause(); video.removeAttribute('src'); video.load();
        // An old runtime can survive until its asynchronous replacement commits.
        // Remove private pixels immediately when its account scope is retired.
        canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
        texture.needsUpdate = true; texture.dispose(); consumers.delete(consumer);
        document.removeEventListener('visibilitychange', visibility);
    }
    function visibility() { if (document.hidden) video.pause(); }
    document.addEventListener('visibilitychange', visibility);
    function createInput() {
        return new Input({ formats: [MP4], source: new UrlSource(clipAssetUrl(source.id, { presetId }), {
            requestInit: { credentials: 'include', cache: 'no-store' }, maxCacheSize: 4 * 1024 * 1024,
            getRetryDelay: () => null,
        }) });
    }
    async function openDecoder(signal) {
        input = createInput();
        const current = input;
        const abort = () => current.dispose();
        signal?.throwIfAborted(); signal?.addEventListener('abort', abort, { once: true });
        try {
            const track = await current.getPrimaryVideoTrack();
            if (!track || !await track.canDecode()) throw new Error('This browser cannot decode background clips for export. Use a browser with H.264 WebCodecs support.');
            return { sink: new CanvasSink(track, { width: canvas.width, height: canvas.height, fit: 'fill' }),
                dispose() { signal?.removeEventListener('abort', abort); current.dispose(); if (input === current) input = null; } };
        } catch (error) { signal?.removeEventListener('abort', abort); current.dispose(); if (input === current) input = null; throw error; }
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
        video.crossOrigin = 'use-credentials'; video.muted = true; video.defaultMuted = true;
        video.playsInline = true; video.loop = true; video.preload = 'auto';
        video.addEventListener('error', () => { if (!disposed) onError('Background clip playback failed. Choose another clip or retry.'); }, { signal: controller.signal });
        video.src = clipAssetUrl(source.id, { presetId });
        const watchFrames = () => {
            if (disposed || !video.requestVideoFrameCallback) return;
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
                video.pause(); return;
            }
            // Keep the displayed phase when rendering resumes after a pause.
            if (pauseTime != null) { timeOffset += timeSeconds - pauseTime; pauseTime = null; }
            lastSceneTime = timeSeconds;
            lastPlan = createClipTimingPlan(clip.duration, targetDuration, playbackMode);
            lastTarget = getClipLocalTime(timeSeconds - timeOffset, lastPlan);
            try {
                if (nativeRate !== lastPlan.rate) {
                    video.playbackRate = lastPlan.rate;
                    if (Math.abs(video.playbackRate - lastPlan.rate) > 1e-6) throw new Error('Unsupported playback rate');
                    nativeRate = lastPlan.rate;
                }
            } catch {
                blocked = true; video.pause(); onError(`This device cannot preview ${lastPlan.rate.toFixed(2)}× playback. Frame-accurate export remains available.`); return;
            }
            if (video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - (clip.firstTimestamp + lastTarget)) > 0.2) {
                video.currentTime = clip.firstTimestamp + lastTarget;
            }
            if (video.paused && video.readyState >= 2) video.play().catch(error => { if (!disposed && !exporting) { blocked = true; onError(error.name === 'NotAllowedError' ? 'Press Play to start the background clip.' : 'Background clip playback failed. Try another clip.'); } });
            drawVideo();
        }
        async function beginExport({ targetDuration, playbackMode, signal } = {}) {
            if (disposed) throw new Error('Background clip is unavailable');
            if (exporting) throw new Error('A background clip capture is already in progress');
            const savedTime = video.currentTime, wasPaused = video.paused;
            exporting = true; video.pause();
            let decoder;
            try { decoder = await openDecoder(signal); }
            catch (error) { exporting = false; throw error; }
            const plan = createClipTimingPlan(clip.duration, targetDuration, playbackMode);
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
                    if (!disposed) { video.currentTime = savedTime; lastFrame = -1; frameAvailable = true; drawVideo(); if (!wasPaused && !blocked && !document.hidden) video.play().catch(() => {}); }
                },
            };
        }
        return { ...consumer, texture, duration: clip.duration, update, beginExport,
            getTime: () => Math.max(0, lastSceneTime - timeOffset),
            pause() { manualPause = true; pauseTime = lastSceneTime; video.pause(); },
            resume: consumer.resume,
        };
    } catch (error) { release(); throw error; }
}
