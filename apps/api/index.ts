// src/index.ts
import { Hono } from 'hono';
import { uploadRoutes } from './routes/upload';
import { textureRoutes } from './routes/textures';
import { authRoutes } from './routes/auth';
import { verifySession } from './middleware/session';

type Bindings = {
    DB: D1Database;
    BUCKET: R2Bucket;
    // Google OAuth
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    SESSION_SECRET: string;
    API_URL: string;
    APP_URL: string;
    CORS_ORIGINS: string;
    // Admin users (comma-separated emails)
    ADMIN_USERS?: string;
    // Legacy Auth0 (can be removed after migration)
    AUTH0_DOMAIN?: string;
    AUTH0_AUDIENCE?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

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

// Get textures owned by current user (authenticated via session cookie)
app.get('/my-textures', verifySession, async (c) => {
    const auth = c.get('auth');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    const results = await c.env.DB.prepare(`
        SELECT 
            id, name, description, thumbnail_url,
            tile_resolution, tile_count, layer_count,
            cross_section_type, storage_provider, status, is_public,
            created_at, updated_at
        FROM texture_sets
        WHERE owner_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `).bind(auth.userId, limit, offset).all();

    return c.json({
        textures: results.results,
        pagination: { limit, offset },
    });
});

// Mount routes
// /textures - public read-only endpoints
// /texture-set - authenticated write operations
app.route('/texture-set', uploadRoutes);
app.route('/textures', textureRoutes);

export default app;
