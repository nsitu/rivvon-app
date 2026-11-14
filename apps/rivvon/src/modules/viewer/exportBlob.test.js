import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExportBlob, readExportBlob } from './exportBlob.js';

const NativeResponse = Response;
const partBytes = 32 * 1024 * 1024;
afterEach(() => vi.unstubAllGlobals());

describe('video Blob packaging', () => {
    it('preserves only the requested view and its MIME type', async () => {
        const bytes = new Uint8Array([99, 1, 2, 3, 99]);
        const blob = await createExportBlob(bytes.subarray(1, 4), { type: 'video/webm' });
        expect(blob.type).toBe('video/webm');
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
        expect([...bytes]).toEqual([99, 1, 2, 3, 99]);
    });

    it('streams independently backed buffers across boundaries without losing bytes', async () => {
        const bytes = new Uint8Array(partBytes + 7);
        bytes[0] = 1; bytes[partBytes - 1] = 2; bytes[partBytes] = 3; bytes[bytes.length - 1] = 4;
        const chunks = [];
        vi.stubGlobal('Response', class extends NativeResponse {
            constructor(stream, options) {
                super(stream.pipeThrough(new TransformStream({
                    transform(chunk, controller) {
                        chunks.push({ size: chunk.byteLength, bufferSize: chunk.buffer.byteLength, original: chunk.buffer === bytes.buffer });
                        if (chunk.buffer.byteLength > partBytes) throw new RangeError('Oversized stream buffer');
                        controller.enqueue(chunk);
                    },
                })), options);
            }
        });
        // Even a tiny subarray must be copied off an oversized backing buffer.
        expect(new Uint8Array(await (await createExportBlob(bytes.subarray(0, 1))).arrayBuffer())).toEqual(new Uint8Array([1]));
        expect(chunks).toEqual([{ size: 1, bufferSize: 1, original: false }]);
        chunks.length = 0;
        const blob = await createExportBlob(bytes);
        expect(blob.type).toBe('video/mp4'); expect(blob.size).toBe(bytes.length);
        expect(Buffer.compare(Buffer.from(await blob.arrayBuffer()), Buffer.from(bytes.buffer))).toBe(0);
        expect(chunks).toEqual([
            { size: partBytes, bufferSize: partBytes, original: false }, { size: 7, bufferSize: 7, original: false },
        ]);
    });

    it('rejects before packaging when already cancelled', async () => {
        const controller = new AbortController(); controller.abort();
        await expect(createExportBlob(new Uint8Array([1]), { signal: controller.signal }))
            .rejects.toMatchObject({ name: 'AbortError' });
    });

    it('allows cancellation between parts without returning a partial file', async () => {
        const controller = new AbortController();
        const result = createExportBlob(new Uint8Array(partBytes + 1), { signal: controller.signal });
        const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
        controller.abort(); await rejected;
    });
    it('reads bounded Blob slices into the exact original bytes', async () => {
        const bytes = new Uint8Array(partBytes + 7); bytes[0] = 3; bytes[partBytes] = 4; bytes[bytes.length - 1] = 5;
        const blob = new Blob([bytes]);
        const slice = vi.spyOn(blob, 'slice');
        const data = await readExportBlob(blob);
        expect(Buffer.compare(Buffer.from(data.buffer), Buffer.from(bytes.buffer))).toBe(0);
        expect(slice.mock.calls).toEqual([[0, partBytes], [partBytes, partBytes * 2]]);
    });
    it('cancels reading between Blob slices', async () => {
        const controller = new AbortController(), blob = new Blob([new Uint8Array(partBytes + 1)]);
        const slice = blob.slice.bind(blob);
        vi.spyOn(blob, 'slice').mockImplementation((start, end) => { controller.abort(); return slice(start, end); });
        await expect(readExportBlob(blob, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
        expect(blob.slice).toHaveBeenCalledOnce();
    });
});
