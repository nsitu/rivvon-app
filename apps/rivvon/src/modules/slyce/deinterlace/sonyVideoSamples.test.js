import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundedMediaOperation } from './sonyVideoSamples.js';

afterEach(() => vi.useRealTimers());

describe('interlaced processing watchdog', () => {
    it('reports stalled media operations after 30 seconds', async () => {
        vi.useFakeTimers();
        const result = boundedMediaOperation(new Promise(() => {}), null, 'GPU stopped.');
        const rejected = expect(result).rejects.toThrow('GPU stopped.');
        await vi.advanceTimersByTimeAsync(30000);
        await rejected;
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels immediately and closes a frame produced after cancellation', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        let complete;
        const operation = new Promise(resolve => { complete = resolve; });
        const result = boundedMediaOperation(operation, controller.signal);
        const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
        controller.abort();
        await rejected;
        const frame = { close: vi.fn() };
        complete(frame);
        await Promise.resolve();
        expect(frame.close).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('clears the watchdog when an operation succeeds', async () => {
        vi.useFakeTimers();
        await expect(boundedMediaOperation(Promise.resolve(42))).resolves.toBe(42);
        expect(vi.getTimerCount()).toBe(0);
    });
});
