import { Hono } from 'hono';
import { verifySession } from '../middleware/session';
import type { AppEnv } from '../types/hono';
import { jsonResponse, notFoundResponse } from '../utils/response';

const AUDIO_COLUMNS = `
    a.id, a.owner_id, a.name, a.source_filename, a.source_mime_type,
    a.mime_type, a.format, a.duration, a.source_duration, a.source_trim_start,
    a.source_trim_end, a.playback_rate, a.pitch_mode, a.sample_rate, a.channel_count,
    a.file_size, a.storage_provider, a.playback_url, a.status, a.is_public,
    a.created_at, a.updated_at,
    u.name AS owner_name, u.picture AS owner_picture
`;

function parseLimit(value: string | undefined) {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isInteger(parsed) ? Math.min(100, Math.max(1, parsed)) : 24;
}

function parseOffset(value: string | undefined) {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isInteger(parsed) ? Math.max(0, parsed) : 0;
}

function serializeAudio(row: Record<string, any>) {
    return { ...row, is_public: Boolean(row.is_public) };
}

export const audioRoutes = new Hono<AppEnv>();

audioRoutes.get('/', verifySession, async (c) => {
    const auth = c.get('auth');
    const limit = parseLimit(c.req.query('limit'));
    const offset = parseOffset(c.req.query('offset'));
    const [rows, count] = await Promise.all([
        c.env.DB.prepare(`SELECT ${AUDIO_COLUMNS} FROM audio_assets a
            LEFT JOIN users u ON a.owner_id = u.id
            WHERE a.owner_id = ? AND a.status = 'complete'
            ORDER BY a.created_at DESC LIMIT ? OFFSET ?`).bind(auth.userId, limit, offset).all(),
        c.env.DB.prepare(`SELECT COUNT(*) AS total FROM audio_assets WHERE owner_id = ? AND status = 'complete'`)
            .bind(auth.userId).first<{ total: number | string }>(),
    ]);
    return jsonResponse({
        audios: (rows.results as Record<string, any>[]).map(serializeAudio),
        pagination: { limit, offset, total: Number(count?.total || 0) },
    });
});

audioRoutes.get('/:id', verifySession, async (c) => {
    const auth = c.get('auth');
    const audio = await c.env.DB.prepare(`SELECT ${AUDIO_COLUMNS} FROM audio_assets a
        LEFT JOIN users u ON a.owner_id = u.id
        WHERE a.id = ? AND a.status = 'complete' AND a.owner_id = ?`)
        .bind(c.req.param('id'), auth.userId).first<Record<string, any>>();
    if (!audio) return notFoundResponse('Audio not found');
    return jsonResponse({ audio: serializeAudio(audio) });
});
