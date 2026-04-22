import { Hono } from 'hono';
import { verifySession } from '../middleware/session';
import { isAdminUser } from '../utils/user';

type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
  ADMIN_USERS?: string;
};

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

export const drawingRoutes = new Hono<{ Bindings: Bindings }>();

drawingRoutes.use('*', verifySession);

drawingRoutes.get('/', async (c) => {
  const auth = c.get('auth');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');
  const isAdmin = isAdminUser(c.env.ADMIN_USERS, auth.email);

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

  const results = isAdmin
    ? await c.env.DB.prepare(`${baseQuery} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`).bind(limit, offset).all()
    : await c.env.DB.prepare(`${baseQuery} WHERE d.owner_id = ? ORDER BY d.created_at DESC LIMIT ? OFFSET ?`).bind(auth.userId, limit, offset).all();

  const totalResult = isAdmin
    ? await c.env.DB.prepare(`SELECT COUNT(*) as total FROM drawings`).first() as { total: number }
    : await c.env.DB.prepare(`SELECT COUNT(*) as total FROM drawings WHERE owner_id = ?`).bind(auth.userId).first() as { total: number };

  return c.json({
    drawings: results.results || [],
    pagination: {
      limit,
      offset,
      total: Number(totalResult?.total || 0),
    },
    scope: isAdmin ? 'admin-all' : 'owner',
  });
});

drawingRoutes.get('/:id', async (c) => {
  const auth = c.get('auth');
  const drawingId = c.req.param('id');
  const isAdmin = isAdminUser(c.env.ADMIN_USERS, auth.email);

  const drawing = await c.env.DB.prepare(`
    SELECT
      d.*,
      u.google_id as owner_google_id,
      u.name as owner_name,
      u.picture as owner_picture
    FROM drawings d
    LEFT JOIN users u ON d.owner_id = u.id
    WHERE d.id = ? ${isAdmin ? '' : 'AND d.owner_id = ?'}
  `).bind(...(isAdmin ? [drawingId] : [drawingId, auth.userId])).first() as any;

  if (!drawing) {
    return c.json({ error: 'Drawing not found or not authorized' }, 404);
  }

  return c.json({
    ...drawing,
    payload: parsePayloadJson(drawing.payload_json),
  });
});