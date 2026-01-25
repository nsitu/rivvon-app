// src/routes/textures.ts
import { Hono } from 'hono';

type Bindings = {
    DB: D1Database;
    BUCKET: R2Bucket;
};

export const textureRoutes = new Hono<{ Bindings: Bindings }>();

// List public texture sets
textureRoutes.get('/', async (c) => {
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    const results = await c.env.DB.prepare(`
    SELECT 
      ts.id, ts.name, ts.description, ts.thumbnail_url,
      ts.tile_resolution, ts.tile_count, ts.layer_count,
      ts.cross_section_type, ts.source_frame_count, ts.sampled_frame_count, ts.created_at,
      u.id as owner_id,
      u.name as owner_name,
      u.picture as owner_picture,
      (SELECT COALESCE(SUM(file_size), 0) FROM texture_tiles WHERE texture_set_id = ts.id) as total_size_bytes
    FROM texture_sets ts
    LEFT JOIN users u ON ts.owner_id = u.id
    WHERE ts.status = 'complete' AND ts.is_public = 1
    ORDER BY ts.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(limit, offset).all();

    return c.json({
        textures: results.results,
        pagination: { limit, offset },
    });
});

// Get single texture set with tile URLs
textureRoutes.get('/:id', async (c) => {
    const textureSetId = c.req.param('id');

    const textureSet = await c.env.DB.prepare(`
    SELECT 
      ts.*,
      u.id as owner_id,
      u.name as owner_name,
      u.picture as owner_picture
    FROM texture_sets ts
    LEFT JOIN users u ON ts.owner_id = u.id
    WHERE ts.id = ? AND ts.status = 'complete'
  `).bind(textureSetId).first() as any;

    if (!textureSet) {
        return c.json({ error: 'Texture set not found' }, 404);
    }

    const tiles = await c.env.DB.prepare(`
    SELECT tile_index, r2_key, drive_file_id, public_url, file_size 
    FROM texture_tiles 
    WHERE texture_set_id = ?
    ORDER BY tile_index
  `).bind(textureSetId).all();

    const storageProvider = textureSet.storage_provider || 'r2';

    // Generate tile data for each tile based on storage provider
    // For Google Drive: include driveFileId so frontend can use Drive API
    // For R2: include direct CDN URL
    const tileUrls = (tiles.results as any[]).map((tile) => {
        let url: string;
        let driveFileId: string | null = null;

        if (storageProvider === 'google-drive' && tile.drive_file_id) {
            // Include driveFileId for frontend to use Drive API (bypasses CORS)
            driveFileId = tile.drive_file_id;
            // Also include URL as fallback (though it won't work due to CORS)
            url = tile.public_url || `https://drive.google.com/uc?export=download&id=${tile.drive_file_id}`;
        } else if (tile.r2_key) {
            // R2 storage - use CDN URL (no auth needed)
            url = `https://cdn.rivvon.ca/${tile.r2_key}`;
        } else {
            // Fallback to stored public_url
            url = tile.public_url || '';
        }

        return {
            tileIndex: tile.tile_index,
            url,
            driveFileId,
            fileSize: tile.file_size,
        };
    });

    return c.json({
        ...textureSet,
        tiles: tileUrls,
    });
});

// Download texture tile (proxy through worker if needed)
textureRoutes.get('/:setId/tile/:index', async (c) => {
    const setId = c.req.param('setId');
    const tileIndex = parseInt(c.req.param('index'));

    const tile = await c.env.DB.prepare(`
    SELECT r2_key FROM texture_tiles 
    WHERE texture_set_id = ? AND tile_index = ?
  `).bind(setId, tileIndex).first();

    if (!tile) {
        return c.json({ error: 'Tile not found' }, 404);
    }

    const object = await c.env.BUCKET.get(tile.r2_key);
    if (!object) {
        return c.json({ error: 'File not found in storage' }, 404);
    }

    return new Response(object.body, {
        headers: {
            'Content-Type': 'image/ktx2',
            'Cache-Control': 'public, max-age=31536000',
            'Access-Control-Allow-Origin': '*',
        },
    });
});
