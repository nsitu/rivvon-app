import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { verifySession } from '../middleware/session';
import type { AppEnv } from '../types/hono';
import { isAdminUser, syncUserIfProvided } from '../utils/user';
import { getAccessibleResourceById, getOwnedResourceById, getResourceById } from '../utils/resourceAccess';
import {
  buildCdnUrl,
  buildDrawingPayloadR2Key,
  buildDrawingThumbnailR2Key,
  buildGoogleDriveDownloadUrl,
  extractCdnPath,
} from '../utils/storagePaths';
import {
  normalizeHttpsUrl,
  normalizeOptionalId,
  normalizePayloadJson,
  parsePositiveInteger,
} from '../utils/validation';
import {
  badRequestResponse,
  forbiddenResponse,
  jsonResponse,
  notFoundResponse,
  successResponse,
} from '../utils/response';

const DRAWING_KIND_VALUES = new Set(['gesture', 'walk', 'text', 'emoji', 'svg', 'contour']);
const DRAWING_STORAGE_PROVIDER_VALUES = new Set(['r2', 'google-drive']);
const THUMBNAIL_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']);

function badRequestFromUnknown(error: unknown, fallbackMessage: string): Response {
  return badRequestResponse(error instanceof Error ? error.message : fallbackMessage);
}

export const drawingUploadRoutes = new Hono<AppEnv>();

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
    return badRequestFromUnknown(error, 'Invalid drawing metadata');
  }
  const normalizedParentDrawingId = normalizeOptionalId(body.parentDrawingId);
  const normalizedRootDrawingId = normalizeOptionalId(body.rootDrawingId);

  if (!normalizedName) {
    return badRequestResponse('name is required');
  }

  if (!DRAWING_KIND_VALUES.has(normalizedKind)) {
    return badRequestResponse('Invalid drawing kind');
  }

  if (!DRAWING_STORAGE_PROVIDER_VALUES.has(normalizedStorageProvider)) {
    return badRequestResponse('Invalid storage provider. Must be "r2" or "google-drive"');
  }

  if (normalizedStorageProvider === 'r2' && !isAdminUser(c.env.ADMIN_USERS, auth.email)) {
    return forbiddenResponse('Only admin users can save drawings to R2');
  }

  await syncUserIfProvided(c.env.DB, auth.userId, body.userProfile);

  let parentDrawing: { id: string; root_drawing_id: string | null } | null = null;

  if (normalizedParentDrawingId) {
    parentDrawing = await getOwnedResourceById<{ id: string; root_drawing_id: string | null }>(
      c.env.DB,
      'drawings',
      normalizedParentDrawingId,
      auth.userId,
      'id, root_drawing_id'
    );

    if (!parentDrawing?.id) {
      return notFoundResponse('Parent drawing not found');
    }
  }

  if (normalizedRootDrawingId) {
    const rootDrawing = await getOwnedResourceById<{ id: string }>(
      c.env.DB,
      'drawings',
      normalizedRootDrawingId,
      auth.userId,
      'id'
    );

    if (!rootDrawing?.id) {
      return notFoundResponse('Root drawing not found');
    }
  }

  const drawingId = nanoid();
  const resolvedRootDrawingId = normalizedRootDrawingId
    || parentDrawing?.root_drawing_id
    || parentDrawing?.id
    || drawingId;

  if (normalizedRootDrawingId && parentDrawing) {
    const expectedRootDrawingId = parentDrawing.root_drawing_id || parentDrawing.id;
    if (normalizedRootDrawingId !== expectedRootDrawingId) {
      return badRequestResponse('rootDrawingId must match the parent drawing root');
    }
  }

  const payloadR2Key = normalizedStorageProvider === 'r2'
    ? buildDrawingPayloadR2Key(drawingId)
    : null;
  const payloadPublicUrl = payloadR2Key
    ? buildCdnUrl(payloadR2Key)
    : null;

  await c.env.DB.prepare(`
    INSERT INTO drawings (
      id, owner_id, parent_drawing_id, root_drawing_id, name, description, kind,
      path_count, point_count, payload_r2_key, payload_public_url,
      storage_provider, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading')
  `).bind(
    drawingId,
    auth.userId,
    normalizedParentDrawingId,
    resolvedRootDrawingId,
    normalizedName,
    normalizedDescription,
    normalizedKind,
    normalizedPathCount,
    normalizedPointCount,
    payloadR2Key,
    payloadPublicUrl,
    normalizedStorageProvider,
  ).run();

  return jsonResponse({
    drawingId,
    parentDrawingId: normalizedParentDrawingId,
    rootDrawingId: resolvedRootDrawingId,
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

  const drawing = await getOwnedResourceById<any>(c.env.DB, 'drawings', drawingId, auth.userId);

  if (!drawing) {
    return notFoundResponse('Drawing not found');
  }

  if (drawing.storage_provider !== 'r2') {
    return badRequestResponse('This endpoint is only for R2-backed drawings');
  }

  const payloadBuffer = await c.req.arrayBuffer();
  let payloadJson: string;

  try {
    payloadJson = normalizePayloadJson(new TextDecoder().decode(payloadBuffer));
  } catch (error) {
    return badRequestFromUnknown(error, 'Invalid drawing payload');
  }

  await c.env.BUCKET.put(drawing.payload_r2_key, payloadBuffer, {
    httpMetadata: { contentType: 'application/json' }
  });

  await c.env.DB.prepare(`
    UPDATE drawings
    SET payload_json = ?, payload_size = ?, updated_at = unixepoch()
    WHERE id = ?
  `).bind(payloadJson, payloadBuffer.byteLength, drawingId).run();

  return successResponse({
    drawingId,
    payloadUrl: drawing.payload_public_url,
    size: payloadBuffer.byteLength,
  });
});

drawingUploadRoutes.post('/:id/payload/metadata', async (c) => {
  const auth = c.get('auth');
  const drawingId = c.req.param('id');

  const drawing = await getOwnedResourceById<any>(c.env.DB, 'drawings', drawingId, auth.userId);

  if (!drawing) {
    return notFoundResponse('Drawing not found');
  }

  if (drawing.storage_provider !== 'google-drive') {
    return badRequestResponse('This endpoint is only for Google Drive-backed drawings');
  }

  const body = await c.req.json();
  const driveFileId = typeof body.driveFileId === 'string' ? body.driveFileId.trim() : '';
  let payloadJson: string;
  try {
    payloadJson = normalizePayloadJson(body.payloadJson ?? body.payload);
  } catch (error) {
    return badRequestFromUnknown(error, 'Invalid drawing payload');
  }
  const fileSize = body.fileSize == null ? null : Number(body.fileSize);
  const driveFolderId = typeof body.driveFolderId === 'string' && body.driveFolderId.trim()
    ? body.driveFolderId.trim()
    : null;

  if (!driveFileId) {
    return badRequestResponse('driveFileId is required');
  }

  let payloadPublicUrl: string;
  try {
    payloadPublicUrl = normalizeHttpsUrl(body.publicUrl, buildGoogleDriveDownloadUrl(driveFileId));
  } catch (error) {
    return badRequestFromUnknown(error, 'Invalid publicUrl');
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

  return successResponse({
    drawingId,
    driveFileId,
    payloadUrl: payloadPublicUrl,
  });
});

drawingUploadRoutes.post('/:id/complete', async (c) => {
  const auth = c.get('auth');
  const drawingId = c.req.param('id');

  const drawing = await getOwnedResourceById<any>(c.env.DB, 'drawings', drawingId, auth.userId);

  if (!drawing) {
    return notFoundResponse('Drawing not found');
  }

  if (drawing.storage_provider === 'r2') {
    if (!drawing.payload_r2_key) {
      return badRequestResponse('Missing payload storage key');
    }

    const object = await c.env.BUCKET.head(drawing.payload_r2_key);
    if (!object) {
      return badRequestResponse('Drawing payload not uploaded');
    }

    await c.env.DB.prepare(`
      UPDATE drawings
      SET payload_size = COALESCE(payload_size, ?), updated_at = unixepoch()
      WHERE id = ?
    `).bind(object.size, drawingId).run();
  } else if (!drawing.payload_drive_file_id) {
    return badRequestResponse('Drawing payload has not been registered');
  }

  if (!drawing.payload_json) {
    return badRequestResponse('Drawing payload JSON is missing');
  }

  await c.env.DB.prepare(`
    UPDATE drawings
    SET status = 'complete', updated_at = unixepoch()
    WHERE id = ?
  `).bind(drawingId).run();

  return successResponse({ drawingId, status: 'complete' });
});

drawingUploadRoutes.put('/:id/thumbnail', async (c) => {
  const auth = c.get('auth');
  const drawingId = c.req.param('id');

  const drawing = await getOwnedResourceById(c.env.DB, 'drawings', drawingId, auth.userId);

  if (!drawing) {
    return notFoundResponse('Drawing not found');
  }

  const contentType = c.req.header('Content-Type') || 'image/jpeg';
  if (!THUMBNAIL_CONTENT_TYPES.has(contentType)) {
    return badRequestResponse('Invalid content type. Allowed: image/jpeg, image/png, image/webp, image/svg+xml');
  }

  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
  };
  const ext = extMap[contentType];
  const r2Key = buildDrawingThumbnailR2Key(drawingId, ext);
  const thumbnailUrl = buildCdnUrl(r2Key);
  const body = await c.req.arrayBuffer();

  await c.env.BUCKET.put(r2Key, body, {
    httpMetadata: { contentType }
  });

  await c.env.DB.prepare(`
    UPDATE drawings
    SET thumbnail_url = ?, updated_at = unixepoch()
    WHERE id = ?
  `).bind(thumbnailUrl, drawingId).run();

  return successResponse({ drawingId, thumbnailUrl, size: body.byteLength });
});

drawingUploadRoutes.patch('/:id', async (c) => {
  const auth = c.get('auth');
  const drawingId = c.req.param('id');
  const body = await c.req.json();
  const normalizedName = typeof body.name === 'string' ? body.name.trim() : body.name;
  const isAdmin = isAdminUser(c.env.ADMIN_USERS, auth.email);

  const drawing = await getResourceById<{ owner_id: string }>(c.env.DB, 'drawings', drawingId, 'owner_id');

  if (!drawing) {
    return notFoundResponse('Drawing not found');
  }

  if (drawing.owner_id !== auth.userId && !isAdmin) {
    return forbiddenResponse('Not authorized to update this drawing');
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    if (typeof normalizedName !== 'string' || !normalizedName) {
      return badRequestResponse('name must be a non-empty string');
    }
    updates.push('name = ?');
    values.push(normalizedName);
  }

  if (body.description !== undefined) {
    updates.push('description = ?');
    values.push(body.description);
  }

  if (updates.length === 0) {
    return badRequestResponse('No fields to update');
  }

  updates.push('updated_at = unixepoch()');
  values.push(drawingId);

  await c.env.DB.prepare(`
    UPDATE drawings SET ${updates.join(', ')} WHERE id = ?
  `).bind(...values).run();

  return successResponse({}, 'Drawing updated');
});

drawingUploadRoutes.delete('/:id', async (c) => {
  const auth = c.get('auth');
  const drawingId = c.req.param('id');

  const drawing = await getAccessibleResourceById<any>(
    c.env.DB,
    'drawings',
    drawingId,
    auth,
    c.env.ADMIN_USERS,
  );

  if (!drawing) {
    return notFoundResponse('Drawing not found or not authorized');
  }

  const r2KeysToDelete = new Set<string>();
  if (drawing.payload_r2_key) {
    r2KeysToDelete.add(drawing.payload_r2_key);
  }
  if (drawing.thumbnail_url) {
    r2KeysToDelete.add(extractCdnPath(String(drawing.thumbnail_url)));
  }

  if (r2KeysToDelete.size > 0) {
    await c.env.BUCKET.delete(Array.from(r2KeysToDelete));
  }

  await c.env.DB.prepare(`
    DELETE FROM drawings WHERE id = ?
  `).bind(drawingId).run();

  return successResponse({ drawingId, deletedFiles: r2KeysToDelete.size });
});