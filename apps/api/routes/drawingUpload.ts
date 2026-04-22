import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { verifySession } from '../middleware/session';
import { syncUser, isAdminUser } from '../utils/user';

type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
  ADMIN_USERS?: string;
};

const DRAWING_KIND_VALUES = new Set(['gesture', 'walk', 'text', 'emoji', 'svg']);
const DRAWING_STORAGE_PROVIDER_VALUES = new Set(['r2', 'google-drive']);
const THUMBNAIL_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']);

function parsePositiveInteger(value: unknown, fieldName: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

function normalizePayloadJson(payload: unknown) {
  const payloadJson = typeof payload === 'string' ? payload : JSON.stringify(payload ?? null);
  if (!payloadJson || payloadJson === 'null') {
    throw new Error('payloadJson is required');
  }

  try {
    JSON.parse(payloadJson);
  } catch {
    throw new Error('payloadJson must be valid JSON');
  }

  return payloadJson;
}

function normalizeHttpsUrl(url: unknown, fallback = '') {
  const normalized = typeof url === 'string' ? url.trim() : '';
  if (!normalized) {
    return fallback;
  }
  if (!normalized.startsWith('https://')) {
    throw new Error('URL must use HTTPS');
  }
  return normalized;
}

export const drawingUploadRoutes = new Hono<{ Bindings: Bindings }>();

drawingUploadRoutes.use('*', verifySession);

drawingUploadRoutes.post('/', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json();

  const normalizedName = typeof body.name === 'string' ? body.name.trim() : '';
  const normalizedDescription = typeof body.description === 'string' ? body.description.trim() : null;
  const normalizedKind = typeof body.kind === 'string' ? body.kind.trim() : '';
  const normalizedStorageProvider = typeof body.storageProvider === 'string' ? body.storageProvider : 'google-drive';
  let normalizedPathCount: number;
  let normalizedPointCount: number;

  try {
    normalizedPathCount = parsePositiveInteger(body.pathCount, 'pathCount');
    normalizedPointCount = parsePositiveInteger(body.pointCount, 'pointCount');
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Invalid drawing metadata' }, 400);
  }
  const normalizedParentDrawingId = typeof body.parentDrawingId === 'string' && body.parentDrawingId.trim()
    ? body.parentDrawingId.trim()
    : null;

  if (!normalizedName) {
    return c.json({ error: 'name is required' }, 400);
  }

  if (!DRAWING_KIND_VALUES.has(normalizedKind)) {
    return c.json({ error: 'Invalid drawing kind' }, 400);
  }

  if (!DRAWING_STORAGE_PROVIDER_VALUES.has(normalizedStorageProvider)) {
    return c.json({ error: 'Invalid storage provider. Must be "r2" or "google-drive"' }, 400);
  }

  if (normalizedStorageProvider === 'r2' && !isAdminUser(c.env.ADMIN_USERS, auth.email)) {
    return c.json({ error: 'Only admin users can save drawings to R2' }, 403);
  }

  if (body.userProfile) {
    await syncUser(c.env.DB, auth.userId, body.userProfile);
  }

  if (normalizedParentDrawingId) {
    const parentDrawing = await c.env.DB.prepare(`
      SELECT id FROM drawings WHERE id = ? AND owner_id = ?
    `).bind(normalizedParentDrawingId, auth.userId).first();

    if (!parentDrawing) {
      return c.json({ error: 'Parent drawing not found' }, 404);
    }
  }

  const drawingId = nanoid();
  const payloadR2Key = normalizedStorageProvider === 'r2'
    ? `drawings/${drawingId}/drawing.json`
    : null;
  const payloadPublicUrl = payloadR2Key
    ? `https://cdn.rivvon.ca/${payloadR2Key}`
    : null;

  await c.env.DB.prepare(`
    INSERT INTO drawings (
      id, owner_id, parent_drawing_id, name, description, kind,
      path_count, point_count, payload_r2_key, payload_public_url,
      storage_provider, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading')
  `).bind(
    drawingId,
    auth.userId,
    normalizedParentDrawingId,
    normalizedName,
    normalizedDescription,
    normalizedKind,
    normalizedPathCount,
    normalizedPointCount,
    payloadR2Key,
    payloadPublicUrl,
    normalizedStorageProvider,
  ).run();

  return c.json({
    drawingId,
    parentDrawingId: normalizedParentDrawingId,
    storageProvider: normalizedStorageProvider,
    payloadUrl: payloadPublicUrl,
    message: normalizedStorageProvider === 'r2'
      ? 'Drawing created. Upload payload and thumbnail, then call /complete.'
      : 'Drawing created. Upload payload to Google Drive, register it, then call /complete.',
  });
});

drawingUploadRoutes.put('/:id/payload', async (c) => {
  const auth = c.get('auth');
  const drawingId = c.req.param('id');

  const drawing = await c.env.DB.prepare(`
    SELECT * FROM drawings WHERE id = ? AND owner_id = ?
  `).bind(drawingId, auth.userId).first() as any;

  if (!drawing) {
    return c.json({ error: 'Drawing not found' }, 404);
  }

  if (drawing.storage_provider !== 'r2') {
    return c.json({ error: 'This endpoint is only for R2-backed drawings' }, 400);
  }

  const payloadBuffer = await c.req.arrayBuffer();
  let payloadJson: string;

  try {
    payloadJson = normalizePayloadJson(new TextDecoder().decode(payloadBuffer));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Invalid drawing payload' }, 400);
  }

  await c.env.BUCKET.put(drawing.payload_r2_key, payloadBuffer, {
    httpMetadata: { contentType: 'application/json' }
  });

  await c.env.DB.prepare(`
    UPDATE drawings
    SET payload_json = ?, payload_size = ?, updated_at = unixepoch()
    WHERE id = ?
  `).bind(payloadJson, payloadBuffer.byteLength, drawingId).run();

  return c.json({
    success: true,
    drawingId,
    payloadUrl: drawing.payload_public_url,
    size: payloadBuffer.byteLength,
  });
});

drawingUploadRoutes.post('/:id/payload/metadata', async (c) => {
  const auth = c.get('auth');
  const drawingId = c.req.param('id');

  const drawing = await c.env.DB.prepare(`
    SELECT * FROM drawings WHERE id = ? AND owner_id = ?
  `).bind(drawingId, auth.userId).first() as any;

  if (!drawing) {
    return c.json({ error: 'Drawing not found' }, 404);
  }

  if (drawing.storage_provider !== 'google-drive') {
    return c.json({ error: 'This endpoint is only for Google Drive-backed drawings' }, 400);
  }

  const body = await c.req.json();
  const driveFileId = typeof body.driveFileId === 'string' ? body.driveFileId.trim() : '';
  let payloadJson: string;
  try {
    payloadJson = normalizePayloadJson(body.payloadJson ?? body.payload);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Invalid drawing payload' }, 400);
  }
  const fileSize = body.fileSize == null ? null : Number(body.fileSize);
  const driveFolderId = typeof body.driveFolderId === 'string' && body.driveFolderId.trim()
    ? body.driveFolderId.trim()
    : null;

  if (!driveFileId) {
    return c.json({ error: 'driveFileId is required' }, 400);
  }

  let payloadPublicUrl: string;
  try {
    payloadPublicUrl = normalizeHttpsUrl(body.publicUrl, `https://drive.google.com/uc?export=download&id=${driveFileId}`);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Invalid publicUrl' }, 400);
  }

  await c.env.DB.prepare(`
    UPDATE drawings
    SET payload_drive_file_id = ?, payload_public_url = ?, payload_size = ?, payload_json = ?, drive_folder_id = ?, updated_at = unixepoch()
    WHERE id = ?
  `).bind(
    driveFileId,
    payloadPublicUrl,
    Number.isFinite(fileSize) ? fileSize : null,
    payloadJson,
    driveFolderId,
    drawingId,
  ).run();

  return c.json({
    success: true,
    drawingId,
    driveFileId,
    payloadUrl: payloadPublicUrl,
  });
});

drawingUploadRoutes.post('/:id/complete', async (c) => {
  const auth = c.get('auth');
  const drawingId = c.req.param('id');

  const drawing = await c.env.DB.prepare(`
    SELECT * FROM drawings WHERE id = ? AND owner_id = ?
  `).bind(drawingId, auth.userId).first() as any;

  if (!drawing) {
    return c.json({ error: 'Drawing not found' }, 404);
  }

  if (drawing.storage_provider === 'r2') {
    if (!drawing.payload_r2_key) {
      return c.json({ error: 'Missing payload storage key' }, 400);
    }

    const object = await c.env.BUCKET.head(drawing.payload_r2_key);
    if (!object) {
      return c.json({ error: 'Drawing payload not uploaded' }, 400);
    }

    await c.env.DB.prepare(`
      UPDATE drawings
      SET payload_size = COALESCE(payload_size, ?), updated_at = unixepoch()
      WHERE id = ?
    `).bind(object.size, drawingId).run();
  } else if (!drawing.payload_drive_file_id) {
    return c.json({ error: 'Drawing payload has not been registered' }, 400);
  }

  if (!drawing.payload_json) {
    return c.json({ error: 'Drawing payload JSON is missing' }, 400);
  }

  await c.env.DB.prepare(`
    UPDATE drawings
    SET status = 'complete', updated_at = unixepoch()
    WHERE id = ?
  `).bind(drawingId).run();

  return c.json({ success: true, drawingId, status: 'complete' });
});

drawingUploadRoutes.put('/:id/thumbnail', async (c) => {
  const auth = c.get('auth');
  const drawingId = c.req.param('id');

  const drawing = await c.env.DB.prepare(`
    SELECT * FROM drawings WHERE id = ? AND owner_id = ?
  `).bind(drawingId, auth.userId).first();

  if (!drawing) {
    return c.json({ error: 'Drawing not found' }, 404);
  }

  const contentType = c.req.header('Content-Type') || 'image/jpeg';
  if (!THUMBNAIL_CONTENT_TYPES.has(contentType)) {
    return c.json({ error: 'Invalid content type. Allowed: image/jpeg, image/png, image/webp, image/svg+xml' }, 400);
  }

  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
  };
  const ext = extMap[contentType];
  const r2Key = `drawing-thumbnails/${drawingId}.${ext}`;
  const thumbnailUrl = `https://cdn.rivvon.ca/${r2Key}`;
  const body = await c.req.arrayBuffer();

  await c.env.BUCKET.put(r2Key, body, {
    httpMetadata: { contentType }
  });

  await c.env.DB.prepare(`
    UPDATE drawings
    SET thumbnail_url = ?, updated_at = unixepoch()
    WHERE id = ?
  `).bind(thumbnailUrl, drawingId).run();

  return c.json({ success: true, drawingId, thumbnailUrl, size: body.byteLength });
});

drawingUploadRoutes.patch('/:id', async (c) => {
  const auth = c.get('auth');
  const drawingId = c.req.param('id');
  const body = await c.req.json();
  const normalizedName = typeof body.name === 'string' ? body.name.trim() : body.name;
  const isAdmin = isAdminUser(c.env.ADMIN_USERS, auth.email);

  const drawing = await c.env.DB.prepare(`
    SELECT owner_id FROM drawings WHERE id = ?
  `).bind(drawingId).first() as any;

  if (!drawing) {
    return c.json({ error: 'Drawing not found' }, 404);
  }

  if (drawing.owner_id !== auth.userId && !isAdmin) {
    return c.json({ error: 'Not authorized to update this drawing' }, 403);
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    if (typeof normalizedName !== 'string' || !normalizedName) {
      return c.json({ error: 'name must be a non-empty string' }, 400);
    }
    updates.push('name = ?');
    values.push(normalizedName);
  }

  if (body.description !== undefined) {
    updates.push('description = ?');
    values.push(body.description);
  }

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  updates.push('updated_at = unixepoch()');
  values.push(drawingId);

  await c.env.DB.prepare(`
    UPDATE drawings SET ${updates.join(', ')} WHERE id = ?
  `).bind(...values).run();

  return c.json({ success: true, message: 'Drawing updated' });
});

drawingUploadRoutes.delete('/:id', async (c) => {
  const auth = c.get('auth');
  const drawingId = c.req.param('id');
  const isAdmin = isAdminUser(c.env.ADMIN_USERS, auth.email);

  const drawing = await c.env.DB.prepare(`
    SELECT * FROM drawings WHERE id = ? ${isAdmin ? '' : 'AND owner_id = ?'}
  `).bind(...(isAdmin ? [drawingId] : [drawingId, auth.userId])).first() as any;

  if (!drawing) {
    return c.json({ error: 'Drawing not found or not authorized' }, 404);
  }

  const r2KeysToDelete = new Set<string>();
  if (drawing.payload_r2_key) {
    r2KeysToDelete.add(drawing.payload_r2_key);
  }
  if (drawing.thumbnail_url) {
    r2KeysToDelete.add(String(drawing.thumbnail_url).replace('https://cdn.rivvon.ca/', ''));
  }

  if (r2KeysToDelete.size > 0) {
    await c.env.BUCKET.delete(Array.from(r2KeysToDelete));
  }

  await c.env.DB.prepare(`
    DELETE FROM drawings WHERE id = ?
  `).bind(drawingId).run();

  return c.json({ success: true, drawingId, deletedFiles: r2KeysToDelete.size });
});