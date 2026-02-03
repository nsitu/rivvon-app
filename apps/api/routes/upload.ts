// src/routes/upload.ts
import { Hono } from 'hono';
import { verifySession } from '../middleware/session';
import { syncUser } from '../utils/user';
import { nanoid } from 'nanoid';

type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
};

export const uploadRoutes = new Hono<{ Bindings: Bindings }>();

// All upload routes require authentication (session-based)
uploadRoutes.use('*', verifySession);

// Create a new texture set and get upload URLs
uploadRoutes.post('/', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json();

  const {
    name,
    description,
    tileResolution,
    tileCount,
    layerCount,
    crossSectionType,
    sourceMetadata,
    userProfile,
    storageProvider = 'google-drive', // Default to Google Drive for new uploads
  } = body;

  // Sync user info if provided
  if (userProfile) {
    await syncUser(c.env.DB, auth.userId, userProfile);
  }

  // Validate required fields
  if (!name || !tileResolution || !tileCount || !layerCount) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  // Validate storage provider
  if (!['r2', 'google-drive'].includes(storageProvider)) {
    return c.json({ error: 'Invalid storage provider. Must be "r2" or "google-drive"' }, 400);
  }

  const textureSetId = nanoid();

  // Insert texture set record with storage provider
  await c.env.DB.prepare(`
    INSERT INTO texture_sets (
      id, owner_id, name, description, 
      tile_resolution, tile_count, layer_count, cross_section_type,
      source_filename, source_width, source_height, 
      source_duration, source_frame_count, sampled_frame_count,
      storage_provider, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading')
  `).bind(
    textureSetId,
    auth.userId,
    name,
    description || null,
    tileResolution,
    tileCount,
    layerCount,
    crossSectionType || null,
    sourceMetadata?.filename || null,
    sourceMetadata?.width || null,
    sourceMetadata?.height || null,
    sourceMetadata?.duration || null,
    sourceMetadata?.sourceFrameCount || null,
    sourceMetadata?.sampledFrameCount || null,
    storageProvider,
  ).run();

  // For R2 storage, pre-create tile records with R2 keys
  // For Google Drive, tiles will be registered via /tile/:index/metadata after upload
  const uploadUrls = [];

  if (storageProvider === 'r2') {
    for (let i = 0; i < tileCount; i++) {
      const tileId = nanoid();
      const r2Key = `textures/${textureSetId}/${i}.ktx2`;
      const publicUrl = `https://cdn.rivvon.ca/${r2Key}`;

      // Insert tile record
      await c.env.DB.prepare(`
        INSERT INTO texture_tiles (id, texture_set_id, tile_index, r2_key, public_url)
        VALUES (?, ?, ?, ?, ?)
      `).bind(tileId, textureSetId, i, r2Key, publicUrl).run();

      // Pre-create empty object in R2 (will be overwritten by actual upload)
      await c.env.BUCKET.put(r2Key, new Uint8Array(), {
        httpMetadata: { contentType: 'image/ktx2' }
      });

      uploadUrls.push({
        tileIndex: i,
        r2Key,
        publicUrl,
      });
    }
  }
  // For Google Drive, no pre-creation - frontend uploads directly to Drive
  // and registers each tile via POST /texture-set/:id/tile/:index/metadata

  return c.json({
    textureSetId,
    storageProvider,
    uploadUrls, // Empty for Google Drive
    message: storageProvider === 'r2'
      ? 'Upload URLs generated. Upload files then call /complete'
      : 'Texture set created. Upload tiles to Google Drive, register with /tile/:index/metadata, then call /complete',
  });
});

// Mark upload as complete
uploadRoutes.post('/:id/complete', async (c) => {
  const auth = c.get('auth');
  const textureSetId = c.req.param('id');

  // Verify ownership
  const textureSet = await c.env.DB.prepare(`
    SELECT * FROM texture_sets WHERE id = ? AND owner_id = ?
  `).bind(textureSetId, auth.userId).first() as any;

  if (!textureSet) {
    return c.json({ error: 'Texture set not found' }, 404);
  }

  const storageProvider = textureSet.storage_provider || 'r2';

  // Get all tiles for this texture set
  const tiles = await c.env.DB.prepare(`
    SELECT * FROM texture_tiles WHERE texture_set_id = ?
  `).bind(textureSetId).all();

  // Validate based on storage provider
  if (storageProvider === 'r2') {
    // Verify all tiles exist in R2
    for (const tile of tiles.results as any[]) {
      const object = await c.env.BUCKET.head(tile.r2_key);
      if (!object) {
        return c.json({
          error: `Tile ${tile.tile_index} not uploaded`,
          missingTile: tile.tile_index
        }, 400);
      }

      // Update tile with file info
      await c.env.DB.prepare(`
        UPDATE texture_tiles SET file_size = ? WHERE id = ?
      `).bind(object.size, tile.id).run();
    }
  } else if (storageProvider === 'google-drive') {
    // Verify expected number of tiles were registered
    const expectedTileCount = textureSet.tile_count as number;
    if (tiles.results.length < expectedTileCount) {
      const registeredIndices = new Set((tiles.results as any[]).map(t => t.tile_index));
      const missingIndices = [];
      for (let i = 0; i < expectedTileCount; i++) {
        if (!registeredIndices.has(i)) {
          missingIndices.push(i);
        }
      }
      return c.json({
        error: `Missing ${expectedTileCount - tiles.results.length} tiles. Register them via /tile/:index/metadata`,
        missingTiles: missingIndices,
      }, 400);
    }

    // Verify all tiles have drive_file_id
    for (const tile of tiles.results as any[]) {
      if (!tile.drive_file_id) {
        return c.json({
          error: `Tile ${tile.tile_index} has no drive_file_id`,
          missingTile: tile.tile_index
        }, 400);
      }
    }
  }

  // Mark as complete and make public by default
  await c.env.DB.prepare(`
    UPDATE texture_sets 
    SET status = 'complete', is_public = 1, updated_at = unixepoch()
    WHERE id = ?
  `).bind(textureSetId).run();

  return c.json({ status: 'complete', textureSetId });
});

// Register a tile's metadata (for Google Drive uploads)
// Called after frontend uploads file directly to Google Drive
uploadRoutes.post('/:id/tile/:index/metadata', async (c) => {
  try {
    const auth = c.get('auth');
    const textureSetId = c.req.param('id');
    const tileIndex = parseInt(c.req.param('index'));

    console.log('Tile metadata request:', { textureSetId, tileIndex, userId: auth?.userId });

    // Verify ownership
    const textureSet = await c.env.DB.prepare(`
      SELECT * FROM texture_sets WHERE id = ? AND owner_id = ?
    `).bind(textureSetId, auth.userId).first() as any;

    if (!textureSet) {
      console.log('Texture set not found:', { textureSetId, userId: auth.userId });
      return c.json({ error: 'Texture set not found' }, 404);
    }

    // Validate this is a Google Drive texture set
    if (textureSet.storage_provider !== 'google-drive') {
      console.log('Wrong storage provider:', textureSet.storage_provider);
      return c.json({ error: 'This endpoint is only for Google Drive storage' }, 400);
    }

    // Validate tile index
    if (tileIndex < 0 || tileIndex >= textureSet.tile_count) {
      console.log('Invalid tile index:', { tileIndex, tileCount: textureSet.tile_count });
      return c.json({ error: 'Invalid tile index' }, 400);
    }

    const body = await c.req.json();
    const { driveFileId, fileSize, mimeType } = body;

    console.log('Tile metadata body:', { driveFileId, fileSize, mimeType });

    if (!driveFileId) {
      return c.json({ error: 'driveFileId is required' }, 400);
    }

    // Build public URL for Google Drive
    // Files need to be shared publicly for this URL to work
    const publicUrl = `https://drive.google.com/uc?export=download&id=${driveFileId}`;

    // Check if tile already exists (update) or needs to be created (insert)
    const existingTile = await c.env.DB.prepare(`
      SELECT id FROM texture_tiles WHERE texture_set_id = ? AND tile_index = ?
    `).bind(textureSetId, tileIndex).first();

    if (existingTile) {
      // Update existing tile
      await c.env.DB.prepare(`
        UPDATE texture_tiles 
        SET drive_file_id = ?, public_url = ?, file_size = ?
        WHERE texture_set_id = ? AND tile_index = ?
      `).bind(driveFileId, publicUrl, fileSize || null, textureSetId, tileIndex).run();
      console.log('Updated existing tile:', { tileIndex });
    } else {
      // Insert new tile
      const tileId = nanoid();
      await c.env.DB.prepare(`
        INSERT INTO texture_tiles (id, texture_set_id, tile_index, drive_file_id, public_url, file_size)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(tileId, textureSetId, tileIndex, driveFileId, publicUrl, fileSize || null).run();
      console.log('Inserted new tile:', { tileId, tileIndex });
    }

    return c.json({
      success: true,
      tileIndex,
      driveFileId,
      publicUrl,
    });
  } catch (error) {
    console.error('Tile metadata error:', error);
    return c.json({ error: 'Failed to register tile metadata', details: String(error) }, 500);
  }
});

// Upload a single tile (alternative to presigned URLs)
uploadRoutes.put('/:setId/tile/:index', async (c) => {
  const auth = c.get('auth');
  const setId = c.req.param('setId');
  const tileIndex = parseInt(c.req.param('index'));

  // Verify ownership
  const textureSet = await c.env.DB.prepare(`
    SELECT * FROM texture_sets WHERE id = ? AND owner_id = ?
  `).bind(setId, auth.userId).first();

  if (!textureSet) {
    return c.json({ error: 'Texture set not found' }, 404);
  }

  // Get tile record
  const tile = await c.env.DB.prepare(`
    SELECT * FROM texture_tiles WHERE texture_set_id = ? AND tile_index = ?
  `).bind(setId, tileIndex).first();

  if (!tile) {
    return c.json({ error: 'Tile not found' }, 404);
  }

  // Upload to R2
  const body = await c.req.arrayBuffer();
  await c.env.BUCKET.put(tile.r2_key, body, {
    httpMetadata: { contentType: 'image/ktx2' }
  });

  // Update tile record with size
  await c.env.DB.prepare(`
    UPDATE texture_tiles SET file_size = ? WHERE id = ?
  `).bind(body.byteLength, tile.id).run();

  return c.json({ success: true, tileIndex, size: body.byteLength });
});

// Upload thumbnail for a texture set
uploadRoutes.put('/:setId/thumbnail', async (c) => {
  const auth = c.get('auth');
  const setId = c.req.param('setId');

  // Verify ownership
  const textureSet = await c.env.DB.prepare(`
    SELECT * FROM texture_sets WHERE id = ? AND owner_id = ?
  `).bind(setId, auth.userId).first();

  if (!textureSet) {
    return c.json({ error: 'Texture set not found' }, 404);
  }

  // Get content type from request
  const contentType = c.req.header('Content-Type') || 'image/jpeg';

  // Validate content type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(contentType)) {
    return c.json({
      error: 'Invalid content type. Allowed: image/jpeg, image/png, image/webp'
    }, 400);
  }

  // Determine file extension
  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  };
  const ext = extMap[contentType];

  // R2 key for thumbnail
  const r2Key = `thumbnails/${setId}.${ext}`;
  const thumbnailUrl = `https://cdn.rivvon.ca/${r2Key}`;

  // Upload to R2
  const body = await c.req.arrayBuffer();
  await c.env.BUCKET.put(r2Key, body, {
    httpMetadata: { contentType }
  });

  // Update texture set with thumbnail URL
  await c.env.DB.prepare(`
    UPDATE texture_sets 
    SET thumbnail_url = ?, updated_at = unixepoch()
    WHERE id = ?
  `).bind(thumbnailUrl, setId).run();

  return c.json({
    success: true,
    thumbnailUrl,
    size: body.byteLength
  });
});

// Update thumbnail URL (for Google Drive storage)
uploadRoutes.patch('/:setId/thumbnail-url', async (c) => {
  const auth = c.get('auth');
  const setId = c.req.param('setId');

  // Verify ownership
  const textureSet = await c.env.DB.prepare(`
    SELECT * FROM texture_sets WHERE id = ? AND owner_id = ?
  `).bind(setId, auth.userId).first();

  if (!textureSet) {
    return c.json({ error: 'Texture set not found' }, 404);
  }

  const body = await c.req.json();
  const { thumbnailUrl } = body;

  if (!thumbnailUrl) {
    return c.json({ error: 'thumbnailUrl is required' }, 400);
  }

  // Validate URL format (basic check)
  if (!thumbnailUrl.startsWith('https://')) {
    return c.json({ error: 'thumbnailUrl must be a valid HTTPS URL' }, 400);
  }

  // Update texture set with thumbnail URL
  await c.env.DB.prepare(`
    UPDATE texture_sets 
    SET thumbnail_url = ?, updated_at = unixepoch()
    WHERE id = ?
  `).bind(thumbnailUrl, setId).run();

  return c.json({ success: true, thumbnailUrl });
});

// Delete a texture set (owner only)
uploadRoutes.delete('/:id', async (c) => {
  const auth = c.get('auth');
  const textureSetId = c.req.param('id');

  // Verify ownership
  const textureSet = await c.env.DB.prepare(`
    SELECT * FROM texture_sets WHERE id = ? AND owner_id = ?
  `).bind(textureSetId, auth.userId).first();

  if (!textureSet) {
    return c.json({ error: 'Texture set not found or not owned by you' }, 404);
  }

  // Get all tiles to delete from R2
  const tiles = await c.env.DB.prepare(`
    SELECT r2_key FROM texture_tiles WHERE texture_set_id = ?
  `).bind(textureSetId).all();

  // Collect all R2 keys to delete
  const r2KeysToDelete: string[] = [];

  // Add tile keys
  for (const tile of tiles.results) {
    r2KeysToDelete.push(tile.r2_key as string);
  }

  // Add thumbnail if exists
  if (textureSet.thumbnail_url) {
    // Extract R2 key from thumbnail URL (e.g., "https://cdn.rivvon.ca/thumbnails/abc.jpg" -> "thumbnails/abc.jpg")
    const thumbnailUrl = textureSet.thumbnail_url as string;
    const thumbnailKey = thumbnailUrl.replace('https://cdn.rivvon.ca/', '');
    r2KeysToDelete.push(thumbnailKey);
  }

  // Delete all files from R2
  if (r2KeysToDelete.length > 0) {
    await c.env.BUCKET.delete(r2KeysToDelete);
  }

  // Delete texture_tiles records
  await c.env.DB.prepare(`
    DELETE FROM texture_tiles WHERE texture_set_id = ?
  `).bind(textureSetId).run();

  // Delete texture_set record
  await c.env.DB.prepare(`
    DELETE FROM texture_sets WHERE id = ?
  `).bind(textureSetId).run();

  return c.json({
    success: true,
    message: 'Texture set deleted',
    deletedFiles: r2KeysToDelete.length
  });
});

// Update texture set metadata (name, description, etc.)
uploadRoutes.patch('/:id', async (c) => {
  const auth = c.get('auth');
  const textureSetId = c.req.param('id');
  const body = await c.req.json();

  const { name, description, isPublic } = body;

  // Verify ownership
  const textureSet = await c.env.DB.prepare(`
    SELECT owner_id FROM texture_sets WHERE id = ?
  `).bind(textureSetId).first();

  if (!textureSet) {
    return c.json({ error: 'Texture set not found' }, 404);
  }

  if (textureSet.owner_id !== auth.userId) {
    return c.json({ error: 'Not authorized to update this texture set' }, 403);
  }

  // Build dynamic update query based on provided fields
  const updates: string[] = [];
  const values: any[] = [];

  if (name !== undefined) {
    updates.push('name = ?');
    values.push(name);
  }

  if (description !== undefined) {
    updates.push('description = ?');
    values.push(description);
  }

  if (isPublic !== undefined) {
    updates.push('is_public = ?');
    values.push(isPublic ? 1 : 0);
  }

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  // Add updated_at timestamp
  updates.push('updated_at = ?');
  values.push(Math.floor(Date.now() / 1000));

  // Add textureSetId for WHERE clause
  values.push(textureSetId);

  await c.env.DB.prepare(`
    UPDATE texture_sets SET ${updates.join(', ')} WHERE id = ?
  `).bind(...values).run();

  return c.json({
    success: true,
    message: 'Texture set updated'
  });
});
