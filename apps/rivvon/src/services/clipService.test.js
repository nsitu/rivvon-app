import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadClipBytes, prepareClipUpload } from './clipService.js';
import { MAX_CLIP_BYTES, CLIP_UPLOAD_PART_BYTES } from '../../../../packages/shared-types/src/clipAsset.js';

describe('large clip uploads', () => {
    let sent, failPart, failed, notify;
    const reply = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    beforeEach(() => {
        sent = []; failed = false; failPart = null; notify = null;
        vi.stubGlobal('XMLHttpRequest', class {
            upload = {};
            open(_method, url) { this.url = url; }
            setRequestHeader() {}
            abort() { this.aborted = true; this.onabort?.(); }
            send(blob) {
                sent.push({ url: this.url, size: blob.size });
                queueMicrotask(() => {
                    const partNumber = Number(/\/parts\/(\d+)$/.exec(this.url)?.[1]);
                    this.upload.onprogress?.({ lengthComputable: true, loaded: blob.size, total: blob.size });
                    notify?.(); if (this.aborted) return;
                    if (partNumber === failPart && !failed) { failed = true; this.onerror(); return; }
                    this.status = 200; this.responseText = JSON.stringify(partNumber ? { partNumber, etag: `etag-${partNumber}` } : { success: true });
                    this.onload();
                });
            }
        });
        vi.stubGlobal('fetch', vi.fn(async (url, options) => {
            if (url.endsWith('/upload')) return reply({ sessionId: 'session-1', partSize: CLIP_UPLOAD_PART_BYTES, partCount: Math.ceil(MAX_CLIP_BYTES / CLIP_UPLOAD_PART_BYTES) });
            if (url.endsWith('/session-1/complete')) return reply({ success: true });
            throw new Error(`Unexpected request ${url} ${options?.method}`);
        }));
    });
    afterEach(() => vi.unstubAllGlobals());
    // A virtual file validates the full 1 GB slicing/manifest path without
    // allocating 1 GB in a unit test. Browser File.slice also avoids a full copy.
    const largeFile = () => ({ size: MAX_CLIP_BYTES, slice: vi.fn((start, end, type) => ({ size: end - start, type })) });
    it('sends a 1 GB clip as bounded parts, retries a failed part, then assembles the ordered receipts', async () => {
        const file = largeFile(), progress = [];
        failPart = 2;
        await uploadClipBytes('clip-1', file, { onProgress: value => progress.push(value) });
        expect(MAX_CLIP_BYTES).toBe(1_000_000_000);
        expect(sent.every(part => part.size > 0 && part.size <= CLIP_UPLOAD_PART_BYTES)).toBe(true);
        expect(sent.filter(part => part.url.endsWith('/parts/2'))).toHaveLength(2);
        const unique = new Map(sent.map(part => [part.url, part.size]));
        expect([...unique.values()].reduce((a, b) => a + b, 0)).toBe(MAX_CLIP_BYTES);
        const call = fetch.mock.calls.find(([url]) => url.endsWith('/session-1/complete'));
        const { parts } = JSON.parse(call[1].body);
        expect(parts).toHaveLength(Math.ceil(MAX_CLIP_BYTES / CLIP_UPLOAD_PART_BYTES));
        expect(parts[0]).toEqual({ partNumber: 1, etag: 'etag-1' });
        expect(parts.at(-1).partNumber).toBe(parts.length);
        expect(progress.at(-1)).toBe(1);
    });
    it('stops sending chunks and never assembles when cancelled', async () => {
        const controller = new AbortController();
        notify = () => controller.abort();
        await expect(uploadClipBytes('clip-1', largeFile(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
        expect(sent).toHaveLength(1);
        expect(fetch.mock.calls.some(([url]) => url.endsWith('/complete'))).toBe(false);
    });
    it('rejects files above 1 GB before media inspection or any upload request', async () => {
        await expect(uploadClipBytes('clip-1', { size: MAX_CLIP_BYTES + 1 })).rejects.toThrow('1 GB');
        await expect(prepareClipUpload({ size: MAX_CLIP_BYTES + 1 })).rejects.toThrow('1 GB');
        expect(fetch).not.toHaveBeenCalled(); expect(sent).toHaveLength(0);
    });
    it('keeps small files on the existing bounded upload path', async () => {
        await uploadClipBytes('clip-1', new Blob(['clip'], { type: 'video/mp4' }));
        expect(sent).toHaveLength(1); expect(sent[0].url).toMatch(/\/assets\/clip$/);
        expect(fetch).not.toHaveBeenCalled();
    });
});
