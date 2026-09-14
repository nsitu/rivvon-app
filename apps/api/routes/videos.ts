import { Hono } from 'hono';
import { optionalSession, verifySession } from '../middleware/session';
import type { AppEnv } from '../types/hono';
import { isAdminRequest } from '../utils/resourceAccess';
import { jsonResponse, notFoundResponse } from '../utils/response';

const VIDEO_COLUMNS = `
        v.id, v.owner_id, v.name, v.description, v.thumbnail_url,
        v.format, v.mime_type, v.width, v.height, v.duration, v.fps,
        v.file_size, v.storage_provider, v.playback_url,
        v.drive_file_id, v.status, v.is_public, v.export_settings_json,
        v.created_at, v.updated_at,
        u.name AS owner_name, u.picture AS owner_picture
`;

const VIDEO_SELECT = `
    SELECT
        ${VIDEO_COLUMNS}
    FROM video_exports v
    LEFT JOIN users u ON v.owner_id = u.id
`;

const VIDEO_DETAIL_SELECT = `
    SELECT
        ${VIDEO_COLUMNS},
        v.source_drawing_payload_json, v.render_snapshot_json
    FROM video_exports v
    LEFT JOIN users u ON v.owner_id = u.id
`;

function parseLimit(value: string | undefined, fallback = 24) {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isInteger(parsed) ? Math.min(100, Math.max(1, parsed)) : fallback;
}

function parseOffset(value: string | undefined) {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isInteger(parsed) ? Math.max(0, parsed) : 0;
}

function parseJson(value: unknown) {
    if (typeof value !== 'string' || !value) {
        return null;
    }

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function serializeVideo(row: Record<string, any>, { includeRenderSource = false } = {}) {
    let exportSettings = null;
    if (typeof row.export_settings_json === 'string' && row.export_settings_json) {
        try {
            exportSettings = JSON.parse(row.export_settings_json);
        } catch {
            exportSettings = null;
        }
    }

    const {
        export_settings_json: _ignored,
        source_drawing_payload_json: sourceDrawingPayloadJson,
        render_snapshot_json: renderSnapshotJson,
        ...video
    } = row;
    const serialized: Record<string, any> = {
        ...video,
        is_public: Boolean(row.is_public),
        export_settings: exportSettings,
    };

    if (includeRenderSource) {
        serialized.source_drawing_payload = parseJson(sourceDrawingPayloadJson);
        serialized.render_snapshot = parseJson(renderSnapshotJson);
    }

    return serialized;
}

export const videoRoutes = new Hono<AppEnv>();

videoRoutes.get('/', async (c) => {
    const limit = parseLimit(c.req.query('limit'));
    const offset = parseOffset(c.req.query('offset'));

    const [rows, count] = await Promise.all([
        c.env.DB.prepare(`${VIDEO_SELECT}
            WHERE v.status = 'complete' AND v.is_public = 1
            ORDER BY v.created_at DESC
            LIMIT ? OFFSET ?
        `).bind(limit, offset).all(),
        c.env.DB.prepare(`
            SELECT COUNT(*) AS total
            FROM video_exports
            WHERE status = 'complete' AND is_public = 1
        `).first<{ total: number | string }>(),
    ]);

    return jsonResponse({
        videos: (rows.results as Record<string, any>[]).map(serializeVideo),
        pagination: { limit, offset, total: Number(count?.total || 0) },
    });
});

videoRoutes.get('/:id', optionalSession, async (c) => {
    const videoId = c.req.param('id');
    const video = await c.env.DB.prepare(`${VIDEO_DETAIL_SELECT} WHERE v.id = ? AND v.status = 'complete'`)
        .bind(videoId)
        .first<Record<string, any>>();

    if (!video) {
        return notFoundResponse('Video not found');
    }

    const auth = c.get('auth');
    const canAccess = Boolean(video.is_public)
        || Boolean(auth && (video.owner_id === auth.userId || isAdminRequest(auth, c.env.ADMIN_USERS)));

    if (!canAccess) {
        return notFoundResponse('Video not found');
    }

    return jsonResponse({ video: serializeVideo(video, { includeRenderSource: true }) });
});

export const myVideoRoutes = new Hono<AppEnv>();

myVideoRoutes.use('*', verifySession);

myVideoRoutes.get('/', async (c) => {
    const auth = c.get('auth');
    const limit = parseLimit(c.req.query('limit'));
    const offset = parseOffset(c.req.query('offset'));

    const [rows, count] = await Promise.all([
        c.env.DB.prepare(`${VIDEO_SELECT}
            WHERE v.owner_id = ? AND v.status = 'complete'
            ORDER BY v.created_at DESC
            LIMIT ? OFFSET ?
        `).bind(auth.userId, limit, offset).all(),
        c.env.DB.prepare(`
            SELECT COUNT(*) AS total
            FROM video_exports
            WHERE owner_id = ? AND status = 'complete'
        `).bind(auth.userId).first<{ total: number | string }>(),
    ]);

    return jsonResponse({
        videos: (rows.results as Record<string, any>[]).map(serializeVideo),
        pagination: { limit, offset, total: Number(count?.total || 0) },
    });
});
