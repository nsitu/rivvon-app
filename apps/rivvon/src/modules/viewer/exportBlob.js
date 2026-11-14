const BLOB_PART_BYTES = 32 * 1024 * 1024;
const checkAbort = signal => {
    if (signal?.aborted) throw new DOMException('Video export cancelled', 'AbortError');
};

// Chrome's WebIDL buffer limit also applies to Blob construction. Feed bounded,
// independently backed pieces through a stream so the browser can spool the
// completed Blob to storage without one oversized BufferSource or many pending
// Blob allocations. Small subarrays alone still retain the original buffer.
export async function createExportBlob(data, { type = 'video/mp4', signal } = {}) {
    checkAbort(signal);
    if (data.buffer.byteLength <= BLOB_PART_BYTES) return new Blob([data], { type });
    let start = 0;
    const stream = new ReadableStream({
        async pull(controller) {
            // Yield to cancellation/progress events while packaging large files.
            await new Promise(resolve => setTimeout(resolve, 0));
            checkAbort(signal);
            if (start === data.byteLength) { controller.close(); return; }
            const bytes = new Uint8Array(Math.min(BLOB_PART_BYTES, data.byteLength - start));
            bytes.set(data.subarray(start, start + bytes.byteLength));
            start += bytes.byteLength;
            controller.enqueue(bytes);
        },
    });
    const blob = await new Response(stream, { headers: { 'Content-Type': type } }).blob();
    checkAbort(signal);
    return blob;
}

// Blob readers have their own single-buffer limits. Read bounded slices while
// retaining the contiguous JavaScript view needed by the MP4 metadata parser.
export async function readExportBlob(blob, { signal } = {}) {
    checkAbort(signal);
    const data = new Uint8Array(blob.size);
    for (let start = 0; start < data.byteLength; start += BLOB_PART_BYTES) {
        checkAbort(signal);
        const bytes = await blob.slice(start, start + BLOB_PART_BYTES).arrayBuffer();
        data.set(new Uint8Array(bytes), start);
    }
    checkAbort(signal);
    return data;
}
