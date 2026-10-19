import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSdrEncoderPool, getSdrWorkerLimit } from './sdrEncoderPool.js';
import { assertSdrSps } from './videoColourMetadata.js';

const mocks = vi.hoisted(() => ({ instances: [], failLoads: new Set() }));
vi.mock('./videoColourMetadata.js', () => ({ inspectAnnexBSps: vi.fn(() => []), assertSdrSps: vi.fn() }));
vi.mock('@ffmpeg/ffmpeg', () => ({ FFmpeg: class {
    constructor() { this.id = mocks.instances.length; mocks.instances.push(this); }
    jobs = [];
    files = new Map();
    on = vi.fn();
    load = vi.fn(async () => { if (mocks.failLoads.has(this.id)) throw new Error('Worker unavailable'); });
    writeFile = vi.fn(async (name, data) => { this.files.set(name, data); });
    readFile = vi.fn(async name => name === 'chunk.h264'
        ? new Uint8Array([this.files.get('frames.yuv')[0]]) : new Uint8Array([99]));
    deleteFile = vi.fn(async name => { this.files.delete(name); });
    exec = vi.fn(args => args.includes('libx264')
        ? new Promise((resolve, reject) => this.jobs.push({ resolve, reject })) : Promise.resolve(0));
    terminate = vi.fn(() => { for (const job of this.jobs.splice(0)) job.reject(new Error('Terminated')); });
    finish() { this.jobs.shift().resolve(0); }
} }));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.instances.length = 0;
    mocks.failLoads.clear();
    vi.stubGlobal('navigator', { hardwareConcurrency: 16 });
});
afterEach(() => vi.unstubAllGlobals());
const options = { width: 2, height: 2, fps: 30, quality: 'high' };
const submit = (pool, n, frames = 1) => pool.submit(() => new Uint8Array([n]), frames);
const waitIdle = slot => vi.waitFor(() => expect(slot.files.has('frames.yuv')).toBe(false));

describe('SDR encoder worker pool', () => {
    it('caps workers at four and leaves a CPU available when possible', () => {
        expect(getSdrWorkerLimit(20)).toBe(4);
        expect(getSdrWorkerLimit(4, { hardwareConcurrency: 4 })).toBe(3);
        expect(getSdrWorkerLimit(4, { hardwareConcurrency: 2 })).toBe(1);
        expect(getSdrWorkerLimit(4, {})).toBe(2);
        expect(getSdrWorkerLimit(1)).toBe(1);
    });

    it('encodes concurrently, applies backpressure, and muxes batches in submission order', async () => {
        const onStatus = vi.fn();
        const pool = await createSdrEncoderPool({ ...options, onStatus });
        for (let n = 1; n <= 4; n++) await submit(pool, n, 3);
        expect(mocks.instances).toHaveLength(4);
        expect(mocks.instances.every(slot => slot.jobs.length === 1)).toBe(true);
        const copyFifth = vi.fn(() => new Uint8Array([5]));
        const fifth = pool.submit(copyFifth, 2);
        await Promise.resolve();
        expect(copyFifth).not.toHaveBeenCalled();

        // Fourth batch finishes first and frees its slot for the fifth batch.
        mocks.instances[3].finish();
        await fifth;
        expect(copyFifth).toHaveBeenCalledOnce();
        expect(mocks.instances).toHaveLength(4);
        expect(onStatus.mock.calls.some(([, details]) => details.encodedFrames === 3)).toBe(true);
        mocks.instances[1].finish();
        mocks.instances[2].finish();
        mocks.instances[3].finish();
        mocks.instances[0].finish();
        const data = await pool.mux();
        expect([...data]).toEqual([99]);
        const joined = mocks.instances[0].writeFile.mock.calls.find(([name]) => name === 'video.h264')[1];
        expect([...joined]).toEqual([1, 2, 3, 4, 5]);
        expect(assertSdrSps).toHaveBeenCalledTimes(5);
        expect(onStatus).toHaveBeenLastCalledWith('Muxing and verifying SDR video…', { encodedFrames: 14 });
        expect(pool.workerCount).toBe(4);
        expect(mocks.instances.slice(1).every(slot => slot.terminate.mock.calls.length === 1)).toBe(true);
        pool.dispose();
        pool.dispose();
        expect(mocks.instances[0].terminate).toHaveBeenCalledOnce();
    });

    it('reuses idle workers rather than loading all four for a short export', async () => {
        const pool = await createSdrEncoderPool(options);
        await submit(pool, 1);
        mocks.instances[0].finish();
        await waitIdle(mocks.instances[0]);
        await submit(pool, 2);
        expect(mocks.instances).toHaveLength(1);
        mocks.instances[0].finish();
        await pool.mux();
        pool.dispose();
    });

    it('continues with existing workers if an additional worker cannot load', async () => {
        mocks.failLoads.add(1);
        const pool = await createSdrEncoderPool(options);
        await submit(pool, 1);
        const second = submit(pool, 2);
        await vi.waitFor(() => expect(mocks.instances[1]?.terminate).toHaveBeenCalledOnce());
        mocks.instances[0].finish();
        await second;
        expect(pool.workerLimit).toBe(1);
        expect(pool.workerCount).toBe(1);
        mocks.instances[0].finish();
        await pool.mux();
        pool.dispose();
    });

    it('terminates all workers and rejects a waiting submission on cancellation', async () => {
        const controller = new AbortController();
        const pool = await createSdrEncoderPool({ ...options, signal: controller.signal });
        for (let n = 1; n <= 4; n++) await submit(pool, n);
        const copy = vi.fn();
        const waiting = pool.submit(copy, 1);
        controller.abort();
        await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
        await expect(pool.mux()).rejects.toMatchObject({ name: 'AbortError' });
        expect(copy).not.toHaveBeenCalled();
        expect(mocks.instances.every(slot => slot.terminate.mock.calls.length === 1)).toBe(true);
    });

    it('observes a background encoder failure and preserves it for the producer', async () => {
        const pool = await createSdrEncoderPool(options);
        await submit(pool, 1);
        await submit(pool, 2);
        const error = new Error('Encoding failed');
        mocks.instances[1].jobs.shift().reject(error);
        await vi.waitFor(() => expect(mocks.instances[0].terminate).toHaveBeenCalledOnce());
        expect(() => pool.check()).toThrow(error);
        await expect(submit(pool, 3)).rejects.toBe(error);
        await expect(pool.mux()).rejects.toBe(error);
    });

    it('rejects invalid batch colour metadata before muxing and stops the pool', async () => {
        assertSdrSps.mockImplementationOnce(() => { throw new Error('Invalid SPS'); });
        const pool = await createSdrEncoderPool(options);
        await submit(pool, 1);
        mocks.instances[0].finish();
        await expect(pool.mux()).rejects.toThrow('Invalid SPS');
        expect(mocks.instances[0].writeFile.mock.calls.some(([name]) => name === 'video.h264')).toBe(false);
    });

    it('cleans up when the initial worker fails to load', async () => {
        mocks.failLoads.add(0);
        await expect(createSdrEncoderPool(options)).rejects.toThrow('Worker unavailable');
        expect(mocks.instances[0].terminate).toHaveBeenCalledOnce();
    });
});
