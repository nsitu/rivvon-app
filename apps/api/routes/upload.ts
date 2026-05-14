// src/routes/upload.ts
import { Hono } from 'hono';
import { verifySession } from '../middleware/session';
import type { AppEnv } from '../types/hono';
import { isAdminUser, syncUserIfProvided } from '../utils/user';
import { getAccessibleResourceById, getOwnedResourceById, getResourceById } from '../utils/resourceAccess';
import {
  buildCdnUrl,
  buildGoogleDriveDownloadUrl,
  buildTextureThumbnailR2Key,
  buildTextureTileR2Key,
  extractCdnPath,
} from '../utils/storagePaths';
import { normalizeHttpsUrl } from '../utils/validation';
import {
  badRequestResponse,
  forbiddenResponse,
  jsonResponse,
  notFoundResponse,
  serverErrorResponse,
  successResponse,
} from '../utils/response';
import { nanoid } from 'nanoid';

export const uploadRoutes = new Hono<AppEnv>();

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
    parentTextureSetId,
    storageProvider: requestedStorageProvider,
  } = body;

  await syncUserIfProvided(c.env.DB, auth.userId, userProfile);

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
      return badRequestResponse('parentTextureSetId must be a non-empty string when provided');
    }

    const requestedParentTextureSet = await getAccessibleResourceById<any>(
      c.env.DB,
      'texture_sets',
      parentTextureSetId.trim(),
      auth,
      c.env.ADMIN_USERS,
    );

    if (!requestedParentTextureSet) {
      return notFoundResponse('Parent texture set not found');
    }

    const rootTextureSetId = requestedParentTextureSet.parent_texture_set_id || requestedParentTextureSet.id;
    const familyRootTextureSet = rootTextureSetId === requestedParentTextureSet.id
      ? requestedParentTextureSet
      : await getAccessibleResourceById<any>(
        c.env.DB,
        'texture_sets',
        rootTextureSetId,
        auth,
        c.env.ADMIN_USERS,
      );

    if (!familyRootTextureSet) {
        return notFoundResponse('Family root texture set not found');
    }

    const rootStorageProvider = familyRootTextureSet.storage_provider || 'google-drive';
    normalizedStorageProvider = requestedStorageProvider || rootStorageProvider;

    if (normalizedStorageProvider !== rootStorageProvider) {
      return badRequestResponse(
        `Derived variants must use the same storage provider as the family root (${rootStorageProvider})`
      );
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
      return badRequestResponse('Derived variants must preserve the family root tileCount');
    }

    if (normalizedLayerCount !== rootLayerCount) {
      return badRequestResponse('Derived variants must preserve the family root layerCount', {
        expectedLayerCount: rootLayerCount,
        receivedLayerCount: normalizedLayerCount,
        rootTextureSetId: familyRootTextureSet.id,
      });
    }

    if (Number.isInteger(rootTileResolution) && normalizedTileResolution >= rootTileResolution) {
      return badRequestResponse('Derived variants must use a tileResolution smaller than the family root');
    }

    if (
      normalizedCrossSectionType
      && familyRootTextureSet.cross_section_type
      && normalizedCrossSectionType !== familyRootTextureSet.cross_section_type
    ) {
      return badRequestResponse('Derived variants must preserve the family root crossSectionType');
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
      frameInterpolationFactor: familyRootTextureSet.frame_interpolation_factor ?? 1,
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
    return badRequestResponse('Missing or invalid required fields');
  }

  // Validate storage provider
  if (!['r2', 'google-drive'].includes(normalizedStorageProvider)) {
    return badRequestResponse('Invalid storage provider. Must be "r2" or "google-drive"');
  }

  const textureSetId = nanoid();

  // Insert texture set record with storage provider.
  // Derived variants point to the root/original texture set ID via parent_texture_set_id.
  await c.env.DB.prepare(`
    INSERT INTO texture_sets (
      id, owner_id, parent_texture_set_id, name, description, thumbnail_url,
      tile_resolution, tile_count, layer_count, cross_section_type,
      source_filename, source_width, source_height, 
      source_duration, source_frame_count, sampled_frame_count, frame_interpolation_factor,
      storage_provider, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading')
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
    normalizedSourceMetadata?.frameInterpolationFactor ?? 1,
    normalizedStorageProvider,
  ).run();

  // For R2 storage, pre-create tile records with R2 keys
  // For Google Drive, tiles will be registered via /tile/:index/metadata after upload
  const uploadUrls = [];

  if (normalizedStorageProvider === 'r2') {
    for (let i = 0; i < normalizedTileCount; i++) {
      const tileId = nanoid();
      const r2Key = buildTextureTileR2Key(textureSetId, i);
      const publicUrl = buildCdnUrl(r2Key);

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

  return jsonResponse({
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

  const textureSet = await getOwnedResourceById<any>(c.env.DB, 'texture_sets', textureSetId, auth.userId);

  if (!textureSet) {
    return notFoundResponse('Texture set not found');
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
        return badRequestResponse(`Tile ${tile.tile_index} not uploaded`, {
          missingTile: tile.tile_index
        });
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
      return badRequestResponse(
        `Missing ${expectedTileCount - tiles.results.length} tiles. Register them via /tile/:index/metadata`,
        {
        missingTiles: missingIndices,
        }
      );
    }

    // Verify all tiles have drive_file_id
    for (const tile of tiles.results as any[]) {
      if (!tile.drive_file_id) {
        return badRequestResponse(`Tile ${tile.tile_index} has no drive_file_id`, {
          missingTile: tile.tile_index
        });
      }
    }
  }

  // Mark as complete and make public by default
  await c.env.DB.prepare(`
    UPDATE texture_sets 
    SET status = 'complete', is_public = 1, updated_at = unixepoch()
    WHERE id = ?
  `).bind(textureSetId).run();

  return jsonResponse({ status: 'complete', textureSetId });
});

// Register a tile's metadata (for Google Drive uploads)
// Called after frontend uploads file directly to Google Drive
uploadRoutes.post('/:id/tile/:index/metadata', async (c) => {
  try {
    const auth = c.get('auth');
    const textureSetId = c.req.param('id');
    const tileIndex = parseInt(c.req.param('index'));

    console.log('Tile metadata request:', { textureSetId, tileIndex, userId: auth?.userId });

    const textureSet = await getOwnedResourceById<any>(c.env.DB, 'texture_sets', textureSetId, auth.userId);

    if (!textureSet) {
      console.log('Texture set not found:', { textureSetId, userId: auth.userId });
      return notFoundResponse('Texture set not found');
    }

    // Validate this is a Google Drive texture set
    if (textureSet.storage_provider !== 'google-drive') {
      console.log('Wrong storage provider:', textureSet.storage_provider);
      return badRequestResponse('This endpoint is only for Google Drive storage');
    }

    // Validate tile index
    if (tileIndex < 0 || tileIndex >= textureSet.tile_count) {
      console.log('Invalid tile index:', { tileIndex, tileCount: textureSet.tile_count });
      return badRequestResponse('Invalid tile index');
    }

    const body = await c.req.json();
    const { driveFileId, fileSize, mimeType } = body;

    console.log('Tile metadata body:', { driveFileId, fileSize, mimeType });

    if (!driveFileId) {
      return badRequestResponse('driveFileId is required');
    }

    // Build public URL for Google Drive
    // Files need to be shared publicly for this URL to work
    const publicUrl = buildGoogleDriveDownloadUrl(driveFileId);

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

    return successResponse({
      tileIndex,
      driveFileId,
      publicUrl,
    });
  } catch (error) {
    console.error('Tile metadata error:', error);
    return serverErrorResponse('Failed to register tile metadata', { details: String(error) });
  }
});

// Upload a single tile (alternative to presigned URLs)
uploadRoutes.put('/:setId/tile/:index', async (c) => {
  const auth = c.get('auth');
  const setId = c.req.param('setId');
  const tileIndex = parseInt(c.req.param('index'));

  const textureSet = await getOwnedResourceById(c.env.DB, 'texture_sets', setId, auth.userId);

  if (!textureSet) {
    return notFoundResponse('Texture set not found');
  }

  // Get tile record
  const tile = await c.env.DB.prepare(`
    SELECT * FROM texture_tiles WHERE texture_set_id = ? AND tile_index = ?
  `).bind(setId, tileIndex).first() as { id: string; r2_key: string } | null;

  if (!tile) {
    return notFoundResponse('Tile not found');
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

  return successResponse({ tileIndex, size: body.byteLength });
});

// Upload thumbnail for a texture set
uploadRoutes.put('/:setId/thumbnail', async (c) => {
  const auth = c.get('auth');
  const setId = c.req.param('setId');

  const textureSet = await getOwnedResourceById(c.env.DB, 'texture_sets', setId, auth.userId);

  if (!textureSet) {
    return notFoundResponse('Texture set not found');
  }

  // Get content type from request
  const contentType = c.req.header('Content-Type') || 'image/jpeg';

  // Validate content type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(contentType)) {
    return badRequestResponse('Invalid content type. Allowed: image/jpeg, image/png, image/webp');
  }

  // Determine file extension
  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  };
  const ext = extMap[contentType];

  // R2 key for thumbnail
  const r2Key = buildTextureThumbnailR2Key(setId, ext);
  const thumbnailUrl = buildCdnUrl(r2Key);

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

  return successResponse({
    thumbnailUrl,
    size: body.byteLength
  });
});

// Update thumbnail URL (for Google Drive storage)
uploadRoutes.patch('/:setId/thumbnail-url', async (c) => {
  const auth = c.get('auth');
  const setId = c.req.param('setId');

  const textureSet = await getOwnedResourceById(c.env.DB, 'texture_sets', setId, auth.userId);

  if (!textureSet) {
    return notFoundResponse('Texture set not found');
  }

  const body = await c.req.json();
  const { thumbnailUrl } = body;

  if (!thumbnailUrl) {
    return badRequestResponse('thumbnailUrl is required');
  }

  let normalizedThumbnailUrl: string;
  try {
    normalizedThumbnailUrl = normalizeHttpsUrl(thumbnailUrl);
  } catch {
    return badRequestResponse('thumbnailUrl must be a valid HTTPS URL');
  }

  // Update texture set with thumbnail URL
  await c.env.DB.prepare(`
    UPDATE texture_sets 
    SET thumbnail_url = ?, updated_at = unixepoch()
    WHERE id = ?
  `).bind(normalizedThumbnailUrl, setId).run();

  return successResponse({ thumbnailUrl: normalizedThumbnailUrl });
});

// Delete a texture set (owner or admin)
uploadRoutes.delete('/:id', async (c) => {
  const auth = c.get('auth');
  const textureSetId = c.req.param('id');

  const textureSet = await getAccessibleResourceById<any>(
    c.env.DB,
    'texture_sets',
    textureSetId,
    auth,
    c.env.ADMIN_USERS,
  );

  if (!textureSet) {
    return notFoundResponse('Texture set not found or not authorized');
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
    const thumbnailKey = extractCdnPath(thumbnailUrl);
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

  return successResponse({
    deletedFiles: r2KeysToDelete.size,
    deletedTextureSets: familyTextureSetIds.length
  }, 'Texture set deleted');
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

  const textureSet = await getResourceById<{
    owner_id: string;
    parent_texture_set_id: string | null;
  }>(c.env.DB, 'texture_sets', textureSetId, 'owner_id, parent_texture_set_id');

  if (!textureSet) {
    return notFoundResponse('Texture set not found');
  }

  if (textureSet.owner_id !== auth.userId && !isAdmin) {
    return forbiddenResponse('Not authorized to update this texture set');
  }

  // Build dynamic update query based on provided fields
  const updates: string[] = [];
  const values: any[] = [];
  const updatedAt = Math.floor(Date.now() / 1000);

  if (name !== undefined) {
    if (typeof normalizedName !== 'string' || !normalizedName) {
      return badRequestResponse('name must be a non-empty string');
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
      return badRequestResponse('tileResolution must be a positive integer');
    }

    updates.push('tile_resolution = ?');
    values.push(parsedTileResolution);
  }

  if (updates.length === 0) {
    return badRequestResponse('No fields to update');
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

  return successResponse({}, 'Texture set updated');
});
