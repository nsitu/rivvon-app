import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { useSceneExport } from './useSceneExport.js';
import { createCanvasVideoExport } from '../../modules/viewer/canvasVideoExport.js';

vi.mock('../../modules/viewer/canvasVideoExport.js', () => ({ createCanvasVideoExport: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());
function fixture() {
    const camera = new PerspectiveCamera(40, 2, 0.1, 100); camera.position.set(1,2,3);
    const renderer = { domElement:{ width:800,height:400 },getPixelRatio:() => 2,setPixelRatio:vi.fn(),setSize:vi.fn() };
    const ctx = { renderer:{ value:renderer },scene:{ value:{} },camera:{ value:camera },
        app:{},tileManager:{ value:{ resetAnimationState:vi.fn(),tickDeterministic:vi.fn() } },tileManagers:{ value:[] },
        controls:{ value:{ target:new Vector3(),enabled:false,update:vi.fn() } },ribbonSeries:{ value:null },
        audio:{ setBlocked:vi.fn() },cinematicCamera:{ hasROIs:{ value:false } } };
    const deps = { renderScene:vi.fn(),pauseRenderLoop:vi.fn(),resumeRenderLoop:vi.fn() };
    const writer = { add:vi.fn(),finalize:vi.fn().mockResolvedValue(new Blob(['mp4'])),dispose:vi.fn() };
    createCanvasVideoExport.mockResolvedValue(writer);
    return { ctx,deps,writer,exporter:useSceneExport(ctx,deps) };
}
describe('scene video export timing and restoration', () => {
    it('forwards the native encoder choice and final report callback', async () => {
        vi.stubGlobal('VideoEncoder', class {});
        const { exporter } = fixture(), report = vi.fn();
        await exporter.exportVideo({ width:320,height:240,fps:30,duration:0.1,encodingMethod:'webcodecs',hardwareAcceleration:'prefer-software',onColourMetadata:report });
        expect(createCanvasVideoExport).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({ encodingMethod:'webcodecs',hardwareAcceleration:'prefer-software',onColourMetadata:report }));
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
        expect(deps.resumeRenderLoop).toHaveBeenCalledOnce();
        expect(ctx.audio.setBlocked).toHaveBeenLastCalledWith('scene-export',false);
    });
    it('restores the scene if the encoder fails its colour validation', async () => {
        const { ctx,deps,writer,exporter } = fixture();
        writer.finalize.mockRejectedValue(new Error('MP4 nclx and H.264 VUI colour metadata disagree.'));
        await expect(exporter.exportVideo({ duration:1/30 })).rejects.toThrow('disagree');
        expect(writer.dispose).toHaveBeenCalledOnce(); expect(deps.resumeRenderLoop).toHaveBeenCalledOnce();
        expect(ctx.audio.setBlocked).toHaveBeenLastCalledWith('scene-export',false);
    });
});
