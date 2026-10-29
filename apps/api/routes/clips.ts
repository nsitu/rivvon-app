import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { nanoid } from 'nanoid';
import { optionalSession, verifySession } from '../middleware/session';
import type { AppEnv, AppBindings } from '../types/hono';
import { syncUser } from '../utils/user';
import { getLinkedPresets, parseAcceptedPresetIds, prepareMediaDeletion } from '../utils/presetDependencies';
import { inspectImage, MAX_THUMBNAIL_BYTES, MAX_THUMBNAIL_SIDE, IMAGE_MIME_TYPES } from '../../../packages/shared-types/src/imageAsset.js';
import { inspectClipInput, MAX_CLIP_BYTES, MAX_CLIP_SIDE, CLIP_MIME_TYPES, getClipInputFormats, CLIP_UPLOAD_PART_BYTES, MAX_CLIP_SINGLE_UPLOAD_BYTES, MAX_CLIP_INSPECTION_BYTES } from '../../../packages/shared-types/src/clipAsset.js';
import { Input, ALL_FORMATS, CustomSource } from 'mediabunny';

type ClipRow = { id: string; owner_id: string; status: string; clip_key: string; thumbnail_key: string;
    name: string; mime_type: string; width: number; height: number; expected_file_size: number;
    thumbnail_size: number; thumbnail_mime_type: string; upload_expires_at: number; [key: string]: any };
const metadata = (row: ClipRow) => ({ id: row.id, name: row.name, width: row.width, height: row.height,
    ...JSON.parse(row.metadata_json || '{}'), mime_type: row.mime_type, file_size: row.file_size, created_at: row.created_at, updated_at: row.updated_at });
const read = (db: D1Database, id: string) => db.prepare('SELECT * FROM clip_assets WHERE id = ?').bind(id).first<ClipRow>();
const fail = (message: string, status: 400 | 404 | 409 | 413 = 400): never => { throw new HTTPException(status, { message }); };
type UploadSession = { clip_id: string; id: string; upload_id: string; object_key: string };
const readUploadSession = (db: D1Database, clipId: string) => db.prepare('SELECT * FROM clip_upload_sessions WHERE clip_id = ?').bind(clipId).first<UploadSession>();
const isWritable = (row: ClipRow) => row.status === 'uploading' && row.upload_expires_at > Date.now() / 1000;

async function discardUploadSession(env: AppBindings, id: string) {
    const session = await readUploadSession(env.DB, id);
    if (!session) return;
    // Completed multipart objects have no active upload left to abort.
    if (!await env.CLIPS_BUCKET.head(session.object_key)) {
        try { await env.CLIPS_BUCKET.resumeMultipartUpload(session.object_key, session.upload_id).abort(); }
        catch (error) { if (!/NoSuchUpload|does not exist|not found/i.test(String(error))) throw error; }
    }
    await env.DB.prepare('DELETE FROM clip_upload_sessions WHERE clip_id = ? AND id = ?').bind(id, session.id).run();
}

async function owned(c: Context<AppEnv>) {
    const row = await read(c.env.DB, c.req.param('id'));
    if (!row || row.owner_id !== c.get('auth').userId) fail('Clip not found', 404);
    return row!;
}

async function accessible(c: Context<AppEnv>) {
    const row = await read(c.env.DB, c.req.param('id'));
    if (!row || row.status !== 'complete') fail('Clip not found', 404);
    if (row!.owner_id === c.get('auth')?.userId) return row!;
    const presetId = c.req.query('sourcePresetId');
    const grant = presetId && await c.env.DB.prepare(`SELECT p.id FROM scene_presets p
        JOIN preset_media_dependencies d ON d.preset_id = p.id
        WHERE p.id = ? AND d.clip_asset_id = ? AND p.status = 'complete'
        AND (p.owner_id = ? OR p.visibility != 'private')`).bind(presetId, row!.id, c.get('auth')?.userId || '').first();
    if (!grant) fail('Clip not found', 404);
    return row!;
}

export async function removeClipFiles(env: AppBindings, id: string) {
    await discardUploadSession(env, id);
    // Prefix cleanup also removes upload attempts whose finalization was interrupted.
    let cursor: string | undefined;
    do {
        const page = await env.CLIPS_BUCKET.list({ prefix: `clips/${id}/`, cursor });
        if (page.objects.length) await env.CLIPS_BUCKET.delete(page.objects.map(object => object.key));
        cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
}

export async function cleanupClips(env: AppBindings) {
    if (!env.CLIPS_BUCKET) return;
    const rows = await env.DB.prepare(`SELECT id FROM clip_assets
        WHERE (status = 'uploading' AND upload_expires_at < unixepoch()) OR status = 'deleting' LIMIT 50`).all<{ id: string }>();
    for (const { id } of rows.results) {
        await env.DB.prepare("UPDATE clip_assets SET status = 'deleting' WHERE id = ? AND (status = 'deleting' OR (status = 'uploading' AND upload_expires_at < unixepoch()))").bind(id).run();
        const row = await read(env.DB, id);
        if (row?.status !== 'deleting') continue;
        await removeClipFiles(env, id);
        await env.DB.prepare("DELETE FROM clip_assets WHERE id = ? AND status = 'deleting'").bind(id).run();
    }
    // A finalization response may be interrupted after committing the asset.
    const completed = await env.DB.prepare(`SELECT s.clip_id FROM clip_upload_sessions s
        JOIN clip_assets c ON c.id = s.clip_id WHERE c.status = 'complete' LIMIT 50`).all<{ clip_id: string }>();
    for (const { clip_id } of completed.results) await discardUploadSession(env, clip_id);
}

export const clipRoutes = new Hono<AppEnv>();
export const clipUploadRoutes = new Hono<AppEnv>();
for (const routes of [clipRoutes, clipUploadRoutes]) {
    routes.onError((error, c) => {
        if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
        console.error('Clip request failed', error);
        return c.json({ error: 'The clip request failed. Please try again.' }, 500);
    });
    routes.use('*', async (c, next) => {
        c.header('Cache-Control', 'private, no-store'); c.header('Vary', 'Cookie');
        if (!c.env.CLIPS_BUCKET) return c.json({ error: 'Clip storage is not configured.' }, 503);
        await next();
    });
}
clipRoutes.use('*', optionalSession);
clipUploadRoutes.use('*', verifySession);
clipUploadRoutes.use('*', async (c, next) => {
    const origin = c.req.header('Origin');
    const allowed = c.env.CORS_ORIGINS?.split(',') || ['https://rivvon.ca', 'https://slyce.rivvon.ca'];
    if (!['GET', 'HEAD'].includes(c.req.method) && origin && !allowed.includes(origin)) return c.json({ error: 'Invalid request origin.' }, 403);
    await next();
});

clipRoutes.get('/', verifySession, async (c) => {
    const limit = Math.min(100, Math.max(1, Number.parseInt(c.req.query('limit') || '24', 10) || 24));
    const offset = Math.max(0, Number.parseInt(c.req.query('offset') || '0', 10) || 0);
    const owner = c.get('auth').userId;
    const [rows, count] = await Promise.all([
        c.env.DB.prepare("SELECT * FROM clip_assets WHERE owner_id = ? AND status = 'complete' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?").bind(owner, limit, offset).all<ClipRow>(),
        c.env.DB.prepare("SELECT COUNT(*) AS total FROM clip_assets WHERE owner_id = ? AND status = 'complete'").bind(owner).first<{ total: number }>(),
    ]);
    return c.json({ clips: rows.results.map(metadata), pagination: { limit, offset, total: count?.total || 0 } });
});
clipRoutes.get('/:id', async (c) => c.json({ clip: metadata(await accessible(c)) }));
clipRoutes.on(['GET', 'HEAD'], '/:id/assets/:asset', async (c) => {
    const row = await accessible(c), asset = c.req.param('asset');
    if (!['clip', 'thumbnail'].includes(asset)) fail('Clip asset not found', 404);
    const objectKey = asset === 'clip' ? row.clip_key : row.thumbnail_key;
    const head = await c.env.CLIPS_BUCKET.head(objectKey);
    if (!head) fail('Clip asset not found', 404);
    const headers = new Headers({ 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff',
        'Content-Type': asset === 'clip' ? row.mime_type : row.thumbnail_mime_type, 'Accept-Ranges': 'bytes' });
    let range: { offset: number; length: number } | undefined;
    const requested = c.req.header('Range');
    if (requested && c.req.method !== 'HEAD') {
        const match = /^bytes=(\d*)-(\d*)$/.exec(requested);
        let start = match?.[1] ? Number(match[1]) : 0;
        let end = match?.[2] ? Number(match[2]) : head!.size - 1;
        if (match && !match[1] && match[2]) { start = Math.max(0, head!.size - Number(match[2])); end = head!.size - 1; }
        if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= head!.size || end < start) {
            headers.set('Content-Range', `bytes */${head!.size}`);
            return new Response(null, { status: 416, headers });
        }
        end = Math.min(end, head!.size - 1); range = { offset: start, length: end - start + 1 };
        headers.set('Content-Range', `bytes ${start}-${end}/${head!.size}`);
    }
    headers.set('Content-Length', String(range?.length ?? head!.size));
    if (c.req.method === 'HEAD') return new Response(null, { headers });
    const object = await c.env.CLIPS_BUCKET.get(objectKey, range ? { range } : undefined);
    if (!object) fail('Clip asset not found', 404);
    object!.writeHttpMetadata(headers); headers.set('ETag', object!.httpEtag);
    return new Response(object!.body, { status: range ? 206 : 200, headers });
});

clipUploadRoutes.post('/', async (c) => {
    const body = await c.req.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 120 || !CLIP_MIME_TYPES.includes(body?.mimeType) || !IMAGE_MIME_TYPES.includes(body?.thumbnailMimeType)
        || ![body?.width, body?.height].every(n => Number.isInteger(n) && n > 0 && n <= MAX_CLIP_SIDE)
        || !Number.isInteger(body?.fileSize) || body.fileSize <= 0 || body.fileSize > MAX_CLIP_BYTES
        || !Number.isInteger(body?.thumbnailSize) || body.thumbnailSize <= 0 || body.thumbnailSize > MAX_THUMBNAIL_BYTES) fail('Invalid clip metadata');
    const id = nanoid(), auth = c.get('auth');
    await syncUser(c.env.DB, auth.userId, { name: auth.name, email: auth.email, picture: auth.picture });
    await c.env.DB.prepare(`INSERT INTO clip_assets
        (id, owner_id, name, source_filename, source_mime_type, mime_type, width, height, expected_file_size,
        thumbnail_size, thumbnail_mime_type, clip_key, thumbnail_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, auth.userId, name,
        typeof body.sourceFilename === 'string' ? body.sourceFilename.slice(0, 255) : null,
        typeof body.sourceMimeType === 'string' ? body.sourceMimeType.slice(0, 120) : null,
        body.mimeType, body.width, body.height, body.fileSize, body.thumbnailSize, body.thumbnailMimeType,
        `clips/${id}/clip-pending`, `clips/${id}/thumbnail-pending`).run();
    return c.json({ clipId: id }, 201);
});

async function readBounded(request: Request, limit: number) {
    const reader = request.body?.getReader();
    if (!reader) fail('A clip file is required');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
        while (true) {
            const chunk = await reader!.read(); if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > limit) fail('Clip exceeds the upload size limit', 413);
            chunks.push(chunk.value);
        }
    } finally { await reader!.cancel().catch(() => {}); }
    const result = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
}

// Bound each HTTP request independently of the whole-file limit. R2 needs a
// known-length stream; this also rejects truncated/oversized chunk bodies.
async function uploadPartStream(request: Request, expectedSize: number, write: (stream: ReadableStream) => Promise<R2UploadedPart>) {
    if (!request.body || Number(request.headers.get('Content-Length')) !== expectedSize) fail('The clip part length does not match its expected size');
    const stream = new FixedLengthStream(expectedSize), controller = new AbortController();
    const transfer = request.body!.pipeTo(stream.writable, { signal: controller.signal });
    transfer.catch(() => {});
    try { const part = await write(stream.readable); await transfer; return part; }
    catch (error) { controller.abort(); await transfer.catch(() => {}); throw error; }
}

clipUploadRoutes.post('/:id/upload', async (c) => {
    const row = await owned(c);
    if (!isWritable(row)) fail('This clip upload is no longer writable', 409);
    const describe = (session: UploadSession) => ({ sessionId: session.id, partSize: CLIP_UPLOAD_PART_BYTES,
        partCount: Math.ceil(row.expected_file_size / CLIP_UPLOAD_PART_BYTES) });
    const existing = await readUploadSession(c.env.DB, row.id);
    if (existing) return c.json(describe(existing));
    const id = nanoid(), objectKey = `clips/${row.id}/clip-${id}`;
    const upload = await c.env.CLIPS_BUCKET.createMultipartUpload(objectKey, { httpMetadata: { contentType: row.mime_type } });
    let session;
    try {
        session = await c.env.DB.prepare(`INSERT INTO clip_upload_sessions (clip_id, id, upload_id, object_key)
            SELECT id, ?, ?, ? FROM clip_assets WHERE id = ? AND status = 'uploading' AND upload_expires_at > unixepoch()
            ON CONFLICT(clip_id) DO NOTHING RETURNING *`).bind(id, upload.uploadId, objectKey, row.id).first<UploadSession>();
    } catch (error) { await upload.abort(); throw error; }
    if (!session) {
        await upload.abort();
        const winner = await readUploadSession(c.env.DB, row.id);
        if (!winner || !isWritable((await read(c.env.DB, row.id)) || { ...row, status: 'deleting' })) fail('The clip changed while preparing its upload', 409);
        return c.json(describe(winner!));
    }
    return c.json(describe(session), 201);
});

clipUploadRoutes.put('/:id/upload/:sessionId/parts/:partNumber', async (c) => {
    const row = await owned(c);
    if (!isWritable(row)) fail('This clip upload is no longer writable', 409);
    const session = await readUploadSession(c.env.DB, row.id);
    if (!session || session.id !== c.req.param('sessionId')) fail('Clip upload session not found', 404);
    const rawPart = c.req.param('partNumber'), partNumber = Number(rawPart);
    const partCount = Math.ceil(row.expected_file_size / CLIP_UPLOAD_PART_BYTES);
    if (!/^\d+$/.test(rawPart) || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > partCount) fail('Invalid clip upload part');
    if (c.req.header('Content-Type')?.split(';')[0] !== row.mime_type) fail('Invalid clip part content type');
    const expectedSize = Math.min(CLIP_UPLOAD_PART_BYTES, row.expected_file_size - (partNumber - 1) * CLIP_UPLOAD_PART_BYTES);
    const upload = c.env.CLIPS_BUCKET.resumeMultipartUpload(session!.object_key, session!.upload_id);
    const part = await uploadPartStream(c.req.raw, expectedSize, stream => upload.uploadPart(partNumber, stream));
    return c.json(part);
});

clipUploadRoutes.post('/:id/upload/:sessionId/complete', async (c) => {
    const row = await owned(c);
    if (row.status === 'complete') return c.json({ success: true });
    if (!isWritable(row)) fail('This clip upload is no longer writable', 409);
    const session = await readUploadSession(c.env.DB, row.id);
    if (!session || session.id !== c.req.param('sessionId')) fail('Clip upload session not found', 404);
    const expectedParts = Math.ceil(row.expected_file_size / CLIP_UPLOAD_PART_BYTES);
    const body = await readBounded(c.req.raw, 64 * 1024);
    let parts: R2UploadedPart[];
    try { parts = JSON.parse(new TextDecoder().decode(body)).parts; } catch { fail('Invalid clip part manifest'); }
    if (!Array.isArray(parts!) || parts!.length !== expectedParts || parts!.some((part, index) => part?.partNumber !== index + 1
        || typeof part.etag !== 'string' || !part.etag.length || part.etag.length > 256 || !/^[\x20-\x7e]+$/.test(part.etag))) fail('Upload every clip part in order before completing');
    const key = session!.object_key;
    // An assembled object is immutable and also makes retries safe when the
    // client lost the assembly response before the D1 pointer was committed.
    let object = await c.env.CLIPS_BUCKET.head(key);
    if (!object) {
        try { object = await c.env.CLIPS_BUCKET.resumeMultipartUpload(key, session!.upload_id).complete(parts!); }
        catch (error) {
            object = await c.env.CLIPS_BUCKET.head(key);
            if (!object) throw error;
        }
    }
    if (object!.size !== row.expected_file_size || object!.size > MAX_CLIP_BYTES) {
        await c.env.CLIPS_BUCKET.delete(key); fail('Assembled clip size does not match the upload metadata');
    }
    const updated = await c.env.DB.prepare(`UPDATE clip_assets SET clip_key = ?, updated_at = unixepoch()
        WHERE id = ? AND status = 'uploading' AND clip_key = ? AND upload_expires_at > unixepoch() RETURNING id`)
        .bind(key, row.id, row.clip_key).first();
    if (!updated) {
        const latest = await read(c.env.DB, row.id);
        if (latest?.clip_key !== key || !['uploading', 'complete'].includes(latest.status)) {
            await c.env.CLIPS_BUCKET.delete(key); fail('The clip changed during upload', 409);
        }
    }
    if (row.clip_key !== key) await c.env.CLIPS_BUCKET.delete(row.clip_key);
    return c.json({ success: true });
});

clipUploadRoutes.put('/:id/assets/:asset', async (c) => {
    const row = await owned(c), asset = c.req.param('asset');
    if (!['clip', 'thumbnail'].includes(asset)) fail('Clip asset not found', 404);
    if (row.status !== 'uploading' || row.upload_expires_at <= Date.now() / 1000) fail('This clip upload is no longer writable', 409);
    const thumbnail = asset === 'thumbnail', expectedSize = thumbnail ? row.thumbnail_size : row.expected_file_size;
    if (!thumbnail && expectedSize > MAX_CLIP_SINGLE_UPLOAD_BYTES) fail('Use multipart upload for this clip', 413);
    const type = thumbnail ? row.thumbnail_mime_type : row.mime_type;
    if (c.req.header('Content-Type')?.split(';')[0] !== type) fail('Uploaded clip does not match its metadata');
    let body: Uint8Array | ReadableStream;
    let transfer: Promise<void> | undefined;
    const controller = new AbortController();
    if (thumbnail) {
        body = await readBounded(c.req.raw, MAX_THUMBNAIL_BYTES);
        let info;
        try { info = inspectImage(body); } catch (error) { fail(error instanceof Error ? error.message : 'Invalid thumbnail'); }
        if (body.byteLength !== expectedSize || info!.mimeType !== type || Math.max(info!.width, info!.height) > MAX_THUMBNAIL_SIDE) fail('Invalid clip thumbnail');
    } else {
        if (!c.req.raw.body || Number(c.req.header('Content-Length')) !== expectedSize) fail('The clip upload length must match its metadata');
        // FixedLengthStream preserves a known length for R2 and rejects both
        // truncated and oversized streams without buffering the video in RAM.
        const stream = new FixedLengthStream(expectedSize);
        transfer = c.req.raw.body!.pipeTo(stream.writable, { signal: controller.signal });
        transfer.catch(() => {});
        body = stream.readable;
    }
    // Each attempt gets an immutable key. A late request can never overwrite a
    // completed clip, even if upload/complete/delete requests overlap.
    const column = thumbnail ? 'thumbnail_key' : 'clip_key', previousKey = row[column];
    const key = `clips/${row.id}/${asset}-${nanoid()}`;
    try {
        await c.env.CLIPS_BUCKET.put(key, body, { httpMetadata: { contentType: type } });
        await transfer;
        const result = await c.env.DB.prepare(`UPDATE clip_assets SET ${column} = ?, updated_at = unixepoch()
            WHERE id = ? AND status = 'uploading' AND ${column} = ? AND upload_expires_at > unixepoch() RETURNING id`)
            .bind(key, row.id, previousKey).first();
        if (!result) fail('The clip changed during upload. Retry the upload.', 409);
    } catch (error) { controller.abort(); await transfer?.catch(() => {}); await c.env.CLIPS_BUCKET.delete(key); throw error; }
    await c.env.CLIPS_BUCKET.delete(previousKey);
    return c.json({ success: true });
});

clipUploadRoutes.post('/:id/complete', async (c) => {
    const row = await owned(c);
    if (row.status === 'complete') return c.json({ clip: metadata(row) });
    if (row.status !== 'uploading' || row.upload_expires_at <= Date.now() / 1000) fail('Clip upload has expired or is being deleted', 409);
    const [clip, thumbnail] = await Promise.all([c.env.CLIPS_BUCKET.head(row.clip_key), c.env.CLIPS_BUCKET.head(row.thumbnail_key)]);
    if (!clip || !thumbnail || clip.size !== row.expected_file_size || thumbnail.size !== row.thumbnail_size) fail('Clip upload is incomplete', 409);
    // Pure JS demuxing works in Workers; only bounded ranges are retained.
    let bytesRead = 0, reads = 0;
    const input = new Input({ formats: getClipInputFormats(ALL_FORMATS), source: new CustomSource({ getSize: () => clip!.size, maxCacheSize: 2 * 1024 * 1024,
        async read(start, end) {
            bytesRead += end - start;
            if (++reads > 4096 || bytesRead > MAX_CLIP_INSPECTION_BYTES) throw new Error('Clip metadata exceeds the inspection budget');
            const part = await c.env.CLIPS_BUCKET.get(row.clip_key, { range: { offset: start, length: end - start } });
            if (!part) throw new Error('Clip upload is unavailable');
            return part.body;
        },
    }) });
    let info;
    try { info = await inspectClipInput(input); }
    catch (error) { fail(error instanceof Error ? error.message : 'Invalid video clip'); }
    finally { input.dispose(); }
    if (info!.mimeType !== row.mime_type) fail('Clip format does not match the upload metadata');
    if (info!.width !== row.width || info!.height !== row.height) fail('Clip dimensions do not match the upload metadata');
    const done = await c.env.DB.prepare(`UPDATE clip_assets SET status = 'complete', file_size = expected_file_size, metadata_json = ?, updated_at = unixepoch()
        WHERE id = ? AND status = 'uploading' AND clip_key = ? AND thumbnail_key = ? AND upload_expires_at > unixepoch() RETURNING *`)
        .bind(JSON.stringify(info), row.id, row.clip_key, row.thumbnail_key).first<ClipRow>();
    if (!done) fail('Clip changed during finalization. Try again.', 409);
    await discardUploadSession(c.env, row.id);
    return c.json({ clip: metadata(done!) });
});
clipUploadRoutes.patch('/:id', async (c) => {
    const row = await owned(c), body = await c.req.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 120 || row.status !== 'complete') fail('Invalid clip name or clip unavailable');
    await c.env.DB.prepare("UPDATE clip_assets SET name = ?, updated_at = unixepoch() WHERE id = ? AND status = 'complete'").bind(name, row.id).run();
    return c.json({ clip: metadata({ ...row, name }) });
});
clipUploadRoutes.get('/:id/preset-dependencies', async (c) => {
    const row = await owned(c);
    return c.json({ linkedPresets: await getLinkedPresets(c.env.DB, 'clip', [row.id], c.get('auth').userId) });
});
clipUploadRoutes.delete('/:id', async (c) => {
    const row = await owned(c), consent = await c.req.json().catch(() => ({}));
    const deletion = await prepareMediaDeletion(c.env, 'clip', [row.id], c.get('auth').userId,
        parseAcceptedPresetIds(JSON.stringify(consent.acceptedPresetIds || [])));
    if (deletion.conflict) return c.json({ error: 'Review the linked presets before deleting this clip.', code: 'PRESET_DEPENDENCIES', linkedPresets: deletion.conflict }, 409);
    await removeClipFiles(c.env, row.id);
    await c.env.DB.prepare("DELETE FROM clip_assets WHERE id = ? AND status = 'deleting'").bind(row.id).run();
    return c.json({ success: true, deletedPresets: deletion.deletedPresets });
});
