import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { nanoid } from 'nanoid';
import { optionalSession, verifySession } from '../middleware/session';
import type { AppEnv, AppBindings } from '../types/hono';
import { syncUser } from '../utils/user';
import { getLinkedPresets, parseAcceptedPresetIds, prepareMediaDeletion } from '../utils/presetDependencies';
import { inspectImage, IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, MAX_THUMBNAIL_BYTES, MAX_THUMBNAIL_SIDE } from '../../../packages/shared-types/src/imageAsset.js';

type ImageRow = { id: string; owner_id: string; status: string; image_key: string; thumbnail_key: string;
    name: string; mime_type: string; width: number; height: number; expected_file_size: number;
    thumbnail_size: number; thumbnail_mime_type: string; upload_expires_at: number; [key: string]: any };
const metadata = (row: ImageRow) => ({ id: row.id, name: row.name, width: row.width, height: row.height,
    mime_type: row.mime_type, file_size: row.file_size, created_at: row.created_at, updated_at: row.updated_at });
const read = (db: D1Database, id: string) => db.prepare('SELECT * FROM image_assets WHERE id = ?').bind(id).first<ImageRow>();
const fail = (message: string, status: 400 | 404 | 409 | 413 = 400): never => { throw new HTTPException(status, { message }); };

async function owned(c: Context<AppEnv>) {
    const row = await read(c.env.DB, c.req.param('id'));
    if (!row || row.owner_id !== c.get('auth').userId) fail('Image not found', 404);
    return row!;
}

async function accessible(c: Context<AppEnv>) {
    const row = await read(c.env.DB, c.req.param('id'));
    if (!row || row.status !== 'complete') fail('Image not found', 404);
    if (row!.owner_id === c.get('auth')?.userId) return row!;
    const presetId = c.req.query('sourcePresetId');
    const grant = presetId && await c.env.DB.prepare(`SELECT p.id FROM scene_presets p
        JOIN preset_media_dependencies d ON d.preset_id = p.id
        WHERE p.id = ? AND d.image_asset_id = ? AND p.status = 'complete'
        AND (p.owner_id = ? OR p.visibility != 'private')`).bind(presetId, row!.id, c.get('auth')?.userId || '').first();
    if (!grant) fail('Image not found', 404);
    return row!;
}

export async function removeImageFiles(env: AppBindings, id: string) {
    // Prefix cleanup also removes upload attempts whose finalization was interrupted.
    let cursor: string | undefined;
    do {
        const page = await env.IMAGES_BUCKET.list({ prefix: `images/${id}/`, cursor });
        if (page.objects.length) await env.IMAGES_BUCKET.delete(page.objects.map(object => object.key));
        cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
}

export async function cleanupImages(env: AppBindings) {
    if (!env.IMAGES_BUCKET) return;
    const rows = await env.DB.prepare(`SELECT id FROM image_assets
        WHERE (status = 'uploading' AND upload_expires_at < unixepoch()) OR status = 'deleting' LIMIT 50`).all<{ id: string }>();
    for (const { id } of rows.results) {
        await env.DB.prepare("UPDATE image_assets SET status = 'deleting' WHERE id = ? AND (status = 'deleting' OR (status = 'uploading' AND upload_expires_at < unixepoch()))").bind(id).run();
        const row = await read(env.DB, id);
        if (row?.status !== 'deleting') continue;
        await removeImageFiles(env, id);
        await env.DB.prepare("DELETE FROM image_assets WHERE id = ? AND status = 'deleting'").bind(id).run();
    }
}

export const imageRoutes = new Hono<AppEnv>();
export const imageUploadRoutes = new Hono<AppEnv>();
for (const routes of [imageRoutes, imageUploadRoutes]) {
    routes.onError((error, c) => {
        if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
        console.error('Image request failed', error);
        return c.json({ error: 'The image request failed. Please try again.' }, 500);
    });
    routes.use('*', async (c, next) => {
        c.header('Cache-Control', 'private, no-store'); c.header('Vary', 'Cookie');
        if (!c.env.IMAGES_BUCKET) return c.json({ error: 'Image storage is not configured.' }, 503);
        await next();
    });
}
imageRoutes.use('*', optionalSession);
imageUploadRoutes.use('*', verifySession);
imageUploadRoutes.use('*', async (c, next) => {
    const origin = c.req.header('Origin');
    const allowed = c.env.CORS_ORIGINS?.split(',') || ['https://rivvon.ca', 'https://slyce.rivvon.ca'];
    if (!['GET', 'HEAD'].includes(c.req.method) && origin && !allowed.includes(origin)) return c.json({ error: 'Invalid request origin.' }, 403);
    await next();
});

imageRoutes.get('/', verifySession, async (c) => {
    const limit = Math.min(100, Math.max(1, Number.parseInt(c.req.query('limit') || '24', 10) || 24));
    const offset = Math.max(0, Number.parseInt(c.req.query('offset') || '0', 10) || 0);
    const owner = c.get('auth').userId;
    const [rows, count] = await Promise.all([
        c.env.DB.prepare("SELECT * FROM image_assets WHERE owner_id = ? AND status = 'complete' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?").bind(owner, limit, offset).all<ImageRow>(),
        c.env.DB.prepare("SELECT COUNT(*) AS total FROM image_assets WHERE owner_id = ? AND status = 'complete'").bind(owner).first<{ total: number }>(),
    ]);
    return c.json({ images: rows.results.map(metadata), pagination: { limit, offset, total: count?.total || 0 } });
});
imageRoutes.get('/:id', async (c) => c.json({ image: metadata(await accessible(c)) }));
imageRoutes.get('/:id/assets/:asset', async (c) => {
    const row = await accessible(c), asset = c.req.param('asset');
    if (!['image', 'thumbnail'].includes(asset)) fail('Image asset not found', 404);
    const object = await c.env.IMAGES_BUCKET.get(asset === 'image' ? row.image_key : row.thumbnail_key);
    if (!object) fail('Image asset not found', 404);
    const headers = new Headers({ 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' });
    object!.writeHttpMetadata(headers); headers.set('ETag', object!.httpEtag);
    return new Response(object!.body, { headers });
});

imageUploadRoutes.post('/', async (c) => {
    const body = await c.req.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 120 || !IMAGE_MIME_TYPES.includes(body?.mimeType) || !IMAGE_MIME_TYPES.includes(body?.thumbnailMimeType)
        || ![body?.width, body?.height].every(n => Number.isInteger(n) && n > 0 && n <= MAX_IMAGE_SIDE)
        || !Number.isInteger(body?.fileSize) || body.fileSize <= 0 || body.fileSize > MAX_IMAGE_BYTES
        || !Number.isInteger(body?.thumbnailSize) || body.thumbnailSize <= 0 || body.thumbnailSize > MAX_THUMBNAIL_BYTES) fail('Invalid image metadata');
    const id = nanoid(), auth = c.get('auth');
    await syncUser(c.env.DB, auth.userId, { name: auth.name, email: auth.email, picture: auth.picture });
    await c.env.DB.prepare(`INSERT INTO image_assets
        (id, owner_id, name, source_filename, source_mime_type, mime_type, width, height, expected_file_size,
        thumbnail_size, thumbnail_mime_type, image_key, thumbnail_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, auth.userId, name,
        typeof body.sourceFilename === 'string' ? body.sourceFilename.slice(0, 255) : null,
        typeof body.sourceMimeType === 'string' ? body.sourceMimeType.slice(0, 120) : null,
        body.mimeType, body.width, body.height, body.fileSize, body.thumbnailSize, body.thumbnailMimeType,
        `images/${id}/image-pending`, `images/${id}/thumbnail-pending`).run();
    return c.json({ imageId: id }, 201);
});

async function readBounded(request: Request, limit: number) {
    const reader = request.body?.getReader();
    if (!reader) fail('An image file is required');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
        while (true) {
            const chunk = await reader!.read(); if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > limit) fail('Image exceeds the upload size limit', 413);
            chunks.push(chunk.value);
        }
    } finally { await reader!.cancel().catch(() => {}); }
    const result = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
}

imageUploadRoutes.put('/:id/assets/:asset', async (c) => {
    const row = await owned(c), asset = c.req.param('asset');
    if (!['image', 'thumbnail'].includes(asset)) fail('Image asset not found', 404);
    if (row.status !== 'uploading' || row.upload_expires_at <= Date.now() / 1000) fail('This image upload is no longer writable', 409);
    const thumbnail = asset === 'thumbnail', expectedSize = thumbnail ? row.thumbnail_size : row.expected_file_size;
    const bytes = await readBounded(c.req.raw, thumbnail ? MAX_THUMBNAIL_BYTES : MAX_IMAGE_BYTES);
    let info;
    try { info = inspectImage(bytes); } catch (error) { fail(error instanceof Error ? error.message : 'Invalid image'); }
    const type = thumbnail ? row.thumbnail_mime_type : row.mime_type;
    if (bytes.byteLength !== expectedSize || info!.mimeType !== type || c.req.header('Content-Type')?.split(';')[0] !== type
        || (thumbnail ? Math.max(info!.width, info!.height) > MAX_THUMBNAIL_SIDE : info!.width !== row.width || info!.height !== row.height)) fail('Uploaded image does not match its metadata');
    // Each attempt gets an immutable key. A late request can never overwrite a
    // completed image, even if upload/complete/delete requests overlap.
    const column = thumbnail ? 'thumbnail_key' : 'image_key', previousKey = row[column];
    const key = `images/${row.id}/${asset}-${nanoid()}`;
    await c.env.IMAGES_BUCKET.put(key, bytes, { httpMetadata: { contentType: type } });
    try {
        const result = await c.env.DB.prepare(`UPDATE image_assets SET ${column} = ?, updated_at = unixepoch()
            WHERE id = ? AND status = 'uploading' AND ${column} = ? AND upload_expires_at > unixepoch() RETURNING id`)
            .bind(key, row.id, previousKey).first();
        if (!result) fail('The image changed during upload. Retry the upload.', 409);
    } catch (error) { await c.env.IMAGES_BUCKET.delete(key); throw error; }
    await c.env.IMAGES_BUCKET.delete(previousKey);
    return c.json({ success: true });
});

imageUploadRoutes.post('/:id/complete', async (c) => {
    const row = await owned(c);
    if (row.status === 'complete') return c.json({ image: metadata(row) });
    if (row.status !== 'uploading' || row.upload_expires_at <= Date.now() / 1000) fail('Image upload has expired or is being deleted', 409);
    const [image, thumbnail] = await Promise.all([c.env.IMAGES_BUCKET.head(row.image_key), c.env.IMAGES_BUCKET.head(row.thumbnail_key)]);
    if (!image || !thumbnail || image.size !== row.expected_file_size || thumbnail.size !== row.thumbnail_size) fail('Image upload is incomplete', 409);
    const done = await c.env.DB.prepare(`UPDATE image_assets SET status = 'complete', file_size = expected_file_size, updated_at = unixepoch()
        WHERE id = ? AND status = 'uploading' AND image_key = ? AND thumbnail_key = ? AND upload_expires_at > unixepoch() RETURNING *`)
        .bind(row.id, row.image_key, row.thumbnail_key).first<ImageRow>();
    if (!done) fail('Image changed during finalization. Try again.', 409);
    return c.json({ image: metadata(done!) });
});
imageUploadRoutes.patch('/:id', async (c) => {
    const row = await owned(c), body = await c.req.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 120 || row.status !== 'complete') fail('Invalid image name or image unavailable');
    await c.env.DB.prepare("UPDATE image_assets SET name = ?, updated_at = unixepoch() WHERE id = ? AND status = 'complete'").bind(name, row.id).run();
    return c.json({ image: metadata({ ...row, name }) });
});
imageUploadRoutes.get('/:id/preset-dependencies', async (c) => {
    const row = await owned(c);
    return c.json({ linkedPresets: await getLinkedPresets(c.env.DB, 'image', [row.id], c.get('auth').userId) });
});
imageUploadRoutes.delete('/:id', async (c) => {
    const row = await owned(c), consent = await c.req.json().catch(() => ({}));
    const deletion = await prepareMediaDeletion(c.env, 'image', [row.id], c.get('auth').userId,
        parseAcceptedPresetIds(JSON.stringify(consent.acceptedPresetIds || [])));
    if (deletion.conflict) return c.json({ error: 'Review the linked presets before deleting this image.', code: 'PRESET_DEPENDENCIES', linkedPresets: deletion.conflict }, 409);
    await removeImageFiles(c.env, row.id);
    await c.env.DB.prepare("DELETE FROM image_assets WHERE id = ? AND status = 'deleting'").bind(row.id).run();
    return c.json({ success: true, deletedPresets: deletion.deletedPresets });
});
