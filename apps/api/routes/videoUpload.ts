import { AwsClient } from 'aws4fetch';
import { Hono, type Context } from 'hono';
import { nanoid } from 'nanoid';
import { verifySession } from '../middleware/session';
import type { AppEnv, SessionAuthContext } from '../types/hono';
import { isAdminUser, syncUserIfProvided } from '../utils/user';
import {
    buildCdnUrl,
    buildVideoR2Key,
    buildVideoThumbnailR2Key,
} from '../utils/storagePaths';
import {
    badRequestResponse,
    forbiddenResponse,
    notFoundResponse,
    serverErrorResponse,
    successResponse,
} from '../utils/response';

const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
const UPLOAD_URL_TTL_SECONDS = 60 * 60;
const ALLOWED_VIDEO_TYPES = new Map([
    ['video/mp4', { format: 'mp4', extension: 'mp4' }],
    ['video/webm', { format: 'webm', extension: 'webm' }],
]);
const ALLOWED_THUMBNAIL_TYPES = new Map([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
]);

type VideoRecord = {
    id: string;
    owner_id: string;
    name: string;
    status: string;
    mime_type: string;
    expected_file_size: number;
    r2_key: string | null;
    thumbnail_r2_key: string | null;
};

function normalizePositiveNumber(value: unknown, { integer = false, max = Number.MAX_SAFE_INTEGER } = {}) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0 || number > max || (integer && !Number.isInteger(number))) {
        return null;
    }
    return number;
}

function getR2SigningConfig(env: AppEnv['Bindings']) {
    const accountId = env.R2_ACCOUNT_ID?.trim();
    const bucketName = env.R2_BUCKET_NAME?.trim() || 'rivvon-textures';
    const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
    const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();

    if (!accountId || !accessKeyId || !secretAccessKey) {
        return null;
    }

    return { accountId, bucketName, accessKeyId, secretAccessKey };
}

async function createPresignedPutUrl(env: AppEnv['Bindings'], key: string, mimeType: string) {
    const config = getR2SigningConfig(env);
    if (!config) {
        return null;
    }

    const client = new AwsClient({
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        service: 's3',
        region: 'auto',
    });
    const url = new URL(
        `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}/${key}`,
    );
    url.searchParams.set('X-Amz-Expires', String(UPLOAD_URL_TTL_SECONDS));

    const signedRequest = await client.sign(new Request(url, {
        method: 'PUT',
        headers: {
            'Content-Type': mimeType,
            'Cache-Control': 'public, max-age=31536000, immutable',
        },
    }), { aws: { signQuery: true } });

    return signedRequest.url;
}

async function getManageableVideo(
    c: Context<AppEnv>,
    videoId: string,
) {
    const auth = c.get('auth') as SessionAuthContext;
    const video = await c.env.DB.prepare(`
        SELECT id, owner_id, name, status, mime_type, expected_file_size,
               r2_key, thumbnail_r2_key
        FROM video_exports
        WHERE id = ?
    `).bind(videoId).first<VideoRecord>();

    if (!video) {
        return { error: notFoundResponse('Video not found'), video: null };
    }
    if (video.owner_id !== auth.userId && !isAdminUser(c.env.ADMIN_USERS, auth.email)) {
        return { error: forbiddenResponse('Not authorized to manage this video'), video: null };
    }
    return { error: null, video };
}

export const videoUploadRoutes = new Hono<AppEnv>();

videoUploadRoutes.use('*', verifySession);

videoUploadRoutes.post('/', async (c) => {
    const auth = c.get('auth');
    if (!isAdminUser(c.env.ADMIN_USERS, auth.email)) {
        return forbiddenResponse('Video gallery publishing to R2 is currently limited to admins');
    }

    if (!getR2SigningConfig(c.env)) {
        return serverErrorResponse('R2 direct-upload signing is not configured');
    }

    const body = await c.req.json<Record<string, any>>();
    await syncUserIfProvided(c.env.DB, auth.userId, body.userProfile);

    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : '';
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType.toLowerCase() : '';
    const typeInfo = ALLOWED_VIDEO_TYPES.get(mimeType);
    const width = normalizePositiveNumber(body.width, { integer: true, max: 8192 });
    const height = normalizePositiveNumber(body.height, { integer: true, max: 8192 });
    const duration = normalizePositiveNumber(body.duration, { max: 60 * 60 });
    // Browser APIs do not reliably expose FPS for local files. Direct gallery
    // uploads may omit it; exported videos still provide their actual value.
    const fps = body.fps === undefined || body.fps === null
        ? 30
        : normalizePositiveNumber(body.fps, { max: 240 });
    const fileSize = normalizePositiveNumber(body.fileSize, { integer: true, max: MAX_VIDEO_BYTES });

    if (!name || !typeInfo || !width || !height || !duration || !fps || !fileSize) {
        return badRequestResponse('Missing or invalid video metadata');
    }

    let exportSettingsJson: string | null = null;
    if (body.exportSettings && typeof body.exportSettings === 'object') {
        exportSettingsJson = JSON.stringify(body.exportSettings);
        if (exportSettingsJson.length > 16_384) {
            return badRequestResponse('exportSettings is too large');
        }
    }

    const videoId = nanoid();
    const r2Key = buildVideoR2Key(videoId, typeInfo.extension);
    const playbackUrl = buildCdnUrl(r2Key);
    const uploadUrl = await createPresignedPutUrl(c.env, r2Key, mimeType);
    if (!uploadUrl) {
        return serverErrorResponse('Unable to create R2 upload URL');
    }

    await c.env.DB.prepare(`
        INSERT INTO video_exports (
            id, owner_id, name, description,
            format, mime_type, width, height, duration, fps,
            expected_file_size, storage_provider, r2_key, playback_url,
            export_settings_json, status, is_public
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'r2', ?, ?, ?, 'uploading', ?)
    `).bind(
        videoId,
        auth.userId,
        name,
        description || null,
        typeInfo.format,
        mimeType,
        width,
        height,
        duration,
        fps,
        fileSize,
        r2Key,
        playbackUrl,
        exportSettingsJson,
        body.isPublic === false ? 0 : 1,
    ).run();

    return successResponse({
        videoId,
        uploadUrl,
        uploadHeaders: {
            'Content-Type': mimeType,
            'Cache-Control': 'public, max-age=31536000, immutable',
        },
        expiresIn: UPLOAD_URL_TTL_SECONDS,
    }, undefined, 201);
});

videoUploadRoutes.post('/:id/complete', async (c) => {
    const videoId = c.req.param('id');
    const access = await getManageableVideo(c, videoId);
    if (access.error || !access.video) return access.error;

    const video = access.video;
    if (!video.r2_key) {
        return badRequestResponse('Video has no R2 upload target');
    }

    const object = await c.env.BUCKET.head(video.r2_key);
    if (!object) {
        return badRequestResponse('Uploaded video was not found in R2');
    }
    if (object.size !== Number(video.expected_file_size)) {
        return badRequestResponse('Uploaded video size does not match the encoded file', {
            expectedSize: Number(video.expected_file_size),
            receivedSize: object.size,
        });
    }

    await c.env.DB.prepare(`
        UPDATE video_exports
        SET file_size = ?, status = 'complete', updated_at = unixepoch()
        WHERE id = ?
    `).bind(object.size, videoId).run();

    return successResponse({ videoId, status: 'complete', fileSize: object.size });
});

videoUploadRoutes.put('/:id/thumbnail', async (c) => {
    const videoId = c.req.param('id');
    const access = await getManageableVideo(c, videoId);
    if (access.error || !access.video) return access.error;

    const contentType = (c.req.header('Content-Type') || '').toLowerCase();
    const extension = ALLOWED_THUMBNAIL_TYPES.get(contentType);
    if (!extension) {
        return badRequestResponse('Thumbnail must be JPEG, PNG, or WebP');
    }

    const declaredLength = Number(c.req.header('Content-Length') || 0);
    if (declaredLength > MAX_THUMBNAIL_BYTES) {
        return badRequestResponse('Thumbnail exceeds the 5 MB limit');
    }

    const body = await c.req.arrayBuffer();
    if (!body.byteLength || body.byteLength > MAX_THUMBNAIL_BYTES) {
        return badRequestResponse('Thumbnail is empty or exceeds the 5 MB limit');
    }

    const thumbnailKey = buildVideoThumbnailR2Key(videoId, extension);
    await c.env.BUCKET.put(thumbnailKey, body, {
        httpMetadata: {
            contentType,
            cacheControl: 'public, max-age=31536000, immutable',
        },
    });

    if (access.video.thumbnail_r2_key && access.video.thumbnail_r2_key !== thumbnailKey) {
        await c.env.BUCKET.delete(access.video.thumbnail_r2_key);
    }

    const thumbnailUrl = buildCdnUrl(thumbnailKey);
    await c.env.DB.prepare(`
        UPDATE video_exports
        SET thumbnail_url = ?, thumbnail_r2_key = ?, updated_at = unixepoch()
        WHERE id = ?
    `).bind(thumbnailUrl, thumbnailKey, videoId).run();

    return successResponse({ videoId, thumbnailUrl, size: body.byteLength });
});

videoUploadRoutes.patch('/:id', async (c) => {
    const videoId = c.req.param('id');
    const access = await getManageableVideo(c, videoId);
    if (access.error || !access.video) return access.error;

    const body = await c.req.json<Record<string, any>>();
    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.name !== undefined) {
        const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
        if (!name) return badRequestResponse('name must be a non-empty string');
        updates.push('name = ?');
        values.push(name);
    }
    if (body.description !== undefined) {
        updates.push('description = ?');
        values.push(typeof body.description === 'string' ? body.description.trim().slice(0, 2000) || null : null);
    }
    if (body.isPublic !== undefined) {
        updates.push('is_public = ?');
        values.push(body.isPublic ? 1 : 0);
    }
    if (!updates.length) {
        return badRequestResponse('No supported video fields were provided');
    }

    updates.push('updated_at = unixepoch()');
    values.push(videoId);
    await c.env.DB.prepare(`UPDATE video_exports SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
    return successResponse({ videoId });
});

videoUploadRoutes.delete('/:id', async (c) => {
    const videoId = c.req.param('id');
    const access = await getManageableVideo(c, videoId);
    if (access.error || !access.video) return access.error;

    const keys = [access.video.r2_key, access.video.thumbnail_r2_key].filter(Boolean) as string[];
    if (keys.length) {
        await c.env.BUCKET.delete(keys);
    }
    await c.env.DB.prepare('DELETE FROM video_exports WHERE id = ?').bind(videoId).run();

    return successResponse({ videoId, deletedFiles: keys.length }, 'Video deleted');
});
