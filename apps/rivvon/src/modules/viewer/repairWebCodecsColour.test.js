import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertSpsColourRepair, getSpsColourRepairArgs, planSpsColourRepair, repairMissingSpsColour } from './repairWebCodecsColour.js';

const mocks = vi.hoisted(() => ({ inspect: vi.fn(), load: vi.fn(), exec: vi.fn(),
    writeFile: vi.fn(), readFile: vi.fn(), terminate: vi.fn() }));
vi.mock('./videoColourMetadata.js', () => ({ inspectMp4Colour: mocks.inspect }));
vi.mock('@ffmpeg/ffmpeg', () => ({ FFmpeg: class {
    on() {}
    load = mocks.load; exec = mocks.exec; writeFile = mocks.writeFile;
    readFile = mocks.readFile; terminate = mocks.terminate;
} }));

const colour = { primaries:1,transfer:13,matrix:1,fullRange:true };
const encoder = { primaries:'bt709',transfer:'iec61966-2-1',matrix:'bt709',fullRange:true };
const sps = { width:960,height:540,chromaFormat:1,bitDepthLuma:8,bitDepthChroma:8,primaries:null,transfer:null,matrix:null,fullRange:null };
const fixture = () => ({ container:[{...colour}],sps:[{...sps}],sampleEntries:['avc1'],timescale:57600,movieTimescale:57600,
    frameCount:90,durationTicks:172800,mediaDurationTicks:172800,movieDurationTicks:172800,
    sampleTiming:[{count:90,value:1920}],compositionTiming:[],edits:[] });
describe('SPS repair eligibility', () => {
    it('uses the observed full/sRGB output rather than the desired limited/709 target', () => {
        const before = fixture(), plan = planSpsColourRepair(before,[encoder]);
        expect(plan).toMatchObject({status:'needed',colour});
        expect(plan.bitstreamFilter).toBe('h264_metadata=colour_primaries=1:transfer_characteristics=13:matrix_coefficients=1:video_full_range_flag=1');
        const args = getSpsColourRepairArgs(plan,before);
        expect(args).toContain('copy'); expect(args).toContain('pc'); expect(args).not.toContain('libx264');
        expect(args.slice(args.indexOf('-movie_timescale'),args.indexOf('-movie_timescale')+2)).toEqual(['-movie_timescale','57600']);
    });
    it('does not load a repair tool for already complete SPS declarations', () => {
        const before = fixture(); before.sps[0] = {...sps,...colour};
        expect(planSpsColourRepair(before,[encoder])).toEqual({status:'not-needed'});
    });
    it.each([
        metadata => {metadata.container=[];},
        metadata => {metadata.container.push({...colour,fullRange:false});},
        metadata => {metadata.sps[0].matrix=6;},
        metadata => {metadata.sps[0].fullRange=false;},
        metadata => {metadata.timescale=0;},
        metadata => {metadata.sps=[];},
    ])('does not replace missing fields when observed declarations conflict or are unavailable', change => {
        const before = fixture(); change(before);
        expect(planSpsColourRepair(before,[encoder]).status).toBe('skipped');
    });
    it.each([[],[{...encoder,fullRange:undefined}],[{...encoder,matrix:'unknown'}],[encoder,{...encoder,fullRange:false}]])('requires complete consistent encoder declarations %j', spaces => {
        expect(planSpsColourRepair(fixture(),spaces).status).toBe('skipped');
    });
    it('fills an unspecified colour code while retaining existing agreeing fields', () => {
        const before = fixture(); before.sps[0] = {...sps,primaries:1,transfer:2,fullRange:true};
        expect(planSpsColourRepair(before,[encoder]).status).toBe('needed');
    });
});
describe('repair validation', () => {
    const repaired = () => ({...fixture(),sps:[{...sps,...colour}]});
    it('allows equivalent timing-table grouping and a neutral edit list', () => {
        const after = repaired(); after.sampleTiming=[{count:45,value:1920},{count:45,value:1920}];
        after.edits=[{duration:172800,mediaTime:0,rateInteger:1,rateFraction:0}];
        expect(() => assertSpsColourRepair(fixture(),after,colour)).not.toThrow();
    });
    it.each([
        after=>{after.sps[0].transfer=1;},
        after=>{after.container[0].fullRange=false;},
        after=>{after.sps[0].width=962;},
        after=>{after.sampleTiming=[{count:45,value:1919},{count:45,value:1921}];},
        after=>{after.compositionTiming=[{count:90,value:1}];},
        after=>{after.edits=[{duration:172800,mediaTime:1920,rateInteger:1,rateFraction:0}];},
        after=>{after.movieDurationTicks++;},
    ])('rejects a repair that changes metadata, dimensions or frame presentation', change => {
        const after = repaired(); change(after);
        expect(() => assertSpsColourRepair(fixture(),after,colour)).toThrow();
    });
});

describe('repair worker cancellation', () => {
    beforeEach(() => {
        Object.values(mocks).forEach(mock => mock.mockReset());
        mocks.inspect.mockImplementation(() => fixture());
        mocks.load.mockResolvedValue(true); mocks.writeFile.mockResolvedValue(undefined);
    });
    it('avoids loading WASM when encoder declarations cannot support a repair', async () => {
        const data = new Uint8Array([1, 2]);
        const result = await repairMissingSpsColour(data, { decoderColourSpaces: [] });
        expect(result.data).toBe(data); expect(result.repair.status).toBe('skipped');
        expect(mocks.load).not.toHaveBeenCalled();
    });
    it('does not recreate a terminated worker after cancellation in a status callback', async () => {
        const controller = new AbortController();
        await expect(repairMissingSpsColour(new Uint8Array([1]), { decoderColourSpaces: [encoder],
            signal: controller.signal, onStatus: () => controller.abort() })).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.terminate).toHaveBeenCalledOnce(); expect(mocks.load).not.toHaveBeenCalled();
    });
    it('terminates a running repair and returns no completed data on cancellation', async () => {
        const controller = new AbortController();
        let started;
        const executing = new Promise(resolve => { started = resolve; });
        mocks.exec.mockImplementation(() => new Promise((_, reject) => {
            mocks.terminate.mockImplementation(() => reject(new Error('Worker terminated')));
            started();
        }));
        const result = repairMissingSpsColour(new Uint8Array([1]), { decoderColourSpaces: [encoder], signal: controller.signal });
        const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
        await executing; controller.abort(); await rejected;
        expect(mocks.terminate).toHaveBeenCalledOnce(); expect(mocks.readFile).not.toHaveBeenCalled();
    });
});
