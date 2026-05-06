import { Hono } from 'hono';
import { verifySession } from '../middleware/session';
import type { AppEnv } from '../types/hono';
import { countAccessibleRows, isAdminRequest, queryAccessibleRowById, queryAccessibleRows } from '../utils/resourceAccess';
import { jsonResponse, notFoundResponse } from '../utils/response';

function parsePayloadJson(payloadJson: unknown) {
  if (typeof payloadJson !== 'string' || !payloadJson) {
    return null;
  }

  try {
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

export const drawingRoutes = new Hono<AppEnv>();

drawingRoutes.use('*', verifySession);

drawingRoutes.get('/', async (c) => {
  const auth = c.get('auth');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');
  const isAdmin = isAdminRequest(auth, c.env.ADMIN_USERS);

  const baseQuery = `
    SELECT
      d.id, d.parent_drawing_id, d.root_drawing_id, d.name, d.description, d.kind,
      d.path_count, d.point_count, d.thumbnail_url,
      d.storage_provider, d.status, d.payload_public_url,
      d.created_at, d.updated_at,
      u.google_id as owner_google_id,
      u.name as owner_name,
      u.picture as owner_picture
    FROM drawings d
    LEFT JOIN users u ON d.owner_id = u.id
  `;

  const drawings = await queryAccessibleRows<any>(c.env.DB, baseQuery, auth, c.env.ADMIN_USERS, {
    ownerColumn: 'd.owner_id',
    orderBy: 'd.created_at DESC',
    limit,
    offset,
  });

  const total = await countAccessibleRows(c.env.DB, 'drawings', auth, c.env.ADMIN_USERS);

  return jsonResponse({
    drawings,
    pagination: {
      limit,
      offset,
      total,
    },
    scope: isAdmin ? 'admin-all' : 'owner',
  });
});

drawingRoutes.get('/:id', async (c) => {
  const auth = c.get('auth');
  const drawingId = c.req.param('id');

  const drawing = await queryAccessibleRowById<any>(c.env.DB, `
    SELECT
      d.*,
      u.google_id as owner_google_id,
      u.name as owner_name,
      u.picture as owner_picture
    FROM drawings d
    LEFT JOIN users u ON d.owner_id = u.id
  `, 'd.id', drawingId, auth, c.env.ADMIN_USERS, {
    ownerColumn: 'd.owner_id',
  });

  if (!drawing) {
    return notFoundResponse('Drawing not found or not authorized');
  }

  return jsonResponse({
    ...drawing,
    payload: parsePayloadJson(drawing.payload_json),
  });
});