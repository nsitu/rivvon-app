import { AwsClient } from 'aws4fetch';
import { Hono, type Context } from 'hono';
import { nanoid } from 'nanoid';
import { verifySession } from '../middleware/session';
import type { AppEnv, SessionAuthContext } from '../types/hono';
import { buildAudioR2Key, buildCdnUrl } from '../utils/storagePaths';
import {
    badRequestResponse,
    forbiddenResponse,
    notFoundResponse,
    serverErrorResponse,
    successResponse,
} from '../utils/response';

const MAX_AUDIO_BYTES = 512 * 1024 * 1024;
const MAX_AUDIO_DURATION = 2 * 60 * 60;
const UPLOAD_URL_TTL_SECONDS = 60 * 60;
const AUDIO_TYPES = new Map([
    ['audio/mp4', { format: 'mp4', extension: 'mp4' }],
    ['audio/m4a', { format: 'mp4', extension: 'mp4' }],
    ['video/mp4', { format: 'mp4', extension: 'mp4' }],
]);

type AudioRecord = {
    id: string;
    owner_id: string;
    name: string;
    status: string;
    expected_file_size: number;
    r2_key: string | null;
};

function getR2SigningConfig(env: AppEnv['Bindings']) {
    const accountId = env.R2_ACCOUNT_ID?.trim();
    const bucketName = env.R2_BUCKET_NAME?.trim() || 'rivvon-textures';
    const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
    const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
    if (!accountId || !accessKeyId || !secretAccessKey) return null;
    return { accountId, bucketName, accessKeyId, secretAccessKey };
}

async function createPresignedPutUrl(env: AppEnv['Bindings'], key: string, mimeType: string) {
    const config = getR2SigningConfig(env);
    if (!config) return null;
    const client = new AwsClient({
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        service: 's3',
        region: 'auto',
    });
    const url = new URL(`https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}/${key}`);
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

async function getOwnedAudio(c: Context<AppEnv>, audioId: string) {
    const auth = c.get('auth') as SessionAuthContext;
    const audio = await c.env.DB.prepare(`
        SELECT id, owner_id, name, status, expected_file_size, r2_key
        FROM audio_assets WHERE id = ?
    `).bind(audioId).first<AudioRecord>();
    if (!audio) return { error: notFoundResponse('Audio not found'), audio: null };
    if (audio.owner_id !== auth.userId) {
        return { error: forbiddenResponse('Not authorized to manage this audio'), audio: null };
    }
    return { error: null, audio };
}

export const audioUploadRoutes = new Hono<AppEnv>();
audioUploadRoutes.use('*', verifySession);

audioUploadRoutes.post('/', async (c) => {
    const auth = c.get('auth');
    if (!getR2SigningConfig(c.env)) return serverErrorResponse('R2 direct-upload signing is not configured');

    const body = await c.req.json<Record<string, any>>();
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
    const sourceFilename = typeof body.sourceFilename === 'string' ? body.sourceFilename.trim().slice(0, 255) : null;
    const sourceMimeType = typeof body.sourceMimeType === 'string' ? body.sourceMimeType.toLowerCase().slice(0, 120) : null;
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType.toLowerCase() : '';
    const typeInfo = AUDIO_TYPES.get(mimeType);
    const duration = Number(body.duration);
    const sampleRate = Number(body.sampleRate);
    const channelCount = Number(body.channelCount);
    const fileSize = Number(body.fileSize);

    if (!name || !typeInfo || !Number.isFinite(duration) || duration <= 0 || duration > MAX_AUDIO_DURATION
        || !Number.isInteger(fileSize) || fileSize <= 0 || fileSize > MAX_AUDIO_BYTES
        || !Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > 384000
        || !Number.isInteger(channelCount) || channelCount <= 0 || channelCount > 32) {
        return badRequestResponse('Missing or invalid audio metadata');
    }

    const audioId = nanoid();
    const r2Key = buildAudioR2Key(audioId, typeInfo.extension);
    const playbackUrl = buildCdnUrl(r2Key);
    const uploadUrl = await createPresignedPutUrl(c.env, r2Key, mimeType);
    if (!uploadUrl) return serverErrorResponse('Unable to create R2 upload URL');

    await c.env.DB.prepare(`
        INSERT INTO audio_assets (
            id, owner_id, name, source_filename, source_mime_type,
            mime_type, format, duration, sample_rate, channel_count,
            expected_file_size, storage_provider, r2_key, playback_url,
            status, is_public
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'r2', ?, ?, 'uploading', 0)
    `).bind(
        audioId, auth.userId, name, sourceFilename, sourceMimeType,
        'audio/mp4', typeInfo.format, duration, sampleRate, channelCount,
        fileSize, r2Key, playbackUrl,
    ).run();

    return successResponse({
        audioId,
        uploadUrl,
        uploadHeaders: {
            'Content-Type': 'audio/mp4',
            'Cache-Control': 'public, max-age=31536000, immutable',
        },
        expiresIn: UPLOAD_URL_TTL_SECONDS,
    }, undefined, 201);
});

audioUploadRoutes.post('/:id/complete', async (c) => {
    const audioId = c.req.param('id');
    const access = await getOwnedAudio(c, audioId);
    if (access.error || !access.audio) return access.error;
    if (!access.audio.r2_key) return badRequestResponse('Audio has no R2 upload target');

    const object = await c.env.BUCKET.head(access.audio.r2_key);
    if (!object) return badRequestResponse('Uploaded audio was not found in R2');
    if (object.size !== Number(access.audio.expected_file_size)) {
        return badRequestResponse('Uploaded audio size does not match the encoded file', {
            expectedSize: Number(access.audio.expected_file_size),
            receivedSize: object.size,
        });
    }

    await c.env.DB.prepare(`
        UPDATE audio_assets SET file_size = ?, status = 'complete', updated_at = unixepoch()
        WHERE id = ?
    `).bind(object.size, audioId).run();
    return successResponse({ audioId, status: 'complete', fileSize: object.size });
});

audioUploadRoutes.patch('/:id', async (c) => {
    const audioId = c.req.param('id');
    const access = await getOwnedAudio(c, audioId);
    if (access.error || !access.audio) return access.error;
    const body = await c.req.json<Record<string, any>>();
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
    if (!name) return badRequestResponse('name must be a non-empty string');
    await c.env.DB.prepare(`UPDATE audio_assets SET name = ?, updated_at = unixepoch() WHERE id = ?`)
        .bind(name, audioId).run();
    return successResponse({ audioId, name });
});

audioUploadRoutes.delete('/:id', async (c) => {
    const audioId = c.req.param('id');
    const access = await getOwnedAudio(c, audioId);
    if (access.error || !access.audio) return access.error;
    if (access.audio.r2_key) await c.env.BUCKET.delete(access.audio.r2_key);
    await c.env.DB.prepare('DELETE FROM audio_assets WHERE id = ?').bind(audioId).run();
    return successResponse({ audioId }, 'Audio deleted');
});
