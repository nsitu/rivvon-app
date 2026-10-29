import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { useSceneExport } from './useSceneExport.js';
import { createCanvasVideoExport } from '../../modules/viewer/canvasVideoExport.js';

vi.mock('../../modules/viewer/canvasVideoExport.js', () => ({ createCanvasVideoExport: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());
function fixture() {
    const camera = new PerspectiveCamera(40, 2, 0.1, 100); camera.position.set(1,2,3);
    let pixelRatio = 2;
    const renderer = { domElement:{ width:800,height:400 },getPixelRatio:() => pixelRatio,
        setPixelRatio:vi.fn(value => { pixelRatio = value; }),
        setSize:vi.fn((width, height) => { renderer.domElement.width = width * pixelRatio; renderer.domElement.height = height * pixelRatio; }) };
    const ctx = { renderer:{ value:renderer },scene:{ value:{} },camera:{ value:camera },
        app:{},tileManager:{ value:{ resetAnimationState:vi.fn(),tickDeterministic:vi.fn() } },tileManagers:{ value:[] },
        controls:{ value:{ target:new Vector3(),enabled:false,update:vi.fn() } },ribbonSeries:{ value:null },
        audio:{ setBlocked:vi.fn() },cinematicCamera:{ hasROIs:{ value:false } } };
    const deps = { renderScene:vi.fn(),pauseRenderLoop:vi.fn(),resumeRenderLoop:vi.fn(),restoreLightingPreview:vi.fn() };
    const writer = { add:vi.fn(),finalize:vi.fn().mockResolvedValue(new Blob(['mp4'])),dispose:vi.fn() };
    createCanvasVideoExport.mockResolvedValue(writer);
    return { ctx,deps,writer,exporter:useSceneExport(ctx,deps) };
}
describe('scene video export timing and restoration', () => {
    it.each([[0, 35], [40, 0], [12.5, 50]])('exports independent %s° horizontal and %s° vertical tilt and restores the artwork', async (horizontal, vertical) => {
        const { ctx, deps, exporter } = fixture();
        ctx.camera.value.position.set(0, 0, 5);
        ctx.tileManager.value.getSeamlessLoopDuration = () => 1;
        ctx.app.artworkTiltHorizontalDegrees = horizontal;
        ctx.app.artworkTiltVerticalDegrees = vertical;
        const root = new Object3D();
        ctx.ribbonSeries.value = { getTransformRoot: () => root, update: vi.fn() };
        const frames = [];
        deps.renderScene.mockImplementation(() => frames.push(root.quaternion.clone()));
        await exporter.exportVideo({ fps: 4, duration: 1, artworkMotionMode: 'circularTilt' });
        const expected = [
            new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), horizontal * Math.PI / 180),
            new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), vertical * Math.PI / 180),
            new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -horizontal * Math.PI / 180),
            new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -vertical * Math.PI / 180),
        ];
        expect(frames).toHaveLength(4);
        frames.forEach((frame, index) => expect(frame.angleTo(expected[index])).toBeCloseTo(0, 7));
        expect(root.quaternion.equals(new Quaternion())).toBe(true);
        expect(root.position.equals(new Vector3())).toBe(true);
    });
    it('waits for background readiness and refuses still/video exports if the selected image failed', async () => {
        const { deps, exporter } = fixture();
        deps.ensureBackgroundReady = vi.fn().mockRejectedValue(new Error('Selected image unavailable'));
        await expect(exporter.captureImageBlobWithSettings()).rejects.toThrow('Selected image unavailable');
        await expect(exporter.exportVideo({ duration: 1 / 30 })).rejects.toThrow('Selected image unavailable');
        await expect(exporter.exportVideoLegacy()).rejects.toThrow('Selected image unavailable');
        expect(deps.renderScene).not.toHaveBeenCalled();
        expect(createCanvasVideoExport).not.toHaveBeenCalled();
    });
    it('awaits generated background pixels at each synthetic timestamp, then restores preview and disposes on success', async () => {
        const { deps, writer, exporter } = fixture();
        const events = [];
        const interpolation = {
            prepareFrame: vi.fn(async options => {
                events.push(`prepare:${options.timeSeconds}`);
                await Promise.resolve();
                return { generatedAt: options.timeSeconds };
            }),
            dispose: vi.fn(),
        };
        deps.createBackgroundExportInterpolation = vi.fn(async () => interpolation);
        deps.restoreBackgroundPreview = vi.fn();
        deps.renderScene.mockImplementation(options => {
            expect(options.backgroundFrame.generatedAt).toBe(options.timeSeconds);
            events.push(`render:${options.timeSeconds}`);
        });
        writer.add.mockImplementation(time => events.push(`encode:${time}`));
        await exporter.exportVideo({ fps: 30, duration: 2 / 30, backgroundInterpolation: 'rife' });
        expect(events).toEqual(['prepare:0', 'render:0', 'encode:0', `prepare:${1 / 30}`, `render:${1 / 30}`, `encode:${1 / 30}`]);
        expect(interpolation.prepareFrame.mock.calls[0][0]).toMatchObject({
            timeSeconds: 0, deterministicBackground: true, backgroundLoopDuration: 2 / 30,
        });
        expect(interpolation.dispose).toHaveBeenCalledOnce();
        expect(deps.restoreBackgroundPreview).toHaveBeenCalledOnce();
        expect(deps.restoreBackgroundPreview.mock.invocationCallOrder[0]).toBeLessThan(deps.resumeRenderLoop.mock.invocationCallOrder[0]);
    });

    it.each(['cancel', 'failure'])('restores preview if interpolation ends with %s before a frame is encoded', async mode => {
        const { deps, writer, exporter } = fixture(), controller = new AbortController();
        const interpolation = { prepareFrame: vi.fn(async () => {
            if (mode === 'cancel') controller.abort();
            else throw new Error('RIFE inference failed');
        }), dispose: vi.fn().mockRejectedValue(new Error('Cleanup failed')) };
        deps.createBackgroundExportInterpolation = vi.fn(async () => interpolation);
        deps.restoreBackgroundPreview = vi.fn();
        const result = exporter.exportVideo({ duration: 1, backgroundInterpolation: 'rife', signal: controller.signal });
        if (mode === 'cancel') expect(await result).toBeNull();
        else await expect(result).rejects.toThrow('RIFE inference failed');
        expect(deps.renderScene).not.toHaveBeenCalled();
        expect(writer.add).not.toHaveBeenCalled();
        expect(writer.finalize).not.toHaveBeenCalled();
        expect(writer.dispose).toHaveBeenCalledOnce();
        expect(interpolation.dispose).toHaveBeenCalledOnce();
        expect(deps.restoreBackgroundPreview).toHaveBeenCalledOnce();
        expect(deps.resumeRenderLoop).toHaveBeenCalledOnce();
    });

    it('does not create a model or decoder for crossfade exports', async () => {
        const { deps, exporter } = fixture();
        deps.createBackgroundExportInterpolation = vi.fn();
        await exporter.exportVideo({ duration: 1 / 30 });
        expect(deps.createBackgroundExportInterpolation).not.toHaveBeenCalled();
    });

    it('uses export-quality backgrounds for still images and restores the viewport', async () => {
        const { ctx, deps, exporter } = fixture();
        deps.restoreLightingPreview.mockImplementation(() => {
            expect(ctx.renderer.value.domElement).toMatchObject({ width: 800, height: 400 });
        });
        const canvas = { getContext: () => ({ drawImage: vi.fn() }), toBlob: callback => callback(new Blob(['png'])) };
        vi.stubGlobal('document', { createElement: () => canvas });
        const capture = await exporter.captureImageBlobWithSettings({ width: 1920, height: 1080, logoOverlayEnabled: false });
        expect(capture).toBeTruthy();
        expect(deps.renderScene).toHaveBeenCalledWith(expect.objectContaining({ blurMode: 'export', width: 1920, height: 1080 }));
        expect(ctx.renderer.value.setPixelRatio).toHaveBeenLastCalledWith(2);
        expect(ctx.renderer.value.setSize).toHaveBeenLastCalledWith(400, 200, false);
        expect(ctx.camera.value.aspect).toBe(2);
        expect(deps.restoreLightingPreview).toHaveBeenCalledOnce();
    });

    it.each([[1920, 1080], [2160, 2160]])('passes the actual %i × %i video dimensions to lighting and restores it before resuming', async (width, height) => {
        const { deps, exporter } = fixture();
        await exporter.exportVideo({ width, height, fps: 30, duration: 2 / 30 });
        expect(deps.renderScene).toHaveBeenCalledTimes(2);
        for (const [options] of deps.renderScene.mock.calls) {
            expect(options).toMatchObject({ blurMode: 'export', width, height });
        }
        expect(deps.restoreLightingPreview).toHaveBeenCalledOnce();
        expect(deps.restoreLightingPreview.mock.invocationCallOrder[0]).toBeLessThan(deps.resumeRenderLoop.mock.invocationCallOrder[0]);
    });

    it('restores lighting and the viewport after a still image render fails', async () => {
        const { ctx, deps, exporter } = fixture();
        deps.renderScene.mockImplementationOnce(() => { throw new Error('Projection render failed'); });
        expect(await exporter.captureImageBlobWithSettings({ width: 2160, height: 2160, logoOverlayEnabled: false })).toBeNull();
        expect(deps.restoreLightingPreview).toHaveBeenCalledOnce();
        expect(ctx.renderer.value.domElement).toMatchObject({ width: 800, height: 400 });
        expect(ctx.camera.value.aspect).toBe(2);
    });

    it('passes one background period per loop to synthetic frames, independent of the export loop count', async () => {
        const { ctx, deps, exporter } = fixture();
        ctx.tileManager.value.getSeamlessLoopDuration = () => 0.2;
        await exporter.exportVideo({ fps: 30, loopCount: 2 });
        expect(deps.renderScene.mock.calls).toHaveLength(12);
        expect(deps.renderScene.mock.calls[0][0]).toMatchObject({
            timeSeconds: 0, deterministicBackground: true, backgroundLoopDuration: 0.2, blurMode: 'export',
        });
        expect(deps.renderScene.mock.calls.at(-1)[0].timeSeconds).toBeCloseTo(11 / 30);
    });

    it('includes slower artwork motion in the synchronized export period', async () => {
        const { ctx, deps, exporter } = fixture();
        ctx.tileManager.value.getSeamlessLoopDuration = () => 0.2;
        ctx.app.artworkMotionMode = 'circularOrbit';
        ctx.app.viewerMotionLoopCount = 2;
        await exporter.exportVideo({ fps: 30, artworkMotionMode: 'circularOrbit' });
        expect(deps.renderScene.mock.calls).toHaveLength(12);
        expect(deps.renderScene.mock.calls[0][0].backgroundLoopDuration).toBe(0.4);
    });
    it('forwards the native encoder choice and final report callback', async () => {
        vi.stubGlobal('VideoEncoder', class {});
        const { exporter } = fixture(), report = vi.fn();
        await exporter.exportVideo({ width:320,height:240,fps:30,duration:0.1,encodingMethod:'webcodecs',hardwareAcceleration:'prefer-software',videoRange:'limited',yuvConversion:'cpu',onColourMetadata:report });
        expect(createCanvasVideoExport).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({ encodingMethod:'webcodecs',hardwareAcceleration:'prefer-software',videoRange:'limited',yuvConversion:'cpu',onColourMetadata:report }));
    });
    it.each(['ffmpeg', 'webcodecs'])('retains frame metrics in %s encoder statuses', async (encodingMethod) => {
        vi.stubGlobal('VideoEncoder', class {});
        const { writer, exporter } = fixture(), onStatus = vi.fn();
        createCanvasVideoExport.mockImplementationOnce(async (_canvas, options) => {
            options.onStatus('Loading encoder…');
            writer.add.mockImplementationOnce(() => options.onStatus('Encoding SDR frames 1–1…'));
            writer.finalize.mockImplementationOnce(async () => {
                options.onStatus('Verifying video…');
                return new Blob(['video']);
            });
            return writer;
        });
        await exporter.exportVideo({ duration: 1 / 30, encodingMethod, onStatus });
        const statuses = onStatus.mock.calls.map(([value]) => value);
        expect(statuses.every(value => / · \d+% · Frames \d\/1 · \d+\.\d fps$/.test(value))).toBe(true);
        expect(statuses.some(value => value.startsWith('Encoding SDR frames 1–1… · 0% · Frames 0/1'))).toBe(true);
        expect(statuses.some(value => value.startsWith('Verifying video… · 95% · Frames 1/1'))).toBe(true);
        expect(statuses.at(-1)).toMatch(/^Export complete\. · 100% · Frames 1\/1/);
    });
    it('renders a fractional duration with the existing ceil frame count, with no duplicate endpoint', async () => {
        vi.stubGlobal('VideoEncoder',undefined); // MP4 no longer relies on WebCodecs.
        const { ctx,deps,writer,exporter } = fixture(), progress = vi.fn();
        await exporter.exportVideo({ width:320,height:240,fps:30,duration:0.101,onProgress:progress });
        expect(writer.add.mock.calls).toEqual([[0,1/30],[1/30,1/30],[2/30,1/30],[3/30,1/30]]);
        expect(ctx.tileManager.value.tickDeterministic.mock.calls).toEqual([[0],[1/30],[1/30],[1/30]]);
        expect(createCanvasVideoExport).toHaveBeenCalledWith(ctx.renderer.value.domElement,expect.objectContaining({ width:320,height:240,format:'mp4' }));
        expect(progress.mock.calls.at(-1)).toEqual([1]);
        expect(writer.dispose).toHaveBeenCalledOnce(); expect(deps.resumeRenderLoop).toHaveBeenCalledOnce();
        expect(ctx.renderer.value.setPixelRatio).toHaveBeenLastCalledWith(2);
        expect(ctx.renderer.value.setSize).toHaveBeenLastCalledWith(400,200);
        expect(ctx.camera.value.aspect).toBe(2);
        expect(ctx.audio.setBlocked.mock.calls).toEqual([['scene-export',true],['scene-export',false]]);
    });
    it('cancels without finalizing a partial loop and restores renderer and audio', async () => {
        const { ctx,deps,writer,exporter } = fixture(), controller = new AbortController();
        writer.add.mockImplementationOnce(() => { controller.abort(); throw new DOMException('Cancelled','AbortError'); });
        expect(await exporter.exportVideo({ duration:1,signal:controller.signal })).toBeNull();
        expect(writer.finalize).not.toHaveBeenCalled(); expect(writer.dispose).toHaveBeenCalledOnce();
        expect(deps.restoreLightingPreview).toHaveBeenCalledOnce();
        expect(deps.resumeRenderLoop).toHaveBeenCalledOnce();
        expect(ctx.audio.setBlocked).toHaveBeenLastCalledWith('scene-export',false);
    });
    it('restores the scene if the encoder fails its colour validation', async () => {
        const { ctx,deps,writer,exporter } = fixture();
        writer.finalize.mockRejectedValue(new Error('MP4 nclx and H.264 VUI colour metadata disagree.'));
        await expect(exporter.exportVideo({ duration:1/30 })).rejects.toThrow('disagree');
        expect(deps.restoreLightingPreview).toHaveBeenCalledOnce();
        expect(writer.dispose).toHaveBeenCalledOnce(); expect(deps.resumeRenderLoop).toHaveBeenCalledOnce();
        expect(ctx.audio.setBlocked).toHaveBeenLastCalledWith('scene-export',false);
    });
});
