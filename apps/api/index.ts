// src/index.ts
import { Hono } from 'hono';
import { uploadRoutes } from './routes/upload';
import { drawingUploadRoutes } from './routes/drawingUpload';
import { textureRoutes } from './routes/textures';
import { drawingRoutes } from './routes/drawings';
import { authRoutes } from './routes/auth';
import { verifySession } from './middleware/session';
import type { AppEnv } from './types/hono';
import { isAdminUser } from './utils/user';
import { buildTextureFamilySummaries, decorateTextureFamilyRoot } from './utils/textureFamilies';

const app = new Hono<AppEnv>();

// CORS middleware - must handle credentials for cross-site cookies
app.use('*', async (c, next) => {
    const allowedOrigins = c.env.CORS_ORIGINS?.split(',') || [
        'https://slyce.rivvon.ca',
        'https://rivvon.ca',
        'http://localhost:5173',
        'http://localhost:5174',
    ];

    const origin = c.req.header('Origin');

    // Handle preflight requests
    if (c.req.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
                'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Allow-Credentials': 'true',
                'Access-Control-Max-Age': '86400',
            },
        });
    }

    await next();

    // Add CORS headers to all responses
    if (origin && allowedOrigins.includes(origin)) {
        c.res.headers.set('Access-Control-Allow-Origin', origin);
        c.res.headers.set('Access-Control-Allow-Credentials', 'true');
    }
});

// Health check
app.get('/', (c) => c.json({ status: 'ok', service: 'rivvon-api' }));

// Mount auth routes (Google OAuth)
app.route('/api/auth', authRoutes);

// Get textures owned by current user, or all textures for admins (authenticated via session cookie)
app.get('/my-textures', verifySession, async (c) => {
    const auth = c.get('auth');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    const isAdmin = isAdminUser(c.env.ADMIN_USERS, auth.email);

    const baseQuery = `
        SELECT 
            ts.id, ts.parent_texture_set_id, ts.name, ts.description, ts.thumbnail_url,
            ts.tile_resolution, ts.tile_count, ts.layer_count,
            ts.cross_section_type, ts.storage_provider, ts.status, ts.is_public,
            ts.created_at, ts.updated_at,
            u.google_id as owner_google_id,
            (SELECT COALESCE(SUM(file_size), 0) FROM texture_tiles WHERE texture_set_id = ts.id) as total_size_bytes
        FROM texture_sets ts
        LEFT JOIN users u ON ts.owner_id = u.id
    `;

    const results = isAdmin
        ? await c.env.DB.prepare(`
            ${baseQuery}
            ORDER BY ts.created_at DESC
        `).all()
        : await c.env.DB.prepare(`
            ${baseQuery}
            WHERE ts.owner_id = ?
            ORDER BY ts.created_at DESC
        `).bind(auth.userId).all();

    const families = buildTextureFamilySummaries(results.results as any[]);
    const pagedFamilies = families.slice(offset, offset + limit).map((family) => decorateTextureFamilyRoot(family));

    return c.json({
        textures: pagedFamilies,
        pagination: { limit, offset, total: families.length },
        scope: isAdmin ? 'admin-all' : 'owner',
    });
});

// Mount routes
// /textures - public read-only endpoints
// /texture-set - authenticated write operations
app.route('/texture-set', uploadRoutes);
app.route('/drawing', drawingUploadRoutes);
app.route('/textures', textureRoutes);
app.route('/drawings', drawingRoutes);

export default app;
