// src/routes/upload.ts
import { Hono } from 'hono';
import { verifySession } from '../middleware/session';
import type { AppEnv } from '../types/hono';
import { syncUser, isAdminUser } from '../utils/user';
import { nanoid } from 'nanoid';

export const uploadRoutes = new Hono<AppEnv>();

// All upload routes require authentication (session-based)
uploadRoutes.use('*', verifySession);

// Create a new texture set and get upload URLs
uploadRoutes.post('/', async (c) => {
  const auth = c.get('auth');
  const isAdmin = isAdminUser(c.env.ADMIN_USERS, auth.email);
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
    parentTextureSetId,
    storageProvider: requestedStorageProvider,
  } = body;

  // Sync user info if provided
  if (userProfile) {
    await syncUser(c.env.DB, auth.userId, userProfile);
  }

  let normalizedName = typeof name === 'string' ? name.trim() : '';
  let normalizedDescription = typeof description === 'string' ? description : null;
  const normalizedTileResolution = Number(tileResolution);
  let normalizedTileCount = Number(tileCount);
  let normalizedLayerCount = Number(layerCount);
  let normalizedCrossSectionType = typeof crossSectionType === 'string' ? crossSectionType : null;
  let normalizedSourceMetadata = sourceMetadata || null;
  let normalizedStorageProvider = requestedStorageProvider || 'google-drive';
  let normalizedParentTextureSetId: string | null = null;
  let normalizedThumbnailUrl: string | null = null;

  if (parentTextureSetId !== undefined && parentTextureSetId !== null) {
    if (typeof parentTextureSetId !== 'string' || !parentTextureSetId.trim()) {
      return c.json({ error: 'parentTextureSetId must be a non-empty string when provided' }, 400);
    }

    const requestedParentTextureSet = (isAdmin
      ? await c.env.DB.prepare(`
        SELECT * FROM texture_sets WHERE id = ?
      `).bind(parentTextureSetId.trim()).first()
      : await c.env.DB.prepare(`
        SELECT * FROM texture_sets WHERE id = ? AND owner_id = ?
      `).bind(parentTextureSetId.trim(), auth.userId).first()) as any;

    if (!requestedParentTextureSet) {
      return c.json({ error: 'Parent texture set not found' }, 404);
    }

    const rootTextureSetId = requestedParentTextureSet.parent_texture_set_id || requestedParentTextureSet.id;
    const familyRootTextureSet = rootTextureSetId === requestedParentTextureSet.id
      ? requestedParentTextureSet
      : (isAdmin
        ? await c.env.DB.prepare(`
          SELECT * FROM texture_sets WHERE id = ?
        `).bind(rootTextureSetId).first()
        : await c.env.DB.prepare(`
          SELECT * FROM texture_sets WHERE id = ? AND owner_id = ?
        `).bind(rootTextureSetId, auth.userId).first()) as any;

    if (!familyRootTextureSet) {
      return c.json({ error: 'Family root texture set not found' }, 404);
    }

    const rootStorageProvider = familyRootTextureSet.storage_provider || 'google-drive';
    normalizedStorageProvider = requestedStorageProvider || rootStorageProvider;

    if (normalizedStorageProvider !== rootStorageProvider) {
      return c.json({
        error: `Derived variants must use the same storage provider as the family root (${rootStorageProvider})`
      }, 400);
    }

    if (!Number.isInteger(normalizedTileCount)) {
      normalizedTileCount = Number(familyRootTextureSet.tile_count);
    }

    if (!Number.isInteger(normalizedLayerCount)) {
      normalizedLayerCount = Number(familyRootTextureSet.layer_count);
    }

    const rootTileCount = Number(familyRootTextureSet.tile_count);
    const rootLayerCount = Number(familyRootTextureSet.layer_count);
    const rootTileResolution = Number(familyRootTextureSet.tile_resolution);

    if (normalizedTileCount !== rootTileCount) {
      return c.json({ error: 'Derived variants must preserve the family root tileCount' }, 400);
    }

    if (normalizedLayerCount !== rootLayerCount) {
      return c.json({ error: 'Derived variants must preserve the family root layerCount' }, 400);
    }

    if (Number.isInteger(rootTileResolution) && normalizedTileResolution >= rootTileResolution) {
      return c.json({ error: 'Derived variants must use a tileResolution smaller than the family root' }, 400);
    }

    if (
      normalizedCrossSectionType
      && familyRootTextureSet.cross_section_type
      && normalizedCrossSectionType !== familyRootTextureSet.cross_section_type
    ) {
      return c.json({ error: 'Derived variants must preserve the family root crossSectionType' }, 400);
    }

    normalizedParentTextureSetId = familyRootTextureSet.id;
    normalizedName = familyRootTextureSet.name;
    normalizedDescription = familyRootTextureSet.description || null;
    normalizedCrossSectionType = familyRootTextureSet.cross_section_type || normalizedCrossSectionType;
    normalizedThumbnailUrl = familyRootTextureSet.thumbnail_url || null;
    normalizedSourceMetadata = {
      filename: familyRootTextureSet.source_filename || null,
      width: familyRootTextureSet.source_width ?? null,
      height: familyRootTextureSet.source_height ?? null,
      duration: familyRootTextureSet.source_duration ?? null,
      sourceFrameCount: familyRootTextureSet.source_frame_count ?? null,
      sampledFrameCount: familyRootTextureSet.sampled_frame_count ?? null,
    };
  }

  // Validate required fields
  if (
    !normalizedName
    || !Number.isInteger(normalizedTileResolution)
    || normalizedTileResolution <= 0
    || !Number.isInteger(normalizedTileCount)
    || normalizedTileCount <= 0
    || !Number.isInteger(normalizedLayerCount)
    || normalizedLayerCount <= 0
  ) {
    return c.json({ error: 'Missing or invalid required fields' }, 400);
  }

  // Validate storage provider
  if (!['r2', 'google-drive'].includes(normalizedStorageProvider)) {
    return c.json({ error: 'Invalid storage provider. Must be "r2" or "google-drive"' }, 400);
  }

  const textureSetId = nanoid();

  // Insert texture set record with storage provider.
  // Derived variants point to the root/original texture set ID via parent_texture_set_id.
  await c.env.DB.prepare(`
    INSERT INTO texture_sets (
      id, owner_id, parent_texture_set_id, name, description, thumbnail_url,
      tile_resolution, tile_count, layer_count, cross_section_type,
      source_filename, source_width, source_height, 
      source_duration, source_frame_count, sampled_frame_count,
      storage_provider, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading')
  `).bind(
    textureSetId,
    auth.userId,
    normalizedParentTextureSetId,
    normalizedName,
    normalizedDescription,
    normalizedThumbnailUrl,
    normalizedTileResolution,
    normalizedTileCount,
    normalizedLayerCount,
    normalizedCrossSectionType || null,
    normalizedSourceMetadata?.filename || null,
    normalizedSourceMetadata?.width || null,
    normalizedSourceMetadata?.height || null,
    normalizedSourceMetadata?.duration || null,
    normalizedSourceMetadata?.sourceFrameCount || null,
    normalizedSourceMetadata?.sampledFrameCount || null,
    normalizedStorageProvider,
  ).run();

  // For R2 storage, pre-create tile records with R2 keys
  // For Google Drive, tiles will be registered via /tile/:index/metadata after upload
  const uploadUrls = [];

  if (normalizedStorageProvider === 'r2') {
    for (let i = 0; i < normalizedTileCount; i++) {
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
    parentTextureSetId: normalizedParentTextureSetId,
    storageProvider: normalizedStorageProvider,
    uploadUrls, // Empty for Google Drive
    message: normalizedStorageProvider === 'r2'
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
  `).bind(setId, tileIndex).first() as { id: string; r2_key: string } | null;

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

// Delete a texture set (owner or admin)
uploadRoutes.delete('/:id', async (c) => {
  const auth = c.get('auth');
  const textureSetId = c.req.param('id');

  // Check if user is admin
  const isAdmin = isAdminUser(c.env.ADMIN_USERS, auth.email);

  // Get texture set (admins can delete any, owners can delete their own)
  let textureSet;
  if (isAdmin) {
    textureSet = await c.env.DB.prepare(`
      SELECT * FROM texture_sets WHERE id = ?
    `).bind(textureSetId).first();
  } else {
    textureSet = await c.env.DB.prepare(`
      SELECT * FROM texture_sets WHERE id = ? AND owner_id = ?
    `).bind(textureSetId, auth.userId).first();
  }

  if (!textureSet) {
    return c.json({ error: 'Texture set not found or not authorized' }, 404);
  }

  // If deleting a root texture set, delete the full family payload from storage first.
  const familyTextureSets = textureSet.parent_texture_set_id
    ? [textureSet]
    : ((await c.env.DB.prepare(`
      SELECT id, thumbnail_url FROM texture_sets WHERE id = ? OR parent_texture_set_id = ?
    `).bind(textureSetId, textureSetId).all()).results as any[]);

  const familyTextureSetIds = familyTextureSets.map((record) => record.id as string);
  const placeholders = familyTextureSetIds.map(() => '?').join(', ');
  const tiles = familyTextureSetIds.length === 0
    ? { results: [] as any[] }
    : await c.env.DB.prepare(`
      SELECT r2_key FROM texture_tiles WHERE texture_set_id IN (${placeholders})
    `).bind(...familyTextureSetIds).all();

  // Collect all R2 keys to delete.
  const r2KeysToDelete = new Set<string>();

  for (const tile of tiles.results as any[]) {
    if (tile.r2_key) {
      r2KeysToDelete.add(tile.r2_key);
    }
  }

  for (const familyTextureSet of familyTextureSets) {
    if (!familyTextureSet.thumbnail_url) {
      continue;
    }

    const thumbnailUrl = familyTextureSet.thumbnail_url as string;
    const thumbnailKey = thumbnailUrl.replace('https://cdn.rivvon.ca/', '');
    r2KeysToDelete.add(thumbnailKey);
  }

  // Delete all files from R2
  if (r2KeysToDelete.size > 0) {
    await c.env.BUCKET.delete(Array.from(r2KeysToDelete));
  }

  // Delete texture_set record. Child variants cascade from the self-reference on parent_texture_set_id.
  await c.env.DB.prepare(`
    DELETE FROM texture_sets WHERE id = ?
  `).bind(textureSetId).run();

  return c.json({
    success: true,
    message: 'Texture set deleted',
    deletedFiles: r2KeysToDelete.size,
    deletedTextureSets: familyTextureSetIds.length
  });
});

// Update texture set metadata (name, description, etc.) - owner or admin
uploadRoutes.patch('/:id', async (c) => {
  const auth = c.get('auth');
  const textureSetId = c.req.param('id');
  const body = await c.req.json();

  const { name, description, isPublic } = body;
  const tileResolution = body.tileResolution ?? body.tile_resolution;
  const normalizedName = typeof name === 'string' ? name.trim() : name;

  // Check if user is admin
  const isAdmin = isAdminUser(c.env.ADMIN_USERS, auth.email);

  // Verify ownership or admin status
  const textureSet = await c.env.DB.prepare(`
    SELECT owner_id, parent_texture_set_id FROM texture_sets WHERE id = ?
  `).bind(textureSetId).first();

  if (!textureSet) {
    return c.json({ error: 'Texture set not found' }, 404);
  }

  if (textureSet.owner_id !== auth.userId && !isAdmin) {
    return c.json({ error: 'Not authorized to update this texture set' }, 403);
  }

  // Build dynamic update query based on provided fields
  const updates: string[] = [];
  const values: any[] = [];
  const updatedAt = Math.floor(Date.now() / 1000);

  if (name !== undefined) {
    if (typeof normalizedName !== 'string' || !normalizedName) {
      return c.json({ error: 'name must be a non-empty string' }, 400);
    }

    updates.push('name = ?');
    values.push(normalizedName);
  }

  if (description !== undefined) {
    updates.push('description = ?');
    values.push(description);
  }

  if (isPublic !== undefined) {
    updates.push('is_public = ?');
    values.push(isPublic ? 1 : 0);
  }

  if (tileResolution !== undefined) {
    const parsedTileResolution = Number(tileResolution);
    if (!Number.isInteger(parsedTileResolution) || parsedTileResolution <= 0) {
      return c.json({ error: 'tileResolution must be a positive integer' }, 400);
    }

    updates.push('tile_resolution = ?');
    values.push(parsedTileResolution);
  }

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  // Add updated_at timestamp
  updates.push('updated_at = ?');
  values.push(updatedAt);

  // Add textureSetId for WHERE clause
  values.push(textureSetId);

  await c.env.DB.prepare(`
    UPDATE texture_sets SET ${updates.join(', ')} WHERE id = ?
  `).bind(...values).run();

  if (name !== undefined || description !== undefined) {
    const familyRootTextureSetId = textureSet.parent_texture_set_id || textureSetId;
    const familyUpdates: string[] = [];
    const familyValues: any[] = [];

    if (name !== undefined) {
      familyUpdates.push('name = ?');
      familyValues.push(normalizedName);
    }

    if (description !== undefined) {
      familyUpdates.push('description = ?');
      familyValues.push(description);
    }

    familyUpdates.push('updated_at = ?');
    familyValues.push(updatedAt);

    await c.env.DB.prepare(`
      UPDATE texture_sets
      SET ${familyUpdates.join(', ')}
      WHERE id = ? OR parent_texture_set_id = ?
    `).bind(...familyValues, familyRootTextureSetId, familyRootTextureSetId).run();
  }

  return c.json({
    success: true,
    message: 'Texture set updated'
  });
});
